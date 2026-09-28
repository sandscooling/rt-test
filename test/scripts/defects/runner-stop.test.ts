import { spawn, type SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { childProcessesOf } from "../run-cleanup.mjs";
import { PROCESS_SCENARIO } from "../timeouts.js";
import { runStandIn, withScratch } from "./harness.js";

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
  };
});

const STALL_WINDOW_MS = 2000;

/**
 * Makes the next spawned process ignore every signal short of SIGKILL, as a Linux Vitest stuck in native code does;
 * a Windows process cannot ignore one. Records each signal sent, and returns a kill that always lands.
 */
async function nextSpawnIgnoresSigterm(signals: string[]): Promise<() => void> {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  let kill = (): void => undefined;
  vi.mocked(spawn).mockImplementationOnce(((
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => {
    const child = actual.spawn(command, args, options);
    const deliver = child.kill.bind(child);
    kill = () => void deliver("SIGKILL");
    child.kill = (signal?: NodeJS.Signals | number) => {
      signals.push(String(signal ?? "SIGTERM"));
      return signal === "SIGKILL" && deliver(signal);
    };
    return child;
  }) as typeof spawn);
  return () => kill();
}

/** Makes the next spawned process be killed outright once it has written to stdout, so it closes on a signal. */
async function nextSpawnKilledAfterOutput(): Promise<void> {
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
    child.stdout?.once("data", () => child.kill("SIGKILL"));
    return child;
  }) as typeof spawn);
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

  it("D1784: leaves a run that finished alone once the idle window passes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const listings = await withScratch(async (dir) => {
      try {
        await runStandIn(dir, { finish: true }, STALL_WINDOW_MS).outcome;
        const before = vi.mocked(childProcessesOf).mock.calls.length;
        await vi.advanceTimersByTimeAsync(STALL_WINDOW_MS);
        return vi.mocked(childProcessesOf).mock.calls.length - before;
      } finally {
        vi.useRealTimers();
      }
    });
    expect(listings).toBe(0);
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
});
