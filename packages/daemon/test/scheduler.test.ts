import { describe, expect, it, vi } from "vitest";
import {
  QUIET_WINDOW_MS,
  Scheduler,
  type RunReport,
} from "../src/daemon/scheduler.js";
import {
  DEPENDENCY_BUILD_FAILED,
  SELECTION_REFUSED,
  type BuildFailureKind,
} from "../src/query/answer.js";
import {
  FALLBACK_SCOPE,
  TRIGGER,
  UNCERTAINTY,
} from "../src/selection/selection-types.js";
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
  /** Makes the job end without having begun, as a stop or a moved revision does. */
  readonly notBegun?: boolean;
  /** Moves the input revision once the job has stored its record, as an edit during the job would. */
  readonly movesRevision?: boolean;
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
  /** What each run leaves, given the workspace and the run's index for it from 0. */
  readonly ran?: (path: string, call: number) => RunResult;
}

interface Rig {
  readonly inputs: StandInInputs;
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
      await nextTurn();
      if (options.discoveryBegins?.(call) === false) return undefined;
      const stored = options.discoveryStored?.(call) ?? true;
      if (stored) {
        store.writeDiscovery(
          { ...SCOPE, inputFingerprint: digestOf(DISCOVERY_DIGEST) },
          options.listed?.(call) ?? discovery(...paths.map(discovered)),
        );
      }
      return { stored };
    },
    run: async (entry, revision): Promise<RunReport | undefined> => {
      const path = entry.workspace.path;
      const call = runsOf.get(path) ?? 0;
      runsOf.set(path, call + 1);
      calls.push(`run:${path}@${revision}`);
      const began = inputs.revision;
      const result = options.ran?.(path, call) ?? {};
      await nextTurn();
      if (result.throws !== undefined) throw new Error(result.throws);
      if (result.notBegun === true) return undefined;
      const changedWhileRunning = result.changedWhileRunning ?? false;
      const stored = result.stored ?? true;
      const print = inputs.current().workspaceFingerprint(entry);
      if (stored) {
        store.writeRun(
          {
            ...SCOPE,
            inputFingerprint:
              print.ok && !changedWhileRunning
                ? digestOf(print.digest)
                : UNFINGERPRINTED,
          },
          result.run ?? ranWorkspace(path),
        );
      }
      if (result.movesRevision === true) inputs.moveRevision();
      return { revision: began, stored, changedWhileRunning };
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

  it("D2788: a retry armed because the last attempt stored nothing, planned once the inputs read current again, is logged with that reason and never as a failed run", async () => {
    let digest = "a-changed";
    let moveRevision = (): void => undefined;
    const due = await running(
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
        return dueEntries(started.log);
      },
    );
    expect(due.at(-1)).toBe(
      "due: a, its last attempt stored nothing, so the periodic reconciliation retries it",
    );
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

  it("D2731: a workspace's periodic retry whose run did not begin is kept, so the workspace runs once the scheduler plans again", async () => {
    const calls = await running(
      {
        seed: (store) => {
          currentResults("a")(store);
          store.seedRun(failedRun("a"), digestOf("a-digest"));
        },
        ran: (_path, call) => ({ notBegun: call === 0 }),
      },
      async (started) => {
        await flush();
        started.inputs.endPeriodicReconciliation();
        await flush();
        return [...started.calls];
      },
    );
    expect(calls).toStrictEqual(["idle", "run:a@1", "run:a@1", "idle"]);
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
});

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
