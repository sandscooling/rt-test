import type { ChildProcess, SpawnSyncReturns } from "node:child_process";

/** How a child process ended, with everything it wrote to the streams the test piped. */
export interface ChildEnd {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Each `error` the child emitted once it had spawned, such as a `send` on a channel it had closed. */
  readonly errors: readonly string[];
}

/**
 * Collects a spawned or forked child's piped output as it arrives. `end` resolves once the child has exited and every
 * piped stream has closed, and rejects only when the child never spawned. It never waits for the child's `close`
 * event, which a parent that disconnects the IPC channel itself never receives.
 */
export class WatchedChild {
  readonly end: Promise<ChildEnd>;
  #stdout = "";
  #stderr = "";
  readonly #errors: string[] = [];
  #settled = false;

  constructor(child: ChildProcess, label: string) {
    child.stdout?.on("data", (chunk: Buffer) => {
      this.#stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr += chunk.toString("utf8");
    });
    const exited = new Promise<Pick<ChildEnd, "code" | "signal">>(
      (resolveExit) =>
        child.once("exit", (code, signal) => resolveExit({ code, signal })),
    );
    const closed = [child.stdout, child.stderr].flatMap((stream) =>
      stream === null
        ? []
        : [new Promise((resolveClose) => stream.once("close", resolveClose))],
    );
    this.end = new Promise<ChildEnd>((resolveEnd, fail) => {
      child.on("error", (error) => {
        if (child.pid === undefined) {
          fail(
            new Error(`${label} failed to start: ${error.message}`, {
              cause: error,
            }),
          );
          return;
        }
        this.#errors.push(error.message);
      });
      void Promise.all([exited, ...closed]).then(([exit]) =>
        resolveEnd({
          ...exit,
          stdout: this.#stdout,
          stderr: this.#stderr,
          errors: this.#errors,
        }),
      );
    });
    // Also marks the promise handled, so a test that goes to its assertion without awaiting it leaves no rejection.
    this.end.then(
      () => {
        this.#settled = true;
      },
      () => {
        this.#settled = true;
      },
    );
  }

  /** What the child has written to stdout so far. */
  get stdout(): string {
    return this.#stdout;
  }

  /** Whether `end` has settled. */
  get settled(): boolean {
    return this.#settled;
  }
}

const quoted = (stream: string): string => (stream === "" ? "(empty)" : stream);

/** The failure for a child that ended in a way neither the named behavior nor its defect produces. */
export function crashError(label: string, end: ChildEnd): Error {
  return new Error(
    [
      `${label} ended in a way the test does not expect: exit code ${end.code ?? "none"}, signal ${end.signal ?? "none"}`,
      ...end.errors.map((error) => `error: ${error}`),
      "stderr:",
      quoted(end.stderr),
      "stdout:",
      quoted(end.stdout),
    ].join("\n"),
  );
}

/**
 * The module URLs `test/fixtures/daemon/list-modules.mjs` printed as its child exited. Stdout that is not that list
 * means the child never reached its exit, so it is a crash.
 */
export function listedModules(label: string, end: ChildEnd): string[] {
  let listed: unknown;
  try {
    listed = JSON.parse(end.stdout);
  } catch {
    throw crashError(label, end);
  }
  const isList =
    Array.isArray(listed) && listed.every((url) => typeof url === "string");
  if (!isList) throw crashError(label, end);
  return listed as string[];
}

/** A `spawnSync` result as a child's end; a child that could not be run, or was ended by its timeout, throws. */
export function syncChildEnd(
  label: string,
  result: SpawnSyncReturns<string>,
): ChildEnd {
  const end: ChildEnd = {
    code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    errors: result.error === undefined ? [] : [result.error.message],
  };
  if (result.error !== undefined) throw crashError(label, end);
  return end;
}
