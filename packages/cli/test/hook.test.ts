import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Each answer the daemon gives in turn, in place of a real one: a response, an error to reject with, or `never` for
 * one that never comes; each call's arguments; and the user's directory each run's memory goes to.
 */
const scripted = vi.hoisted(() => ({
  never: "never" as const,
  replies: [] as unknown[],
  calls: [] as unknown[][],
  directory: undefined as string | undefined,
}));

vi.mock("@rt-test/daemon/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@rt-test/daemon/client")>();
  return {
    ...actual,
    queryChanges: (...args: Parameters<typeof actual.queryChanges>) => {
      scripted.calls.push(args);
      const reply = scripted.replies.shift();
      if (reply === scripted.never) return new Promise(() => undefined);
      if (reply instanceof Error) return Promise.reject(reply);
      return reply === undefined
        ? Promise.reject(new Error("the test scripted no answer"))
        : Promise.resolve(reply);
    },
    userDirectory: () =>
      scripted.directory === undefined
        ? actual.userDirectory()
        : { ok: true, directory: scripted.directory },
  };
});

import {
  FAILING_STATES,
  TEST_STATES,
  type ChangesOptions,
  type ChangesResponse,
  type ListedChange,
  type TestCounts,
} from "@rt-test/daemon/client";
import { inTempDir } from "../../daemon/test/harness.js";
import {
  ANSWER_ROOT,
  BUILD_NOT_ENDED,
  countsOf,
  determined,
  DROPPED_TEST,
  FAILING_CHANGE,
  NO_TESTS,
  notDetermined,
  RECOVERED_ENTRY,
  type Determined,
} from "./changes-answers.js";
import {
  BATCH,
  context,
  HARNESS,
  payloadOf,
  printed,
  PROMPT,
  runHook,
  STOP,
  TOOL_CALLS,
  type HookRun,
} from "./hook-harness.js";

const { write, edit, notebookEdit, bash } = TOOL_CALLS;
const SESSION_ID = "session-1";
const SUBAGENT = "subagent-1";
const OTHER_SUBAGENT = "subagent-2";
/** Event-loop turns a run gets to settle once its timer fired, far more than it takes. */
const SETTLE_TURNS = 50;
/** The hook's bound on a run, a target the ticket set at 2,000 ms. */
const HOOK_BOUND_MS = 2_000;
const DAY_S = 24 * 60 * 60;
const MINUTE_S = 60;

type Reply = ChangesResponse | Error | typeof scripted.never;

interface RunOptions {
  readonly agentId?: string;
  readonly toolCalls?: readonly unknown[];
  /** The command's arguments after `hook`; the harness alone by default. */
  readonly args?: readonly string[];
  /** Where the command runs; the consumer root by default. */
  readonly cwd?: string;
}

interface HookSession {
  /** The consumer root, a directory of its own. */
  readonly root: string;
  /** The user's RT Test directory the session's memory goes to. */
  readonly directory: string;
  /** A directory beside the root, outside it. */
  readonly outside: string;
  /** Runs the hook on `event` for this session, the daemon answering its queries with `replies` in turn. */
  run(
    event: string,
    replies?: readonly Reply[],
    options?: RunOptions,
  ): Promise<HookRun>;
}

/** Hands `body` a session over a fresh consumer root whose memory goes to a fresh user directory. */
function inHookSession<T>(body: (session: HookSession) => Promise<T>) {
  return inTempDir(async (dir) => {
    const root = join(dir, "consumer");
    const directory = join(dir, "user");
    const outside = join(dir, "outside");
    for (const made of [root, directory, outside]) mkdirSync(made);
    scripted.directory = directory;
    scripted.replies = [];
    scripted.calls = [];
    let lastEnded = Number.NEGATIVE_INFINITY;
    try {
      return await body({
        root,
        directory,
        outside,
        run: async (event, replies = [], options = {}) => {
          // Each hook run is a process of its own, so no two of a session's runs record a time in one millisecond.
          while (Date.now() <= lastEnded) await nextTurn();
          scripted.replies.push(...replies);
          const ended = await runHook(
            options.args ?? [HARNESS],
            options.cwd ?? root,
            payloadOf(event, {
              root,
              sessionId: SESSION_ID,
              ...(options.agentId === undefined
                ? {}
                : { agentId: options.agentId }),
              ...(options.toolCalls === undefined
                ? {}
                : { toolCalls: options.toolCalls }),
            }),
          );
          lastEnded = Date.now();
          return ended;
        },
      });
    } finally {
      scripted.directory = undefined;
    }
  });
}

/** The cursor each query so far was sent, undefined for none. */
function sinces(): (string | undefined)[] {
  return scripted.calls.map(
    ([, , options]) => (options as ChangesOptions).since,
  );
}

/** The paths each query so far asked about. */
function askedPaths(): unknown[] {
  return scripted.calls.map(([, paths]) => paths);
}

/** A determined answer to a query that gave no cursor, counting `counts` in scope. */
function withoutCursor(more: Partial<Determined> = {}): Determined {
  return determined({
    cursorUse: "none-given",
    outside: { counts: NO_TESTS, changed: null },
    ...more,
  });
}

/** Two tests in scope, one failing, both current. */
const ONE_OF_TWO_FAILING: TestCounts = {
  tests: 2,
  states: { ...NO_TESTS.states, passed: 1, failed: 1 },
  freshness: { ...NO_TESTS.freshness, current: 2 },
};

const ONE_FAILING = countsOf(1, "failed", "current");
const ONE_FAILING_LINE =
  "RT Test: of the 1 tests covering the files this session edited, 1 is failing and 0 are not current.";

/** A failing test of `src/a.test.ts` named `name`, whose first error is `reason`. */
function failingTest(name: string, reason = "boom"): ListedChange {
  return {
    kind: "failing",
    firstError: { reason, omittedCharacters: 0 },
    test: {
      workspacePath: "packages/a",
      projectName: "unit",
      modulePath: "src/a.test.ts",
      namePath: [name],
      occurrence: 0,
    },
    atCursor: { state: "passed", freshness: "current" },
    now: { state: "failed", freshness: "current" },
  };
}

function failingLine(name: string, reason = "boom"): string {
  return `  failing packages/a unit src/a.test.ts > ${name}: at your last report: passed, current; now: failed, current; first error: ${reason}`;
}

const FAILING_CHANGE_LINE =
  "  failing packages/a unit src/a.test.ts > outer > inner: at your last report: passed, current; now: failed, current; first error: boom";

function reportHead(changes: number): string {
  return `RT Test: ${changes} ${changes === 1 ? "change" : "changes"} since your last report in the tests covering the files this session edited, failures first:`;
}

/** The daemon's reason when it is stopping. */
function stopping(root: string): Error {
  return new Error(`The daemon serving ${root} is stopping.`);
}

/** The line that tells of a loss of the daemon's answer, as `stopping` gives it. */
function noAnswerLine(root: string): string {
  return `RT Test: cannot tell what changed in the tests covering the files this session edited: no answer for ${root}: The daemon serving ${root} is stopping. It says nothing more of this until the daemon answers again.`;
}

/** What the main agent's second batch prints when the daemon answers it `answer`, its first a passing baseline. */
function secondBatch(answer: ChangesResponse): Promise<unknown> {
  return inHookSession(async ({ root, run }) => {
    await run(BATCH, [withoutCursor()], {
      toolCalls: [write(join(root, "a.ts"))],
    });
    return printed(await run(BATCH, [answer], { toolCalls: [bash()] }));
  });
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function turns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await nextTurn();
}

async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < SETTLE_TURNS && !ready(); turn += 1) {
    await nextTurn();
  }
}

describe("the cursor each agent's batches ask from", () => {
  it("D3526: each batch asks from the cursor the agent's last determined answer returned", async () => {
    const sent = await inHookSession(async ({ root, run }) => {
      await run(BATCH, [withoutCursor({ cursor: "life.1" })], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      await run(BATCH, [determined({ cursor: "life.2" })], {
        toolCalls: [bash()],
      });
      await run(BATCH, [determined({ cursor: "life.3" })], {
        toolCalls: [bash()],
      });
      return sinces();
    });
    expect(sent).toStrictEqual([undefined, "life.1", "life.2"]);
  });

  it("D3527: a not-determined answer says nothing and leaves the agent's cursor as it was, so the next determined answer is the baseline that counts the failing tests", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(
          BATCH,
          [notDetermined({ cursor: "life.9", cursorUse: "none-given" })],
          { toolCalls: [write(join(root, "a.ts"))] },
        ),
        await run(
          BATCH,
          [withoutCursor({ cursor: "life.10", counts: ONE_FAILING })],
          { toolCalls: [bash()] },
        ),
        await run(
          BATCH,
          [notDetermined({ cursor: "life.11", cursorUse: "expired" })],
          { toolCalls: [bash()] },
        ),
        await run(
          BATCH,
          [
            withoutCursor({
              cursor: "life.12",
              cursorUse: "expired",
              counts: ONE_FAILING,
            }),
          ],
          { toolCalls: [bash()] },
        ),
      ];
      return {
        sent: sinces(),
        exits: runs.map((each) => each.exit),
        printed: runs.map(printed),
      };
    });
    expect(outcome).toStrictEqual({
      sent: [undefined, undefined, "life.10", "life.10"],
      exits: [0, 0, 0, 0],
      printed: [
        {},
        context(
          BATCH,
          "RT Test: no changes listed, since you have had no report yet; of the 1 tests covering the files this session edited, 1 is failing and 0 are not current.",
        ),
        {},
        context(
          BATCH,
          "RT Test: no changes listed, since your last report is older than the changes the daemon keeps; of the 1 tests covering the files this session edited, 1 is failing and 0 are not current.",
        ),
      ],
    });
  });

  it("D3528: the main agent and a subagent each ask about the session's edited files from a cursor of their own", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const file = join(root, "a.ts");
      await run(BATCH, [withoutCursor({ cursor: "main.1" })], {
        toolCalls: [write(file)],
      });
      await run(BATCH, [withoutCursor({ cursor: "sub.1" })], {
        agentId: SUBAGENT,
        toolCalls: [bash()],
      });
      await run(BATCH, [determined({ cursor: "main.2" })], {
        toolCalls: [bash()],
      });
      await run(BATCH, [determined({ cursor: "sub.2" })], {
        agentId: SUBAGENT,
        toolCalls: [bash()],
      });
      return { file, asked: askedPaths(), sent: sinces() };
    });
    expect(outcome).toStrictEqual({
      file: outcome.file,
      asked: [[outcome.file], [outcome.file], [outcome.file], [outcome.file]],
      sent: [undefined, undefined, "main.1", "sub.1"],
    });
  });

  it("D3529: a turn end and a prompt ask with no cursor, and the agent's next batch still asks from its own", async () => {
    const sent = await inHookSession(async ({ root, run }) => {
      await run(BATCH, [withoutCursor({ cursor: "main.1" })], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      await run(STOP, [withoutCursor({ cursor: "stop.1" })]);
      await run(PROMPT, [withoutCursor({ cursor: "prompt.1" })]);
      await run(BATCH, [determined({ cursor: "main.2" })], {
        toolCalls: [bash()],
      });
      return sinces();
    });
    expect(sent).toStrictEqual([undefined, undefined, undefined, "main.1"]);
  });
});

describe("the line at a turn's end and with the next prompt", () => {
  it("D3530: at a turn's end a not-determined answer tells the person why RT Test has not decided", async () => {
    const run = await inHookSession(async ({ root, run: hook }) => {
      await hook(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      return hook(STOP, [
        notDetermined({ cursor: null, cursorUse: "none-given" }),
      ]);
    });
    expect({ exit: run.exit, printed: printed(run) }).toStrictEqual({
      exit: 0,
      printed: {
        systemMessage: `RT Test: not decided for the tests covering the files this session edited, since the dependency build at this input revision has not ended: ${BUILD_NOT_ENDED}.`,
      },
    });
  });

  it("D3539: a test in scope whose freshness is stale or unknown counts as not current", async () => {
    const run = await inHookSession(async ({ root, run: hook }) => {
      await hook(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      return hook(STOP, [
        withoutCursor({
          counts: {
            tests: 3,
            states: { ...NO_TESTS.states, passed: 3 },
            freshness: { current: 1, stale: 1, unknown: 1 },
          },
        }),
      ]);
    });
    expect(printed(run)).toStrictEqual({
      systemMessage:
        "RT Test: of the 3 tests covering the files this session edited, 0 are failing and 2 are not current.",
    });
  });

  it("D3540: while every test in scope passes and is current, a baseline batch, a turn end and a prompt each say nothing", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const passing = withoutCursor({
        counts: countsOf(2, "passed", "current"),
      });
      const runs = [
        await run(BATCH, [passing], { toolCalls: [write(join(root, "a.ts"))] }),
        await run(STOP, [passing]),
        await run(PROMPT, [passing]),
      ];
      return runs.map((each) => ({ exit: each.exit, printed: printed(each) }));
    });
    expect(outcome).toStrictEqual([
      { exit: 0, printed: {} },
      { exit: 0, printed: {} },
      { exit: 0, printed: {} },
    ]);
  });

  it("D3541: a test in any failing state counts as failing, not only one that failed an assertion", async () => {
    const failingStates = TEST_STATES.filter((state) => FAILING_STATES[state]);
    const tests = failingStates.length + 1;
    const run = await inHookSession(async ({ root, run: hook }) => {
      await hook(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      return hook(STOP, [
        withoutCursor({
          counts: {
            tests,
            states: {
              ...NO_TESTS.states,
              ...Object.fromEntries(failingStates.map((state) => [state, 1])),
              passed: 1,
            },
            freshness: { ...NO_TESTS.freshness, current: tests },
          },
        }),
      ]);
    });
    expect(printed(run)).toStrictEqual({
      systemMessage: `RT Test: of the ${tests} tests covering the files this session edited, ${failingStates.length} are failing and 0 are not current.`,
    });
  });

  it("D3542: at a turn's end the line goes to the person as a system message, and with the next prompt into the agent's context", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      await run(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      const runs = [
        await run(STOP, [withoutCursor({ counts: ONE_FAILING })]),
        await run(PROMPT, [withoutCursor({ counts: ONE_FAILING })]),
      ];
      return runs.map((each) => ({ exit: each.exit, printed: printed(each) }));
    });
    expect(outcome).toStrictEqual([
      { exit: 0, printed: { systemMessage: ONE_FAILING_LINE } },
      { exit: 0, printed: context(PROMPT, ONE_FAILING_LINE) },
    ]);
  });
});

describe("the report of what changed since the agent's last one", () => {
  it("D3531: a failing change names its test's file and full name, its standing at the last report and now, and its first error", async () => {
    expect(
      await secondBatch(
        determined({ changes: [FAILING_CHANGE], counts: ONE_FAILING }),
      ),
    ).toStrictEqual(context(BATCH, `${reportHead(1)}\n${FAILING_CHANGE_LINE}`));
  });

  it("D3532: a report names at most five changes, in the answer's order, and counts the rest by kind", async () => {
    const five = ["t1", "t2", "t3", "t4", "t5"];
    const reports = [
      await secondBatch(
        determined({ changes: five.map((name) => failingTest(name)) }),
      ),
      await secondBatch(
        determined({
          changes: [
            ...five.map((name) => failingTest(name)),
            RECOVERED_ENTRY,
            DROPPED_TEST,
          ],
          omittedChanges: { failing: 0, recovered: 0, other: 1 },
        }),
      ),
    ];
    const named = five.map((name) => failingLine(name));
    expect(reports).toStrictEqual([
      context(BATCH, [reportHead(5), ...named].join("\n")),
      context(
        BATCH,
        [reportHead(8), ...named, "  and 3 more: recovered 1, other 2"].join(
          "\n",
        ),
      ),
    ]);
  });

  it("D3533: a failing change's first error is kept whole at 200 characters and cut to 200 past them", async () => {
    const whole = "x".repeat(200);
    const longer = "y".repeat(201);
    expect(
      await secondBatch(
        determined({
          changes: [failingTest("whole", whole), failingTest("longer", longer)],
        }),
      ),
    ).toStrictEqual(
      context(
        BATCH,
        [
          reportHead(2),
          failingLine("whole", whole),
          failingLine("longer", `${"y".repeat(200)} (cut)`),
        ].join("\n"),
      ),
    );
  });

  it("D3534: a report listing only a test that recovered is told, naming it", async () => {
    const recovered: ListedChange = {
      kind: "recovered",
      test: {
        workspacePath: "packages/a",
        projectName: "unit",
        modulePath: "src/a.test.ts",
        namePath: ["outer", "inner"],
        occurrence: 0,
      },
      atCursor: { state: "failed", freshness: "current" },
      now: { state: "passed", freshness: "current" },
    };
    expect(
      await secondBatch(
        determined({
          changes: [recovered],
          counts: countsOf(1, "passed", "current"),
        }),
      ),
    ).toStrictEqual(
      context(
        BATCH,
        `${reportHead(1)}\n  recovered packages/a unit src/a.test.ts > outer > inner: at your last report: failed, current; now: passed, current`,
      ),
    );
  });

  it("D3535: an answer from the agent's cursor that lists no change says nothing, even while a test in scope still fails", async () => {
    expect(
      await secondBatch(determined({ counts: ONE_FAILING })),
    ).toStrictEqual({});
  });

  it("D3536: a report counts the failing tests outside the edited files' scope on a line of its own", async () => {
    expect(
      await secondBatch(
        determined({
          changes: [FAILING_CHANGE],
          counts: ONE_FAILING,
          outside: { counts: countsOf(3, "failed", "current"), changed: 3 },
        }),
      ),
    ).toStrictEqual(
      context(
        BATCH,
        `${reportHead(1)}\n${FAILING_CHANGE_LINE}\nTests outside those files that are failing: 3`,
      ),
    );
  });

  it("D3538: a baseline for a cursor from another daemon life or one expired says why and counts the failing tests in scope", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(BATCH, [withoutCursor()], {
          toolCalls: [write(join(root, "a.ts"))],
        }),
        await run(
          BATCH,
          [
            withoutCursor({
              cursorUse: "not-issued",
              counts: ONE_OF_TWO_FAILING,
            }),
          ],
          { toolCalls: [bash()] },
        ),
        await run(
          BATCH,
          [withoutCursor({ cursorUse: "expired", counts: ONE_OF_TWO_FAILING })],
          { toolCalls: [bash()] },
        ),
      ];
      return runs.map(printed);
    });
    expect(outcome).toStrictEqual([
      {},
      context(
        BATCH,
        "RT Test: no changes listed, since your last report came from another daemon life, such as before a restart; of the 2 tests covering the files this session edited, 1 is failing and 0 are not current.",
      ),
      context(
        BATCH,
        "RT Test: no changes listed, since your last report is older than the changes the daemon keeps; of the 2 tests covering the files this session edited, 1 is failing and 0 are not current.",
      ),
    ]);
  });
});

describe("a loss of the daemon's answer", () => {
  it("D3537: the no-answer line names the root and the reason, and says nothing more will be said until an answer", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const lost = await run(BATCH, [stopping(root)], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      return { root, exit: lost.exit, printed: printed(lost) };
    });
    expect(outcome).toStrictEqual({
      root: outcome.root,
      exit: 1,
      printed: context(BATCH, noAnswerLine(outcome.root)),
    });
  });

  it("D3543: an agent is told of a loss once, and its later batches during the loss say nothing and exit 1", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(BATCH, [stopping(root)], {
          toolCalls: [write(join(root, "a.ts"))],
        }),
        await run(BATCH, [stopping(root)], { toolCalls: [bash()] }),
      ];
      return {
        root,
        runs: runs.map((each) => ({ exit: each.exit, printed: printed(each) })),
      };
    });
    expect(outcome.runs).toStrictEqual([
      { exit: 1, printed: context(BATCH, noAnswerLine(outcome.root)) },
      { exit: 1, printed: {} },
    ]);
  });

  it("D3544: once an answer arrives, the next loss is told again", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(BATCH, [stopping(root)], {
          toolCalls: [write(join(root, "a.ts"))],
        }),
        await run(BATCH, [withoutCursor()], { toolCalls: [bash()] }),
        await run(BATCH, [stopping(root)], { toolCalls: [bash()] }),
      ];
      return { root, printed: runs.map(printed) };
    });
    expect(outcome.printed).toStrictEqual([
      context(BATCH, noAnswerLine(outcome.root)),
      {},
      context(BATCH, noAnswerLine(outcome.root)),
    ]);
  });

  it("D3545: the person is told of a loss once, at the first turn end that meets it, though the agent was already told", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(BATCH, [stopping(root)], {
          toolCalls: [write(join(root, "a.ts"))],
        }),
        await run(STOP, [stopping(root)]),
        await run(STOP, [stopping(root)]),
      ];
      return { root, printed: runs.map(printed) };
    });
    expect(outcome.printed).toStrictEqual([
      context(BATCH, noAnswerLine(outcome.root)),
      { systemMessage: noAnswerLine(outcome.root) },
      {},
    ]);
  });

  it("D3546: a loss told to the main agent with a prompt is not told again at its next batch", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(BATCH, [withoutCursor()], {
          toolCalls: [write(join(root, "a.ts"))],
        }),
        await run(PROMPT, [stopping(root)]),
        await run(BATCH, [stopping(root)], { toolCalls: [bash()] }),
      ];
      return { root, printed: runs.map(printed) };
    });
    expect(outcome.printed).toStrictEqual([
      {},
      context(PROMPT, noAnswerLine(outcome.root)),
      {},
    ]);
  });

  it("D3547: a subagent is told of a loss once itself, though the main agent was already told", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const runs = [
        await run(BATCH, [stopping(root)], {
          toolCalls: [write(join(root, "a.ts"))],
        }),
        await run(BATCH, [stopping(root)], {
          agentId: SUBAGENT,
          toolCalls: [bash()],
        }),
        await run(BATCH, [stopping(root)], {
          agentId: SUBAGENT,
          toolCalls: [bash()],
        }),
      ];
      return { root, printed: runs.map(printed) };
    });
    expect(outcome.printed).toStrictEqual([
      context(BATCH, noAnswerLine(outcome.root)),
      context(BATCH, noAnswerLine(outcome.root)),
      {},
    ]);
  });

  it("D3548: a request refused while a remembered file has since vanished is asked again without it and answered, and that file leaves the agent's memory", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const kept = join(root, "a.ts");
      const vanished = join(root, "b.ts");
      writeFileSync(kept, "");
      writeFileSync(vanished, "");
      await run(BATCH, [withoutCursor()], {
        toolCalls: [write(kept), write(vanished)],
      });
      rmSync(vanished);
      const retried = await run(
        BATCH,
        [
          new Error(`${vanished} names nothing that exists`),
          determined({ changes: [FAILING_CHANGE], counts: ONE_FAILING }),
        ],
        { toolCalls: [bash()] },
      );
      await run(BATCH, [determined()], { toolCalls: [bash()] });
      return { kept, vanished, exit: retried.exit, asked: askedPaths() };
    });
    expect(outcome).toStrictEqual({
      kept: outcome.kept,
      vanished: outcome.vanished,
      exit: 0,
      asked: [
        [outcome.kept, outcome.vanished],
        [outcome.kept, outcome.vanished],
        [outcome.kept],
        [outcome.kept],
      ],
    });
  });

  it("D3549: when the retry without a vanished file gets no answer either, the first reason is told and no file is dropped", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const kept = join(root, "a.ts");
      const vanished = join(root, "b.ts");
      writeFileSync(kept, "");
      writeFileSync(vanished, "");
      await run(BATCH, [withoutCursor()], {
        toolCalls: [write(kept), write(vanished)],
      });
      rmSync(vanished);
      const lost = await run(
        BATCH,
        [stopping(root), new Error("a second reason")],
        { toolCalls: [bash()] },
      );
      await run(BATCH, [determined()], { toolCalls: [bash()] });
      return {
        root,
        kept,
        vanished,
        printed: printed(lost),
        lastAsked: askedPaths().at(-1),
      };
    });
    expect(outcome).toStrictEqual({
      root: outcome.root,
      kept: outcome.kept,
      vanished: outcome.vanished,
      printed: context(BATCH, noAnswerLine(outcome.root)),
      lastAsked: [outcome.kept, outcome.vanished],
    });
  });

  it("D3550: the hook gives the daemon's query a bound that ends within its own", async () => {
    const options = await inHookSession(async ({ root, run }) => {
      await run(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      return scripted.calls[0]?.[2] as ChangesOptions;
    });
    expect({
      keys: Object.keys(options),
      within:
        options.boundMs !== undefined &&
        options.boundMs > 0 &&
        options.boundMs < HOOK_BOUND_MS,
    }).toStrictEqual({ keys: ["boundMs"], within: true });
  });
});

describe("a run's bound and its exit", () => {
  it("D3551: a run whose payload never ends is still running just before 2,000 ms, and at 2,000 ms prints {} and exits 1 with its reason on stderr", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let ended: HookRun | undefined;
      void runHook([HARNESS], ANSWER_ROOT, undefined).then((run) => {
        ended = run;
      });
      await vi.advanceTimersByTimeAsync(HOOK_BOUND_MS - 1);
      await turns(SETTLE_TURNS);
      const before = ended;
      await vi.advanceTimersByTimeAsync(1);
      await until(() => ended !== undefined);
      const after: HookRun | undefined = ended;
      expect({
        before,
        after:
          after === undefined
            ? "still running"
            : {
                exit: after.exit,
                stdout: after.stdout,
                why: after.stderr !== "",
              },
      }).toStrictEqual({
        before: undefined,
        after: { exit: 1, stdout: "{}\n", why: true },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("D3552: arguments the hook cannot parse print {} and exit 1 with the reason on stderr, never 2, and ask nothing", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const cases = [
        [],
        ["cursor"],
        [HARNESS, "--bogus"],
        [HARNESS, "--root", ""],
        [HARNESS, HARNESS],
      ];
      const runs = [];
      for (const args of cases) {
        const each = await run(BATCH, [withoutCursor()], {
          args,
          toolCalls: [write(join(root, "a.ts"))],
        });
        runs.push({
          exit: each.exit,
          stdout: each.stdout,
          why: each.stderr !== "",
        });
      }
      return { runs, asked: scripted.calls.length };
    });
    const refused = { exit: 1, stdout: "{}\n", why: true };
    expect(outcome).toStrictEqual({
      runs: [refused, refused, refused, refused, refused],
      asked: 0,
    });
  });

  it("D3553: an event the hook does not answer prints {}, exits 0 and asks nothing", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      await run(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      const other = await run("SessionStart", [
        withoutCursor({ counts: ONE_FAILING }),
      ]);
      return {
        exit: other.exit,
        stdout: other.stdout,
        asked: scripted.calls.length,
      };
    });
    expect(outcome).toStrictEqual({ exit: 0, stdout: "{}\n", asked: 1 });
  });

  it("D3559: the root is --root resolved against the directory the hook runs in, or that directory itself without it", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      await run(BATCH, [withoutCursor()], {
        args: [HARNESS, "--root", "consumer"],
        cwd: dirname(root),
        toolCalls: [write(join(root, "a.ts"))],
      });
      await run(BATCH, [determined()], { toolCalls: [bash()] });
      return { root, roots: scripted.calls.map(([asked]) => asked) };
    });
    expect(outcome.roots).toStrictEqual([outcome.root, outcome.root]);
  });
});

describe("the files a session edited", () => {
  it("D3554: a batch adds each Write, Edit and NotebookEdit file under the root, and neither a file outside it nor a Bash call", async () => {
    const outcome = await inHookSession(async ({ root, outside, run }) => {
      const inside = [
        join(root, "a.ts"),
        join(root, "b.ts"),
        join(root, "c.ipynb"),
      ];
      await run(BATCH, [withoutCursor()], {
        toolCalls: [
          write(inside[0] ?? ""),
          edit(inside[1] ?? ""),
          notebookEdit(inside[2] ?? ""),
          write(join(outside, "x.ts")),
          bash(),
        ],
      });
      return { inside, asked: askedPaths() };
    });
    expect(outcome.asked).toStrictEqual([outcome.inside]);
  });

  it("D3555: a session that has edited no file asks nothing and says nothing on a batch, a turn end or a prompt", async () => {
    const outcome = await inHookSession(async ({ run }) => {
      const runs = [
        await run(BATCH, [withoutCursor({ counts: ONE_FAILING })], {
          toolCalls: [bash()],
        }),
        await run(STOP, [withoutCursor({ counts: ONE_FAILING })]),
        await run(PROMPT, [withoutCursor({ counts: ONE_FAILING })]),
      ];
      return {
        runs: runs.map((each) => ({ exit: each.exit, stdout: each.stdout })),
        asked: scripted.calls.length,
      };
    });
    expect(outcome).toStrictEqual({
      runs: [
        { exit: 0, stdout: "{}\n" },
        { exit: 0, stdout: "{}\n" },
        { exit: 0, stdout: "{}\n" },
      ],
      asked: 0,
    });
  });

  it("D3556: a batch the deadline ends before the daemon answers still remembers the files it edited", async () => {
    const outcome = await inHookSession(async ({ root, run }) => {
      const file = join(root, "a.ts");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const first = await (async () => {
        try {
          const pending = run(BATCH, [scripted.never], {
            toolCalls: [write(file)],
          });
          await until(() => scripted.calls.length === 1);
          await vi.advanceTimersByTimeAsync(HOOK_BOUND_MS);
          return await pending;
        } finally {
          vi.useRealTimers();
        }
      })();
      await run(BATCH, [withoutCursor()], { toolCalls: [bash()] });
      return {
        file,
        first: { exit: first.exit, stdout: first.stdout },
        asked: askedPaths(),
      };
    });
    expect(outcome).toStrictEqual({
      file: outcome.file,
      first: { exit: 1, stdout: "{}\n" },
      asked: [[outcome.file], [outcome.file]],
    });
  });
});

describe("the session's memory", () => {
  it("D3557: a memory file that cannot be parsed counts as none, with the reason on stderr, and the run still ends 0", async () => {
    const outcome = await inHookSession(async ({ root, directory, run }) => {
      await run(BATCH, [withoutCursor()], {
        toolCalls: [write(join(root, "a.ts"))],
      });
      for (const name of readdirSync(directory)) {
        writeFileSync(join(directory, name), "{not json");
      }
      const next = await run(BATCH, [withoutCursor()], {
        toolCalls: [bash()],
      });
      return {
        exit: next.exit,
        stdout: next.stdout,
        why: next.stderr.includes("cannot be read, so it counts as none"),
        asked: scripted.calls.length,
      };
    });
    expect(outcome).toStrictEqual({
      exit: 0,
      stdout: "{}\n",
      why: true,
      asked: 1,
    });
  });

  it("D3558: an agent's memory untouched for over 7 days is read as none and removed when a run creates a file, and one just under 7 days stays", async () => {
    const outcome = await inHookSession(async ({ root, directory, run }) => {
      const [old, recent, current] = ["a.ts", "b.ts", "c.ts"].map((name) =>
        join(root, name),
      );
      await run(BATCH, [withoutCursor()], { toolCalls: [write(old ?? "")] });
      const [mainFile = ""] = readdirSync(directory);
      await run(BATCH, [withoutCursor()], {
        agentId: SUBAGENT,
        toolCalls: [write(recent ?? "")],
      });
      const [subagentFile = ""] = readdirSync(directory).filter(
        (name) => name !== mainFile,
      );
      const now = Date.now() / 1000;
      const expiredAt = now - 7 * DAY_S - MINUTE_S;
      const keptAt = now - 7 * DAY_S + MINUTE_S;
      utimesSync(join(directory, mainFile), expiredAt, expiredAt);
      utimesSync(join(directory, subagentFile), keptAt, keptAt);
      await run(BATCH, [withoutCursor()], {
        agentId: OTHER_SUBAGENT,
        toolCalls: [write(current ?? "")],
      });
      return {
        expected: [current, recent].sort(),
        asked: [...(askedPaths().at(-1) as string[])].sort(),
        mainKept: existsSync(join(directory, mainFile)),
        subagentKept: existsSync(join(directory, subagentFile)),
      };
    });
    expect(outcome).toStrictEqual({
      expected: outcome.expected,
      asked: outcome.expected,
      mainKept: false,
      subagentKept: true,
    });
  });
});
