import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { PROGRESS_MARKER } from "../../../scripts/lib/defects/progress-reporter.mjs";
import { endsWithin, holdsWithin } from "../processes.js";
import {
  childProcessesOf,
  endOwnedProcesses,
  endRecorded,
  recordsInside,
  type ProcessRecord,
} from "../run-cleanup.mjs";
import { PROCESS_SCENARIO } from "../timeouts.js";
import {
  collected,
  progress,
  runStandIn,
  withScratch,
  type StandInRun,
  type StandInScript,
} from "./harness.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn<typeof actual.spawn>(actual.spawn) };
});

vi.mock("../run-cleanup.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../run-cleanup.mjs")>();
  return {
    ...actual,
    childProcessesOf: vi.fn<typeof actual.childProcessesOf>(
      actual.childProcessesOf,
    ),
    endRecorded: vi.fn<typeof actual.endRecorded>(actual.endRecorded),
  };
});

const STALL_WINDOW_MS = 2000;

/** Hands the next spawned process to `alter` before the runner gets it. */
async function onNextSpawn(
  alter: (child: ChildProcess) => void,
): Promise<void> {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  vi.mocked(spawn).mockImplementationOnce(((
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => {
    const child = actual.spawn(command, args, options);
    alter(child);
    return child;
  }) as typeof spawn);
}

/**
 * Makes the next spawned process ignore every signal short of SIGKILL, as a Linux Vitest stuck in native code does;
 * a Windows process cannot ignore one. Records each signal sent, and returns a kill that always lands.
 */
async function nextSpawnIgnoresSigterm(signals: string[]): Promise<() => void> {
  let kill = (): void => undefined;
  await onNextSpawn((child) => {
    const deliver = child.kill.bind(child);
    kill = () => void deliver("SIGKILL");
    child.kill = (signal?: NodeJS.Signals | number) => {
      signals.push(String(signal ?? "SIGTERM"));
      return signal === "SIGKILL" && deliver(signal);
    };
  });
  return () => kill();
}

/** Makes the next spawned process be killed outright once it has written to stdout, so it closes on a signal. */
function nextSpawnKilledAfterOutput(): Promise<void> {
  return onNextSpawn((child) => {
    child.stdout?.once("data", () => child.kill("SIGKILL"));
  });
}

/** Long enough that a run killed on its first output is never stopped as stalled first. */
const UNSTALLED_WINDOW_MS = 30_000;

/** A millisecond short of the runner's 10 s kill grace. */
const JUST_UNDER_KILL_GRACE_MS = 9_999;

/**
 * Runs a hung stand-in under fake timers until the runner stops it, lets `afterStop` move the clock, and returns the
 * signals sent by then; the stand-in is killed outright afterwards.
 */
async function signalsAfterStall(
  signals: readonly string[],
  killNow: () => void,
  afterStop: () => Promise<unknown>,
): Promise<string[]> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return withScratch(async (dir) => {
    const { outcome } = runStandIn(dir, {}, STALL_WINDOW_MS);
    try {
      await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS);
      await afterStop();
      return [...signals];
    } finally {
      vi.useRealTimers();
      killNow();
      await outcome;
    }
  });
}

const JUST_UNDER_STALL_WINDOW_MS = STALL_WINDOW_MS - 1;
/** How many idle windows a run that keeps reporting progress is watched across. */
const LIVE_WINDOWS = 5;
/** How long one wait on a spawned process may last on a loaded machine before the test fails naming the wait. */
const TAP_WAIT_MS = 20_000;
/** How long an ended process may take to go on a loaded machine. */
const STOP_WAIT_MS = 15_000;
/** How long a process that must be spared is watched for an end that should never come. */
const SPARE_WAIT_MS = 2000;
/** How long a stopped run may take to fail on a loaded machine, kept under the test's budget. */
const SETTLE_WAIT_MS = 10_000;

const startedCalc = progress({
  event: "started",
  test: "calc > D1",
  timeout: 5000,
});

/** What a spawned process has written and whether it has exited, each as the runner has already handled it. */
interface Tap {
  /** Each whole line of its stdout so far. */
  readonly lines: readonly string[];
  readonly stderr: () => string;
  readonly exited: () => boolean;
  /** Kills it outright; a process that has exited is left alone. */
  readonly kill: () => void;
}

/** Its listeners run in the same emit as the runner's, so a test reads nothing here the runner has not handled. */
function tapOf(child: ChildProcess): Tap {
  const lines: string[] = [];
  let unfinished = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: string) => {
    const parts = `${unfinished}${chunk}`.split("\n");
    unfinished = parts.pop() ?? "";
    lines.push(...parts);
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return {
    lines,
    stderr: () => stderr,
    exited: () => child.exitCode !== null || child.signalCode !== null,
    kill: () => void child.kill("SIGKILL"),
  };
}

/** Taps the next spawned process, and returns the tap, which exists once the runner has spawned. */
async function nextSpawnTapped(): Promise<() => Tap> {
  let tap: Tap | undefined;
  await onNextSpawn((child) => {
    tap = tapOf(child);
  });
  return () => {
    if (tap === undefined) throw new Error("the runner has spawned no process");
    return tap;
  };
}

/** Waits until `ready` holds of a tapped process, and throws naming `what` it had not done when it never does. */
async function seen(ready: () => boolean, what: string): Promise<void> {
  if (await holdsWithin(ready, TAP_WAIT_MS)) return;
  throw new Error(
    `the spawned process had not ${what} within ${TAP_WAIT_MS} ms`,
  );
}

/** Waits for the runner to read a line the process writes from now on, or for the process to exit. */
function nextLine(tap: Tap): Promise<void> {
  const read = tap.lines.length;
  return seen(
    () => tap.lines.length > read || tap.exited(),
    "written another line",
  );
}

const reportedStart = (tap: Tap) =>
  seen(() => tap.lines.includes(startedCalc), "reported its test's start");

/** Runs `body`, then `cleanUp`: a cleanup failure fails a body that passed, and is only logged behind one that failed. */
async function withCleanup<T>(
  body: () => Promise<T>,
  cleanUp: () => Promise<void>,
): Promise<T> {
  const result = await body().catch(async (error: unknown) => {
    await cleanUp().catch((cleanup: unknown) => {
      console.error(`after the failure below, ${String(cleanup)}`);
    });
    throw error;
  });
  await cleanUp();
  return result;
}

/**
 * Runs the stand-in under the runner with the runner's timers on a clock only `body` moves, so the runner finds no
 * stall until `body` has read off the tap what its claim needs. Afterwards, on the real clock again, kills the
 * stand-in outright, ends the children it recorded, and awaits the run.
 */
async function onHeldClock<T>(
  script: StandInScript,
  body: (run: StandInRun, tap: Tap, dir: string) => Promise<T>,
): Promise<T> {
  const tapped = await nextSpawnTapped();
  return withScratch((dir) => {
    let run: StandInRun | undefined;
    let tap: Tap | undefined;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    return withCleanup(
      async () => {
        run = runStandIn(dir, script, STALL_WINDOW_MS);
        tap = tapped();
        return body(run, tap, dir);
      },
      async () => {
        vi.useRealTimers();
        tap?.kill();
        if (run === undefined) return;
        endOwnedProcesses([dir], run.children());
        await run.outcome;
      },
    );
  });
}

/**
 * The runner's word on a stand-in that reports a started test, then writes `line` until released: its error when it
 * stopped the run a whole idle window after that start, having read a `line` halfway through, otherwise `read`.
 */
function outcomeWhileWriting(line: string): Promise<string> {
  return onHeldClock(
    { lines: [startedCalc], repeat: line, finish: true },
    async (run, tap) => {
      await reportedStart(tap);
      await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS / 2);
      await nextLine(tap);
      await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS / 2);
      run.release();
      return run.outcome;
    },
  );
}

/**
 * Runs a stand-in that starts `script`'s children, reports one line and hangs, and has the runner stop it once it
 * has read that line; then hands `observe` the record of each child still running, which lies inside the scratch
 * folder. A child with no record has already ended.
 */
function afterStall<T>(
  script: StandInScript,
  observe: (children: ProcessRecord[]) => Promise<T>,
): Promise<T> {
  return onHeldClock(
    { ...script, lines: [startedCalc] },
    async (run, tap, dir) => {
      await reportedStart(tap);
      await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS);
      await run.outcome;
      const children = run.children();
      if (children.length !== script.children?.length) {
        throw new Error("the stand-in did not start its children");
      }
      return observe(recordsInside([dir], children));
    },
  );
}

/**
 * Has the runner find a stall only once it has seen its stand-in exit, leaving a child that holds its output open;
 * then hands `observe` the run.
 */
function stalledAfterExit<T>(
  observe: (run: StandInRun) => Promise<T>,
): Promise<T> {
  return onHeldClock(
    {
      lines: [startedCalc],
      children: [[]],
      childStdio: "inherit",
      finish: true,
    },
    async (run, tap) => {
      await seen(tap.exited, "exited");
      await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS);
      return observe(run);
    },
  );
}

describe("stopping a stalled Vitest run", PROCESS_SCENARIO, () => {
  it("D1706: asks a stalled Vitest to stop, then kills it once the grace has passed", async () => {
    const signals: string[] = [];
    const killNow = await nextSpawnIgnoresSigterm(signals);
    const sent = await signalsAfterStall(signals, killNow, () =>
      vi.runOnlyPendingTimersAsync(),
    );
    expect(sent).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("D1785: waits the whole grace before killing a stalled Vitest that ignored the stop", async () => {
    const signals: string[] = [];
    const killNow = await nextSpawnIgnoresSigterm(signals);
    const sent = await signalsAfterStall(signals, killNow, () =>
      vi.advanceTimersByTimeAsync(JUST_UNDER_KILL_GRACE_MS),
    );
    expect(sent).toEqual(["SIGTERM"]);
  });

  it("D1784: leaves no timer armed once a run has finished, so nothing holds the verifier's process open", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const armed = await withScratch(async (dir) => {
      try {
        await runStandIn(dir, { finish: true }, STALL_WINDOW_MS).outcome;
        return vi.getTimerCount();
      } finally {
        vi.useRealTimers();
      }
    });
    expect(armed).toBe(0);
  });

  it("D1707: says in the stall report when the stopped run's workers could not be listed", async () => {
    vi.mocked(childProcessesOf).mockImplementationOnce(() => {
      throw new Error("the process table cannot be read");
    });
    const outcome = await withScratch(
      (dir) => runStandIn(dir, {}, STALL_WINDOW_MS).outcome,
    );
    expect(outcome).toMatch(
      /workers could not be listed.*the process table cannot be read/,
    );
  });

  it("D2473: says in the stall report when the stopped run's workers could not be checked before they were ended", async () => {
    vi.mocked(endRecorded).mockImplementationOnce(() => {
      throw new Error("the process table cannot be read");
    });
    const outcome = await withScratch(
      (dir) => runStandIn(dir, {}, STALL_WINDOW_MS).outcome,
    );
    expect(outcome).toMatch(
      /workers could not be checked before they were ended.*the process table cannot be read/,
    );
  });

  it("D2063: ends a run interrupted by a signal with its stderr and stdout tail", async () => {
    await nextSpawnKilledAfterOutput();
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          { lines: ["said before the signal"] },
          UNSTALLED_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toBe(
      "Bootstrap runner interrupted: SIGKILL; Vitest reported no run end; the Vitest process recorded no exit, so it was killed, crashed below JavaScript, or could not write its record; stderr: (empty); stdout tail: said before the signal",
    );
  });

  it("D1701: never stops a run that keeps reporting progress, however long it runs past the idle window", async () => {
    const outcome = await onHeldClock(
      { repeat: collected, finish: true },
      async (run, tap) => {
        for (let passed = 0; passed < LIVE_WINDOWS && !tap.exited(); passed++) {
          await nextLine(tap);
          await vi.advanceTimersByTimeAsync(JUST_UNDER_STALL_WINDOW_MS);
        }
        run.release();
        return run.outcome;
      },
    );
    expect(outcome).toBe("read");
  });

  it("D1702: stops a run whose only output is not a reporter line, naming the running test and the last progress", async () => {
    const outcome = await outcomeWhileWriting("plain output");
    expect(outcome).toMatch(
      /no progress .*still running: calc > D1; last progress: started calc > D1/,
    );
  });

  it("D1703: stops a run whose only output is a malformed reporter line", async () => {
    const outcome = await outcomeWhileWriting(`${PROGRESS_MARKER}{"event":`);
    expect(outcome).toMatch(/made no progress/);
  });

  it("D1782: stops a run whose only output is a reporter line naming no known event", async () => {
    const outcome = await outcomeWhileWriting(
      progress({ event: "unknown", test: "calc > D1" }),
    );
    expect(outcome).toMatch(/made no progress/);
  });

  it("D1980: quotes a stalled run's stderr and stdout tail in its stop failure", async () => {
    const outcome = await onHeldClock(
      { stderr: ["hung here"], lines: ["said before hanging"] },
      async (run, tap) => {
        await seen(
          () =>
            tap.stderr().includes("hung here\n") &&
            tap.lines.includes("said before hanging"),
          "written its output",
        );
        await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS);
        return run.outcome;
      },
    );
    expect(outcome).toMatch(
      /made no progress.*; stderr: hung here\n; stdout tail: said before hanging$/s,
    );
  });

  it("D1783: ends a stopped run's worker that holds the main process's output open", async () => {
    const ended = await afterStall(
      { children: [[]], childStdio: "inherit" },
      (workers) => endsWithin(workers, STOP_WAIT_MS),
    );
    expect(ended).toBe(true);
  });

  it("D2472: fails a stalled run whose main process exited before the stop, saying its workers could not be told apart", async () => {
    const outcome = await stalledAfterExit((run) => run.outcome);
    expect(outcome).toMatch(
      /its main process had exited before the stop, so its workers could not be told from other processes/,
    );
  });

  it("D2494: fails, rather than waiting on its output, a stalled run whose main process exited before the stop", async () => {
    const failed = await stalledAfterExit((run) => {
      let stalled = false;
      void run.outcome.then((outcome) => {
        stalled = outcome.includes("made no progress");
      });
      return holdsWithin(() => stalled, SETTLE_WAIT_MS);
    });
    expect(failed).toBe(true);
  });

  it("D1704: ends a stopped run's pool workers, which outlive its main process", async () => {
    const ended = await afterStall({ children: [[]] }, (workers) =>
      endsWithin(workers, STOP_WAIT_MS),
    );
    expect(ended).toBe(true);
  });

  it("D1705: spares a stopped run's watchdog, named by its command line, so it can clean up after the run", async () => {
    const ended = await afterStall(
      { children: [["run-watchdog.mjs"]] },
      (watchdogs) => endsWithin(watchdogs, SPARE_WAIT_MS),
    );
    expect(ended).toBe(false);
  });
});
