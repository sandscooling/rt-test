import { describe, expect, it, vi } from "vitest";
import {
  MAX_COUNTED_CHANGES,
  type JobsByPath,
} from "../src/daemon/change-record.js";
import type { DaemonActivity } from "../src/daemon/protocol.js";
import type { RoundExplanation } from "../src/daemon/round-selection.js";
import { SELF_CHANGE_HOLD_COUNT } from "../src/daemon/run-history.js";
import type { NotKeptVerdict } from "../src/daemon/run-judgment.js";
import {
  QUIET_WINDOW_MS,
  Scheduler,
  type RunReport,
} from "../src/daemon/scheduler.js";
import {
  WorkspaceSchedule,
  type ScheduleReader,
} from "../src/daemon/workspace-schedule.js";
import {
  DEPENDENCY_BUILD_FAILED,
  DUE_REASON,
  ROUND_SELECTION,
  SELECTION_REFUSED,
  type BuildFailureKind,
  type RoundFacts,
  type WorkspaceExecution,
} from "../src/query/answer.js";
import {
  FALLBACK_SCOPE,
  TRIGGER,
  UNCERTAINTY,
  type BroadFallback,
  type ChangedPathReport,
} from "../src/selection/selection-types.js";
import type { StoredRun } from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { TestDiscovery } from "../src/vitest/discover-tests.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import { memoryLog, type MemoryLog } from "./daemon-harness.js";
import {
  DISCOVERY_DIGEST,
  RecordingStore,
  SCOPE,
  StandInInputs,
  UNFINGERPRINTED,
  confirmed,
  digestOf,
  discovered,
  discovery,
  flush,
  workspace,
  Deferred,
  type InputsScript,
} from "./scheduling-harness.js";
import {
  NO_BUILD_ENDED,
  StandInNarrowing,
  builtAt,
  crashedRun,
  discoveredIn,
  failedAt,
  failedRun,
  inputsOf,
  pathReport,
  ranWorkspace,
  refusedSelection,
  selectionOf,
  unbuiltAfter,
} from "./round-fixtures.js";
import type { JobWindow } from "../src/inputs/input-jobs.js";
import type { InputDigests } from "../src/inputs/input-inventory.js";
import type { QueryNarrowing } from "../src/inputs/narrowed-inputs.js";

/** What one run job the test scripts leaves. */
interface RunResult {
  /** The run stored; a passing run of the workspace when absent. */
  readonly run?: WorkspaceRun;
  /** Whether the job stored anything; true when absent. */
  readonly stored?: boolean;
  /** Whether the run's inputs changed while it ran. */
  readonly changedWhileRunning?: boolean;
  /** Makes the job throw this text instead of ending. */
  readonly throws?: string;
  /**
   * Makes the job end without having begun: with `movesRevision`, as a moved revision does; alone, as the lifecycle's
   * refusal at the planned revision does, which keeps the attempt the run marked.
   */
  readonly notBegun?: boolean;
  /**
   * Moves the input revision once the job has stored its record, as an edit during the job would, or as a job that did
   * not begin returns.
   */
  readonly movesRevision?: boolean;
  /** Why the run was stored not fingerprinted, as the lifecycle reports its verdict. */
  readonly notKept?: NotKeptVerdict;
  /** The changed paths inside its inputs that interrupted the run, as the lifecycle reports them. */
  readonly interruptedBy?: readonly string[];
  /** Holds the job, begun and not ended, before it stores anything. */
  readonly held?: Promise<void>;
  /** Holds the job, begun and not ended, once it has stored its record. */
  readonly heldAfterStore?: Promise<void>;
  /** The paths the tracker recorded changing while the run ran. */
  readonly changed?: readonly string[];
  /** The causes naming no path the tracker recorded while the run ran, as a watcher failure is. */
  readonly causes?: readonly string[];
  /** Runs once the job's end digests are taken, before `movesRevision`, as a change after the job does. */
  readonly afterEnd?: () => void;
}

interface RigOptions {
  /** The workspaces the start confirmed; `a` when absent. */
  readonly workspaces?: readonly string[];
  /** What each discovery lists, given its index from 0; every confirmed workspace, discovered, when absent. */
  readonly listed?: (call: number) => TestDiscovery;
  /** Results an earlier life stored. */
  readonly seed?: (store: RecordingStore) => void;
  readonly script?: InputsScript;
  readonly quietWindowMs?: number;
  readonly narrowing?: () => QueryNarrowing;
  readonly awaitBuild?: () => Promise<void>;
  /** Whether each discovery stored a record; true when absent. */
  readonly discoveryStored?: (call: number) => boolean;
  /** Whether each discovery began, given its index from 0; true when absent. */
  readonly discoveryBegins?: (call: number) => boolean;
  /** Holds each discovery, begun and not ended, until it settles. */
  readonly discoveryHeld?: Promise<void>;
  /**
   * What each run leaves, given the workspace, the run's index for it from 0, and why no change may interrupt it when
   * the scheduler says none may.
   */
  readonly ran?: (
    path: string,
    call: number,
    uninterruptible: string | undefined,
  ) => RunResult;
  /** The paths the tracker recorded changing while each discovery ran, given its index from 0. */
  readonly discoveryChanged?: (call: number) => readonly string[];
}

interface Rig {
  readonly inputs: StandInInputs;
  readonly store: RecordingStore;
  readonly scheduler: Scheduler;
  readonly log: MemoryLog;
  /** Each job in the order it began, as `discover@<revision>` or `run:<path>@<revision>`, and each idle entry as `idle`. */
  readonly calls: string[];
  /** Whether `scheduler.start()` has returned. */
  over(): boolean;
  stop(): Promise<void>;
}

/** Lets a job's end wait for a later event-loop turn, as a child process's reply does, so a loop that never ends still lets `flush` return. */
const nextTurn = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const ONLY_A = ["a"] as const;

function rig(options: RigOptions = {}): Rig {
  const paths = options.workspaces ?? ONLY_A;
  const store = new RecordingStore();
  options.seed?.(store);
  const inputs = new StandInInputs(options.script);
  const log = memoryLog();
  const calls: string[] = [];
  const runsOf = new Map<string, number>();
  let discoveries = 0;
  let stopping = false;
  const digests = (): InputDigests | undefined =>
    options.script?.snapshot?.()?.comparedDigests;
  const windowOf = (
    startDigests: InputDigests | undefined,
    changed: readonly string[] = [],
    causes: readonly string[] = [],
  ): JobWindow => ({
    paths: new Set(changed),
    causes: new Set(causes),
    startDigests,
    endDigests: digests(),
  });
  const scheduler = new Scheduler({
    inputs,
    log,
    start: confirmed(...paths),
    quietWindowMs: options.quietWindowMs ?? 0,
    isStopping: () => stopping,
    view: () => ({
      results: store.readLatestResults(SCOPE),
      inputs: inputs.current(),
    }),
    narrowing: options.narrowing ?? (() => NO_BUILD_ENDED),
    awaitBuild: options.awaitBuild ?? (() => Promise.resolve()),
    discover: async (revision) => {
      const call = discoveries;
      discoveries += 1;
      calls.push(`discover@${revision}`);
      const startDigests = digests();
      await nextTurn();
      await options.discoveryHeld;
      if (options.discoveryBegins?.(call) === false) return undefined;
      const stored = options.discoveryStored?.(call) ?? true;
      if (stored) {
        store.writeDiscovery(
          { ...SCOPE, inputFingerprint: digestOf(DISCOVERY_DIGEST) },
          options.listed?.(call) ?? discovery(...paths.map(discovered)),
        );
      }
      return {
        stored,
        window: windowOf(startDigests, options.discoveryChanged?.(call)),
      };
    },
    run: async (
      entry,
      revision,
      uninterruptible,
    ): Promise<RunReport | undefined> => {
      const path = entry.workspace.path;
      const call = runsOf.get(path) ?? 0;
      runsOf.set(path, call + 1);
      calls.push(`run:${path}@${revision}`);
      const began = inputs.revision;
      const result = options.ran?.(path, call, uninterruptible) ?? {};
      const startDigests = digests();
      await nextTurn();
      await result.held;
      if (result.throws !== undefined) throw new Error(result.throws);
      if (result.notBegun === true) {
        if (result.movesRevision === true) inputs.moveRevision();
        return undefined;
      }
      const changedWhileRunning = result.changedWhileRunning ?? false;
      const stored = result.stored ?? true;
      const print = inputs.current().workspaceFingerprint(entry);
      const written = stored
        ? store.writeRun(
            {
              ...SCOPE,
              inputFingerprint:
                print.ok && !changedWhileRunning
                  ? digestOf(print.digest)
                  : UNFINGERPRINTED,
            },
            result.run ?? ranWorkspace(path),
          )
        : undefined;
      const window = windowOf(startDigests, result.changed, result.causes);
      result.afterEnd?.();
      if (result.movesRevision === true) inputs.moveRevision();
      await result.heldAfterStore;
      const { notKept, interruptedBy } = result;
      return {
        revision: began,
        stored,
        changedWhileRunning,
        window,
        ...(written === undefined ? {} : { runId: written.runId }),
        ...(notKept === undefined ? {} : { notKept }),
        ...(interruptedBy === undefined ? {} : { interruptedBy }),
      };
    },
    idle: () => {
      calls.push("idle");
    },
  });
  inputs.start();
  let over = false;
  const ended = scheduler
    .start()
    .catch(() => undefined)
    .then(() => {
      over = true;
    });
  return {
    inputs,
    store,
    scheduler,
    log,
    calls,
    over: () => over,
    async stop() {
      stopping = true;
      scheduler.stop();
      await inputs.stop();
      await ended;
    },
  };
}

/** Runs `body` over a started scheduler, then stops it and puts the real timers back. */
async function running<T>(
  options: RigOptions,
  body: (started: Rig) => Promise<T>,
): Promise<T> {
  const started = rig(options);
  try {
    return await body(started);
  } finally {
    await started.stop();
    vi.useRealTimers();
  }
}

/**
 * Fakes the clock the quiet window runs on, and leaves `setImmediate`, which `flush` waits on, real. The clock has run
 * for an hour, so a window that started at the start of the run is not confused with one that has not started.
 */
function fakeClock(): void {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  vi.advanceTimersByTime(3_600_000);
}

const QUIET_MS = 1000;

/** Results an earlier life stored for `paths`, each bound to the fingerprint it reads current under. */
function currentResults(...paths: readonly string[]) {
  return (store: RecordingStore): void => {
    store.seedDiscovery(
      discovery(...paths.map(discovered)),
      digestOf(DISCOVERY_DIGEST),
    );
    for (const path of paths) {
      store.seedRun(ranWorkspace(path), digestOf(`${path}-digest`));
    }
  };
}

const runsIn = (calls: readonly string[]): string[] =>
  calls.filter((call) => call.startsWith("run:"));
const discoveriesIn = (calls: readonly string[]): string[] =>
  calls.filter((call) => call.startsWith("discover@"));
const dueEntries = (log: MemoryLog): string[] =>
  log.entries.filter((entry) => entry.startsWith("due: "));

describe("what is due", () => {
  it("D2643: a restart over a discovery and runs stored under their current fingerprints starts no discovery and no run", async () => {
    const calls = await running(
      { workspaces: ["a", "b"], seed: currentResults("a", "b") },
      async (started) => {
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle"]);
  });

  it("D2644: a workspace whose latest run is stored under another digest runs, with its reason logged, and one bound to its current fingerprint does not", async () => {
    const outcome = await running(
      {
        workspaces: ["a", "b"],
        seed: (store) => {
          currentResults("a", "b")(store);
          store.seedRun(ranWorkspace("a"), digestOf("a-old-digest"));
        },
      },
      async (started) => {
        await flush();
        return { calls: [...started.calls], due: dueEntries(started.log) };
      },
    );
    expect(outcome).toStrictEqual({
      calls: ["run:a@1", "idle"],
      due: ["due: a, its inputs differ from those of its latest run"],
    });
  });

  it("D2645: a workspace whose latest run is stored not fingerprinted runs, with its reason logged", async () => {
    const outcome = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(ranWorkspace("a"), UNFINGERPRINTED);
        },
      },
      async (started) => {
        await flush();
        return { calls: [...started.calls], due: dueEntries(started.log) };
      },
    );
    expect(outcome).toStrictEqual({
      calls: ["run:a@1", "idle"],
      due: ["due: a, its latest run was stored not fingerprinted"],
    });
  });

  it("D2646: a workspace whose current fingerprint cannot be computed runs, with its reason logged", async () => {
    const outcome = await running(
      {
        script: {
          fingerprintOf: () => ({
            ok: false,
            reason: "the watcher failed: ENOSPC",
          }),
        },
        seed: currentResults("a"),
      },
      async (started) => {
        await flush();
        return { calls: [...started.calls], due: dueEntries(started.log) };
      },
    );
    expect(outcome).toStrictEqual({
      calls: ["run:a@1", "idle"],
      due: ["due: a, its current input fingerprint cannot be computed"],
    });
  });

  it("D2647: a workspace whose latest run holds failed and errored tests but is bound to its current fingerprint is not run again", async () => {
    const calls = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(
            ranWorkspace("a", ["failed", "error"]),
            digestOf("a-digest"),
          );
        },
      },
      async (started) => {
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle"]);
  });
});

describe("running each workspace at most once per revision", () => {
  it("D2648: a workspace whose run ended with nothing stored is not run again at the same input revision", async () => {
    const calls = await running(
      { ran: () => ({ stored: false }) },
      async (started) => {
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["discover@1", "run:a@1", "idle"]);
  });

  /**
   * Workspace `a`, whose fingerprint cannot be computed, runs at the first discovery; a periodic reconciliation then
   * rediscovers because `b`'s discovery failed, and the new discovery lists one more test module for `a`, at the same
   * input revision.
   */
  async function rediscoveredWithANewModule(): Promise<{
    runs: string[];
    due: string[];
  }> {
    const failedB = {
      status: "failed" as const,
      workspace: workspace("b"),
      vitestVersion: "5.0.1",
      error: "Error: config boom",
    };
    return running(
      {
        workspaces: ["a", "b"],
        script: {
          fingerprintOf: (path) =>
            path === "a"
              ? { ok: false, reason: "the watcher failed: ENOSPC" }
              : { ok: true, digest: `${path}-digest` },
        },
        listed: (call) =>
          discovery(
            discoveredIn(
              "a",
              call === 0 ? ["x.test.ts"] : ["x.test.ts", "y.test.ts"],
            ),
            failedB,
          ),
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return {
          runs: runsIn(started.calls).filter((call) =>
            call.startsWith("run:a"),
          ),
          due: dueEntries(started.log).filter((entry) =>
            entry.startsWith("due: a"),
          ),
        };
      },
    );
  }

  it("D2649: a rediscovery at an unchanged revision that lists a new test module runs the workspace again", async () => {
    const { runs } = await rediscoveredWithANewModule();
    expect(runs).toStrictEqual(["run:a@1", "run:a@1"]);
  });

  it("D2742: a workspace run again because a rediscovery at an unchanged revision listed a new test module is logged as due again", async () => {
    const { due } = await rediscoveredWithANewModule();
    expect(due).toStrictEqual([
      "due: a, it has no stored run",
      "due: a, its latest run was stored not fingerprinted",
    ]);
  });

  it("D2650: a run stored not fingerprinted by a change that left the input revision unmoved is run once more at that revision", async () => {
    const calls = await running(
      { ran: (_path, call) => ({ changedWhileRunning: call === 0 }) },
      async (started) => {
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["discover@1", "run:a@1", "run:a@1", "idle"]);
  });

  it("D2651: when the run repeated for an unmoved change is also stored not fingerprinted, the workspace is held and the log says so", async () => {
    const outcome = await running(
      { ran: () => ({ changedWhileRunning: true }) },
      async (started) => {
        await flush();
        return {
          calls: [...started.calls],
          held: started.log.entries.filter((entry) => entry.includes("held"))
            .length,
        };
      },
    );
    expect(outcome).toStrictEqual({
      calls: ["discover@1", "run:a@1", "run:a@1", "idle"],
      held: 1,
    });
  });

  it("D3133: a workspace owed a once-more run at one revision whose first run at a later revision is also stored not fingerprinted by an unmoved change is run once more there, not held", async () => {
    const released = new Deferred<void>();
    const outcome = await running(
      {
        ran: () => ({ changedWhileRunning: true }),
        awaitBuild: heldFrom(3, released.promise),
      },
      async (started) => {
        await flush();
        started.inputs.moveRevision();
        released.resolve();
        await flush();
        return {
          runs: runsIn(started.calls),
          logged: started.log.entries.filter((entry) =>
            entry.startsWith("the run of a was stored not fingerprinted"),
          ),
        };
      },
    );
    expect(outcome).toStrictEqual({
      runs: ["run:a@1", "run:a@2", "run:a@2"],
      logged: [
        "the run of a was stored not fingerprinted because its inputs changed while it ran at input revision 1, which the change did not move, so it runs once more",
        "the run of a was stored not fingerprinted because its inputs changed while it ran at input revision 2, which the change did not move, so it runs once more",
        "the run of a was stored not fingerprinted again because its inputs changed while it ran at input revision 2, which the change did not move, so it is held until the input revision or its list of test modules changes",
      ],
    });
  });

  it("D3134: a workspace owed a once-more run whose first run after a rediscovery at the same revision listed a new test module is also stored not fingerprinted by an unmoved change is run once more, not held", async () => {
    const released = new Deferred<void>();
    const failedB = {
      status: "failed" as const,
      workspace: workspace("b"),
      vitestVersion: "5.0.1",
      error: "Error: config boom",
    };
    const calls = await running(
      {
        workspaces: ["a", "b"],
        listed: (call) =>
          discovery(
            discoveredIn(
              "a",
              call === 0 ? ["x.test.ts"] : ["x.test.ts", "y.test.ts"],
            ),
            failedB,
          ),
        ran: () => ({ changedWhileRunning: true }),
        awaitBuild: heldFrom(3, released.promise),
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        released.resolve();
        await flush();
        return started.calls.filter(
          (call) => call.startsWith("discover@") || call.startsWith("run:a"),
        );
      },
    );
    expect(calls).toStrictEqual([
      "discover@1",
      "run:a@1",
      "discover@1",
      "run:a@1",
      "run:a@1",
    ]);
  });
});

describe("the quiet window", () => {
  it("D2652: the quiet window is 1000 ms", () => {
    expect(QUIET_WINDOW_MS).toBe(1000);
  });

  it("D2653: no discovery starts until the input revision has held still for the quiet window, and one starts when it has", async () => {
    fakeClock();
    const outcome = await running(
      { quietWindowMs: QUIET_MS },
      async (started) => {
        await flush();
        await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
        await flush();
        const before = discoveriesIn(started.calls);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        return { before, after: discoveriesIn(started.calls) };
      },
    );
    expect(outcome).toStrictEqual({ before: [], after: ["discover@1"] });
  });

  it("D2654: a burst of input changes, each less than the window after the one before, leads to one discovery, after the last of them, at the revision they leave", async () => {
    fakeClock();
    const outcome = await running(
      { quietWindowMs: QUIET_MS },
      async (started) => {
        await flush();
        await vi.advanceTimersByTimeAsync(500);
        started.inputs.moveRevision();
        await flush();
        await vi.advanceTimersByTimeAsync(700);
        started.inputs.moveRevision();
        await flush();
        await vi.advanceTimersByTimeAsync(300);
        await flush();
        const whileBursting = discoveriesIn(started.calls);
        await vi.advanceTimersByTimeAsync(QUIET_MS - 301);
        await flush();
        const justBefore = discoveriesIn(started.calls);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        return {
          whileBursting,
          justBefore,
          after: discoveriesIn(started.calls),
        };
      },
    );
    expect(outcome).toStrictEqual({
      whileBursting: [],
      justBefore: [],
      after: ["discover@3"],
    });
  });

  it("D2655: no discovery starts while the inputs have events unread, and one starts once they are read", async () => {
    const outcome = await running(
      { script: { heldSettle: 0 } },
      async (started) => {
        await flush();
        const held = discoveriesIn(started.calls);
        started.inputs.settleHeld.resolve();
        await flush();
        return { held, released: discoveriesIn(started.calls) };
      },
    );
    expect(outcome).toStrictEqual({ held: [], released: ["discover@1"] });
  });

  it("D2656: an input change while the events are being read starts the quiet window again, so no discovery starts until the new revision has held still", async () => {
    fakeClock();
    const outcome = await running(
      { quietWindowMs: QUIET_MS, script: { heldSettle: 0 } },
      async (started) => {
        await flush();
        await vi.advanceTimersByTimeAsync(QUIET_MS);
        await flush();
        started.inputs.moveRevision();
        started.inputs.settleHeld.resolve();
        await flush();
        const released = discoveriesIn(started.calls);
        await vi.advanceTimersByTimeAsync(QUIET_MS - 1);
        await flush();
        const justBefore = discoveriesIn(started.calls);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        return { released, justBefore, after: discoveriesIn(started.calls) };
      },
    );
    expect(outcome).toStrictEqual({
      released: [],
      justBefore: [],
      after: ["discover@2"],
    });
  });

  it("D1953: a stop given to the scheduler during the first reconciliation of the inputs starts no discovery once the reconciliation ends", async () => {
    const outcome = await running(
      { script: { heldReconciliation: true } },
      async (started) => {
        await flush();
        started.scheduler.stop();
        started.inputs.reconciled.resolve();
        await flush();
        return [...started.calls];
      },
    );
    expect(outcome).toStrictEqual([]);
  });

  it("D2657: a stop given while the dependency build wait is held starts no discovery once the wait is released", async () => {
    const held = new Deferred<void>();
    const calls = await running(
      { awaitBuild: () => held.promise },
      async (started) => {
        await flush();
        started.scheduler.stop();
        held.resolve();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual([]);
  });

  it("D2694: a stop given while the quiet window waits ends the scheduler at once, without the window running out", async () => {
    fakeClock();
    const outcome = await running(
      { quietWindowMs: QUIET_MS },
      async (started) => {
        await flush();
        started.scheduler.stop();
        await flush();
        const outcome = { over: started.over(), calls: [...started.calls] };
        // A scheduler that ignored the stop is released by the window running out, so the teardown ends.
        await vi.advanceTimersByTimeAsync(QUIET_MS);
        return outcome;
      },
    );
    expect(outcome).toStrictEqual({ over: true, calls: [] });
  });
});

describe("discovering again", () => {
  it("D2658: a stored discovery that is not current is rediscovered before any due run", async () => {
    const calls = await running(
      {
        workspaces: ["a", "b"],
        seed: (store) => {
          currentResults("a", "b")(store);
          store.seedDiscovery(
            discovery(discovered("a"), discovered("b")),
            digestOf("an-old-digest"),
          );
          store.seedRun(ranWorkspace("b"), UNFINGERPRINTED);
        },
      },
      async (started) => {
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["discover@1", "run:b@1", "idle"]);
  });

  it("D2659: a discovery whose record stays not current is attempted once at an input revision", async () => {
    const attempts = await running(
      {
        script: {
          discoveryFingerprintOf: () => ({
            ok: false,
            reason: "the input set cannot be established",
          }),
        },
      },
      async (started) => {
        await flush();
        return discoveriesIn(started.calls);
      },
    );
    expect(attempts).toStrictEqual(["discover@1"]);
  });
});

describe("retrying at a periodic reconciliation", () => {
  it("D2660: a workspace whose latest run failed is not retried until a periodic reconciliation ends, and then is", async () => {
    const outcome = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
      },
      async (started) => {
        await flush();
        const before = [...started.calls];
        started.inputs.endPeriodicReconciliation();
        await flush();
        return { before, after: [...started.calls] };
      },
    );
    expect(outcome).toStrictEqual({
      before: ["idle"],
      after: ["idle", "run:a@1", "idle"],
    });
  });

  it("D2786: a workspace whose latest run crashed is not retried until a periodic reconciliation ends, and then is", async () => {
    const outcome = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(crashedRun("a"), digestOf("a-digest"));
        },
      },
      async (started) => {
        await flush();
        const before = [...started.calls];
        started.inputs.endPeriodicReconciliation();
        await flush();
        return { before, after: [...started.calls] };
      },
    );
    expect(outcome).toStrictEqual({
      before: ["idle"],
      after: ["idle", "run:a@1", "idle"],
    });
  });

  it("D2787: a crashed run's retry is logged with the crash's own reason, never as a failed run", async () => {
    const due = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(crashedRun("a"), digestOf("a-digest"));
        },
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return dueEntries(started.log);
      },
    );
    expect(due).toStrictEqual([
      "due: a, its latest run's executor process ended during the run with no input change to blame, so the periodic reconciliation retries it",
    ]);
  });

  it("D2795: a failed run's retry is logged with the failed run's own reason, never as a crash", async () => {
    const due = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return dueEntries(started.log);
      },
    );
    expect(due).toStrictEqual([
      "due: a, its latest run failed with no input change to blame, so the periodic reconciliation retries it",
    ]);
  });

  it("D2788: a retry armed because the last attempt stored nothing does not run a workspace whose latest run reads current again by plan time", async () => {
    let digest = "a-changed";
    let moveRevision = (): void => undefined;
    const outcome = await running(
      {
        seed: currentResults("a"),
        script: {
          fingerprintOf: (path) => ({
            ok: true,
            digest: path === "a" ? digest : `${path}-digest`,
          }),
        },
        ran: (_path, call) => {
          if (call === 0) return { stored: false };
          if (call === 1) {
            digest = "a-digest";
            moveRevision();
            return { notBegun: true };
          }
          return {};
        },
      },
      async (started) => {
        moveRevision = () => started.inputs.moveRevision();
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return { calls: [...started.calls], due: dueEntries(started.log) };
      },
    );
    expect(outcome).toStrictEqual({
      calls: ["run:a@1", "idle", "run:a@1", "idle"],
      due: ["due: a, its inputs differ from those of its latest run"],
    });
  });

  it("D2661: a workspace whose retry fails again is retried once for each periodic reconciliation, not repeatedly", async () => {
    const calls = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
        ran: () => ({ run: failedRun("a") }),
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle", "run:a@1", "idle"]);
  });

  it("D2662: a discovery listing a workspace whose status is failed is retried when a periodic reconciliation ends", async () => {
    const outcome = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedDiscovery(
            discovery({
              status: "failed",
              workspace: workspace("a"),
              vitestVersion: "5.0.1",
              error: "Error: config boom",
            }),
            digestOf(DISCOVERY_DIGEST),
          );
        },
      },
      async (started) => {
        await flush();
        const before = [...started.calls];
        started.inputs.endPeriodicReconciliation();
        await flush();
        return { before, after: [...started.calls] };
      },
    );
    expect(outcome).toStrictEqual({
      before: ["idle"],
      after: ["idle", "discover@1", "idle"],
    });
  });

  it("D2663: a discovery that ended with nothing stored is not retried at the same input revision, and is when a periodic reconciliation ends", async () => {
    const outcome = await running(
      { discoveryStored: (call) => call > 0 },
      async (started) => {
        await flush();
        const before = [...started.calls];
        started.inputs.endPeriodicReconciliation();
        await flush();
        return { before, after: [...started.calls] };
      },
    );
    expect(outcome).toStrictEqual({
      before: ["discover@1", "idle"],
      after: ["discover@1", "idle", "discover@1", "run:a@1", "idle"],
    });
  });

  it("D2693: a workspace whose run ended with nothing stored and is still due is run again when a periodic reconciliation ends, and not before", async () => {
    const outcome = await running(
      { ran: (_path, call) => ({ stored: call > 0 }) },
      async (started) => {
        await flush();
        const before = [...started.calls];
        started.inputs.endPeriodicReconciliation();
        await flush();
        return { before, after: [...started.calls] };
      },
    );
    expect(outcome).toStrictEqual({
      before: ["discover@1", "run:a@1", "idle"],
      after: ["discover@1", "run:a@1", "idle", "run:a@1", "idle"],
    });
  });

  it("D2731: a workspace's periodic retry whose run did not begin because the revision moved is kept, so the workspace runs at the new revision", async () => {
    const calls = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
        ran: (_path, call) =>
          call === 0 ? { notBegun: true, movesRevision: true } : {},
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle", "run:a@1", "run:a@2", "idle"]);
  });

  it("D3184: a retried workspace the lifecycle refuses at its planned revision drops its retry, so it runs into no further refusal until the revision moves", async () => {
    const calls = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
        ran: () => ({ notBegun: true }),
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle", "run:a@1", "idle"]);
  });

  it("D2732: a discovery's periodic retry that did not begin is kept, so the discovery happens once the scheduler plans again", async () => {
    const calls = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedDiscovery(
            discovery({
              status: "failed",
              workspace: workspace("a"),
              vitestVersion: "5.0.1",
              error: "Error: config boom",
            }),
            digestOf(DISCOVERY_DIGEST),
          );
        },
        discoveryBegins: (call) => call > 0,
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle", "discover@1", "discover@1", "idle"]);
  });

  it("D2733: a workspace whose run threw is run again when a periodic reconciliation ends, while it is still due", async () => {
    const calls = await running(
      { ran: (_path, call) => (call === 0 ? { throws: "boom" } : {}) },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["discover@1", "run:a@1", "run:a@1", "idle"]);
  });
});

const DIGESTS_BEFORE = {
  "src/x.ts": "1",
  "src/gone.ts": "1",
  "src/same.ts": "1",
};
const DIGESTS_AFTER = {
  "src/x.ts": "2",
  "src/new.ts": "1",
  "src/same.ts": "1",
};

/** A setup file git ignores, which the tracker holds a read of apart from the inputs. */
const LISTED_SETUP = "gen/setup.ts";

interface Change {
  readonly options: RigOptions;
  /** Lets the first round end, then changes the inputs to `DIGESTS_AFTER` at the next revision and lets the second end. */
  nextRound(started: Rig): Promise<void>;
}

/**
 * A scheduler whose first round reads `DIGESTS_BEFORE` and whose inputs then change to `DIGESTS_AFTER`, each
 * workspace's fingerprint but those of `unmoved` moving with them, and whose dependency build at the new revision answers with `narrowing`.
 */
function afterAChange(
  narrowing: QueryNarrowing,
  more: RigOptions = {},
  unmoved: readonly string[] = [],
): Change {
  const state = { digests: DIGESTS_BEFORE as Readonly<Record<string, string>> };
  return {
    options: {
      ...more,
      script: {
        ...more.script,
        snapshot: () => inputsOf(state.digests),
        fingerprintOf: (path) => ({
          ok: true,
          digest: `${path}-digest-${state.digests === DIGESTS_BEFORE || unmoved.includes(path) ? 1 : 2}`,
        }),
      },
      narrowing: () => narrowing,
    },
    async nextRound(started) {
      await flush();
      state.digests = DIGESTS_AFTER;
      started.inputs.moveRevision();
      await flush();
    },
  };
}

/** Results an earlier life stored for `paths` under the fingerprints the first round reads. */
function beforeTheChange(...paths: readonly string[]) {
  return (store: RecordingStore): void => {
    store.seedDiscovery(
      discovery(...paths.map(discovered)),
      digestOf(DISCOVERY_DIGEST),
    );
    for (const path of paths) {
      store.seedRun(ranWorkspace(path), digestOf(`${path}-digest-1`));
    }
  };
}

describe("a round's selection over the paths that changed", () => {
  it("D2664: selection is asked about each path whose digest changed, appeared or disappeared since the previous round, and no other", async () => {
    const selection = new StandInNarrowing(selectionOf([], []));
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const asked = await running(change.options, async (started) => {
      await change.nextRound(started);
      return selection.asked;
    });
    expect(asked).toStrictEqual([["src/gone.ts", "src/new.ts", "src/x.ts"]]);
  });

  it("D3243: selection is asked about a listed file the inputs leave out whose held read changed since the previous round, though the inputs' digests held still", async () => {
    const selection = new StandInNarrowing(selectionOf([], []));
    const state = { listed: "1" };
    const asked = await running(
      {
        seed: beforeTheChange("a"),
        script: {
          snapshot: () =>
            inputsOf(DIGESTS_BEFORE, { [LISTED_SETUP]: state.listed }),
          fingerprintOf: (path) => ({
            ok: true,
            digest: `${path}-digest-${state.listed}`,
          }),
        },
        narrowing: () => builtAt(2, selection),
      },
      async (started) => {
        await flush();
        state.listed = "2";
        started.inputs.moveRevision();
        await flush();
        return selection.asked;
      },
    );
    expect(asked).toStrictEqual([[LISTED_SETUP]]);
  });

  it("D2665: the round's log names each changed path, its owner and each workspace it selected", async () => {
    const selection = new StandInNarrowing(
      selectionOf(
        [pathReport("lib/x.ts", "package-owner", ["dep-one", "dep-two"])],
        ["dep-one", "dep-two"],
      ),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const entry = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries.find((logged) => logged.includes("lib/x.ts"));
    });
    expect({
      namesOwner: entry?.includes("package-owner"),
      namesSelected: ["dep-one", "dep-two"].map((name) =>
        entry?.includes(name),
      ),
    }).toStrictEqual({ namesOwner: true, namesSelected: [true, true] });
  });

  it("D2690: the round's log says why a changed path selected no workspace", async () => {
    const selection = new StandInNarrowing(
      selectionOf([pathReport("lib/y.ts", undefined, [])], []),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const entry = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries.find((logged) => logged.includes("lib/y.ts"));
    });
    expect({
      names: entry?.includes("selected no workspace"),
      why: entry?.includes("no Vitest workspace depends on it"),
    }).toStrictEqual({ names: true, why: true });
  });

  it("D2666: the round's log gives the selected and total test and workspace counts, and says each total that is incomplete", async () => {
    const selection = new StandInNarrowing(
      selectionOf([], ["a"], {
        counts: {
          selectedTests: { count: 3, complete: true },
          totalTests: { count: 7, complete: false },
          selectedWorkspaces: 2,
          totalWorkspaces: { count: 5, complete: false },
          notRunnableWorkspaces: 0,
        },
      }),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const entry = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries.find((logged) => /\b3 of 7\b/.test(logged));
    });
    expect({
      found: entry !== undefined,
      workspaces: /\b2 of 5\b/.test(entry ?? ""),
      incomplete: (entry?.match(/incomplete/g) ?? []).length,
    }).toStrictEqual({ found: true, workspaces: true, incomplete: 2 });
  });

  it("D2667: the round's log names each broad fallback with the path and the trigger that caused it", async () => {
    const selection = new StandInNarrowing(
      selectionOf([], ["a"], {
        fallbacks: [
          {
            path: "package.json",
            trigger: TRIGGER.manifest,
            scope: FALLBACK_SCOPE.project,
            workspaces: ["package-owner"],
          },
        ],
      }),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const entry = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries.find((logged) =>
        logged.includes("package.json"),
      );
    });
    expect({
      names: [TRIGGER.manifest, FALLBACK_SCOPE.project].map((word) =>
        entry?.includes(word),
      ),
    }).toStrictEqual({ names: [true, true] });
  });

  it("D2668: a workspace the selection picked that holds current results is logged as not run, and one that is due is not", async () => {
    const selection = new StandInNarrowing(selectionOf([], ["alpha", "beta"]));
    const change = afterAChange(
      builtAt(2, selection),
      {
        workspaces: ["alpha", "beta"],
        seed: beforeTheChange("alpha", "beta"),
      },
      ["beta"],
    );
    const notRun = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries
        .filter((logged) => logged.startsWith("not run"))
        .map((logged) => (logged.includes("beta") ? "beta" : logged));
    });
    expect(notRun).toStrictEqual(["beta"]);
  });

  it("D2669: a round with no selection because the dependency build failed is logged at warning level with the build's kind and reason, and its due workspace still runs", async () => {
    const change = afterAChange(
      failedAt(
        2,
        DEPENDENCY_BUILD_FAILED satisfies BuildFailureKind,
        "the build died",
      ),
      { seed: beforeTheChange("a") },
    );
    const outcome = await running(change.options, async (started) => {
      await change.nextRound(started);
      const warnings = started.log.entries.filter((logged) =>
        logged.startsWith("warning: "),
      );
      return {
        warnings: warnings.length,
        names: [DEPENDENCY_BUILD_FAILED, "the build died"].map((word) =>
          warnings[0]?.includes(word),
        ),
        reran: started.calls.includes("run:a@2"),
      };
    });
    expect(outcome).toStrictEqual({
      warnings: 1,
      names: [true, true],
      reran: true,
    });
  });

  it("D2670: a round whose build wait was released with no build ended at its revision is logged at warning level, and its due workspace still runs", async () => {
    const change = afterAChange(NO_BUILD_ENDED, {
      seed: beforeTheChange("a"),
    });
    const outcome = await running(change.options, async (started) => {
      await change.nextRound(started);
      const warnings = started.log.entries.filter((logged) =>
        logged.startsWith("warning: "),
      );
      return {
        warnings: warnings.length,
        saysReleased: warnings[0]?.includes("released"),
        reran: started.calls.includes("run:a@2"),
      };
    });
    expect(outcome).toStrictEqual({
      warnings: 1,
      saysReleased: true,
      reran: true,
    });
  });

  it("D2695: a round whose inputs' digests cannot be read is logged at warning level with that cause, and its due workspace still runs", async () => {
    const outcome = await running({}, async (started) => {
      await flush();
      const warnings = started.log.entries.filter((logged) =>
        logged.startsWith("warning: "),
      );
      return {
        warnings: warnings.length,
        namesCause: warnings[0]?.includes("digests cannot be read"),
        ran: started.calls.includes("run:a@1"),
      };
    });
    expect(outcome).toStrictEqual({
      warnings: 1,
      namesCause: true,
      ran: true,
    });
  });

  it("D2734: a round whose build wait was released, after an earlier build failed, is logged as the released wait and not as that failure", async () => {
    const change = afterAChange(
      unbuiltAfter(DEPENDENCY_BUILD_FAILED, "the earlier build died"),
      { seed: beforeTheChange("a") },
    );
    const outcome = await running(change.options, async (started) => {
      await change.nextRound(started);
      const warnings = started.log.entries.filter((logged) =>
        logged.startsWith("warning: "),
      );
      return {
        warnings: warnings.length,
        namesReleasedWait: warnings[0]?.startsWith(
          "warning: no selection was made (no-build-ended)",
        ),
      };
    });
    expect(outcome).toStrictEqual({ warnings: 1, namesReleasedWait: true });
  });

  it("D2735: the round's log names the detail of each step a selection reason passed through", async () => {
    const detail = "the override cannot be resolved";
    const selection = new StandInNarrowing(
      selectionOf(
        [
          pathReport("lib/x.ts", "package-owner", ["dep-one"], {
            steps: [
              {
                workspace: "dep-one",
                via: UNCERTAINTY.unresolvedOverride,
                detail,
              },
            ],
          }),
        ],
        ["dep-one"],
      ),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const entry = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries.find((logged) => logged.includes("lib/x.ts"));
    });
    expect(entry?.includes(detail)).toBe(true);
  });

  it("D2736: the round's log names a workspace a changed path reached that cannot run, with its reason, beside the one it selected", async () => {
    const reason = "its config file could not be loaded";
    const selection = new StandInNarrowing(
      selectionOf(
        [
          pathReport("lib/x.ts", "package-owner", ["dep-one"], {
            notRunnable: [{ workspace: workspace("dep-broken"), reason }],
          }),
        ],
        ["dep-one"],
      ),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    const entry = await running(change.options, async (started) => {
      await change.nextRound(started);
      return started.log.entries.find((logged) => logged.includes("lib/x.ts"));
    });
    expect({
      namesWorkspace: entry?.includes("dep-broken"),
      namesReason: entry?.includes(reason),
    }).toStrictEqual({ namesWorkspace: true, namesReason: true });
  });

  it("D2741: a round whose selection is refused is logged at warning level with the refusal's kind and reason, and its due workspace still runs", async () => {
    const reason = "the changed path cannot be attributed";
    const change = afterAChange(
      builtAt(2, new StandInNarrowing(refusedSelection("src/x.ts", reason))),
      { seed: beforeTheChange("a") },
    );
    const outcome = await running(change.options, async (started) => {
      await change.nextRound(started);
      const warnings = started.log.entries.filter((logged) =>
        logged.startsWith("warning: "),
      );
      return {
        warnings: warnings.length,
        names: [SELECTION_REFUSED, reason].map((word) =>
          warnings[0]?.includes(word),
        ),
        reran: started.calls.includes("run:a@2"),
      };
    });
    expect(outcome).toStrictEqual({
      warnings: 1,
      names: [true, true],
      reran: true,
    });
  });

  it("D2671: each due workspace is logged once for an input revision, not again at each later plan of it", async () => {
    const logged = await running(
      { workspaces: ["a", "b"] },
      async (started) => {
        await flush();
        return dueEntries(started.log).filter((entry) =>
          entry.startsWith("due: b"),
        ).length;
      },
    );
    expect(logged).toBe(1);
  });

  /**
   * Runs a scheduler whose selection at the second revision throws once, then signals a periodic reconciliation,
   * which plans that revision again with the revision unmoved, and returns what `read` gives of it.
   */
  async function afterASelectionThrew<T>(
    read: (started: Rig, selection: StandInNarrowing) => T,
  ): Promise<T> {
    const selection = new OnceThrowingNarrowing(
      selectionOf([pathReport("lib/x.ts", "a", ["a"])], ["a"]),
    );
    const change = afterAChange(builtAt(2, selection), {
      seed: beforeTheChange("a"),
    });
    return running(change.options, async (started) => {
      await change.nextRound(started);
      started.inputs.endPeriodicReconciliation();
      await flush();
      return read(started, selection);
    });
  }

  it("D3107: after a round's selection throws, the round planned again at that revision explains its selection", async () => {
    const selection = await afterASelectionThrew((started) => {
      const latest = scheduleOf(started).latestSelection;
      return latest.state === ROUND_SELECTION.made
        ? {
            state: latest.state,
            revision: latest.revision,
            paths: latest.paths.named.map(({ path }) => path),
          }
        : latest;
    });
    expect(selection).toStrictEqual({
      state: "made",
      revision: 2,
      paths: ["lib/x.ts"],
    });
  });

  it("D3108: after a round's selection throws, the round planned again at that revision asks selection about the same changed paths", async () => {
    const asked = await afterASelectionThrew(
      (_started, selection) => selection.asked,
    );
    const changed = ["src/gone.ts", "src/new.ts", "src/x.ts"];
    expect(asked).toStrictEqual([changed, changed]);
  });
});

/** A dependency build's narrowing whose first selection throws, as a selection over an unreadable input would. */
class OnceThrowingNarrowing extends StandInNarrowing {
  #thrown = false;

  override select(
    paths: readonly string[],
  ): ReturnType<StandInNarrowing["select"]> {
    if (this.#thrown) return super.select(paths);
    this.#thrown = true;
    this.asked.push(paths);
    throw new Error("the selection failed");
  }
}

describe("the order of a round's runs", () => {
  it("D2672: a workspace owning a path that changed runs first, then one whose latest run holds a failed test, then the rest, each group in the discovery's order", async () => {
    const selection = new StandInNarrowing(
      selectionOf([pathReport("c/x.ts", "c", ["c"])], ["c"]),
    );
    const change = afterAChange(builtAt(2, selection), {
      workspaces: ["a", "b", "c", "d"],
      seed: (store) => {
        beforeTheChange("a", "b", "c", "d")(store);
        store.seedRun(ranWorkspace("b", ["failed"]), digestOf("b-digest-1"));
      },
    });
    const order = await running(change.options, async (started) => {
      await change.nextRound(started);
      return runsIn(started.calls);
    });
    expect(order).toStrictEqual(["run:c@2", "run:b@2", "run:a@2", "run:d@2"]);
  });

  it("D2673: in a round with no changed path to name a direct target, a workspace whose latest run holds a failed test runs before the rest", async () => {
    const order = await running(
      {
        workspaces: ["a", "b", "c", "d"],
        seed: (store) => {
          currentResults("a", "b", "c", "d")(store);
          for (const path of ["a", "c", "d"]) {
            store.seedRun(ranWorkspace(path), digestOf("an-old-digest"));
          }
          store.seedRun(
            ranWorkspace("b", ["failed"]),
            digestOf("an-old-digest"),
          );
        },
      },
      async (started) => {
        await flush();
        return runsIn(started.calls);
      },
    );
    expect(order).toStrictEqual(["run:b@1", "run:a@1", "run:c@1", "run:d@1"]);
  });

  it("D2744: a workspace whose latest run holds only an errored test runs before the rest, as one holding a failed test does", async () => {
    const order = await running(
      {
        workspaces: ["a", "b", "c"],
        seed: (store) => {
          currentResults("a", "b", "c")(store);
          for (const path of ["a", "c"]) {
            store.seedRun(ranWorkspace(path), digestOf("an-old-digest"));
          }
          store.seedRun(
            ranWorkspace("b", ["error"]),
            digestOf("an-old-digest"),
          );
        },
      },
      async (started) => {
        await flush();
        return runsIn(started.calls);
      },
    );
    expect(order).toStrictEqual(["run:b@1", "run:a@1", "run:c@1"]);
  });
});

describe("what a run leaves in the log", () => {
  it("D2743: a run stored not fingerprinted by a change that moved the input revision is not logged as run once more at its revision", async () => {
    const logged = await running(
      {
        ran: (_path, call) =>
          call === 0 ? { changedWhileRunning: true, movesRevision: true } : {},
      },
      async (started) => {
        await flush();
        return started.log.entries.filter((entry) =>
          entry.includes("runs once more"),
        );
      },
    );
    expect(logged).toStrictEqual([]);
  });

  it("D2745: a workspace whose latest run was stored under another adapter version is logged as due for that reason", async () => {
    const due = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(
            ranWorkspace("a"),
            digestOf("a-digest"),
            VITEST_ADAPTER_VERSION + 1,
          );
        },
      },
      async (started) => {
        await flush();
        return dueEntries(started.log);
      },
    );
    expect(due).toStrictEqual([
      "due: a, its latest run was stored under another adapter version",
    ]);
  });
});

describe("a step that throws", () => {
  it("D2674: a job that throws is logged, and the scheduler plans again at the next change of the input revision", async () => {
    const outcome = await running(
      { ran: (_path, call) => (call === 0 ? { throws: "boom" } : {}) },
      async (started) => {
        await flush();
        started.inputs.moveRevision();
        await flush();
        return {
          calls: [...started.calls],
          logged: started.log.entries.some((entry) =>
            entry.startsWith("error: a scheduling step failed"),
          ),
        };
      },
    );
    expect(outcome).toStrictEqual({
      calls: ["discover@1", "run:a@1", "run:a@2", "idle"],
      logged: true,
    });
  });
});

const IDLE_ACTIVITY: DaemonActivity = { state: "idle" };
const RUNNING_A: DaemonActivity = { state: "running", workspacePath: "a" };
const INSIDE_PATH = "a/src/a.ts";
const CHANGED_INSIDE_REASON = `its inputs changed while it ran: ${INSIDE_PATH}`;
const WATCHER_FAILED_REASON =
  "its inputs could not be vouched for while it ran: the watcher failed: ENOSPC";
const NO_CHANGED_PATHS: readonly ChangedPathReport[] = [];

/** What every answer reads of the schedule at the rig's input revision, while the daemon is doing `activity`. */
function scheduleOf(
  started: Rig,
  activity: DaemonActivity = IDLE_ACTIVITY,
): ReturnType<ScheduleReader["read"]> {
  const results = started.store.readLatestResults(SCOPE);
  const inputs = started.inputs.current();
  return started.scheduler.schedule.read({
    revision: inputs.facts.revision,
    activity,
    workspaces: results.discovery?.discovery.workspaces ?? [],
    latestRuns: new Map(
      results.latestRuns.map((run) => [run.run.workspace.path, run]),
    ),
    fingerprint: (entry) => inputs.workspaceFingerprint(entry),
  });
}

function executionOf(
  started: Rig,
  path: string,
  activity: DaemonActivity = IDLE_ACTIVITY,
): WorkspaceExecution | undefined {
  return scheduleOf(started, activity).schedule.workspaces.find(
    (execution) => execution.workspacePath === path,
  );
}

function roundOf(started: Rig): RoundFacts {
  return started.scheduler.schedule.round(started.inputs.revision);
}

function latestRunOf(started: Rig, path: string): StoredRun | undefined {
  return started.store
    .readLatestResults(SCOPE)
    .latestRuns.find((run) => run.run.workspace.path === path);
}

/** Results an earlier life stored for `paths` under a current discovery, each run under a digest its workspace no longer has. */
function staleResults(...paths: readonly string[]) {
  return (store: RecordingStore): void => {
    store.seedDiscovery(
      discovery(...paths.map(discovered)),
      digestOf(DISCOVERY_DIGEST),
    );
    for (const path of paths) {
      store.seedRun(ranWorkspace(path), digestOf("an-old-digest"));
    }
  };
}

/** A wait released at once for its calls before the one numbered `from`, counted from 1, and held until `released` from then on. */
function heldFrom(from: number, released: Promise<void>): () => Promise<void> {
  let calls = 0;
  return () => {
    calls += 1;
    return calls < from ? Promise.resolve() : released;
  };
}

function numbered<T>(count: number, item: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => item(index));
}

describe("the round every answer carries", () => {
  it("D2971: before the first reconciliation of the inputs ends, the round is pending on it", async () => {
    const round = await running(
      { script: { heldReconciliation: true } },
      async (started) => {
        await flush();
        return roundOf(started);
      },
    );
    expect(round).toStrictEqual({
      state: "pending",
      waitsFor: "first-reconciliation",
    });
  });

  it("D2972: while the quiet window waits, the round is pending on the input revision holding still", async () => {
    fakeClock();
    const round = await running(
      { quietWindowMs: QUIET_MS },
      async (started) => {
        await flush();
        return roundOf(started);
      },
    );
    expect(round).toStrictEqual({ state: "pending", waitsFor: "quiet-window" });
  });

  it("D2973: while the input events seen so far are unread, the round is pending on their being read", async () => {
    const round = await running(
      { script: { heldSettle: 0 } },
      async (started) => {
        await flush();
        return roundOf(started);
      },
    );
    expect(round).toStrictEqual({
      state: "pending",
      waitsFor: "inputs-settling",
    });
  });

  it("D2974: while the dependency build at the revision has not ended, the round is pending on it", async () => {
    const held = new Deferred<void>();
    const round = await running(
      { awaitBuild: () => held.promise },
      async (started) => {
        await flush();
        const round = roundOf(started);
        held.resolve();
        return round;
      },
    );
    expect(round).toStrictEqual({
      state: "pending",
      waitsFor: "dependency-build",
    });
  });

  it("D2975: while a rediscovery the round needs is in progress, the round is pending on it", async () => {
    const held = new Deferred<void>();
    const round = await running(
      { discoveryHeld: held.promise },
      async (started) => {
        await flush();
        const round = roundOf(started);
        held.resolve();
        return round;
      },
    );
    expect(round).toStrictEqual({ state: "pending", waitsFor: "rediscovery" });
  });

  it("D2976: once the revision moves while a run planned at an earlier one is in progress, the round is pending on that job", async () => {
    const held = new Deferred<void>();
    const round = await running(
      { ran: () => ({ held: held.promise }) },
      async (started) => {
        await flush();
        started.inputs.moveRevision();
        await flush();
        const round = roundOf(started);
        held.resolve();
        return round;
      },
    );
    expect(round).toStrictEqual({
      state: "pending",
      waitsFor: "job-in-progress",
    });
  });

  it("D2977: once a round has planned at the answer's revision, the round is planned at that revision", async () => {
    const round = await running(
      { seed: currentResults("a") },
      async (started) => {
        await flush();
        return roundOf(started);
      },
    );
    expect(round).toStrictEqual({ state: "planned", revision: 1 });
  });

  it("D2978: after a scheduling step fails, the round is held until the next input change, naming the failure", async () => {
    const round = await running(
      { ran: () => ({ throws: "boom" }) },
      async (started) => {
        await flush();
        return roundOf(started);
      },
    );
    expect(round).toStrictEqual({
      state: "held",
      failure: { reason: "boom", omittedCharacters: 0 },
    });
  });
});

/** Runs `body` while the run of `a`, the first of workspaces `a` and `b` due at the first round, is held begun. */
function whileARuns<T>(body: (started: Rig) => Promise<T>): Promise<T> {
  const held = new Deferred<void>();
  return running(
    {
      workspaces: ["a", "b"],
      ran: (path) => (path === "a" ? { held: held.promise } : {}),
    },
    async (started) => {
      await flush();
      try {
        return await body(started);
      } finally {
        held.resolve();
      }
    },
  );
}

/** Workspace `a`'s execution once a run the lifecycle reports interrupted by `paths` has returned, before the next round plans. */
function afterAnInterruption(
  paths: readonly string[],
): Promise<WorkspaceExecution | undefined> {
  const released = new Deferred<void>();
  return running(
    {
      seed: staleResults("a"),
      awaitBuild: heldFrom(2, released.promise),
      ran: (_path, call) =>
        call === 0
          ? { stored: false, interruptedBy: paths, movesRevision: true }
          : {},
    },
    async (started) => {
      await flush();
      const execution = executionOf(started, "a");
      released.resolve();
      return execution;
    },
  );
}

describe("each confirmed workspace's execution state", () => {
  it("D2979: a workspace reads running while the answer's activity names its run", async () => {
    const execution = await whileARuns(async (started) =>
      executionOf(started, "a", RUNNING_A),
    );
    expect(execution).toStrictEqual({ workspacePath: "a", state: "running" });
  });

  it("D2980: a workspace the round planned at the answer's revision found due, whose run has not begun, reads queued with its due reason", async () => {
    const execution = await whileARuns(async (started) =>
      executionOf(started, "b", RUNNING_A),
    );
    expect(execution).toStrictEqual({
      workspacePath: "b",
      state: "queued",
      due: { kind: "no-run" },
      chosenBy: { named: [], more: 0 },
    });
  });

  it("D2981: once the revision moves past the latest plan, a workspace that plan found due no longer reads queued", async () => {
    const state = await whileARuns(async (started) => {
      started.inputs.moveRevision();
      await flush();
      return executionOf(started, "b", RUNNING_A)?.state;
    });
    expect(state).toBe("idle");
  });

  it("D2982: while a round is pending, an idle workspace whose results are not current says nothing more", async () => {
    const execution = await whileARuns(async (started) => {
      started.inputs.moveRevision();
      await flush();
      return executionOf(started, "b", RUNNING_A);
    });
    expect(execution).toStrictEqual({ workspacePath: "b", state: "idle" });
  });

  it("D2983: a workspace whose run has returned no longer reads queued while the round that planned it is still in effect", async () => {
    const released = new Deferred<void>();
    const execution = await running(
      {
        workspaces: ["a", "b"],
        seed: staleResults("a", "b"),
        awaitBuild: heldFrom(2, released.promise),
      },
      async (started) => {
        await flush();
        const execution = executionOf(started, "a");
        released.resolve();
        return execution;
      },
    );
    expect(execution).toStrictEqual({ workspacePath: "a", state: "idle" });
  });

  it("D2984: a workspace whose run a change interrupted reads interrupted, naming the paths, until the next round decides it", async () => {
    expect(await afterAnInterruption([INSIDE_PATH])).toStrictEqual({
      workspacePath: "a",
      state: "interrupted",
      interruptedBy: { named: [INSIDE_PATH], more: 0 },
    });
  });

  it("D2985: once the next round finds an interrupted workspace due, it reads queued with its due reason and names the interruption's paths", async () => {
    const held = new Deferred<void>();
    const execution = await running(
      {
        seed: staleResults("a"),
        ran: (_path, call) =>
          call === 0
            ? {
                stored: false,
                interruptedBy: [INSIDE_PATH],
                movesRevision: true,
              }
            : { held: held.promise },
      },
      async (started) => {
        await flush();
        const execution = executionOf(started, "a");
        held.resolve();
        return execution;
      },
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: { kind: "inputs-changed" },
      chosenBy: { named: [], more: 0 },
      interruptedBy: { named: [INSIDE_PATH], more: 0 },
    });
  });

  it("D2986: an interruption names at most 20 of its paths and counts the rest, and names exactly 20 whole", async () => {
    const paths = numbered(21, (index) => `a/src/f${index}.ts`);
    const named = async (count: number): Promise<unknown> => {
      const execution = await afterAnInterruption(paths.slice(0, count));
      return execution?.state === "interrupted"
        ? execution.interruptedBy
        : execution;
    };
    const outcome = { over: await named(21), atBound: await named(20) };
    expect(outcome).toStrictEqual({
      over: { named: paths.slice(0, 20), more: 1 },
      atBound: { named: paths.slice(0, 20), more: 0 },
    });
  });

  it("D2987: an idle workspace whose latest run failed says a retry is pending, with its due reason", async () => {
    const execution = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
      },
      async (started) => {
        await flush();
        return executionOf(started, "a");
      },
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "idle",
      notRunning: { why: "retry-pending", due: { kind: "failed-run" } },
    });
  });

  it("D2988: an idle workspace held after its run was stored not fingerprinted twice at one revision says no run comes until the next input change, with the verdict's reason", async () => {
    const execution = await running(
      {
        ran: () => ({
          changedWhileRunning: true,
          notKept: { kind: "causes", reason: WATCHER_FAILED_REASON },
        }),
      },
      async (started) => {
        await flush();
        return executionOf(started, "a");
      },
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "idle",
      notRunning: {
        why: "no-run-until-input-change",
        due: {
          kind: "not-fingerprinted",
          detail: { reason: WATCHER_FAILED_REASON, omittedCharacters: 0 },
        },
      },
    });
  });

  it("D2989: after a scheduling step fails, a workspace that is not current says why no run has begun, with its due reason", async () => {
    const execution = await running(
      { ran: () => ({ throws: "boom" }) },
      async (started) => {
        await flush();
        return executionOf(started, "a");
      },
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "idle",
      notRunning: { why: "round-held", due: { kind: "no-run" } },
    });
  });

  it("D3089: under a held round, an idle workspace that is not current names the held round as why no run has begun, never that none comes until the next input change", async () => {
    const execution = await running(
      { ran: () => ({ throws: "boom" }) },
      async (started) => {
        await flush();
        return executionOf(started, "a");
      },
    );
    expect(
      execution?.state === "idle" ? execution.notRunning?.why : execution,
    ).toBe("round-held");
  });

  it("D3105: once the scheduler tries again after a failed step, the round is pending on its wait and no longer names the failure", async () => {
    const released = new Deferred<void>();
    const round = await running(
      {
        seed: staleResults("a"),
        awaitBuild: heldFrom(2, released.promise),
        ran: (_path, call) => (call === 0 ? { throws: "boom" } : {}),
      },
      async (started) => {
        await flush();
        started.inputs.moveRevision();
        await flush();
        const round = roundOf(started);
        released.resolve();
        return round;
      },
    );
    expect(round).toStrictEqual({
      state: "pending",
      waitsFor: "dependency-build",
    });
  });

  it("D3090: a workspace queued because its current input fingerprint cannot be computed names why", async () => {
    const held = new Deferred<void>();
    const execution = await running(
      {
        seed: currentResults("a"),
        script: {
          fingerprintOf: () => ({
            ok: false,
            reason: "the watcher failed: ENOSPC",
          }),
        },
        ran: () => ({ held: held.promise }),
      },
      async (started) => {
        await flush();
        const execution = executionOf(started, "a");
        held.resolve();
        return execution;
      },
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: {
        kind: "no-current-fingerprint",
        detail: { reason: "the watcher failed: ENOSPC", omittedCharacters: 0 },
      },
      chosenBy: { named: [], more: 0 },
    });
  });

  it("D3095: between two runs of one round at an unmoved revision, the round stays planned and the workspace still due reads queued", async () => {
    const released = new Deferred<void>();
    const outcome = await running(
      {
        workspaces: ["a", "b"],
        seed: staleResults("a", "b"),
        awaitBuild: heldFrom(2, released.promise),
      },
      async (started) => {
        await flush();
        const outcome = {
          round: roundOf(started),
          b: executionOf(started, "b"),
        };
        released.resolve();
        return outcome;
      },
    );
    expect(outcome).toStrictEqual({
      round: { state: "planned", revision: 1 },
      b: {
        workspacePath: "b",
        state: "queued",
        due: { kind: "inputs-changed" },
        chosenBy: { named: [], more: 0 },
      },
    });
  });

  it("D3096: once the revision moves while a discovery begun at an earlier one is in progress, the round is pending on that job", async () => {
    const held = new Deferred<void>();
    const round = await running(
      { discoveryHeld: held.promise },
      async (started) => {
        await flush();
        started.inputs.moveRevision();
        await flush();
        const round = roundOf(started);
        held.resolve();
        return round;
      },
    );
    expect(round).toStrictEqual({
      state: "pending",
      waitsFor: "job-in-progress",
    });
  });

  /** Workspace `a`'s execution once a first run the lifecycle reported as `first` has returned, before the next round plans. */
  function afterAFirstRun(first: RunResult): Promise<unknown> {
    const released = new Deferred<void>();
    return running(
      {
        seed: staleResults("a"),
        awaitBuild: heldFrom(2, released.promise),
        ran: (_path, call) => (call === 0 ? first : {}),
      },
      async (started) => {
        await flush();
        const execution = executionOf(started, "a");
        released.resolve();
        return execution;
      },
    );
  }

  it("D3097: a workspace whose run was stored not fingerprinted and is owed once more at an unmoved revision stays queued with that reason until it runs again", async () => {
    const execution = await afterAFirstRun(
      storedNotKept({ kind: "causes", reason: WATCHER_FAILED_REASON }),
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: {
        kind: "not-fingerprinted",
        detail: { reason: WATCHER_FAILED_REASON, omittedCharacters: 0 },
      },
      chosenBy: { named: [], more: 0 },
    });
  });

  it("D3098: a run that stored nothing, though its inputs changed at an unmoved revision, keeps the due reason its round gave rather than one read from an older run", async () => {
    const execution = await afterAFirstRun({
      stored: false,
      changedWhileRunning: true,
    });
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: { kind: "inputs-changed" },
      chosenBy: { named: [], more: 0 },
    });
  });

  /**
   * Workspace `a`'s execution while its run is held begun at the third revision, after a run a change interrupted
   * at the first and a second run that `second` scripts, followed by an edit of `a`'s inputs.
   */
  function queuedAfterALaterRun(second: RunResult): Promise<unknown> {
    const held = new Deferred<void>();
    const fingerprint = { digest: "a-digest" };
    return running(
      {
        seed: staleResults("a"),
        script: {
          fingerprintOf: () => ({ ok: true, digest: fingerprint.digest }),
        },
        ran: (_path, call) => {
          if (call === 0) {
            return {
              stored: false,
              interruptedBy: [INSIDE_PATH],
              movesRevision: true,
            };
          }
          return call === 1 ? second : { held: held.promise };
        },
      },
      async (started) => {
        await flush();
        fingerprint.digest = "a-edited";
        started.inputs.moveRevision();
        await flush();
        const execution = executionOf(started, "a");
        held.resolve();
        return execution;
      },
    );
  }

  it("D3031: a queued workspace names no interruption once a later run of it has ended", async () => {
    expect(await queuedAfterALaterRun({})).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: { kind: "inputs-changed" },
      chosenBy: { named: [], more: 0 },
    });
  });

  it("D3035: a queued workspace names no interruption once a later run of it has thrown", async () => {
    expect(await queuedAfterALaterRun({ throws: "boom" })).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: { kind: "inputs-changed" },
      chosenBy: { named: [], more: 0 },
    });
  });
});

/** Workspace `a`'s execution while its second run is held begun, after a first run the lifecycle reported as `first`. */
function queuedAfter(
  first: RunResult,
): Promise<WorkspaceExecution | undefined> {
  const held = new Deferred<void>();
  return running(
    {
      ran: (_path, call) => (call === 0 ? first : { held: held.promise }),
    },
    async (started) => {
      await flush();
      const execution = executionOf(started, "a");
      held.resolve();
      return execution;
    },
  );
}

function storedNotKept(verdict: NotKeptVerdict): RunResult {
  return { changedWhileRunning: true, notKept: verdict };
}

describe("the due reason of a run stored not fingerprinted", () => {
  it("D2990: a workspace queued after its run was stored not fingerprinted by a change inside its inputs reads invalidated, with the verdict's reason", async () => {
    const execution = await queuedAfter(
      storedNotKept({ kind: "changed-inside", reason: CHANGED_INSIDE_REASON }),
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: {
        kind: "invalidated",
        detail: { reason: CHANGED_INSIDE_REASON, omittedCharacters: 0 },
      },
      chosenBy: { named: [], more: 0 },
    });
  });

  it("D2991: a run stored not fingerprinted because its fingerprint moved while it ran reads invalidated", async () => {
    const reason = "its workspace's input fingerprint moved while it ran";
    const execution = await queuedAfter(
      storedNotKept({ kind: "moved", reason }),
    );
    expect(
      execution?.state === "queued" ? execution.due : execution,
    ).toStrictEqual({
      kind: "invalidated",
      detail: { reason, omittedCharacters: 0 },
    });
  });

  it("D2992: a run stored not fingerprinted for a cause that names no path is not called invalidated, and names its reason", async () => {
    const execution = await queuedAfter(
      storedNotKept({ kind: "causes", reason: WATCHER_FAILED_REASON }),
    );
    expect(
      execution?.state === "queued" ? execution.due : execution,
    ).toStrictEqual({
      kind: "not-fingerprinted",
      detail: { reason: WATCHER_FAILED_REASON, omittedCharacters: 0 },
    });
  });

  it("D2993: a run stored not fingerprinted before this daemon started reads as stored in an earlier daemon life", async () => {
    const held = new Deferred<void>();
    const execution = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(ranWorkspace("a"), UNFINGERPRINTED);
        },
        ran: () => ({ held: held.promise }),
      },
      async (started) => {
        await flush();
        const execution = executionOf(started, "a");
        held.resolve();
        return execution;
      },
    );
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: { kind: "earlier-daemon-life" },
      chosenBy: { named: [], more: 0 },
    });
  });

  it("D2994: a later run stored for the workspace never carries the invalidated label held for an earlier one", async () => {
    const held = new Deferred<void>();
    const label = await running(
      {
        ran: (_path, call) =>
          call === 0
            ? {
                ...storedNotKept({
                  kind: "changed-inside",
                  reason: CHANGED_INSIDE_REASON,
                }),
                movesRevision: true,
              }
            : { heldAfterStore: held.promise },
      },
      async (started) => {
        await flush();
        const latest = latestRunOf(started, "a");
        const label =
          latest === undefined
            ? "no run stored"
            : started.scheduler.schedule.invalidation(latest);
        held.resolve();
        return label;
      },
    );
    expect(label).toBeUndefined();
  });
});

/** A schedule whose round planned at revision 2 found each of `due` due by its changed inputs, read after `explanation`. */
function readAfter(
  explanation: RoundExplanation,
  due: readonly string[] = [],
): ReturnType<ScheduleReader["read"]> {
  const schedule = new WorkspaceSchedule({
    confirmed: () => true,
    storedNothing: () => false,
    heldBy: () => undefined,
  });
  schedule.planned(
    2,
    new Map(due.map((path) => [path, DUE_REASON.inputsChanged])),
  );
  schedule.selected(explanation);
  return schedule.read({
    revision: 2,
    activity: IDLE_ACTIVITY,
    workspaces: due.map(discovered),
    latestRuns: new Map(),
    fingerprint: (entry) => ({
      ok: true,
      digest: `${entry.workspace.path}-digest`,
    }),
  });
}

/** The explanation of a selection made at revision 2 over `paths` and `fallbacks`. */
function made(
  paths: readonly ChangedPathReport[],
  fallbacks: readonly BroadFallback[] = [],
): RoundExplanation {
  const { counts } = selectionOf([], []);
  return {
    revision: 2,
    state: ROUND_SELECTION.made,
    paths,
    fallbacks,
    counts,
  };
}

/** The reasons queued workspace `a` names for why the selection explained by `explanation` chose it. */
function chosenByOf(explanation: RoundExplanation): unknown {
  const [execution] = readAfter(explanation, ["a"]).schedule.workspaces;
  return execution?.state === "queued" ? execution.chosenBy : execution;
}

/** Changed path `lib/f<index>.ts`, owned by no package workspace, selecting `selected`. */
function numberedPath(
  index: number,
  selected: readonly string[] = [],
  more: Parameters<typeof pathReport>[3] = {},
): ChangedPathReport {
  return pathReport(`lib/f${index}.ts`, undefined, selected, more);
}

describe("the reasons the latest selection chose a queued workspace", () => {
  it("D2995: a queued workspace names the changed path and trigger by which the latest round's selection chose it", async () => {
    const held = new Deferred<void>();
    const change = afterAChange(
      builtAt(
        2,
        new StandInNarrowing(
          selectionOf([pathReport("lib/x.ts", "a", ["a"])], ["a"]),
        ),
      ),
      { seed: beforeTheChange("a"), ran: () => ({ held: held.promise }) },
    );
    const execution = await running(change.options, async (started) => {
      await change.nextRound(started);
      const execution = executionOf(started, "a");
      held.resolve();
      return execution;
    });
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "queued",
      due: { kind: "inputs-changed" },
      chosenBy: {
        named: [{ path: "lib/x.ts", trigger: "changed-path" }],
        more: 0,
      },
    });
  });

  it("D2996: a queued workspace names at most 3 of the reasons that chose it and counts the rest, and names exactly 3 whole", () => {
    const chosen = (count: number): unknown =>
      chosenByOf(made(numbered(count, (index) => numberedPath(index, ["a"]))));
    const reasons = numbered(3, (index) => ({
      path: `lib/f${index}.ts`,
      trigger: "changed-path",
    }));
    expect({ over: chosen(4), atBound: chosen(3) }).toStrictEqual({
      over: { named: reasons, more: 1 },
      atBound: { named: reasons, more: 0 },
    });
  });

  it("D2997: a reason that is a broad fallback names the fallback's scope", () => {
    const report: ChangedPathReport = {
      ...pathReport("package.json", undefined, []),
      triggers: [TRIGGER.manifest],
      selected: [
        {
          workspace: "a",
          reasons: [
            {
              path: "package.json",
              trigger: TRIGGER.manifest,
              from: undefined,
              steps: [],
            },
          ],
        },
      ],
      nothingSelected: undefined,
    };
    const fallback: BroadFallback = {
      path: "package.json",
      trigger: TRIGGER.manifest,
      scope: FALLBACK_SCOPE.project,
      workspaces: ["a"],
    };
    expect(chosenByOf(made([report], [fallback]))).toStrictEqual({
      named: [{ path: "package.json", trigger: "manifest", scope: "project" }],
      more: 0,
    });
  });

  it("D2998: a reason whose changed path the explanation leaves past its 20 is counted and not named, and one on the 20th path is named", () => {
    const chosenAt = (position: number): unknown =>
      chosenByOf(
        made(
          numbered(21, (index) =>
            numberedPath(index, index === position ? ["a"] : []),
          ),
        ),
      );
    expect({ past: chosenAt(20), last: chosenAt(19) }).toStrictEqual({
      past: { named: [], more: 1 },
      last: {
        named: [{ path: "lib/f19.ts", trigger: "changed-path" }],
        more: 0,
      },
    });
  });
});

describe("the latest selection every answer carries", () => {
  it("D2999: before any round has planned in this daemon life, the answer says so", async () => {
    const selection = await running(
      { script: { heldReconciliation: true } },
      async (started) => {
        await flush();
        return scheduleOf(started).latestSelection;
      },
    );
    expect(selection).toStrictEqual({ state: "no-round-yet" });
  });

  it("D3000: a first round, with no earlier round to compare with, made no selection and says why", async () => {
    const selection = await running(
      {
        seed: currentResults("a"),
        script: { snapshot: () => inputsOf(DIGESTS_BEFORE) },
      },
      async (started) => {
        await flush();
        return scheduleOf(started).latestSelection;
      },
    );
    expect(selection).toStrictEqual({
      state: "not-made",
      revision: 1,
      kind: "first-round",
      reason: {
        reason: "no previous round read the inputs to compare with",
        omittedCharacters: 0,
      },
    });
  });

  it("D3001: a round whose inputs' digests could not be read made no selection and says why", async () => {
    const selection = await running(
      { seed: currentResults("a") },
      async (started) => {
        await flush();
        return scheduleOf(started).latestSelection;
      },
    );
    expect(selection).toStrictEqual({
      state: "not-made",
      revision: 1,
      kind: "input-digests-unread",
      reason: {
        reason: "the inputs' digests cannot be read now",
        omittedCharacters: 0,
      },
    });
  });

  it("D3002: a round's selection is explained at its revision: each changed path with its owner and the workspaces it selected with their reasons, the fallbacks and the counts", async () => {
    const change = afterAChange(
      builtAt(
        2,
        new StandInNarrowing(
          selectionOf([pathReport("lib/x.ts", "a", ["a"])], ["a"]),
        ),
      ),
      { seed: beforeTheChange("a") },
    );
    const selection = await running(change.options, async (started) => {
      await change.nextRound(started);
      return scheduleOf(started).latestSelection;
    });
    expect(selection).toStrictEqual({
      state: "made",
      revision: 2,
      paths: {
        named: [
          {
            path: "lib/x.ts",
            owner: "a",
            triggers: ["changed-path"],
            selected: {
              named: [
                {
                  workspace: "a",
                  reasons: [
                    {
                      path: "lib/x.ts",
                      trigger: "changed-path",
                      from: undefined,
                      steps: [],
                    },
                  ],
                },
              ],
              more: 0,
            },
            notRunnable: { named: [], more: 0 },
            nothingSelected: undefined,
          },
        ],
        more: 0,
      },
      fallbacks: { named: [], more: 0 },
      counts: {
        selectedTests: { count: 1, complete: true },
        totalTests: { count: 4, complete: true },
        selectedWorkspaces: 1,
        totalWorkspaces: { count: 4, complete: true },
        notRunnableWorkspaces: 0,
      },
    });
  });

  it("D3003: a round whose dependency build failed made no selection, giving the build's kind and reason", async () => {
    const change = afterAChange(
      failedAt(2, DEPENDENCY_BUILD_FAILED, "the build died"),
      { seed: beforeTheChange("a") },
    );
    const selection = await running(change.options, async (started) => {
      await change.nextRound(started);
      return scheduleOf(started).latestSelection;
    });
    expect(selection).toStrictEqual({
      state: "not-made",
      revision: 2,
      kind: "dependency-build-failed",
      reason: { reason: "the build died", omittedCharacters: 0 },
    });
  });

  it("D3004: a round whose selection refused the change made no selection, giving the refusal's reason", async () => {
    const reason = "the changed path cannot be attributed";
    const change = afterAChange(
      builtAt(2, new StandInNarrowing(refusedSelection("src/x.ts", reason))),
      { seed: beforeTheChange("a") },
    );
    const selection = await running(change.options, async (started) => {
      await change.nextRound(started);
      return scheduleOf(started).latestSelection;
    });
    expect(selection).toStrictEqual({
      state: "not-made",
      revision: 2,
      kind: "selection-refused",
      reason: { reason, omittedCharacters: 0 },
    });
  });

  it("D3005: a round whose build wait was released with no build ended at its revision made no selection and says so", async () => {
    const change = afterAChange(NO_BUILD_ENDED, {
      seed: beforeTheChange("a"),
    });
    const selection = await running(change.options, async (started) => {
      await change.nextRound(started);
      return scheduleOf(started).latestSelection;
    });
    expect(selection).toStrictEqual({
      state: "not-made",
      revision: 2,
      kind: "no-build-ended",
      reason: {
        reason:
          "no dependency build ended at this input revision, because the wait for it was released",
        omittedCharacters: 0,
      },
    });
  });
});

describe("the bounds on the latest selection's explanation", () => {
  const WORKSPACES = numbered(21, (index) => `w${index}`);
  const PATHS = numbered(20, (index) => `lib/f${index}.ts`);

  /** The explanation read from `explanation`, when the selection was made. */
  function madeRead(explanation: RoundExplanation) {
    const selection = readAfter(explanation).latestSelection;
    if (selection.state !== ROUND_SELECTION.made) {
      throw new Error(`no selection was read: ${selection.state}`);
    }
    return selection;
  }

  it("D3006: an answer names at most 20 changed paths and counts the rest, and names exactly 20 whole", () => {
    const named = (count: number): unknown => {
      const { paths } = madeRead(
        made(numbered(count, (index) => numberedPath(index))),
      );
      return { named: paths.named.map(({ path }) => path), more: paths.more };
    };
    expect({ over: named(21), atBound: named(20) }).toStrictEqual({
      over: { named: PATHS, more: 1 },
      atBound: { named: PATHS, more: 0 },
    });
  });

  it("D3007: an answer names at most 20 broad fallbacks and counts the rest, and names exactly 20 whole", () => {
    const named = (count: number): unknown => {
      const { fallbacks } = madeRead(
        made(
          NO_CHANGED_PATHS,
          numbered(count, (index) => ({
            path: `lib/f${index}.ts`,
            trigger: TRIGGER.manifest,
            scope: FALLBACK_SCOPE.project,
            workspaces: ["a"],
          })),
        ),
      );
      return {
        named: fallbacks.named.map(({ path }) => path),
        more: fallbacks.more,
      };
    };
    expect({ over: named(21), atBound: named(20) }).toStrictEqual({
      over: { named: PATHS, more: 1 },
      atBound: { named: PATHS, more: 0 },
    });
  });

  it("D3008: a changed path names at most 20 of the workspaces it selected and counts the rest, and names exactly 20 whole", () => {
    const named = (count: number): unknown => {
      const [path] = madeRead(
        made([numberedPath(0, WORKSPACES.slice(0, count))]),
      ).paths.named;
      return {
        named: path?.selected.named.map(({ workspace }) => workspace),
        more: path?.selected.more,
      };
    };
    expect({ over: named(21), atBound: named(20) }).toStrictEqual({
      over: { named: WORKSPACES.slice(0, 20), more: 1 },
      atBound: { named: WORKSPACES.slice(0, 20), more: 0 },
    });
  });

  it("D3009: a changed path names at most 20 of the workspaces it reached that cannot run and counts the rest, and names exactly 20 whole", () => {
    const named = (count: number): unknown => {
      const [path] = madeRead(
        made([
          numberedPath(0, ["a"], {
            notRunnable: WORKSPACES.slice(0, count).map((name) => ({
              workspace: workspace(name),
              reason: "its config file could not be loaded",
            })),
          }),
        ]),
      ).paths.named;
      return {
        named: path?.notRunnable.named.map(({ workspace }) => workspace.path),
        more: path?.notRunnable.more,
      };
    };
    expect({ over: named(21), atBound: named(20) }).toStrictEqual({
      over: { named: WORKSPACES.slice(0, 20), more: 1 },
      atBound: { named: WORKSPACES.slice(0, 20), more: 0 },
    });
  });

  it("D3010: a broad fallback names at most 20 of its workspaces and counts the rest, and names exactly 20 whole", () => {
    const named = (count: number): unknown => {
      const [fallback] = madeRead(
        made(NO_CHANGED_PATHS, [
          {
            path: "package.json",
            trigger: TRIGGER.manifest,
            scope: FALLBACK_SCOPE.project,
            workspaces: WORKSPACES.slice(0, count),
          },
        ]),
      ).fallbacks.named;
      return fallback?.workspaces;
    };
    expect({ over: named(21), atBound: named(20) }).toStrictEqual({
      over: { named: WORKSPACES.slice(0, 20), more: 1 },
      atBound: { named: WORKSPACES.slice(0, 20), more: 0 },
    });
  });

  it("D3011: why no selection was made is cut to 1,000 characters, counting the rest, and one of exactly 1,000 is whole", () => {
    const kept = "r".repeat(1000);
    const cut = (reason: string): unknown => {
      const selection = readAfter({
        revision: 2,
        state: ROUND_SELECTION.notMade,
        kind: SELECTION_REFUSED,
        reason,
      }).latestSelection;
      return selection.state === ROUND_SELECTION.notMade
        ? selection.reason
        : selection;
    };
    expect({ over: cut(`${kept}#####`), atLimit: cut(kept) }).toStrictEqual({
      over: { reason: kept, omittedCharacters: 5 },
      atLimit: { reason: kept, omittedCharacters: 0 },
    });
  });

  it("D3012: why a workspace a changed path reached cannot run is cut to 1,000 characters, counting the rest", () => {
    const kept = "r".repeat(1000);
    const [path] = madeRead(
      made([
        numberedPath(0, ["a"], {
          notRunnable: [{ workspace: workspace("w0"), reason: `${kept}#####` }],
        }),
      ]),
    ).paths.named;
    expect(path?.notRunnable.named).toStrictEqual([
      { workspace: workspace("w0"), reason: kept, omittedCharacters: 5 },
    ]);
  });

  it("D3087: the detail of each step a selection reason passed through is cut to 1,000 characters, counting the rest, and one of exactly 1,000 is whole", () => {
    const kept = "r".repeat(1000);
    const detailOf = (detail: string): unknown => {
      const [path] = madeRead(
        made([
          numberedPath(0, ["a"], {
            steps: [
              { workspace: "a", via: UNCERTAINTY.unresolvedOverride, detail },
            ],
          }),
        ]),
      ).paths.named;
      return path?.selected.named[0]?.reasons[0]?.steps[0]?.detail;
    };
    expect({
      over: detailOf(`${kept}#####`),
      atLimit: detailOf(kept),
    }).toStrictEqual({
      over: { reason: kept, omittedCharacters: 5 },
      atLimit: { reason: kept, omittedCharacters: 0 },
    });
  });
});

const FIXTURE = "a/fixture.json";
const SOURCE = "a/src/a.ts";
const OTHER = "a/other.json";
const WATCHER_FAILED = "the watcher failed: ENOSPC";
/** How many runs of `a` do what a test gives them before its runs change nothing, so a loop never held still ends. */
const REWRITES = 6;
/** The runs of `a` when no count holds it: each run a test gives, then one that changes nothing. */
const NEVER_HELD_RUNS = REWRITES + 1;
/** Flushes a loop of rounds may take before the test reads it anyway. */
const QUIET_FLUSHES = 50;

function changedInside(paths: readonly string[]): NotKeptVerdict {
  return {
    kind: "changed-inside",
    reason: `its inputs changed while it ran: ${paths.join(", ")}`,
  };
}

/**
 * A run that rewrote `paths` while it ran, moving the input revision: interrupted by them, or, when no change may
 * interrupt it, stored invalidated by them, as the lifecycle reports each.
 */
function rewrote(
  uninterruptible: string | undefined,
  paths: readonly string[] = [FIXTURE],
): RunResult {
  const job = {
    changed: paths,
    changedWhileRunning: true,
    movesRevision: true,
  };
  return uninterruptible === undefined
    ? { ...job, stored: false, interruptedBy: paths }
    : { ...job, notKept: changedInside(paths) };
}

/** Committed digests that hold still until the test edits one or makes them unreadable. */
class SteadyDigests {
  unreadable = false;
  #digests: Readonly<Record<string, string>> = {
    [FIXTURE]: "1",
    [SOURCE]: "1",
  };

  readonly script: InputsScript = {
    snapshot: () => (this.unreadable ? undefined : inputsOf(this.#digests)),
  };

  /** Changes `path`'s digest, as an edit does. */
  edit(path: string): void {
    this.#digests = { ...this.#digests, [path]: "edited" };
  }
}

interface Rewriting {
  /** What each run of `a` leaves, given its index from 0 and why no change may interrupt it; `rewrote` when absent. */
  readonly ran?: (
    call: number,
    uninterruptible: string | undefined,
  ) => RunResult;
  readonly options?: RigOptions;
  readonly digests?: SteadyDigests;
  /** Runs once the rounds have run out; the outcome is read once the rounds it starts have too. */
  readonly afterRuns?: (started: Rig) => void | Promise<void>;
}

interface Rewritten {
  readonly runs: readonly string[];
  readonly entries: readonly string[];
  readonly execution: WorkspaceExecution | undefined;
  /** Why no change could interrupt each run of `a`, undefined for a run a change could. */
  readonly uninterruptible: readonly (string | undefined)[];
}

/** Flushes until a flush begins no job, so a loop of rounds has run out. */
async function untilQuiet(started: Rig): Promise<void> {
  for (let flushes = 0; flushes < QUIET_FLUSHES; flushes += 1) {
    const before = started.calls.length;
    await flush();
    if (started.calls.length === before) return;
  }
}

/** Workspace `a` over digests that hold still, whose first `REWRITES` runs each do what `ran` gives them. */
function rewriting(setup: Rewriting = {}): Promise<Rewritten> {
  const digests = setup.digests ?? new SteadyDigests();
  const ran = setup.ran ?? ((_call, reason) => rewrote(reason));
  const options = setup.options ?? {};
  const uninterruptible: (string | undefined)[] = [];
  return running(
    {
      ...options,
      script: { ...digests.script, ...options.script },
      ran: (path, call, reason) => {
        if (path !== "a") return options.ran?.(path, call, reason) ?? {};
        uninterruptible.push(reason);
        return call < REWRITES ? ran(call, reason) : {};
      },
    },
    async (started) => {
      await untilQuiet(started);
      await setup.afterRuns?.(started);
      await untilQuiet(started);
      return {
        runs: runsIn(started.calls),
        entries: [...started.log.entries],
        execution: executionOf(started, "a"),
        uninterruptible,
      };
    },
  );
}

async function runsOfA(setup: Rewriting): Promise<number> {
  return (await rewriting(setup)).runs.length;
}

function selfChangedOf(execution: WorkspaceExecution | undefined): unknown {
  return execution?.state === "idle"
    ? execution.notRunning?.selfChanged
    : execution;
}

/** Each discovery's fingerprint differs from the one it is stored under, so each input revision rediscovers. */
const REDISCOVERED: InputsScript = {
  discoveryFingerprintOf: () => ({ ok: true, digest: "moved" }),
};

describe("holding a workspace whose runs keep changing its inputs", () => {
  it("D3138: a workspace is held once it became due 3 times in a row through its jobs' changes", () => {
    expect(SELF_CHANGE_HOLD_COUNT).toBe(3);
  });

  it("D3139: a workspace each of whose runs rewrites one of its own inputs runs three times and no more", async () => {
    expect((await rewriting()).runs).toStrictEqual([
      "run:a@1",
      "run:a@2",
      "run:a@3",
    ]);
  });

  it("D3140: the log says once, as the hold begins, that the workspace is held, naming the path and the job that changed it", async () => {
    const { entries } = await rewriting();
    expect(
      entries
        .filter((entry) => entry.startsWith("held: a "))
        .map((entry) => ({
          path: entry.includes(FIXTURE),
          job: entry.includes("during the run of a"),
        })),
    ).toStrictEqual([{ path: true, job: true }]);
  });

  it("D3141: only the run begun at a count of 2 is told no change may interrupt it, and why, naming the path", async () => {
    const { uninterruptible } = await rewriting();
    expect(
      uninterruptible.map((reason) =>
        reason === undefined ? "interruptible" : reason.includes(FIXTURE),
      ),
    ).toStrictEqual(["interruptible", "interruptible", true]);
  });

  it("D3142: an edit inside a workspace's inputs between two of its runs starts its count again from 0", async () => {
    const digests = new SteadyDigests();
    const runs = await runsOfA({
      digests,
      ran: (call, reason) =>
        call === 1
          ? { ...rewrote(reason), afterEnd: () => digests.edit(SOURCE) }
          : rewrote(reason),
    });
    expect(runs).toBe(5);
  });

  it("D3143: an edit inside a held workspace's inputs releases it, and its count starts again from 0", async () => {
    const digests = new SteadyDigests();
    const runs = await runsOfA({
      digests,
      afterRuns: (started) => {
        digests.edit(SOURCE);
        started.inputs.moveRevision();
      },
    });
    expect(runs).toBe(6);
  });

  it("D3244: an edit between jobs to a listed file the inputs leave out releases a held workspace, though the inputs' digests held still", async () => {
    const listed = { digest: "1" };
    const runs = await runsOfA({
      options: {
        script: {
          snapshot: () =>
            inputsOf(
              { [FIXTURE]: "1", [SOURCE]: "1" },
              { [LISTED_SETUP]: listed.digest },
            ),
        },
      },
      afterRuns: (started) => {
        listed.digest = "edited";
        started.inputs.moveRevision();
      },
    });
    expect(runs).toBe(6);
  });

  it("D3144: the log says once that an edit released a held workspace", async () => {
    const digests = new SteadyDigests();
    const { entries } = await rewriting({
      digests,
      afterRuns: (started) => {
        digests.edit(SOURCE);
        started.inputs.moveRevision();
      },
    });
    expect(
      entries.filter((entry) => entry.startsWith("a is no longer held")),
    ).toHaveLength(1);
  });

  it("D3145: a cause naming no path recorded while a run ran counts as an edit, starting the count again from 0", async () => {
    const runs = await runsOfA({
      ran: (call, reason) =>
        call === 1
          ? { ...rewrote(reason), causes: [WATCHER_FAILED] }
          : rewrote(reason),
    });
    expect(runs).toBe(5);
  });

  it("D3146: committed digests a round cannot read count as an edit, releasing a held workspace", async () => {
    const digests = new SteadyDigests();
    const runs = await runsOfA({
      digests,
      ran: (call, reason) => {
        if (call === 3) digests.unreadable = false;
        return rewrote(reason);
      },
      afterRuns: (started) => {
        digests.unreadable = true;
        started.inputs.moveRevision();
      },
    });
    expect(runs).toBe(6);
  });

  it("D3147: a workspace whose inputs each discovery changes is held, the answer naming the discovery as the job", async () => {
    const moves = { count: 0 };
    const { execution } = await rewriting({
      options: {
        discoveryChanged: () => [FIXTURE],
        script: {
          ...REDISCOVERED,
          fingerprintOf: (path) => ({
            ok: true,
            digest: `${path}-digest-${moves.count}`,
          }),
        },
      },
      ran: () => ({
        afterEnd: () => {
          moves.count += 1;
        },
        movesRevision: true,
      }),
    });
    expect(selfChangedOf(execution)).toStrictEqual({
      named: [{ path: FIXTURE, jobs: { named: [{}], more: 0 } }],
      more: 0,
    });
  });

  it("D3148: a time that shares no changed path with the times before it starts the count again at 1", async () => {
    const runs = await runsOfA({
      ran: (call, reason) => rewrote(reason, call === 0 ? [OTHER] : [FIXTURE]),
    });
    expect(runs).toBe(4);
  });

  it("D3149: a held workspace names only the paths that changed in every one of its counted times", async () => {
    const { execution } = await rewriting({
      ran: (call, reason) =>
        rewrote(reason, call < 2 ? [FIXTURE, OTHER] : [FIXTURE]),
    });
    const named =
      execution?.state === "idle"
        ? execution.notRunning?.selfChanged?.named.map(({ path }) => path)
        : execution;
    expect(named).toStrictEqual([FIXTURE]);
  });

  it("D3150: a held workspace reads idle and self-changing, beside its due reason, naming each path and the run that changed it", async () => {
    const { execution } = await rewriting();
    expect(execution).toStrictEqual({
      workspacePath: "a",
      state: "idle",
      notRunning: {
        why: "self-changing",
        due: {
          kind: "invalidated",
          detail: {
            reason: `its inputs changed while it ran: ${FIXTURE}`,
            omittedCharacters: 0,
          },
        },
        selfChanged: {
          named: [
            {
              path: FIXTURE,
              jobs: { named: [{ workspacePath: "a" }], more: 0 },
            },
          ],
          more: 0,
        },
      },
    });
  });

  it("D3156: a periodic reconciliation retries no held workspace, though its latest run failed", async () => {
    const { entries } = await rewriting({
      ran: (call, reason) =>
        call === 2
          ? { ...rewrote(reason), run: failedRun("a") }
          : rewrote(reason),
      afterRuns: (started) => started.inputs.endPeriodicReconciliation(),
    });
    expect(
      entries.filter((entry) =>
        entry.startsWith("periodic reconciliation ended"),
      ),
    ).toStrictEqual([]);
  });

  it("D3157: a workspace due only for a periodic retry is never counted, so failed runs that change its inputs are retried at each one", async () => {
    const runs = await runsOfA({
      ran: () => ({ run: failedRun("a"), changed: [FIXTURE] }),
      afterRuns: async (started) => {
        for (let retry = 0; retry < 4; retry += 1) {
          started.inputs.endPeriodicReconciliation();
          await untilQuiet(started);
        }
      },
    });
    expect(runs).toBe(5);
  });

  it("D3158: a workspace whose current fingerprint cannot be computed is never counted", async () => {
    const runs = await runsOfA({
      options: {
        script: {
          fingerprintOf: () => ({ ok: false, reason: WATCHER_FAILED }),
        },
      },
      ran: () => ({ changed: [FIXTURE], movesRevision: true }),
    });
    expect(runs).toBe(NEVER_HELD_RUNS);
  });

  it("D3159: a run stored not fingerprinted for a cause that names no path is not a counted time", async () => {
    const runs = await runsOfA({
      ran: () => ({
        changed: [FIXTURE],
        changedWhileRunning: true,
        notKept: { kind: "causes", reason: WATCHER_FAILED_REASON },
        movesRevision: true,
      }),
    });
    expect(runs).toBe(NEVER_HELD_RUNS);
  });

  it("D3160: a run that stored nothing though no change interrupted it is not a counted time", async () => {
    const runs = await runsOfA({
      ran: () => ({
        changed: [FIXTURE],
        stored: false,
        changedWhileRunning: true,
        movesRevision: true,
      }),
    });
    expect(runs).toBe(NEVER_HELD_RUNS);
  });

  it("D3161: a run that never began leaves the run before it as the last run begun, so its count follows that run", async () => {
    const runs = await runsOfA({
      ran: (call, reason) =>
        call === 1 ? { notBegun: true, movesRevision: true } : rewrote(reason),
    });
    expect(runs).toBe(4);
  });

  it("D3162: a placement that throws counts as an edit to the workspace's inputs, so it never holds it", async () => {
    const at = { revision: 1 };
    const narrowing = new StandInNarrowing(selectionOf([], []));
    const runs = await runsOfA({
      options: { narrowing: () => builtAt(at.revision, narrowing) },
      ran: (_call, reason) => ({
        ...rewrote(reason),
        afterEnd: () => {
          at.revision += 1;
        },
      }),
    });
    expect(runs).toBe(NEVER_HELD_RUNS);
  });

  it("D3165: a workspace reads as edited once more than 1,000 distinct paths changed since its last run began", () => {
    expect(MAX_COUNTED_CHANGES).toBe(1000);
  });

  /** The runs of `a`, each rewriting 500 paths, whose inputs each rediscovery changes at `discovered` more paths. */
  function runsBesideRediscoveries(discovered: number): Promise<number> {
    const own = [FIXTURE, ...numbered(499, (index) => `a/out/r${index}.json`)];
    return runsOfA({
      options: {
        script: REDISCOVERED,
        discoveryChanged: () =>
          numbered(discovered, (index) => `a/out/d${index}.json`),
      },
      ran: (_call, reason) => rewrote(reason, own),
    });
  }

  it("D3163: a workspace for which exactly 1,000 distinct paths changed since its last run began is still counted", async () => {
    expect(await runsBesideRediscoveries(500)).toBe(3);
  });

  it("D3164: a workspace for which 1,001 distinct paths changed since its last run began reads as edited", async () => {
    expect(await runsBesideRediscoveries(501)).toBe(NEVER_HELD_RUNS);
  });
});

const HELD_BY_A: JobsByPath = new Map([[FIXTURE, new Set(["a"])]]);

/**
 * Workspace `a`'s execution in a schedule whose count holds it by `held`, once `round` has set the round, its latest run
 * `latest` stored under `fingerprint` and its current fingerprint `a-digest`.
 */
function heldExecution(
  round: (schedule: WorkspaceSchedule) => void,
  held: JobsByPath = HELD_BY_A,
  latest: WorkspaceRun = ranWorkspace("a"),
  fingerprint: StoredRun["inputFingerprint"] = UNFINGERPRINTED,
): WorkspaceExecution | undefined {
  const schedule = new WorkspaceSchedule({
    confirmed: () => true,
    storedNothing: () => false,
    heldBy: (path) => (path === "a" ? held : undefined),
  });
  round(schedule);
  const stored: StoredRun = {
    ...SCOPE,
    inputFingerprint: fingerprint,
    adapterVersion: VITEST_ADAPTER_VERSION,
    runId: "run-0",
    run: latest,
  };
  const [execution] = schedule.read({
    revision: 2,
    activity: IDLE_ACTIVITY,
    workspaces: [discovered("a")],
    latestRuns: new Map([["a", stored]]),
    fingerprint: () => ({ ok: true, digest: "a-digest" }),
  }).schedule.workspaces;
  return execution;
}

const plannedAt2 = (schedule: WorkspaceSchedule): void => {
  schedule.planned(2, new Map());
};

function whyOf(execution: WorkspaceExecution | undefined): unknown {
  return execution?.state === "idle" ? execution.notRunning?.why : execution;
}

describe("the answer for a held workspace", () => {
  it("D3151: a held workspace reads self-changing while the round is held after a failed step", () => {
    const execution = heldExecution((schedule) => schedule.held("boom"));
    expect(whyOf(execution)).toBe("self-changing");
  });

  it("D3152: a held workspace whose latest run failed reads self-changing, not retry-pending", () => {
    const execution = heldExecution(
      plannedAt2,
      HELD_BY_A,
      failedRun("a"),
      digestOf("a-digest"),
    );
    expect(whyOf(execution)).toBe("self-changing");
  });

  it("D3153: while a round is pending, a held workspace says nothing more", () => {
    expect(heldExecution(() => undefined)).toStrictEqual({
      workspacePath: "a",
      state: "idle",
    });
  });

  it("D3154: a held workspace names at most 20 of its paths and counts the rest, and names exactly 20 whole", () => {
    const paths = numbered(21, (index) => `a/f${index}.json`);
    const listed = (count: number): unknown =>
      selfChangedOf(
        heldExecution(
          plannedAt2,
          new Map(paths.slice(0, count).map((path) => [path, new Set(["a"])])),
        ),
      );
    const named = paths.slice(0, 20).map((path) => ({
      path,
      jobs: { named: [{ workspacePath: "a" }], more: 0 },
    }));
    expect({ over: listed(21), atBound: listed(20) }).toStrictEqual({
      over: { named, more: 1 },
      atBound: { named, more: 0 },
    });
  });

  it("D3155: a held workspace names at most 20 jobs for each path and counts the rest, and names exactly 20 whole", () => {
    const jobs = numbered(21, (index) => `w${index}`);
    const listed = (count: number): unknown =>
      selfChangedOf(
        heldExecution(
          plannedAt2,
          new Map([[FIXTURE, new Set(jobs.slice(0, count))]]),
        ),
      );
    const named = jobs.slice(0, 20).map((workspacePath) => ({ workspacePath }));
    expect({ over: listed(21), atBound: listed(20) }).toStrictEqual({
      over: { named: [{ path: FIXTURE, jobs: { named, more: 1 } }], more: 0 },
      atBound: {
        named: [{ path: FIXTURE, jobs: { named, more: 0 } }],
        more: 0,
      },
    });
  });
});

describe("the jobs a held workspace names", () => {
  it("D3180: a held workspace names every job that changed its shared path in any counted time, not only in the latest", async () => {
    const moves = { count: 0 };
    const moved = (): void => {
      moves.count += 1;
    };
    const { execution } = await rewriting({
      options: {
        discoveryChanged: () => [FIXTURE],
        script: {
          ...REDISCOVERED,
          fingerprintOf: (path) => ({
            ok: true,
            digest: `${path}-digest-${moves.count}`,
          }),
        },
      },
      ran: (call) => ({
        ...(call === 0 ? { changed: [FIXTURE] } : {}),
        afterEnd: moved,
        movesRevision: true,
      }),
    });
    expect(selfChangedOf(execution)).toStrictEqual({
      named: [
        {
          path: FIXTURE,
          jobs: { named: [{ workspacePath: "a" }, {}], more: 0 },
        },
      ],
      more: 0,
    });
  });
});
