import { statSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  errorText,
  queryChanges,
  resolveCallerPath,
  userDirectory,
  type ChangesOptions,
  type ChangesResponse,
} from "@rt-test/daemon/client";
import {
  absolutePath,
  nonEmptyPath,
  UsageError,
  type CliIo,
  type Command,
  type CommandRun,
} from "../command.js";
import { batchEdits } from "../hook-edits.js";
import {
  agentWriter,
  PROMPTS_WRITER,
  SessionMemory,
  TURN_ENDS_WRITER,
  withEdits,
  withoutPaths,
  type Writer,
  type WriterMemory,
} from "../hook-memory.js";
import {
  batchText,
  noAnswerLine,
  standingLine,
  type AskedPaths,
} from "../hook-report.js";
import { EXIT_FAILURE, EXIT_SUCCESS, type ExitCode } from "../output.js";

const NAME = "hook";
const HARNESS = "claude-code";
/**
 * A target: the longest a run may take from reading its payload. A `PostToolBatch` hook holds the agent's next model
 * request until it ends, so this is what an unresponsive daemon costs each batch.
 */
const HOOK_BOUND_MS = 2_000;
/** Kept back from the daemon's query for writing the memory and printing. */
const WRITE_RESERVE_MS = 250;
const OPTIONS = { root: { type: "string" } } as const;
const EVENT = {
  postToolBatch: "PostToolBatch",
  stop: "Stop",
  userPromptSubmit: "UserPromptSubmit",
} as const;
const NOTHING = {};
/** A turn end or a prompt edits no file, so its request names none as edited. */
const NONE_EDITED: readonly string[] = [];
const UTF8 = "utf8";

interface Payload {
  readonly sessionId: string;
  readonly event: string;
  /** Absent for the main agent. */
  readonly agentId?: string;
  readonly toolCalls: readonly unknown[];
}

interface HookResult {
  /** The one JSON object Claude Code reads. */
  readonly output: object;
  readonly exitCode: ExitCode;
  /** Written to stderr. */
  readonly problems: readonly string[];
}

interface HookRun {
  readonly root: string;
  readonly cwd: string;
  readonly payload: Payload;
  readonly memory: SessionMemory;
  /** A `Date.now()` time. */
  readonly deadline: number;
}

type Asked =
  | { readonly kind: "nothing" }
  | {
      readonly kind: "answer";
      readonly answer: ChangesResponse;
      readonly paths: AskedPaths;
      /** The paths the daemon answered without, after refusing a request that named them. */
      readonly unusable: readonly string[];
    }
  | { readonly kind: "none"; readonly reason: string };

type Attempt =
  | { readonly ok: true; readonly answer: ChangesResponse }
  | { readonly ok: false; readonly reason: string };

export const hookCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} ${HARNESS} [--root <dir>]`,
  /** Never throws, since `main` exits 2 on a usage error, which Claude Code reads as blocking. */
  parse(args) {
    let rootArgument: string | undefined;
    try {
      rootArgument = hookRoot(args);
    } catch (error) {
      return refusedRun(`Cannot run rt-test ${NAME}: ${errorText(error)}`);
    }
    return (io) => boundedRun(io, rootArgument);
  },
};

function hookRoot(args: string[]): string | undefined {
  const { values, positionals } = parseArgs({
    args,
    options: OPTIONS,
    strict: true,
    allowPositionals: true,
  });
  if (positionals.length !== 1 || positionals[0] !== HARNESS) {
    throw new UsageError(
      `expected the harness ${HARNESS}, not ${positionals.length === 0 ? "none" : positionals.join(" ")}`,
    );
  }
  return nonEmptyPath(values.root, "--root");
}

function refusedRun(reason: string): CommandRun {
  return (io) => {
    io.stderr.write(`${reason}\n`);
    io.stdout.write(`${JSON.stringify(NOTHING)}\n`);
    return Promise.resolve(EXIT_FAILURE);
  };
}

/** Prints the run's one JSON object, once. */
class Printer {
  readonly #io: CliIo;
  #written: Promise<void> | undefined;

  constructor(io: CliIo) {
    this.#io = io;
  }

  /** True when this call printed `value`; false when an object was already printed. */
  print(value: object): boolean {
    if (this.#written !== undefined) return false;
    this.#written = written(this.#io.stdout, `${JSON.stringify(value)}\n`);
    return true;
  }

  /** Resolves once stdout has taken the printed object, at once when none was printed. */
  flushed(): Promise<void> {
    return this.#written ?? Promise.resolve();
  }
}

function written(stream: NodeJS.WritableStream, text: string): Promise<void> {
  return new Promise((taken) => {
    stream.write(text, () => taken());
  });
}

/**
 * Ends by `HOOK_BOUND_MS` whatever the work does: at the deadline it prints `{}` unless it already printed, and ends
 * the process when the caller gave a way to.
 */
async function boundedRun(
  io: CliIo,
  rootArgument: string | undefined,
): Promise<ExitCode> {
  const deadline = Date.now() + HOOK_BOUND_MS;
  const printer = new Printer(io);
  const stdin = readAll(io.stdin);
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<ExitCode>((expire) => {
    timer = setTimeout(() => {
      stdin.release();
      const saidNothing = printer.print(NOTHING);
      const note = written(
        io.stderr,
        `rt-test ${NAME} did not end within ${HOOK_BOUND_MS} ms${saidNothing ? ", so it said nothing" : ""}.\n`,
      );
      void Promise.all([note, printer.flushed()]).then(() =>
        io.exit?.(EXIT_FAILURE),
      );
      expire(EXIT_FAILURE);
    }, HOOK_BOUND_MS);
  });
  const work = hookRun(io, rootArgument, deadline, stdin.text).then(
    (result): ExitCode => {
      for (const problem of result.problems) io.stderr.write(`${problem}\n`);
      printer.print(result.output);
      return result.exitCode;
    },
    (error: unknown): ExitCode => {
      io.stderr.write(`rt-test ${NAME} failed: ${errorText(error)}\n`);
      printer.print(NOTHING);
      return EXIT_FAILURE;
    },
  );
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function readAll(stream: NodeJS.ReadableStream): {
  readonly text: Promise<string>;
  release(): void;
} {
  const chunks: Buffer[] = [];
  const text = new Promise<string>((resolveText, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.once("end", () => resolveText(Buffer.concat(chunks).toString(UTF8)));
    stream.once("error", reject);
  });
  return {
    text,
    release: () => {
      stream.pause();
      (stream as { destroy?: () => void }).destroy?.();
    },
  };
}

async function hookRun(
  io: CliIo,
  rootArgument: string | undefined,
  deadline: number,
  text: Promise<string>,
): Promise<HookResult> {
  const payload = payloadOf(await text);
  if (typeof payload === "string") {
    return failed(`Cannot read the hook's payload: ${payload}.`);
  }
  const handler = HANDLERS.get(payload.event);
  if (handler === undefined) return said(NOTHING);
  const directory = userDirectory();
  if (!directory.ok) {
    return failed(
      `Cannot use the user's RT Test directory: ${directory.reason}.`,
    );
  }
  const root = absolutePath(io, rootArgument);
  const memory = SessionMemory.read(
    directory.directory,
    payload.sessionId,
    root,
    Date.now(),
  );
  const result = await handler({
    root,
    cwd: io.cwd,
    payload,
    memory,
    deadline,
  });
  return { ...result, problems: [...memory.problems, ...result.problems] };
}

const HANDLERS: ReadonlyMap<string, (run: HookRun) => Promise<HookResult>> =
  new Map([
    [EVENT.postToolBatch, onBatch],
    [
      EVENT.stop,
      (run: HookRun) =>
        onStanding(run, TURN_ENDS_WRITER, (line) => ({ systemMessage: line })),
    ],
    [
      EVENT.userPromptSubmit,
      (run: HookRun) =>
        onStanding(run, PROMPTS_WRITER, (line) =>
          addedContext(EVENT.userPromptSubmit, line),
        ),
    ],
  ]);

/**
 * Remembers the batch's edited files for its agent before asking, so a run the deadline ends still keeps them, and
 * tells the agent what changed since its own last report. A path the retry found unusable leaves only this agent's
 * memory, since each other file has its own writer.
 */
async function onBatch(run: HookRun): Promise<HookResult> {
  const { memory, payload } = run;
  const agent = agentWriter(payload.agentId);
  const edits = batchEdits(payload.toolCalls, run.cwd, run.root);
  const remembered =
    edits.named.length === 0
      ? said(NOTHING)
      : saved(
          run,
          agent,
          said(NOTHING),
          withEdits(memory.of(agent), edits.named, Date.now()),
        );
  const asked = await askSession(run, memory.of(agent).cursor, edits.saved);
  if (asked.kind === "nothing") return remembered;
  if (asked.kind === "answer") {
    const text = batchText(asked.answer, asked.paths);
    const answered = withAnswer(
      withoutPaths(memory.of(agent), asked.unusable),
      asked.answer,
      Date.now(),
    );
    return alongside(
      remembered,
      saved(
        run,
        agent,
        said(
          text === undefined
            ? NOTHING
            : addedContext(EVENT.postToolBatch, text),
        ),
        answered,
      ),
    );
  }
  const loss = lossResult(run, agent, asked.reason, (line) =>
    addedContext(EVENT.postToolBatch, line),
  );
  return alongside(remembered, loss);
}

/**
 * Says whether the tests covering the session's edited files are failing or not current, asked afresh with no
 * cursor; it moves no agent's cursor and drops no remembered path.
 */
async function onStanding(
  run: HookRun,
  writer: Writer,
  shape: (line: string) => object,
): Promise<HookResult> {
  const asked = await askSession(run, undefined, NONE_EDITED);
  if (asked.kind === "nothing") return said(NOTHING);
  if (asked.kind === "answer") {
    const line = standingLine(asked.answer);
    return saved(
      run,
      writer,
      said(line === undefined ? NOTHING : shape(line)),
      {
        ...run.memory.of(writer),
        answeredAt: Date.now(),
      },
    );
  }
  return lossResult(run, writer, asked.reason, shape);
}

/** The no-answer line when the writer has not yet told of this loss, which it then records. */
function lossResult(
  run: HookRun,
  writer: Writer,
  reason: string,
  shape: (line: string) => object,
): HookResult {
  const problem = `No answer from the daemon: ${reason}`;
  if (run.memory.toldLoss(writer)) return failed(problem);
  return saved(
    run,
    writer,
    {
      output: shape(noAnswerLine(run.root, reason)),
      exitCode: EXIT_FAILURE,
      problems: [problem],
    },
    { ...run.memory.of(writer), toldLossAt: Date.now() },
  );
}

/**
 * Asks about the session's edited files, naming as edited each of the `batch`'s own files a request sends. When the
 * daemon gives no answer and some of them no longer name an existing file under the root, asks once more without
 * those, which the daemon may refuse the whole request for; they count as unusable only when that answer came. With no
 * answer, the first attempt's reason stands.
 */
async function askSession(
  run: HookRun,
  since: string | undefined,
  batch: readonly string[],
): Promise<Asked> {
  const { paths, leftOut } = run.memory.editedPaths();
  if (paths.length === 0) return { kind: "nothing" };
  const first = await attempt(run, paths, since, batch);
  if (first.ok) {
    return answered(first.answer, { asked: paths.length, leftOut }, []);
  }
  const none: Asked = { kind: "none", reason: first.reason };
  const unusable = new Set(paths.filter((path) => !usableFile(path, run.root)));
  const rest = paths.filter((path) => !unusable.has(path));
  if (unusable.size === 0 || rest.length === 0) return none;
  const second = await attempt(run, rest, since, batch);
  return second.ok
    ? answered(second.answer, { asked: rest.length, leftOut }, [...unusable])
    : none;
}

function answered(
  answer: ChangesResponse,
  paths: AskedPaths,
  unusable: readonly string[],
): Asked {
  return { kind: "answer", answer, paths, unusable };
}

/**
 * The daemon's answer within what is left of the deadline, less the reserve for writing and printing; `batch` holds
 * the files the batch being reported edited.
 */
async function attempt(
  run: HookRun,
  paths: readonly string[],
  since: string | undefined,
  batch: readonly string[],
): Promise<Attempt> {
  const boundMs = run.deadline - WRITE_RESERVE_MS - Date.now();
  if (boundMs <= 0) {
    return {
      ok: false,
      reason: `no time was left of the hook's ${HOOK_BOUND_MS} ms to ask the daemon`,
    };
  }
  const batchFiles = new Set(batch);
  const edited = paths.filter((path) => batchFiles.has(path));
  const options: ChangesOptions = {
    ...(since === undefined ? {} : { since }),
    boundMs,
    ...(edited.length === 0 ? {} : { edited }),
  };
  try {
    return { ok: true, answer: await queryChanges(run.root, paths, options) };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

/** A path the daemon cannot refuse: an existing file whose real path lies under the root's. */
function usableFile(path: string, root: string): boolean {
  try {
    return statSync(path).isFile() && resolveCallerPath(path, root).ok;
  } catch {
    return false;
  }
}

/**
 * Only a determined answer moves the cursor. A not-determined one hands back the agent's own cursor when it is usable,
 * and otherwise the daemon's latest, which would turn the next answer's baseline, and its counts of failing tests,
 * into a list of changes since then.
 */
function withAnswer(
  memory: WriterMemory,
  answer: ChangesResponse,
  now: number,
): WriterMemory {
  const { toldLossAt } = memory;
  const cursor = answer.determined ? answer.cursor : memory.cursor;
  return {
    paths: memory.paths,
    ...(cursor === null || cursor === undefined ? {} : { cursor }),
    ...(toldLossAt === undefined ? {} : { toldLossAt }),
    answeredAt: now,
  };
}

function payloadOf(text: string): Payload | string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return errorText(error);
  }
  if (typeof value !== "object" || value === null) {
    return "it is not a JSON object";
  }
  const fields = value as Record<string, unknown>;
  const {
    session_id: sessionId,
    hook_event_name: event,
    agent_id: agentId,
    tool_calls: toolCalls,
  } = fields;
  if (typeof sessionId !== "string" || sessionId === "") {
    return "it names no session_id";
  }
  if (typeof event !== "string") return "it names no hook_event_name";
  if (agentId !== undefined && typeof agentId !== "string") {
    return "its agent_id is not a string";
  }
  return {
    sessionId,
    event,
    ...(agentId === undefined ? {} : { agentId }),
    toolCalls: Array.isArray(toolCalls) ? toolCalls : [],
  };
}

/** Remembers and writes the writer's `memory`; a failure to write turns the result into a failure, keeping what it says. */
function saved(
  run: HookRun,
  writer: Writer,
  result: HookResult,
  memory: WriterMemory,
): HookResult {
  run.memory.set(writer, memory);
  try {
    const problems = run.memory.save(writer, Date.now());
    return { ...result, problems: [...result.problems, ...problems] };
  } catch (error) {
    return {
      ...result,
      exitCode: EXIT_FAILURE,
      problems: [...result.problems, errorText(error)],
    };
  }
}

/** `later`'s output, failing when either failed, with both results' problems. */
function alongside(earlier: HookResult, later: HookResult): HookResult {
  return {
    output: later.output,
    exitCode:
      earlier.exitCode === EXIT_SUCCESS ? later.exitCode : earlier.exitCode,
    problems: [...earlier.problems, ...later.problems],
  };
}

function addedContext(hookEventName: string, text: string): object {
  return { hookSpecificOutput: { hookEventName, additionalContext: text } };
}

function said(output: object): HookResult {
  return { output, exitCode: EXIT_SUCCESS, problems: [] };
}

function failed(problem: string): HookResult {
  return { output: NOTHING, exitCode: EXIT_FAILURE, problems: [problem] };
}
