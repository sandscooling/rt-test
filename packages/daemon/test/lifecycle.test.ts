import {
  mkdirSync,
  realpathSync,
  utimesSync,
  watch,
  writeFileSync,
  type PathLike,
  type WatchListener,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { DependencyBuilds } from "../src/daemon/dependency-builds.js";
import {
  ABORT_PURPOSE,
  type Executor,
  type JobOutcome,
} from "../src/daemon/executor.js";
import { DaemonLifecycle } from "../src/daemon/lifecycle.js";
import {
  PROTOCOL_VERSION,
  type DaemonActivity,
  type DaemonIdentity,
} from "../src/daemon/protocol.js";
import { RunWatch, type RunJudgment } from "../src/daemon/run-judgment.js";
import { takeStartEnvironment } from "../src/inputs/environment-digest.js";
import {
  ProjectInputs,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import { JobWindows, type JobVerdict } from "../src/inputs/input-jobs.js";
import {
  InputTracker,
  type CurrentInputs,
} from "../src/inputs/input-tracker.js";
import {
  NARROWING,
  Narrowing,
  narrowingAt,
  type QueryNarrowing,
  type WorkspaceNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import {
  DEPENDENCY_BUILD_FAILED,
  SELECTION_REFUSED,
  type InputsNotNarrowed,
} from "../src/query/answer.js";
import { buildSelectionInput } from "../src/selection/selection-input.js";
import type {
  DependencyInformation,
  SelectableWorkspace,
} from "../src/selection/selection-types.js";
import {
  openStore,
  type LatestResults,
  type RtTestStore,
} from "../src/store/open-store.js";
import { STORE_SCHEMA_VERSION } from "../src/store/schema.js";
import type {
  StoreBindings,
  StoredDiscovery,
  StoredRun,
  StoreScope,
} from "../src/store/stored-records.js";
import { NewerStoreSchemaError } from "../src/store/transaction.js";
import type { ConfirmedStart } from "../src/vitest/confirmed-start.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { VitestWorkspace } from "../src/vitest/find-workspaces.js";
import type {
  NotConfirmedRun,
  WorkspaceRun,
} from "../src/vitest/run-workspace.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  IDLE_ENTRY,
  eventually,
  memoryLog,
  type MemoryLog,
} from "./daemon-harness.js";
import { inTempDir, projectFacts, settle } from "./harness.js";
import { onPlatform } from "./on-platform.js";
import {
  builtAt,
  discoveredIn,
  failedAt,
  inputsOf,
  ranWorkspace,
} from "./round-fixtures.js";
import {
  ABSENT_ROOT,
  DISCOVERY_DIGEST,
  Deferred,
  FINGERPRINTED,
  NO_DECLARATION,
  RecordingStore,
  SCOPE,
  SETTLED_INPUTS,
  StandInInputs,
  type InputsScript,
  confirmed,
  discovered,
  discoveredWithTest,
  discovery,
  flush,
  interrupted,
  workspace,
} from "./scheduling-harness.js";
import { unhandledRejectionsDuring } from "./unhandled-rejections.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn<typeof actual.watch>(actual.watch) };
});

const { watch: realWatch } =
  await vi.importActual<typeof import("node:fs")>("node:fs");

const IDENTITY: DaemonIdentity = {
  pid: 4242,
  consumerRoot: "/consumer",
  ...SCOPE,
  stateDirectory: "/consumer/.rt-test",
  logFile: "/consumer/.rt-test/daemon.log",
  protocolVersion: PROTOCOL_VERSION,
};
/** No quiet window, so a job begins as soon as the inputs have settled; the window itself is pinned in the scheduler's tests. */
const NO_QUIET_WINDOW_MS = 0;
const FRESHNESS_SETTLE_MS = 5_000;
/** A quiet window no test waits out: the scheduler plans nothing until the stop ends it. */
const HELD_BY_QUIET_WINDOW_MS = 600_000;
const CONFIG_NOT_CONFIRMED =
  "its config file is no longer the one confirmed at start";
/** A declared file written after an edit; once the tracker has handled its event, it has handled the edit's. */
const SENTINEL = "z.md";
const RECONCILIATION_ENDED = "input reconciliation ended";
/** Why the tracker cannot vouch for its inputs, as it says while its watcher has failed. */
const WATCHER_FAILED = "the watcher failed: ENOSPC";
/** Why no fingerprint can be taken while a reconciliation runs, as the tracker says it. */
const RECONCILING = "a reconciliation of the inputs is running";

type RunOutcome = JobOutcome<WorkspaceRun | NotConfirmedRun>;
type AbortPurpose = NonNullable<Parameters<Executor["abort"]>[0]>;

/** An executor that answers each job from a script, and records the jobs it was given and what each abort was for. */
class ScriptedExecutor implements Pick<
  Executor,
  "discover" | "run" | "abort" | "close"
> {
  readonly runs: string[] = [];
  readonly purposes: AbortPurpose[] = [];
  discoveries = 0;
  aborts = 0;
  readonly #discovery: Promise<JobOutcome<TestDiscovery>>;
  readonly #runs: (path: string) => Promise<RunOutcome>;

  constructor(
    discovery: JobOutcome<TestDiscovery> | Promise<JobOutcome<TestDiscovery>>,
    runs: (path: string) => RunOutcome | Promise<RunOutcome> = (path) => ({
      ended: true,
      value: interrupted(path),
    }),
  ) {
    this.#discovery = Promise.resolve(discovery);
    this.#runs = async (path) => runs(path);
  }

  discover(): Promise<JobOutcome<TestDiscovery>> {
    this.discoveries += 1;
    return this.#discovery;
  }

  run(workspace: VitestWorkspace): Promise<RunOutcome> {
    this.runs.push(workspace.path);
    return this.#runs(workspace.path);
  }

  /** Reaches the job in progress, as the executor's abort does while one runs. */
  abort(purpose: AbortPurpose = ABORT_PURPOSE.stop): boolean {
    this.aborts += 1;
    this.purposes.push(purpose);
    return true;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

type BuildOutcome = JobOutcome<DependencyInformation>;

const NO_DEPENDENCIES: DependencyInformation = {
  packageWorkspaces: [],
  notRead: [],
  withoutManifest: [],
  edges: [],
  uncertainties: [],
};
const BUILD_ABORTED = "the build was aborted";

/**
 * A build executor that answers each build from a script, given the build's index from 0, and records the workspaces
 * each was given. Each answer waits for the next event-loop turn, as a child process's reply does, so builds that
 * repeat without end still let `flush` return. An abort ends every held build, as the real executor ends its job.
 */
class ScriptedBuilds implements Pick<
  Executor,
  "buildDependencies" | "abort" | "close"
> {
  readonly builds: (readonly string[])[] = [];
  aborts = 0;
  closes = 0;
  readonly #answer: (index: number) => BuildOutcome | Promise<BuildOutcome>;
  #aborted = new Deferred<BuildOutcome>();

  constructor(
    answer: (index: number) => BuildOutcome | Promise<BuildOutcome> = () => ({
      ended: true,
      value: NO_DEPENDENCIES,
    }),
  ) {
    this.#answer = answer;
  }

  buildDependencies(
    _consumerRoot: string,
    workspaces: readonly SelectableWorkspace[],
  ): Promise<BuildOutcome> {
    const index = this.builds.length;
    this.builds.push(workspaces.map(({ workspace }) => workspace.path));
    return Promise.race([
      new Promise((resolve) => setImmediate(resolve)).then(() =>
        this.#answer(index),
      ),
      this.#aborted.promise,
    ]);
  }

  abort(): boolean {
    this.aborts += 1;
    this.#aborted.resolve({ ended: false, reason: BUILD_ABORTED });
    this.#aborted = new Deferred<BuildOutcome>();
    return true;
  }

  close(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }
}

/** A recording store whose first read of the latest results throws, as a locked database would. */
class FirstReadFailingStore extends RecordingStore {
  #failed = false;

  override readLatestResults(scope: StoreScope): LatestResults {
    if (!this.#failed) {
      this.#failed = true;
      throw new Error("database is locked");
    }
    return super.readLatestResults(scope);
  }
}

interface Daemon {
  readonly lifecycle: DaemonLifecycle;
  readonly executor: ScriptedExecutor;
  readonly store: RecordingStore;
  readonly log: MemoryLog;
  readonly endpointCloses: { count: number };
  readonly inputs: StandInInputs;
  readonly builds: ScriptedBuilds;
}

/** Every build ends failed, so each workspace covers the whole project's inputs, as before any build. */
function failingBuilds(): Executor {
  return new ScriptedBuilds(() => ({
    ended: false,
    reason: "the test builds no dependency information",
  })) as unknown as Executor;
}

/**
 * The start's consumer root from `confirmed` does not exist, so each build over it fails before its job begins unless
 * the test starts from a root it wrote.
 */
function daemon(
  start: ConfirmedStart,
  executor: ScriptedExecutor,
  store: RtTestStore = new RecordingStore(),
  identity: DaemonIdentity = IDENTITY,
  inputs: StandInInputs = new StandInInputs(),
  builds: ScriptedBuilds = new ScriptedBuilds(),
  quietWindowMs: number = NO_QUIET_WINDOW_MS,
): Daemon {
  const log = memoryLog();
  const endpointCloses = { count: 0 };
  const lifecycle = new DaemonLifecycle({
    identity,
    scope: SCOPE,
    start,
    store,
    log,
    executor: executor as unknown as Executor,
    buildExecutor: builds as unknown as Executor,
    inputs,
    quietWindowMs,
    closeEndpoint: () => {
      endpointCloses.count += 1;
      return Promise.resolve();
    },
  });
  return {
    lifecycle,
    executor,
    store: store as RecordingStore,
    log,
    endpointCloses,
    inputs,
    builds,
  };
}

/**
 * A daemon over one confirmed workspace `a`, discovered as `entryOf` gives it and run once, with inputs the test
 * scripts. Each run calls `during` with the inputs and the run's count from 1, as what the run sees change while it
 * runs. Every build fails, so each workspace's inputs are the whole project's.
 */
function scripted(
  script: InputsScript,
  during: (inputs: StandInInputs, run: number) => void = () => undefined,
  entryOf: (path: string) => WorkspaceDiscovery = discovered,
): Daemon {
  const inputs = new StandInInputs(script);
  const executor: ScriptedExecutor = new ScriptedExecutor(
    { ended: true, value: discovery(entryOf("a")) },
    (path) => {
      during(inputs, executor.runs.length);
      return { ended: true, value: interrupted(path) };
    },
  );
  return daemon(
    confirmed("a"),
    executor,
    new RecordingStore(),
    IDENTITY,
    inputs,
  );
}

/** Runs `during` inside the discovery's job, as an edit while Vitest collects would, and ends the job once it settles. */
class EditingExecutor extends ScriptedExecutor {
  readonly #during: () => Promise<unknown>;

  constructor(found: TestDiscovery, during: () => Promise<unknown>) {
    super({ ended: true, value: found });
    this.#during = during;
  }

  override async discover(): Promise<JobOutcome<TestDiscovery>> {
    await this.#during();
    return super.discover();
  }
}

/**
 * Inside the discovery's job, given the test module's path and the name of each watch event the tracker has handled,
 * in order; resolves whether the hold it waited for was reached.
 */
type DuringDiscovery = (
  module: string,
  handled: readonly string[],
) => Promise<boolean>;

interface DeclaredModuleStart {
  readonly held: boolean;
  readonly idle: boolean;
  readonly discoveryFreshness: unknown;
  /** The kind of fingerprint the first discovery was stored under. */
  readonly storedFingerprint: string | undefined;
  /** How many discoveries the start sequence stored before it ended. */
  readonly discoveries: number;
}

/**
 * Runs the scheduler to idle with a real input tracker and store, over a consumer whose `rt-test.json` declares
 * `src/**` and whose one workspace, the root, lists the test module `src/a.test.ts`, last modified an hour ago.
 * Every watch the tracker opens is real; each event's name is recorded once the tracker's listener has returned. With
 * `earlierLife`, the store already holds a discovery that reports its facts and lists no test module, so the declared
 * pattern hides the module until the new discovery is protected; without it no pattern applies until then.
 */
async function declaredModuleStart(
  dir: string,
  during: DuringDiscovery = () => Promise.resolve(true),
  earlierLife = false,
): Promise<DeclaredModuleStart> {
  const root = join(dir, "consumer");
  const module = join(root, "src", "a.test.ts");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "rt-test.json"),
    JSON.stringify({ nonInputs: ["src/**"] }),
  );
  writeFileSync(module, "it('t', () => {});\n");
  const anHourAgo = new Date(Date.now() - 3_600_000);
  // The access time stays current, as the discovery's own read leaves it: Windows raises a change event for a read that
  // updates an access time over an hour old, which would count against the job like an edit.
  utimesSync(module, new Date(), anHourAgo);
  const found = discovery({
    ...discovered("."),
    workspace: { path: ".", directory: root },
    tests: [
      {
        identity: {
          workspacePath: ".",
          projectName: "unit",
          modulePath: "src/a.test.ts",
          namePath: ["t"],
          occurrence: 0,
        },
        isDuplicate: false,
        mode: "run",
      },
    ],
  });
  const handled: string[] = [];
  vi.mocked(watch).mockImplementation(((
    path: PathLike,
    options: { recursive?: boolean },
    listener: WatchListener<string>,
  ) =>
    realWatch(path, options, (kind, name) => {
      listener(kind, name);
      handled.push(String(name));
    })) as typeof watch);
  let held = false;
  const log = memoryLog();
  const store = openStore(join(dir, "state"));
  if (earlierLife) {
    store.writeDiscovery(
      { ...SCOPE, inputFingerprint: { kind: "not-fingerprinted" } },
      discovery({
        ...discovered("."),
        workspace: { path: ".", directory: root },
      }),
    );
  }
  const written = vi.spyOn(store, "writeDiscovery");
  const lifecycle = new DaemonLifecycle({
    identity: { ...IDENTITY, consumerRoot: root },
    scope: SCOPE,
    start: confirmed("."),
    store,
    log,
    executor: new EditingExecutor(found, async () => {
      held = await during(module, handled);
    }) as unknown as Executor,
    buildExecutor: failingBuilds(),
    inputs: new InputTracker({
      consumerRoot: root,
      exclusions: [],
      log: memoryLog(),
      startEnvironment: takeStartEnvironment(),
    }),
    quietWindowMs: NO_QUIET_WINDOW_MS,
    closeEndpoint: () => Promise.resolve(),
  });
  try {
    lifecycle.begin();
    const idle = await eventually(() => log.entries.includes(IDLE_ENTRY));
    const freshness = (): unknown => {
      const answer = lifecycle.summary();
      return "discovery" in answer ? answer.discovery.freshness : answer;
    };
    // A watch event still in flight leaves the inputs unread, so the discovery reads unknown until the tracker settles.
    await eventually(() => freshness() === "current", FRESHNESS_SETTLE_MS);
    return {
      held,
      idle,
      discoveryFreshness: freshness(),
      storedFingerprint: written.mock.calls[0]?.[0].inputFingerprint.kind,
      discoveries: written.mock.calls.length,
    };
  } finally {
    lifecycle.stop();
    await lifecycle.stopped();
    vi.mocked(watch).mockReset();
  }
}

/**
 * Runs the start sequence to idle with a real input tracker and store, over a consumer root holding one input and
 * discovered as one workspace, and returns the kind of fingerprint the discovery was stored under. As the first
 * reconciliation ends, the root's watch reports a change to the input, as Windows does for the reconciliation's own
 * read of a file whose access time is over an hour old, so the event is still unread when that reconciliation ends.
 */
async function idleStart(dir: string): Promise<IdleStart> {
  const root = join(dir, "consumer");
  mkdirSync(root);
  writeFileSync(join(root, "a.ts"), "export {};\n");
  const listeners: WatchListener<string>[] = [];
  const paths: string[] = [];
  vi.mocked(watch).mockImplementation(((
    path: PathLike,
    options: { recursive?: boolean },
    listener: WatchListener<string>,
  ) => {
    listeners.push(listener);
    paths.push(String(path));
    return realWatch(path, options, listener);
  }) as typeof watch);
  let injected = false;
  const recording = memoryLog();
  const trackerLog: MemoryLog = {
    ...recording,
    error: (context, error) => recording.error(context, error),
    entry(message) {
      recording.entry(message);
      const rootWatch = listeners[paths.indexOf(realpathSync.native(root))];
      if (message.startsWith(RECONCILIATION_ENDED) && rootWatch !== undefined) {
        rootWatch("change", "a.ts");
        injected = true;
      }
    },
  };
  const log = memoryLog();
  const store = openStore(join(dir, "state"));
  const lifecycle = new DaemonLifecycle({
    identity: { ...IDENTITY, consumerRoot: root },
    scope: SCOPE,
    start: confirmed("."),
    store,
    log,
    executor: new ScriptedExecutor({
      ended: true,
      value: discovery({
        ...discovered("."),
        workspace: { path: ".", directory: root },
      }),
    }) as unknown as Executor,
    buildExecutor: failingBuilds(),
    inputs: new InputTracker({
      consumerRoot: root,
      exclusions: [],
      log: trackerLog,
      startEnvironment: takeStartEnvironment(),
    }),
    quietWindowMs: NO_QUIET_WINDOW_MS,
    closeEndpoint: () => Promise.resolve(),
  });
  try {
    lifecycle.begin();
    await eventually(() => log.entries.includes(IDLE_ENTRY));
    return {
      injected,
      storedFingerprint:
        store.readLatestDiscovery(SCOPE)?.inputFingerprint.kind,
    };
  } finally {
    lifecycle.stop();
    await lifecycle.stopped();
    vi.mocked(watch).mockReset();
  }
}

interface IdleStart {
  /** Whether the change was delivered through the root's watch as the first reconciliation ended. */
  readonly injected: boolean;
  readonly storedFingerprint: string | undefined;
}

/**
 * `change` until protection has taken a discovery, and nothing after: as the tracker answers for a listed file a
 * declared pattern kept unwatched, which protection then reads into the inputs, where no later check of the file looks.
 */
function untilProtected(
  started: Daemon | undefined,
  change: string,
): string | undefined {
  const protectedOne = started?.inputs.protected.some(
    (discovered) => discovered !== undefined,
  );
  return protectedOne === true ? undefined : change;
}

/** Starts the sequence and lets every job that has already settled run to the sequence's end. */
async function begun(started: Daemon): Promise<Daemon> {
  started.lifecycle.begin();
  await flush();
  return started;
}

/** A daemon whose run of `path` is held until the returned deferred settles. */
function heldAt(
  path: string,
  paths: readonly string[],
  entryOf: (path: string) => WorkspaceDiscovery = discovered,
): { readonly started: Daemon; readonly held: Deferred<RunOutcome> } {
  const held = new Deferred<RunOutcome>();
  const executor = new ScriptedExecutor(
    { ended: true, value: discovery(...paths.map(entryOf)) },
    (runPath) =>
      runPath === path
        ? held.promise
        : { ended: true, value: interrupted(runPath) },
  );
  return { started: daemon(confirmed(...paths), executor), held };
}

/** Runs `body` with the clocks the quiet window reads faked, and puts the real ones back. */
async function underFakeClock<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
  });
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/**
 * Begins `started` behind a quiet window and waits the window out so its first job begins. `during` then ends or
 * holds a job with the input revision moved, so the scheduler waits out the next window: only what the job's own end
 * left in the activity can say what the daemon is doing. Stops `started` and returns that activity.
 */
async function activityWhileTheNextWindowWaits(
  started: Daemon,
  during: () => Promise<void>,
): Promise<DaemonActivity> {
  const { lifecycle } = started;
  lifecycle.begin();
  await flush();
  await vi.advanceTimersByTimeAsync(1000);
  await flush();
  await during();
  const { activity } = lifecycle.status();
  lifecycle.stop();
  await lifecycle.stopped();
  return activity;
}

/** A daemon whose run of `a` waits for the inputs to settle, whatever else waits before it. */
function holdingRun(quietWindowMs = NO_QUIET_WINDOW_MS): Daemon {
  const held: { daemon?: Daemon } = {};
  const inputs = new StandInInputs({
    unavailable: WATCHER_FAILED,
    heldSettleIf: () =>
      held.daemon?.lifecycle.status().activity.state === "running" &&
      inputs.jobsBegun === 2,
  });
  held.daemon = daemon(
    confirmed("a"),
    new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("a")),
    }),
    new RecordingStore(),
    IDENTITY,
    inputs,
    new ScriptedBuilds(),
    quietWindowMs,
  );
  return held.daemon;
}

describe("the start sequence", () => {
  it("D1451: each confirmed workspace runs once, in the order the discovery lists them", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("b"), discovered("a"), discovered("c")),
    });
    await begun(daemon(confirmed("a", "b", "c"), executor));
    expect(executor.runs).toStrictEqual(["b", "a", "c"]);
  });

  it("D1452: a workspace whose discovery failed or was unsupported is still run", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(
        {
          status: "failed",
          workspace: workspace("a"),
          vitestVersion: "5.0.1",
          error: "Error: config boom",
        },
        {
          status: "unsupported",
          workspace: workspace("b"),
          vitest: {
            supported: false,
            version: "3.2.4",
            supportedRange: "^4.1.0 || ^5.0.0",
            reason: "Vitest 3.2.4 is outside the supported range",
          },
        },
        discovered("c"),
      ),
    });
    await begun(daemon(confirmed("a", "b", "c"), executor));
    expect(executor.runs).toStrictEqual(["a", "b", "c"]);
  });

  it("D1453: the discovery and each run whose inputs held still are stored under the worktree's project and worktree and the digest they started from", async () => {
    const bindings = await inTempDir(async (dir) => {
      const store = openStore(dir);
      try {
        const executor = new ScriptedExecutor({
          ended: true,
          value: discovery(discovered("a")),
        });
        await begun(daemon(confirmed("a"), executor, store));
        const binding = (record: StoreBindings | undefined): unknown =>
          record === undefined
            ? undefined
            : {
                projectIdentity: record.projectIdentity,
                worktreeIdentity: record.worktreeIdentity,
                inputFingerprint: record.inputFingerprint,
              };
        return {
          discovery: binding(store.readLatestDiscovery(SCOPE)),
          runs: store.readRuns(SCOPE).map(binding),
        };
      } finally {
        store.close();
      }
    });
    expect(bindings).toStrictEqual({
      discovery: {
        ...SCOPE,
        inputFingerprint: { kind: "digest", digest: DISCOVERY_DIGEST },
      },
      runs: [
        { ...SCOPE, inputFingerprint: { kind: "digest", digest: "a-digest" } },
      ],
    });
  });

  it("D1877: a run whose inputs changed while it ran is stored not fingerprinted, and the log names the run and the change", async () => {
    const reason = "its inputs changed while it ran: packages/a/src/a.ts";
    const { store, log } = await begun(
      scripted({}, (inputs, run) => {
        if (run === 1) inputs.recordPath("packages/a/src/a.ts");
      }),
    );
    expect({
      stored: store.runFingerprints,
      logged: log.entries.filter((entry) =>
        entry.startsWith("the run of a is stored not fingerprinted"),
      ),
    }).toStrictEqual({
      stored: [
        { kind: "not-fingerprinted" },
        { kind: "digest", digest: "a-digest" },
      ],
      logged: [`the run of a is stored not fingerprinted: ${reason}`],
    });
  });

  it("D1878: a run whose workspace fingerprint at its end differs from the one at its start is stored not fingerprinted", async () => {
    let asked = 0;
    const { store } = await begun(
      scripted({
        fingerprintOf: () => {
          asked += 1;
          return { ok: true, digest: `a-digest-${asked}` };
        },
      }),
    );
    expect(store.runFingerprints[0]).toStrictEqual({
      kind: "not-fingerprinted",
    });
  });

  it("D1879: a discovery during which a listed test module a declared pattern kept unwatched may have changed is stored not fingerprinted, naming the module", async () => {
    const moduleChanged =
      "packages/a/gen/a.test.ts, which the discovery protects and the inputs leave out, may have changed while the job ran";
    const held: { daemon?: Daemon } = {};
    held.daemon = scripted({
      get moduleChanged() {
        return untilProtected(held.daemon, moduleChanged);
      },
    });
    const { store, log } = await begun(held.daemon);
    expect({
      discovery: store.discoveryFingerprints,
      logged: log.entries.filter((entry) =>
        entry.includes("stored not fingerprinted"),
      ),
    }).toStrictEqual({
      discovery: [{ kind: "not-fingerprinted" }],
      logged: [`the discovery is stored not fingerprinted: ${moduleChanged}`],
    });
  });

  it("D3030: a listed test module the inputs leave out, edited after protection's check and before the discovery's fingerprint is composed, leaves the discovery stored not fingerprinted, naming the module", async () => {
    const moduleChanged =
      "packages/a/gen/a.test.ts, which the discovery protects and the inputs leave out, may have changed while the job ran";
    const held: { daemon?: Daemon } = {};
    held.daemon = scripted({
      // The edit lands once the discovery's protection has begun, after its own check of the module and before the fingerprint.
      get moduleChanged() {
        return held.daemon?.inputs.protected.some(
          (protectedDiscovery) => protectedDiscovery !== undefined,
        ) === true
          ? moduleChanged
          : undefined;
      },
    });
    const { store, log } = await begun(held.daemon);
    expect({
      discovery: store.discoveryFingerprints,
      logged: log.entries.filter((entry) =>
        entry.startsWith("the discovery is stored not fingerprinted"),
      ),
    }).toStrictEqual({
      discovery: [{ kind: "not-fingerprinted" }],
      logged: [`the discovery is stored not fingerprinted: ${moduleChanged}`],
    });
  });

  it("D3100: both checks for a listed file the inputs leave out are measured from the discovery's start, so an edit during the job is caught however long before the fingerprint it landed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const inputs = new StandInInputs();
      const executor = new EditingExecutor(
        discovery(discovered("a")),
        async () => {
          vi.setSystemTime(Date.now() + 5000);
        },
      );
      const { lifecycle } = await begun(
        daemon(
          confirmed("a"),
          executor,
          new RecordingStore(),
          IDENTITY,
          inputs,
        ),
      );
      lifecycle.stop();
      await lifecycle.stopped();
      const start = inputs.jobStarts.find((jobStart) => jobStart !== undefined);
      expect(inputs.changedSince).toStrictEqual([start, start]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("D2159: a discovery during which a file only protection's walk found may have changed is stored not fingerprinted, naming the file", async () => {
    const walkChanged =
      "docs/new.test.ts, an input the tracker had not read before protection changed, may have changed while the job ran";
    const { store, log } = await begun(scripted({ walkChanged }));
    expect({
      discovery: store.discoveryFingerprints,
      logged: log.entries.filter((entry) =>
        entry.includes("stored not fingerprinted"),
      ),
    }).toStrictEqual({
      discovery: [{ kind: "not-fingerprinted" }],
      logged: [`the discovery is stored not fingerprinted: ${walkChanged}`],
    });
  });

  it("D2163: protection of the new discovery is given the discovery job's start, and protection of the stored one is given none", async () => {
    const before = Date.now();
    const { inputs } = await begun(scripted({}));
    const after = Date.now();
    const [stored, discovered] = inputs.jobStarts;
    expect({
      stored,
      duringStart:
        discovered !== undefined && discovered >= before && discovered <= after,
    }).toStrictEqual({ stored: undefined, duringStart: true });
  });

  it("D1880: no discovery starts until the first reconciliation of the inputs has ended", async () => {
    const started = await begun(scripted({ heldReconciliation: true }));
    const before = started.executor.discoveries;
    started.inputs.reconciled.resolve();
    await flush();
    expect({ before, after: started.executor.discoveries }).toStrictEqual({
      before: 0,
      after: 1,
    });
  });

  it("D1882: the input tracker starts when the start sequence begins, never when the daemon is built", async () => {
    const built = scripted({});
    const beforeBegin = built.inputs.starts;
    await begun(built);
    expect({ beforeBegin, afterBegin: built.inputs.starts }).toStrictEqual({
      beforeBegin: 0,
      afterBegin: 1,
    });
  });

  it("D1457: a run whose store write fails is listed as stored nothing, and the next workspace still runs", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("a"), discovered("b")),
    });
    const { lifecycle, store } = await begun(
      daemon(confirmed("a", "b"), executor, new RecordingStore(["a"])),
    );
    expect({
      stored: store.runs.map((run) => run.workspace.path),
      unstored: lifecycle.status().unstoredJobs,
    }).toStrictEqual({
      stored: ["b"],
      unstored: [{ workspacePath: "a", reason: "the store write failed" }],
    });
  });

  it("D1458: a run that loaded nothing because its config changed is listed with its reason and never written", async () => {
    const executor = new ScriptedExecutor(
      { ended: true, value: discovery(discovered("a")) },
      () => ({
        ended: true,
        value: {
          status: "not-confirmed",
          workspace: workspace("a"),
          reason: CONFIG_NOT_CONFIRMED,
        },
      }),
    );
    const { lifecycle, store } = await begun(daemon(confirmed("a"), executor));
    expect({
      written: store.runs,
      unstored: lifecycle.status().unstoredJobs,
    }).toStrictEqual({
      written: [],
      unstored: [{ workspacePath: "a", reason: CONFIG_NOT_CONFIRMED }],
    });
  });

  it("D1464: a confirmed workspace the discovery did not find is named in the log", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("a")),
    });
    const { log } = await begun(daemon(confirmed("a", "gone"), executor));
    expect(log.entries.filter((entry) => entry.includes("gone"))).toStrictEqual(
      [
        "the confirmed workspace gone was not found, so nothing of it was loaded",
      ],
    );
  });

  it("D1538: a workspace the discovery lists as not confirmed is neither run nor listed as stored nothing", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("a"), {
        status: "not-confirmed",
        workspace: workspace("b"),
        reason: "not confirmed at start",
      }),
    });
    const { lifecycle } = await begun(daemon(confirmed("a", "b"), executor));
    expect({
      runs: executor.runs,
      unstored: lifecycle.status().unstoredJobs,
    }).toStrictEqual({ runs: ["a"], unstored: [] });
  });

  it("D2642: a workspace the discovery lists but the confirmed start does not is neither run nor listed as stored nothing", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("a"), discovered("b")),
    });
    const { lifecycle } = await begun(daemon(confirmed("a"), executor));
    expect({
      runs: executor.runs,
      unstored: lifecycle.status().unstoredJobs,
    }).toStrictEqual({ runs: ["a"], unstored: [] });
  });
});

describe(
  "protecting the discovery's test modules",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D1987: a discovery whose test module a declared pattern hid until its protection reads current once the start sequence ends", async () => {
      const outcome = await inTempDir((dir) =>
        declaredModuleStart(dir, undefined, true),
      );
      expect(outcome).toStrictEqual({
        held: true,
        idle: true,
        discoveryFreshness: "current",
        storedFingerprint: "digest",
        discoveries: 1,
      });
    });

    it("D1988: a test module a declared pattern hid through the discovery's job, edited during it, leaves the first discovery stored not fingerprinted, and the next round's discovery reads current", async () => {
      const outcome = await inTempDir((dir) =>
        declaredModuleStart(
          dir,
          (module, handled) => {
            writeFileSync(module, "it('t', () => {});\n// an edit\n");
            // The access time stays current for the reason the helper gives; only the modification time moves ahead.
            utimesSync(module, new Date(), new Date(Date.now() + 60_000));
            // One watch covers both files and reports in order, so the job ends only after the edit's events were dropped.
            writeFileSync(join(dirname(module), SENTINEL), "a sentinel\n");
            return eventually(() =>
              handled.some((name) => basename(name) === SENTINEL),
            );
          },
          true,
        ),
      );
      expect(outcome).toStrictEqual({
        held: true,
        idle: true,
        discoveryFreshness: "current",
        storedFingerprint: "not-fingerprinted",
        discoveries: 2,
      });
    });

    it("D1989: an input event while the discovery's test modules are protected leaves the discovery stored not fingerprinted", async () => {
      const reason = "its inputs changed while it ran: packages/a/src/a.ts";
      const { store } = await begun(
        scripted({
          verdicts: [
            FINGERPRINTED,
            { fingerprinted: false, reason, changedWhileRunning: true },
          ],
        }),
      );
      expect(store.discoveryFingerprints).toStrictEqual([
        { kind: "not-fingerprinted" },
      ]);
    });

    it("D1990: the test modules of the discovery an earlier life stored are protected before the new discovery's", async () => {
      const earlier = discovery(discoveredWithTest("old"));
      const store = new RecordingStore();
      store.discoveries.push(earlier);
      const { inputs } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          store,
        ),
      );
      expect(inputs.protected).toStrictEqual([
        earlier,
        discovery(discovered("a")),
      ]);
    });

    it("D2052: a store whose read of the earlier life's discovery throws still lets begin return and the start sequence reach idle, with the error logged", async () => {
      const started = daemon(
        confirmed("a"),
        new ScriptedExecutor({
          ended: true,
          value: discovery(discovered("a")),
        }),
        new FirstReadFailingStore(),
      );
      const begin = settle(() => started.lifecycle.begin());
      await flush();
      expect({
        returned: begin === undefined,
        logged: started.log.entries.some((entry) =>
          entry.startsWith("error: reading the latest stored discovery"),
        ),
        idle: started.log.entries.includes(IDLE_ENTRY),
      }).toStrictEqual({ returned: true, logged: true, idle: true });
    });
  },
);

describe(
  "a latest discovery the store refuses, and a store a newer RT Test migrated",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    const UNREADABLE = "The store holds an unreadable";
    const REFUSAL = `${UNREADABLE} not_read: {"x":1}`;
    const OTHER_REFUSAL = `${UNREADABLE} not_read: {"y":2}`;
    const MADE_UNREADABLE = `UPDATE discoveries SET not_read = '{"x":1}'`;
    const MADE_OTHERWISE_UNREADABLE = `UPDATE discoveries SET not_read = '{"y":2}'`;
    const MADE_READABLE = "UPDATE discoveries SET not_read = '[]'";
    const NEWER = STORE_SCHEMA_VERSION + 1;
    const UNFINGERPRINTED = { kind: "not-fingerprinted" } as const;

    /** Runs `sql` over the store's file through a second connection, as another process would. */
    function alterStore(file: string, sql: string): void {
      const database = new DatabaseSync(file);
      try {
        database.exec(sql);
      } finally {
        database.close();
      }
    }

    /** A store under `dir` whose latest discovery an earlier life stored, since made unreadable by `REFUSAL`. */
    function refusedDiscoveryStore(dir: string): RtTestStore {
      const store = openStore(join(dir, "state"));
      store.writeDiscovery(
        { ...SCOPE, inputFingerprint: UNFINGERPRINTED },
        discovery(discovered("a")),
      );
      alterStore(store.file, MADE_UNREADABLE);
      return store;
    }

    /** Each log entry quoting the refusal, by what it says. */
    function refusalEntries(log: MemoryLog) {
      return log.entries
        .filter((entry) => entry.includes(REFUSAL))
        .map((entry) => ({
          warning: entry.startsWith("warning: "),
          due: entry.includes("a discovery is due as if none were stored"),
          noRun: entry.includes("no workspace runs until it is stored"),
          whole: entry.endsWith(`: ${REFUSAL}`),
        }));
    }

    function summaryOutcome(lifecycle: DaemonLifecycle): string {
      try {
        lifecycle.summary();
        return "answered";
      } catch (error) {
        return error instanceof NewerStoreSchemaError &&
          error.message.includes("nothing was read")
          ? "refused for a newer schema, nothing read"
          : String(error);
      }
    }

    /** Begins `started` and runs `body`, then stops the daemon, whose stop closes its store, so no job outlives the test. */
    function begunThenStopped<T>(
      started: Daemon,
      body: (begun: Daemon) => T | Promise<T>,
    ): Promise<T> {
      return thenStopped(started, async () => body(await begun(started)));
    }

    /** The refusal each warning entry quotes, in the order logged. */
    function quotedRefusals(log: MemoryLog): string[] {
      return log.entries
        .filter((entry) => entry.startsWith("warning: "))
        .flatMap((entry) => {
          const at = entry.indexOf(UNREADABLE);
          return at === -1 ? [] : [entry.slice(at)];
        });
    }

    /**
     * Runs a daemon over a readable store to idle, so it has stored and read its own discovery, then runs `after`
     * against the store's file and the daemon, and returns the refusals the log quotes.
     */
    function afterIdle(
      after: (file: string, lifecycle: DaemonLifecycle) => void,
    ): Promise<string[]> {
      return inTempDir((dir) => {
        const store = openStore(join(dir, "state"));
        const started = daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          store,
        );
        return begunThenStopped(started, ({ lifecycle, log }) => {
          after(store.file, lifecycle);
          return quotedRefusals(log);
        });
      });
    }

    it("D2927: a latest discovery refused as unreadable leaves a discovery due, and the workspaces run from the discovery that replaces it", async () => {
      const outcome = await inTempDir((dir) => {
        const store = refusedDiscoveryStore(dir);
        const started = daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          store,
        );
        return begunThenStopped(started, ({ executor }) => ({
          discoveries: executor.discoveries,
          runs: executor.runs,
          latest: settle(() => {
            const latest = store.readLatestResults(SCOPE);
            return {
              readable: latest.discovery !== undefined,
              discoveryRefusal: latest.discoveryRefusal,
            };
          }),
        }));
      });
      expect(outcome).toStrictEqual({
        discoveries: 1,
        runs: ["a"],
        latest: { readable: true, discoveryRefusal: undefined },
      });
    });

    it("D2928: a refusal of the latest discovery read at every plan is logged once, as a warning that a discovery is due and no workspace runs, with its whole text", async () => {
      const entries = await inTempDir((dir) => {
        const store = refusedDiscoveryStore(dir);
        const started = daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: false,
            reason: "the test's discovery stores nothing",
          }),
          store,
        );
        return begunThenStopped(started, ({ log }) => refusalEntries(log));
      });
      expect(entries).toStrictEqual([
        { warning: true, due: true, noRun: true, whole: true },
      ]);
    });

    it("D2929: at start a refused latest discovery is logged as the refusal, not as a failed read, before the first reconciliation ends", async () => {
      const outcome = await inTempDir((dir) => {
        const store = refusedDiscoveryStore(dir);
        const inputs = new StandInInputs({ heldReconciliation: true });
        const started = daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          store,
          IDENTITY,
          inputs,
        );
        return begunThenStopped(started, ({ log, executor }) => {
          const atStart = {
            refusals: refusalEntries(log).length,
            readErrors: log.entries.filter((entry) =>
              entry.startsWith("error: reading the latest stored discovery"),
            ).length,
            discoveries: executor.discoveries,
          };
          return atStart;
        });
      });
      expect(outcome).toStrictEqual({
        refusals: 1,
        readErrors: 0,
        discoveries: 0,
      });
    });

    it("D2930: a store a newer RT Test migrated plans no discovery, and a summary is refused naming it", async () => {
      const outcome = await inTempDir((dir) => {
        const store = openStore(join(dir, "state"));
        alterStore(store.file, `PRAGMA user_version = ${NEWER}`);
        const started = daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          store,
        );
        return begunThenStopped(started, ({ executor, lifecycle }) => ({
          discoveries: executor.discoveries,
          summary: summaryOutcome(lifecycle),
        }));
      });
      expect(outcome).toStrictEqual({
        discoveries: 0,
        summary: "refused for a newer schema, nothing read",
      });
    });

    it("D2931: a run whose store write was refused for a newer schema is listed as stored nothing, with the refusal in its reason", async () => {
      const outcome = await inTempDir((dir) => {
        const store = openStore(join(dir, "state"));
        const executor = new ScriptedExecutor(
          { ended: true, value: discovery(discovered("a")) },
          (path) => {
            alterStore(store.file, `PRAGMA user_version = ${NEWER}`);
            return { ended: true, value: interrupted(path) };
          },
        );
        const started = daemon(confirmed("a"), executor, store);
        return begunThenStopped(started, ({ lifecycle }) =>
          lifecycle.status().unstoredJobs.map((job) => ({
            workspacePath: job.workspacePath,
            failed: job.reason.startsWith("the store write failed: "),
            namesRefusal: job.reason.endsWith(
              "so nothing was stored. Restart the daemon with the newer RT Test.",
            ),
          })),
        );
      });
      expect(outcome).toStrictEqual([
        { workspacePath: "a", failed: true, namesRefusal: true },
      ]);
    });

    it("D2932: a run whose store write failed for any other reason is listed with the plain reason, its detail only in the log", async () => {
      const { lifecycle, log } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          new RecordingStore(["a"]),
        ),
      );
      expect({
        unstored: lifecycle.status().unstoredJobs,
        logged: log.entries
          .filter((entry) => entry.includes("database is locked"))
          .map((entry) => entry.startsWith("error: storing")),
      }).toStrictEqual({
        unstored: [{ workspacePath: "a", reason: "the store write failed" }],
        logged: [true],
      });
    });

    it("D2958: a refusal a summary reads first is logged before the answer quotes it", async () => {
      const refusals = await afterIdle((file, lifecycle) => {
        alterStore(file, MADE_UNREADABLE);
        lifecycle.summary();
      });
      expect(refusals).toStrictEqual([REFUSAL]);
    });

    it("D2959: a refusal a path status reads first is logged before the answer quotes it", async () => {
      const refusals = await afterIdle((file, lifecycle) => {
        alterStore(file, MADE_UNREADABLE);
        lifecycle.pathStatus(join(IDENTITY.consumerRoot, "a"));
      });
      expect(refusals).toStrictEqual([REFUSAL]);
    });

    it("D2960: a different refusal of the latest discovery is logged too, once each", async () => {
      const refusals = await afterIdle((file, lifecycle) => {
        alterStore(file, MADE_UNREADABLE);
        lifecycle.summary();
        lifecycle.summary();
        alterStore(file, MADE_OTHERWISE_UNREADABLE);
        lifecycle.summary();
      });
      expect(refusals).toStrictEqual([REFUSAL, OTHER_REFUSAL]);
    });

    it("D2961: a refusal that returns after a readable discovery replaced it is logged again", async () => {
      const refusals = await afterIdle((file, lifecycle) => {
        alterStore(file, MADE_UNREADABLE);
        lifecycle.summary();
        alterStore(file, MADE_READABLE);
        lifecycle.summary();
        alterStore(file, MADE_UNREADABLE);
        lifecycle.summary();
      });
      expect(refusals).toStrictEqual([REFUSAL, REFUSAL]);
    });

    it("D2970: a discovery whose store write failed is logged with the storing error and never as ended, and a stored one is logged as ended", async () => {
      /** The storing errors and `discovery ended:` entries a start sequence logs over `store`. */
      async function endings(store: RtTestStore) {
        const { log } = await begunThenStopped(
          daemon(
            confirmed("a"),
            new ScriptedExecutor({
              ended: true,
              value: discovery(discovered("a")),
            }),
            store,
          ),
          (started) => started,
        );
        return {
          storingErrors: log.entries.filter((entry) =>
            entry.startsWith("error: storing the discovery"),
          ).length,
          ended: log.entries.filter((entry) =>
            entry.startsWith("discovery ended:"),
          ),
        };
      }
      const failing = new RecordingStore();
      failing.writeDiscovery = () => {
        throw new Error("database is locked");
      };
      expect({
        failed: await endings(failing),
        stored: await endings(new RecordingStore()),
      }).toStrictEqual({
        failed: { storingErrors: 1, ended: [] },
        stored: { storingErrors: 0, ended: ["discovery ended: a discovered"] },
      });
    });

    describe("a latest run the store refuses as unreadable", () => {
      const RUN_REFUSED_BEFORE = "warning: the latest stored run of ";
      const RUN_REFUSED_AFTER =
        " was refused as unreadable, so the daemon plans for it as if no run of it were stored: ";
      const READABLE_STATUS = "interrupted-before-load";

      /** Gives the latest stored run of `path` the status `status`, through a second connection. */
      function setLatestRunStatus(
        file: string,
        path: string,
        status: string,
      ): void {
        alterStore(
          file,
          `PRAGMA ignore_check_constraints = ON;
            UPDATE runs SET status = '${status}' WHERE sequence =
              (SELECT max(sequence) FROM runs WHERE workspace_path = '${path}')`,
        );
      }

      /** The whole entry the daemon logs for `path`'s latest run refused for its status `status`. */
      function refusalEntry(path: string, status: string): string {
        return `${RUN_REFUSED_BEFORE}${path}${RUN_REFUSED_AFTER}The store holds an unreadable runs.status: "${status}"`;
      }

      /**
       * Runs a daemon over a readable store and confirmed workspaces `paths` to idle, so it has stored a run of each,
       * then runs `after` against the store's file and the daemon, and returns the log's run refusal entries.
       */
      function afterRunsIdle(
        paths: readonly string[],
        after: (file: string, lifecycle: DaemonLifecycle) => void,
      ): Promise<string[]> {
        return inTempDir((dir) => {
          const store = openStore(join(dir, "state"));
          const started = daemon(
            confirmed(...paths),
            new ScriptedExecutor({
              ended: true,
              value: discovery(...paths.map((path) => discovered(path))),
            }),
            store,
          );
          return begunThenStopped(started, ({ lifecycle, log }) => {
            after(store.file, lifecycle);
            return log.entries.filter((entry) =>
              entry.startsWith(RUN_REFUSED_BEFORE),
            );
          });
        });
      }

      it("D3279: a workspace whose latest run is refused runs, though that run was stored current, and the run it stores replaces the refused one as its latest", async () => {
        const outcome = await inTempDir((dir) => {
          const store = openStore(join(dir, "state"));
          store.writeDiscovery(
            {
              ...SCOPE,
              inputFingerprint: { kind: "digest", digest: DISCOVERY_DIGEST },
            },
            discovery(discovered("a")),
          );
          store.writeRun(
            {
              ...SCOPE,
              inputFingerprint: { kind: "digest", digest: "a-digest" },
            },
            ranWorkspace("a"),
          );
          setLatestRunStatus(store.file, "a", "bogus");
          const started = daemon(
            confirmed("a"),
            new ScriptedExecutor({
              ended: true,
              value: discovery(discovered("a")),
            }),
            store,
          );
          return begunThenStopped(started, ({ executor }) => ({
            runs: executor.runs,
            latest: settle(() => {
              const latest = store.readLatestResults(SCOPE);
              return {
                runs: latest.latestRuns.map((stored) => stored.run),
                runRefusals: latest.runRefusals,
              };
            }),
          }));
        });
        expect(outcome).toStrictEqual({
          runs: ["a"],
          latest: { runs: [interrupted("a")], runRefusals: [] },
        });
      });

      it("D3280: a run refusal a summary reads is logged, naming its workspace, with its whole text", async () => {
        const status = "x".repeat(1500);
        const entries = await afterRunsIdle(["a"], (file, lifecycle) => {
          setLatestRunStatus(file, "a", status);
          lifecycle.summary();
        });
        expect(entries).toStrictEqual([refusalEntry("a", status)]);
      });

      it("D3281: a run refusal read again is logged once", async () => {
        const entries = await afterRunsIdle(["a"], (file, lifecycle) => {
          setLatestRunStatus(file, "a", "bogus");
          lifecycle.summary();
          lifecycle.summary();
        });
        expect(entries).toStrictEqual([refusalEntry("a", "bogus")]);
      });

      it("D3282: a run refusal that returns after a read that did not refuse it is logged again", async () => {
        const entries = await afterRunsIdle(["a"], (file, lifecycle) => {
          setLatestRunStatus(file, "a", "bogus");
          lifecycle.summary();
          setLatestRunStatus(file, "a", READABLE_STATUS);
          lifecycle.summary();
          setLatestRunStatus(file, "a", "bogus");
          lifecycle.summary();
        });
        expect(entries).toStrictEqual([
          refusalEntry("a", "bogus"),
          refusalEntry("a", "bogus"),
        ]);
      });

      it("D3283: a different refusal of a workspace's latest run is logged too, once each", async () => {
        const entries = await afterRunsIdle(["a"], (file, lifecycle) => {
          setLatestRunStatus(file, "a", "bogus");
          lifecycle.summary();
          lifecycle.summary();
          setLatestRunStatus(file, "a", "mangled");
          lifecycle.summary();
        });
        expect(entries).toStrictEqual([
          refusalEntry("a", "bogus"),
          refusalEntry("a", "mangled"),
        ]);
      });

      it("D3284: a second workspace's run refused for the reason already logged for another is logged too", async () => {
        const entries = await afterRunsIdle(["a", "b"], (file, lifecycle) => {
          setLatestRunStatus(file, "a", "bogus");
          lifecycle.summary();
          setLatestRunStatus(file, "b", "bogus");
          lifecycle.summary();
        });
        expect(entries).toStrictEqual([
          refusalEntry("a", "bogus"),
          refusalEntry("b", "bogus"),
        ]);
      });
    });
  },
);

describe(
  "beginning each job once the inputs settle",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    /** How many jobs have begun while the given wait is held, and how many once it is released. */
    async function jobsAroundHeldSettle(
      heldSettle: number,
    ): Promise<{ held: number; released: number }> {
      const { inputs } = await begun(scripted({ heldSettle }));
      const held = inputs.jobsBegun;
      inputs.settleHeld.resolve();
      await flush();
      return { held, released: inputs.jobsBegun };
    }

    it("D2080: the discovery's job begins only once the inputs have settled", async () => {
      expect(await jobsAroundHeldSettle(1)).toStrictEqual({
        held: 0,
        released: 3,
      });
    });

    it("D2081: the guard around protecting the discovery's test modules begins only once the inputs have settled", async () => {
      expect(await jobsAroundHeldSettle(2)).toStrictEqual({
        held: 1,
        released: 3,
      });
    });

    // A pending dependency build waits for the inputs itself, so the run's own wait shows only with none pending, as
    // while the tracker cannot vouch for its inputs.
    it("D2082: a run's job begins only once the inputs have settled", async () => {
      const { inputs } = await begun(holdingRun());
      const held = inputs.jobsBegun;
      inputs.settleHeld.resolve();
      await flush();
      expect({ held, released: inputs.jobsBegun }).toStrictEqual({
        held: 2,
        released: 3,
      });
    });

    it("D2083: a stop while the guard waits for the inputs to settle begins no guard job", async () => {
      const { lifecycle, inputs } = await begun(scripted({ heldSettle: 2 }));
      lifecycle.stop();
      await lifecycle.stopped();
      expect(inputs.jobsBegun).toBe(1);
    });

    it("D2084: a stop while a run waits for the inputs to settle starts no run", async () => {
      const { lifecycle, executor } = await begun(holdingRun());
      lifecycle.stop();
      await lifecycle.stopped();
      expect(executor.runs).toStrictEqual([]);
    });

    it("D2090: a declared test module that changes while the guard waits for the inputs to settle leaves the discovery stored not fingerprinted", async () => {
      const moduleChange = { settled: false };
      const held: { daemon?: Daemon } = {};
      held.daemon = scripted({
        heldSettle: 2,
        get moduleChanged() {
          return moduleChange.settled
            ? untilProtected(
                held.daemon,
                "src/a.test.ts, which the discovery protects and the inputs leave out, may have changed while the job ran",
              )
            : undefined;
        },
      });
      const { inputs, store } = await begun(held.daemon);
      moduleChange.settled = true;
      inputs.settleHeld.resolve();
      await flush();
      expect(store.discoveryFingerprints).toStrictEqual([
        { kind: "not-fingerprinted" },
      ]);
    });

    it("D2092: a stop while the discovery waits for the inputs to settle starts no discovery", async () => {
      const { lifecycle, executor } = await begun(scripted({ heldSettle: 1 }));
      lifecycle.stop();
      await lifecycle.stopped();
      expect(executor.discoveries).toBe(0);
    });

    it("D2088: while a run waits for the inputs to settle, the activity names its workspace", async () => {
      const { lifecycle } = await begun(holdingRun());
      expect(lifecycle.status().activity).toStrictEqual({
        state: "running",
        workspacePath: "a",
      });
    });

    it("D2086: the first discovery after a start whose reconciliation left an event unread, on an input nothing changed, is stored fingerprinted", async () => {
      expect(await inTempDir(idleStart)).toStrictEqual({
        injected: true,
        storedFingerprint: "digest",
      });
    });
  },
);

describe("the activity and the jobs that stored nothing", () => {
  it("D1454: while a run is in progress, the activity names its workspace", async () => {
    const { started } = heldAt("b", ["a", "b"]);
    const { lifecycle } = await begun(started);
    expect(lifecycle.status().activity).toStrictEqual({
      state: "running",
      workspacePath: "b",
    });
  });

  it("D1455: after a discovery that ended with nothing stored, while the scheduler waits out the next quiet window, the activity is idle", async () => {
    const activity = await underFakeClock(async () => {
      const inputs = new StandInInputs();
      const held = new Deferred<JobOutcome<TestDiscovery>>();
      return activityWhileTheNextWindowWaits(
        daemon(
          confirmed("a"),
          new ScriptedExecutor(held.promise),
          new RecordingStore(),
          IDENTITY,
          inputs,
          new ScriptedBuilds(),
          1000,
        ),
        async () => {
          inputs.moveRevision();
          held.resolve({
            ended: false,
            reason:
              "the executor process 7 exited during the job (exit code 1)",
          });
          await flush();
        },
      );
    });
    expect(activity).toStrictEqual({ state: "idle" });
  });

  it("D1456: a discovery that ended with nothing stored is listed with its reason and no workspace", async () => {
    const reason = "the executor process 7 exited during the job (exit code 1)";
    const executor = new ScriptedExecutor({ ended: false, reason });
    const { lifecycle } = await begun(daemon(confirmed("a"), executor));
    expect(lifecycle.status().unstoredJobs).toStrictEqual([{ reason }]);
  });
});

describe("answering a query", () => {
  it("D1841: a summary during a run carries the activity running that workspace", async () => {
    const { started } = heldAt("b", ["a", "b"], discoveredWithTest);
    const { lifecycle } = await begun(started);
    const answer = lifecycle.summary();
    expect("activity" in answer ? answer.activity : answer).toStrictEqual({
      state: "running",
      workspacePath: "b",
    });
  });

  it("D1842: a summary carries each job that ended with nothing stored, with its reason", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discoveredWithTest("a"), discoveredWithTest("b")),
    });
    const { lifecycle } = await begun(
      daemon(confirmed("a", "b"), executor, new RecordingStore(["a"])),
    );
    const answer = lifecycle.summary();
    expect(
      "unstoredJobs" in answer ? answer.unstoredJobs : answer,
    ).toStrictEqual([{ workspacePath: "a", reason: "the store write failed" }]);
  });

  it("D1843: a summary and a path status during a run neither interrupt it nor change which jobs run after it", async () => {
    const { started, held } = heldAt("a", ["a", "b"], discoveredWithTest);
    const { lifecycle, executor } = await begun(started);
    lifecycle.summary();
    lifecycle.pathStatus("/consumer/a");
    held.resolve({ ended: true, value: interrupted("a") });
    await flush();
    expect({ runs: executor.runs, aborts: executor.aborts }).toStrictEqual({
      runs: ["a", "b"],
      aborts: 0,
    });
  });

  it("D1871: a summary and a path status during a run leave the activity running that workspace", async () => {
    const { started } = heldAt("a", ["a", "b"], discoveredWithTest);
    const { lifecycle } = await begun(started);
    lifecycle.summary();
    lifecycle.pathStatus("/consumer/a");
    expect(lifecycle.status().activity).toStrictEqual({
      state: "running",
      workspacePath: "a",
    });
  });

  it("D1872: a path status carries each job that ended with nothing stored, with its reason", async () => {
    const jobs = await inTempDir(async (root) => {
      const executor = new ScriptedExecutor({
        ended: true,
        value: discovery(discoveredWithTest("a"), discoveredWithTest("b")),
      });
      const { lifecycle } = await begun(
        daemon(confirmed("a", "b"), executor, new RecordingStore(["a"]), {
          ...IDENTITY,
          consumerRoot: root,
        }),
      );
      const answer = lifecycle.pathStatus(join(root, "b"));
      return "unstoredJobs" in answer ? answer.unstoredJobs : answer;
    });
    expect(jobs).toStrictEqual([
      { workspacePath: "a", reason: "the store write failed" },
    ]);
  });

  it("D3020: a summary during a run reads that run's workspace running, as the answer's activity names it", async () => {
    const { started } = heldAt("b", ["a", "b"], discoveredWithTest);
    const { lifecycle } = await begun(started);
    const answer = lifecycle.summary();
    expect(
      "schedule" in answer
        ? answer.schedule.workspaces.find(
            (execution) => execution.workspacePath === "b",
          )
        : answer,
    ).toStrictEqual({ workspacePath: "b", state: "running" });
  });
});

describe("stopping", () => {
  it("D1459: a stop aborts the job in progress", async () => {
    const { started } = heldAt("a", ["a", "b"]);
    const { lifecycle, executor } = await begun(started);
    lifecycle.stop();
    await flush();
    expect(executor.aborts).toBe(1);
  });

  it("D1461: the run in progress when the stop arrives is stored once it ends", async () => {
    const { started, held } = heldAt("a", ["a", "b"]);
    const { lifecycle, store } = await begun(started);
    lifecycle.stop();
    await flush();
    held.resolve({ ended: true, value: interrupted("a") });
    await lifecycle.stopped();
    expect(store.runs).toStrictEqual([interrupted("a")]);
  });

  it("D1462: the store closes only after the run in progress has been stored", async () => {
    const { started, held } = heldAt("a", ["a"]);
    const { lifecycle, store } = await begun(started);
    lifecycle.stop();
    await flush();
    held.resolve({ ended: true, value: interrupted("a") });
    await lifecycle.stopped();
    expect({ stored: store.runs.length, closed: store.closed }).toStrictEqual({
      stored: 1,
      closed: true,
    });
  });

  it("D1463: a stop during a stop joins it, closing the endpoint once", async () => {
    const { started, held } = heldAt("a", ["a"]);
    const { lifecycle, endpointCloses } = await begun(started);
    lifecycle.stop();
    lifecycle.stop();
    await flush();
    held.resolve({ ended: true, value: interrupted("a") });
    await lifecycle.stopped();
    await flush();
    expect(endpointCloses.count).toBe(1);
  });

  it("D1881: a stop while a job's end waits on the inputs stops the tracker, so the stop ends", async () => {
    const { lifecycle } = await begun(scripted({ heldJobEnds: true }));
    lifecycle.stop();
    let stopped = false;
    void lifecycle.stopped().then(() => {
      stopped = true;
    });
    await flush();
    expect(stopped).toBe(true);
  });

  it("D2537: a stop closes the build executor, so no build process outlives the daemon", async () => {
    const { lifecycle, builds } = await begun(scripted({}));
    lifecycle.stop();
    await lifecycle.stopped();
    expect(builds.closes).toBe(1);
  });

  it("D1465: a discovery that returns after the stop arrived is not stored, and is listed with the reason", async () => {
    const held = new Deferred<JobOutcome<TestDiscovery>>();
    const started = daemon(confirmed("a"), new ScriptedExecutor(held.promise));
    const { lifecycle, store } = await begun(started);
    lifecycle.stop();
    await flush();
    held.resolve({ ended: true, value: discovery(discovered("a")) });
    await lifecycle.stopped();
    expect({
      discoveries: store.discoveries.length,
      unstored: lifecycle.status().unstoredJobs,
    }).toStrictEqual({
      discoveries: 0,
      unstored: [
        {
          reason: "the stop arrived during the discovery, so it was not stored",
        },
      ],
    });
  });

  it("D3200: the stop signal has aborted once stop() returns, while the run in progress still holds the stop sequence", async () => {
    const { started, held } = heldAt("a", ["a"]);
    const { lifecycle } = await begun(started);
    lifecycle.stop();
    const aborted = lifecycle.stopSignal.aborted;
    held.resolve({ ended: true, value: interrupted("a") });
    await lifecycle.stopped();
    expect(aborted).toBe(true);
  });

  it("D3201: the lifecycle reads stopping once its stop has begun", async () => {
    const { lifecycle } = await begun(scripted({}));
    lifecycle.stop();
    const stopping = lifecycle.isStopping();
    await lifecycle.stopped();
    expect(stopping).toBe(true);
  });

  it("D3247: a stop sequence that rejects is logged and still ends the stop, with no unhandled rejection", async () => {
    let logged: boolean | undefined;
    const unhandled = await unhandledRejectionsDuring(async () => {
      const { lifecycle, log } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          new RecordingStore(),
          IDENTITY,
          new FailingStopInputs(),
        ),
      );
      lifecycle.stop();
      await lifecycle.stopped();
      logged = log.entries.some((entry) =>
        entry.startsWith("error: the stop sequence failed: "),
      );
    });
    expect({ logged, unhandled: unhandled.map(String) }).toStrictEqual({
      logged: true,
      unhandled: [],
    });
  });

  it("D3192: a tracker stop that rejects still closes the executor, the build executor, the store and the endpoint", async () => {
    const executor = new ClosingExecutor({
      ended: true,
      value: discovery(discovered("a")),
    });
    const { lifecycle, builds, store, endpointCloses } = await begun(
      daemon(
        confirmed("a"),
        executor,
        new RecordingStore(),
        IDENTITY,
        new FailingStopInputs(),
      ),
    );
    lifecycle.stop();
    await lifecycle.stopped();
    expect({
      executor: executor.closes,
      builds: builds.closes,
      store: store.closed,
      endpoint: endpointCloses.count,
    }).toStrictEqual({ executor: 1, builds: 1, store: true, endpoint: 1 });
  });

  it("D3255: a stop whose sequence fails still resolves stopped(), so the daemon exits", async () => {
    const { lifecycle } = await begun(
      daemon(
        confirmed("a"),
        new ScriptedExecutor({
          ended: true,
          value: discovery(discovered("a")),
        }),
        new RecordingStore(),
        IDENTITY,
        new FailingStopInputs(),
      ),
    );
    lifecycle.stop();
    let stopped = false;
    void lifecycle.stopped().then(() => {
      stopped = true;
    });
    await flush();
    expect(stopped).toBe(true);
  });
});

/** A scripted executor that counts its closes. */
class ClosingExecutor extends ScriptedExecutor {
  closes = 0;

  override close(): Promise<void> {
    this.closes += 1;
    return super.close();
  }
}

/** Stand-in inputs whose stop rejects, as a tracker that fails to close its watches would. */
class FailingStopInputs extends StandInInputs {
  override async stop(): Promise<void> {
    await super.stop();
    throw new Error("the tracker failed to stop");
  }
}

const BUILT: BuildOutcome = { ended: true, value: NO_DEPENDENCIES };
const BUILD_FAILED_REASON =
  "the executor process 7 exited during the job (exit code 1)";
const BUILD_FAILED: BuildOutcome = {
  ended: false,
  reason: BUILD_FAILED_REASON,
};
const EDITED_REASON = "its inputs changed while it ran: packages/a/src/a.ts";
const EDITED: JobVerdict = {
  fingerprinted: false,
  reason: EDITED_REASON,
  changedWhileRunning: true,
};
const PROCEEDS_WITHOUT_BUILD = "proceeds without its dependency build";

function storedAs(discoveryId: string, found: TestDiscovery): StoredDiscovery {
  return {
    ...SCOPE,
    inputFingerprint: { kind: "not-fingerprinted" },
    adapterVersion: 3,
    discoveryId,
    discovery: found,
  };
}

/** A discovery of workspace `a` that reports its selection facts, so it yields a selection input. */
const STORED_A = storedAs("discovery-a", discovery(discovered("a")));

/** The bound the tests that shorten it give the builds, a literal each expected reason and log line is written from. */
const BOUND_MS = 5000;
/** The default bound of a dependency build in milliseconds, as the ticket names it. */
const DEFAULT_BOUND_MS = 120_000;
const ENDED_CAUSE = "the tracker failed: EIO";

/** A build that never ends by itself: only an abort ends it. */
function heldForever(): Promise<BuildOutcome> {
  return new Promise(() => undefined);
}

/** Fakes the timers a build's bound runs on, and leaves `setImmediate`, which `flush` waits on, real. */
function fakeBoundTimers(): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
}

/**
 * A build executor whose build produces its dependencies as the abort reaches it, so the build ends after the bound's
 * timer has fired.
 */
class FinishesOnAbort extends ScriptedBuilds {
  readonly #finish = new Deferred<BuildOutcome>();

  override buildDependencies(
    consumerRoot: string,
    workspaces: readonly SelectableWorkspace[],
  ): Promise<BuildOutcome> {
    void super.buildDependencies(consumerRoot, workspaces);
    return this.#finish.promise;
  }

  override abort(): boolean {
    const reached = super.abort();
    this.#finish.resolve(BUILT);
    return reached;
  }
}

interface BuildsCase {
  readonly script?: InputsScript;
  readonly answer?: (index: number) => BuildOutcome | Promise<BuildOutcome>;
  /** Shortens the bound of each build; the builds' own bound when absent. */
  readonly boundMs?: number;
  /** Fakes the bound's timers, so the test moves the clock and no build waits in real time. */
  readonly fakeTimers?: boolean;
  /** Stands in for the build executor instead of one answering from `answer`. */
  readonly executor?: ScriptedBuilds;
}

interface StartedBuilds {
  readonly builds: DependencyBuilds;
  readonly inputs: StandInInputs;
  readonly executor: ScriptedBuilds;
  readonly log: MemoryLog;
  /** How the view at the inputs' current revision takes each workspace's inputs. */
  view(): WorkspaceNarrowing;
}

/**
 * Starts the dependency builds and their stand-in inputs over a consumer root the test wrote, so each build reaches
 * the build executor, and stops both once `body` ends, aborting any build it left held.
 */
function withBuilds<T>(
  buildsCase: BuildsCase,
  body: (started: StartedBuilds) => Promise<T>,
): Promise<T> {
  return inTempDir(async (root) => {
    const inputs = new StandInInputs(buildsCase.script);
    const executor =
      buildsCase.executor ?? new ScriptedBuilds(buildsCase.answer);
    const log = memoryLog();
    if (buildsCase.fakeTimers === true) fakeBoundTimers();
    const builds = new DependencyBuilds({
      inputs,
      executor: executor as unknown as Executor,
      consumerRoot: root,
      stateDirectory: join(root, ".rt-test"),
      log,
      ...(buildsCase.boundMs === undefined
        ? {}
        : { boundMs: buildsCase.boundMs }),
    });
    inputs.start();
    builds.start();
    try {
      return await body({
        builds,
        inputs,
        executor,
        log,
        view: () => narrowingAt(builds.narrowing(), inputs.revision),
      });
    } finally {
      const stopped = builds.stop();
      executor.abort();
      await inputs.stop();
      await stopped;
      vi.useRealTimers();
    }
  });
}

/** Moves the clock the bound's timers run on by `ms`, then lets every job that has settled run to its end. */
async function advanceBound(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await flush();
}

/** Why a view says its inputs are not narrowed; undefined when it says none. */
function notNarrowedReason(view: WorkspaceNarrowing): string | undefined {
  return view.kind === NARROWING.narrowed
    ? undefined
    : view.notNarrowed?.reason;
}

/** The kind of input fact a view carries, or the view itself when it carries none. */
function notNarrowedKind(view: WorkspaceNarrowing): unknown {
  return view.kind !== NARROWING.narrowed && view.notNarrowed !== undefined
    ? { kind: view.kind, notNarrowed: view.notNarrowed.kind }
    : view;
}

describe("the dependency builds", { timeout: DAEMON_TEST_TIMEOUT_MS }, () => {
  it("D2504: no dependency build starts until the first reconciliation of the inputs has ended", async () => {
    const counts = await withBuilds(
      { script: { heldReconciliation: true } },
      async ({ builds, inputs, executor }) => {
        builds.use(STORED_A);
        await flush();
        const before = executor.builds.length;
        inputs.reconciled.resolve();
        await flush();
        return { before, after: executor.builds.length };
      },
    );
    expect(counts).toStrictEqual({ before: 0, after: 1 });
  });

  it("D2505: a build during which an input event arrived, with the revision unmoved, is never used", async () => {
    const rebuild = new Deferred<BuildOutcome>();
    const kind = await withBuilds(
      {
        script: { verdicts: [EDITED] },
        answer: (index) => (index === 0 ? BUILT : rebuild.promise),
      },
      async ({ builds, view }) => {
        builds.use(STORED_A);
        await flush();
        return view().kind;
      },
    );
    expect(kind).toBe(NARROWING.building);
  });

  it("D2506: a build over a discovery that a new one replaced while it ran is never used, and the new one gets its own build", async () => {
    const first = new Deferred<BuildOutcome>();
    const built = await withBuilds(
      { answer: (index) => (index === 0 ? first.promise : BUILT) },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        builds.use(storedAs("discovery-b", discovery(discovered("b"))));
        first.resolve(BUILT);
        await flush();
        return executor.builds;
      },
    );
    expect(built).toStrictEqual([["a"], ["b"]]);
  });

  it("D2507: a failed build is logged once at warning level, naming why", async () => {
    const levels = await withBuilds(
      { answer: () => BUILD_FAILED },
      async ({ builds, log }) => {
        builds.use(STORED_A);
        await flush();
        return log.entries
          .filter((entry) => entry.includes(BUILD_FAILED_REASON))
          .map((entry) => entry.startsWith("warning: "));
      },
    );
    expect(levels).toStrictEqual([true]);
  });

  it("D2508: a failed build is never retried at the same input revision", async () => {
    const count = await withBuilds(
      { answer: () => BUILD_FAILED },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        return executor.builds.length;
      },
    );
    expect(count).toBe(1);
  });

  it("D2509: the next change of the input revision after a failed build starts another build", async () => {
    const count = await withBuilds(
      { answer: () => BUILD_FAILED },
      async ({ builds, inputs, executor }) => {
        builds.use(STORED_A);
        await flush();
        inputs.moveRevision();
        await flush();
        return executor.builds.length;
      },
    );
    expect(count).toBe(2);
  });

  it("D2510: while the build after a failed one runs, the view still carries the failure", async () => {
    const rebuild = new Deferred<BuildOutcome>();
    const view = await withBuilds(
      { answer: (index) => (index === 0 ? BUILD_FAILED : rebuild.promise) },
      async ({ builds, inputs, view }) => {
        builds.use(STORED_A);
        await flush();
        inputs.moveRevision();
        await flush();
        return notNarrowedKind(view());
      },
    );
    expect(view).toStrictEqual({
      kind: NARROWING.building,
      notNarrowed: "dependency-build-failed",
    });
  });

  it("D2511: while the tracker cannot vouch for its inputs, no build starts", async () => {
    const count = await withBuilds(
      { script: { unavailable: WATCHER_FAILED } },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        return executor.builds.length;
      },
    );
    expect(count).toBe(0);
  });

  it("D2512: a stop ends the build in progress without waiting for it to end", async () => {
    const held = new Deferred<BuildOutcome>();
    const stop = await withBuilds(
      { answer: () => held.promise },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        let stopped = false;
        void builds.stop().then(() => {
          stopped = true;
        });
        await flush();
        return { aborts: executor.aborts, stopped };
      },
    );
    expect(stop).toStrictEqual({ aborts: 1, stopped: true });
  });

  it("D2514: a stop while a build waits for the inputs to settle starts no build", async () => {
    const count = await withBuilds(
      { script: { heldSettle: 0 } },
      async ({ builds, inputs, executor }) => {
        builds.use(STORED_A);
        await flush();
        const stopped = builds.stop();
        await inputs.stop();
        await stopped;
        await flush();
        return executor.builds.length;
      },
    );
    expect(count).toBe(0);
  });

  it("D2515: a build whose executor call throws reads as a failed build, and its job mark is closed", async () => {
    const outcome = await withBuilds(
      { answer: () => Promise.reject(new Error("spawn EAGAIN")) },
      async ({ builds, inputs, view }) => {
        builds.use(STORED_A);
        await flush();
        return {
          view: notNarrowedKind(view()),
          begun: inputs.jobsBegun,
          ended: inputs.jobsEnded,
        };
      },
    );
    expect(outcome).toStrictEqual({
      view: { kind: NARROWING.widened, notNarrowed: "dependency-build-failed" },
      begun: 1,
      ended: 1,
    });
  });

  it("D2558: a recorded build ends a run of discards, so the next discard starts the count again", async () => {
    const held = new Deferred<BuildOutcome>();
    const consecutive = await withBuilds(
      {
        script: { verdicts: [EDITED, FINGERPRINTED, EDITED] },
        answer: (index) => (index < 3 ? BUILT : held.promise),
      },
      async ({ builds, inputs }) => {
        builds.use(STORED_A);
        await flush();
        inputs.moveRevision();
        await flush();
        return builds.discards().consecutive;
      },
    );
    expect(consecutive).toBe(1);
  });

  it("D2560: a build discarded because a new discovery replaced its own never counts toward the new discovery's discards", async () => {
    const first = new Deferred<BuildOutcome>();
    const held = new Deferred<BuildOutcome>();
    const discards = await withBuilds(
      { answer: (index) => (index === 0 ? first.promise : held.promise) },
      async ({ builds }) => {
        builds.use(STORED_A);
        await flush();
        builds.use(storedAs("discovery-b", discovery(discovered("b"))));
        first.resolve(BUILT);
        await flush();
        const { total, consecutive } = builds.discards();
        return { total, consecutive };
      },
    );
    expect(discards).toStrictEqual({ total: 1, consecutive: 0 });
  });

  it("D2561: a narrowing whose selection refuses an input's path is logged once at warning level, naming the path", async () => {
    const refusedPath = "a:b.txt";
    const warnings = await withBuilds({}, async ({ builds, log }) => {
      builds.use(STORED_A);
      await flush();
      const state = builds.narrowing().state;
      const latest = state?.selectionInput === true ? state.latest : undefined;
      if (latest?.built !== true) return latest;
      const refused = new ProjectInputs(
        "/consumer",
        new Map([[refusedPath, "a-digest"]]),
      );
      latest.narrowing.refusal(refused);
      latest.narrowing.refusal(refused);
      return log.entries.filter(
        (entry) => entry.startsWith("warning: ") && entry.includes(refusedPath),
      ).length;
    });
    expect(warnings).toBe(1);
  });

  it("D2516: a discovery that yields no selection input builds nothing and reads widened, with that as the reason", async () => {
    const outcome = await withBuilds({}, async ({ builds, executor, view }) => {
      builds.use(
        storedAs(
          "discovery-unreported",
          discovery({
            ...discovered("a"),
            selectionFacts: { reported: false },
          }),
        ),
      );
      await flush();
      return { builds: executor.builds.length, view: notNarrowedKind(view()) };
    });
    expect(outcome).toStrictEqual({
      builds: 0,
      view: { kind: NARROWING.widened, notNarrowed: "no-selection-input" },
    });
  });

  it("D2607: a run that begins waiting for a build after the builds' rounds ended by throwing is released at once", async () => {
    const released = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs }) => {
        builds.use(STORED_A);
        await flush();
        inputs.settleHeld.resolve();
        await flush();
        let waiting = true;
        void builds.ended().then(() => {
          waiting = false;
        });
        await flush();
        return !waiting;
      },
    );
    expect(released).toBe(true);
  });

  it("D2609: an error the builds' rounds throw after a stop is logged as an error, naming the cause", async () => {
    const levels = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs, log }) => {
        builds.use(STORED_A);
        await flush();
        void builds.stop();
        inputs.settleHeld.resolve();
        await flush();
        return log.entries
          .filter((entry) => entry.includes(ENDED_CAUSE))
          .map((entry) => entry.startsWith("error: "));
      },
    );
    expect(levels).toStrictEqual([true]);
  });

  it("D2610: a build that timed out while its inputs moved is logged as counting as discarded, with the reason the inputs moved", async () => {
    const logged = await withBuilds(
      {
        fakeTimers: true,
        boundMs: BOUND_MS,
        script: { verdicts: [EDITED] },
        answer: heldForever,
      },
      async ({ builds, log }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return log.entries.filter(
          (entry) =>
            entry.includes("timed out") &&
            entry.includes("discarded") &&
            entry.includes(EDITED_REASON),
        ).length;
      },
    );
    expect(logged).toBe(1);
  });

  it("D2579: a build still running at the bound is recorded at its revision as a build that timed out, not as a failed one", async () => {
    const view = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, view }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return notNarrowedKind(view());
      },
    );
    expect(view).toStrictEqual({
      kind: NARROWING.widened,
      notNarrowed: "dependency-build-timed-out",
    });
  });

  it("D2580: a build with no bound given is still running 119999 ms after it began and has timed out at 120000 ms", async () => {
    const views = await withBuilds(
      { fakeTimers: true, answer: heldForever },
      async ({ builds, view }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(119_999);
        const beforeBound = view().kind;
        await advanceBound(1);
        return { beforeBound, atBound: notNarrowedKind(view()) };
      },
    );
    expect(views).toStrictEqual({
      beforeBound: NARROWING.building,
      atBound: {
        kind: NARROWING.widened,
        notNarrowed: "dependency-build-timed-out",
      },
    });
  });

  it("D2581: a build that has not ended at the bound is ended through the executor, once", async () => {
    const aborts = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        const beforeBound = executor.aborts;
        await advanceBound(BOUND_MS);
        return { beforeBound, atBound: executor.aborts };
      },
    );
    expect(aborts).toStrictEqual({ beforeBound: 0, atBound: 1 });
  });

  it("D2583: a build that timed out is never retried at the same input revision", async () => {
    const count = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        await advanceBound(BOUND_MS);
        return executor.builds.length;
      },
    );
    expect(count).toBe(1);
  });

  it("D2584: the next change of the input revision after a build that timed out starts another build", async () => {
    const count = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, inputs, executor }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        inputs.moveRevision();
        await flush();
        return executor.builds.length;
      },
    );
    expect(count).toBe(2);
  });

  it("D2585: builds discarded and then timed out with the inputs moving each count toward the discards in a row", async () => {
    const discards = await withBuilds(
      {
        fakeTimers: true,
        boundMs: BOUND_MS,
        script: { verdicts: [EDITED, EDITED] },
        answer: (index) => (index === 0 ? BUILT : heldForever()),
      },
      async ({ builds }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        const { total, consecutive } = builds.discards();
        return { total, consecutive };
      },
    );
    expect(discards).toStrictEqual({ total: 2, consecutive: 2 });
  });

  it("D2586: a build that timed out while its inputs moved counts as a discard, with the reason the inputs moved", async () => {
    const discards = await withBuilds(
      {
        fakeTimers: true,
        boundMs: BOUND_MS,
        script: { verdicts: [EDITED] },
        answer: heldForever,
      },
      async ({ builds }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return builds.discards();
      },
    );
    expect(discards).toStrictEqual({
      total: 1,
      consecutive: 1,
      reason: EDITED_REASON,
    });
  });

  it("D2587: a build that timed out with its inputs unmoved is not a discard", async () => {
    const discards = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return builds.discards();
      },
    );
    expect(discards).toStrictEqual({
      total: 0,
      consecutive: 0,
      reason: undefined,
    });
  });

  it("D2588: the reason recorded for a build that timed out names the bound", async () => {
    const reason = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, view }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return notNarrowedReason(view());
      },
    );
    expect(reason).toContain("5000 ms");
  });

  it("D2589: the reason recorded for a build that timed out is not the stop's reason the abort settles it with", async () => {
    const recorded = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, view }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        const reason = notNarrowedReason(view());
        return {
          recorded: reason !== undefined,
          aborted: reason === BUILD_ABORTED,
        };
      },
    );
    expect(recorded).toStrictEqual({ recorded: true, aborted: false });
  });

  it("D2590: a build that produced its dependencies as the bound's timer fired is recorded as an ordinary build", async () => {
    const kind = await withBuilds(
      {
        fakeTimers: true,
        boundMs: BOUND_MS,
        executor: new FinishesOnAbort(),
      },
      async ({ builds, view }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return view().kind;
      },
    );
    expect(kind).toBe(NARROWING.narrowed);
  });

  it("D2591: a build that ends before the bound is never ended by the bound's timer afterward", async () => {
    const aborts = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: () => BUILT },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return executor.aborts;
      },
    );
    expect(aborts).toBe(0);
  });

  it("D2592: a build that timed out over a discovery a new one replaced is discarded, and the new discovery gets its own build", async () => {
    const built = await withBuilds(
      {
        fakeTimers: true,
        boundMs: BOUND_MS,
        answer: (index) => (index === 0 ? heldForever() : BUILT),
      },
      async ({ builds, executor }) => {
        builds.use(STORED_A);
        await flush();
        builds.use(storedAs("discovery-b", discovery(discovered("b"))));
        await advanceBound(BOUND_MS);
        return executor.builds;
      },
    );
    expect(built).toStrictEqual([["a"], ["b"]]);
  });

  it("D2593: a build that timed out is logged once at warning level, naming its input revision and the bound", async () => {
    const levels = await withBuilds(
      { fakeTimers: true, boundMs: BOUND_MS, answer: heldForever },
      async ({ builds, log }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        return log.entries
          .filter(
            (entry) =>
              entry.includes("timed out") &&
              entry.includes("input revision 1") &&
              entry.includes("5000 ms"),
          )
          .map((entry) => entry.startsWith("warning: "));
      },
    );
    expect(levels).toStrictEqual([true]);
  });

  it("D2594: while the build after one that timed out runs, the view still says that build timed out", async () => {
    const view = await withBuilds(
      {
        fakeTimers: true,
        boundMs: BOUND_MS,
        answer: heldForever,
      },
      async ({ builds, inputs, view }) => {
        builds.use(STORED_A);
        await flush();
        await advanceBound(BOUND_MS);
        inputs.moveRevision();
        await flush();
        return notNarrowedKind(view());
      },
    );
    expect(view).toStrictEqual({
      kind: NARROWING.building,
      notNarrowed: "dependency-build-timed-out",
    });
  });

  it("D2595: once the builds' rounds end by throwing, the discovery in effect reads widened, with the builds ended as the kind", async () => {
    const view = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs, view }) => {
        builds.use(STORED_A);
        await flush();
        inputs.settleHeld.resolve();
        await flush();
        return notNarrowedKind(view());
      },
    );
    expect(view).toStrictEqual({
      kind: NARROWING.widened,
      notNarrowed: "dependency-builds-ended",
    });
  });

  it("D2596: the reason the builds ended is the text of the error that ended their rounds", async () => {
    const reason = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs, view }) => {
        builds.use(STORED_A);
        await flush();
        inputs.settleHeld.resolve();
        await flush();
        return notNarrowedReason(view());
      },
    );
    expect(reason).toContain(ENDED_CAUSE);
  });

  it("D2597: a discovery handed to the builds after their rounds ended reads widened too, never as building", async () => {
    const view = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs, view }) => {
        builds.use(STORED_A);
        await flush();
        inputs.settleHeld.resolve();
        await flush();
        builds.use(storedAs("discovery-b", discovery(discovered("b"))));
        return notNarrowedKind(view());
      },
    );
    expect(view).toStrictEqual({
      kind: NARROWING.widened,
      notNarrowed: "dependency-builds-ended",
    });
  });

  it("D2598: a run waiting for a build is released when the builds' rounds end by throwing", async () => {
    const released = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs }) => {
        builds.use(STORED_A);
        await flush();
        let waiting = true;
        void builds.ended().then(() => {
          waiting = false;
        });
        await flush();
        const whileRoundsRun = waiting;
        inputs.settleHeld.resolve();
        await flush();
        return { whileRoundsRun, afterRoundsEnd: waiting };
      },
    );
    expect(released).toStrictEqual({
      whileRoundsRun: true,
      afterRoundsEnd: false,
    });
  });

  it("D2599: a stop that ends the builds' rounds is never read as the builds ending", async () => {
    const buildsEnded = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs }) => {
        builds.use(STORED_A);
        await flush();
        void builds.stop();
        inputs.settleHeld.resolve();
        await flush();
        return builds.narrowing().buildsEnded;
      },
    );
    expect(buildsEnded).toBeUndefined();
  });

  it("D2600: builds whose rounds ended by throwing are logged once at warning level, naming the cause", async () => {
    const levels = await withBuilds(
      { script: { heldSettle: 0, settleFails: ENDED_CAUSE } },
      async ({ builds, inputs, log }) => {
        builds.use(STORED_A);
        await flush();
        inputs.settleHeld.resolve();
        await flush();
        return log.entries
          .filter((entry) => entry.includes(ENDED_CAUSE))
          .map((entry) => entry.startsWith("warning: "));
      },
    );
    expect(levels).toStrictEqual([true]);
  });
});

/**
 * A daemon over one confirmed workspace `a`, started from `root`, a directory the test wrote, so each dependency build
 * reaches `builds`.
 */
function rootedAt(
  root: string,
  script: InputsScript,
  builds: ScriptedBuilds,
  store: RecordingStore = new RecordingStore(),
  executor: ScriptedExecutor = new ScriptedExecutor({
    ended: true,
    value: discovery(discovered("a")),
  }),
  quietWindowMs: number = NO_QUIET_WINDOW_MS,
): Daemon {
  return daemon(
    { ...confirmed("a"), consumerRoot: root },
    executor,
    store,
    { ...IDENTITY, consumerRoot: root },
    new StandInInputs(script),
    builds,
    quietWindowMs,
  );
}

/** Runs `body` over the started daemon, then stops it. */
async function thenStopped<T>(
  started: Daemon,
  body: (started: Daemon) => Promise<T>,
): Promise<T> {
  try {
    return await body(started);
  } finally {
    started.lifecycle.stop();
    await started.lifecycle.stopped();
  }
}

/** A fingerprint that fails while the view waits for its build, as a building view's does. */
function failingWhileBuilding(
  path: string,
  narrowing: QueryNarrowing | undefined,
): FingerprintResult {
  return narrowing !== undefined &&
    narrowingAt(narrowing, SETTLED_INPUTS.revision).kind === NARROWING.building
    ? { ok: false, reason: "the dependency build has not ended" }
    : { ok: true, digest: `${path}-digest` };
}

describe(
  "each run's wait for its dependency build",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D2513: while the tracker cannot vouch for its inputs, a run proceeds without waiting for a build", async () => {
      const { executor } = await begun(
        scripted({ unavailable: WATCHER_FAILED }),
      );
      expect(executor.runs).toStrictEqual(["a"]);
    });

    it("D2517: a run begins only once the dependency build at its settled revision has ended", async () => {
      const held = new Deferred<BuildOutcome>();
      const runs = await inTempDir(async (root) =>
        thenStopped(
          await begun(
            rootedAt(root, {}, new ScriptedBuilds(() => held.promise)),
          ),
          async ({ executor }) => {
            const whileBuilding = [...executor.runs];
            held.resolve(BUILT);
            await flush();
            return { whileBuilding, after: executor.runs };
          },
        ),
      );
      expect(runs).toStrictEqual({ whileBuilding: [], after: ["a"] });
    });

    it("D2559: each run counts the discards from its own wait's start, so the next workspace waits after the first gave up", async () => {
      const held = new Deferred<BuildOutcome>();
      const runs = await inTempDir(async (root) =>
        thenStopped(
          await begun(
            daemon(
              { ...confirmed("a", "b"), consumerRoot: root },
              new ScriptedExecutor({
                ended: true,
                value: discovery(discovered("a"), discovered("b")),
              }),
              new RecordingStore(),
              { ...IDENTITY, consumerRoot: root },
              new StandInInputs({
                verdicts: [FINGERPRINTED, FINGERPRINTED, EDITED, EDITED],
              }),
              new ScriptedBuilds((index) => (index < 2 ? BUILT : held.promise)),
            ),
          ),
          async ({ executor }) => [...executor.runs],
        ),
      );
      expect(runs).toStrictEqual(["a"]);
    });

    it("D2518: a run keeps waiting through one discarded build", async () => {
      const rebuild = new Deferred<BuildOutcome>();
      const runs = await inTempDir(async (root) =>
        thenStopped(
          await begun(
            rootedAt(
              root,
              { verdicts: [FINGERPRINTED, FINGERPRINTED, EDITED] },
              new ScriptedBuilds((index) =>
                index === 0 ? BUILT : rebuild.promise,
              ),
            ),
          ),
          async ({ executor }) => [...executor.runs],
        ),
      );
      expect(runs).toStrictEqual([]);
    });

    it("D2519: a run whose build is discarded twice in a row while it waits proceeds, is stored not fingerprinted, and the log says why", async () => {
      const held = new Deferred<BuildOutcome>();
      const outcome = await inTempDir(async (root) => {
        const { lifecycle, store, log } = await begun(
          rootedAt(
            root,
            {
              verdicts: [FINGERPRINTED, FINGERPRINTED, EDITED, EDITED],
              fingerprintOf: failingWhileBuilding,
            },
            new ScriptedBuilds((index) => (index < 2 ? BUILT : held.promise)),
          ),
        );
        // The run's verdict waits for the build still held at its end revision, which the stop ends.
        lifecycle.stop();
        await lifecycle.stopped();
        return {
          runs: [...store.runFingerprints],
          logged: log.entries.filter(
            (entry) =>
              entry.includes(PROCEEDS_WITHOUT_BUILD) &&
              entry.includes(EDITED_REASON),
          ).length,
        };
      });
      expect(outcome).toStrictEqual({
        runs: [{ kind: "not-fingerprinted" }],
        logged: 1,
      });
    });

    it("D2520: a stop while a run waits for its dependency build ends the stop and starts no run", async () => {
      const held = new Deferred<BuildOutcome>();
      const outcome = await inTempDir(async (root) => {
        const { lifecycle, executor } = await begun(
          rootedAt(root, {}, new ScriptedBuilds(() => held.promise)),
        );
        lifecycle.stop();
        let stopped = false;
        void lifecycle.stopped().then(() => {
          stopped = true;
        });
        await flush();
        return { stopped, runs: executor.runs };
      });
      expect(outcome).toStrictEqual({ stopped: true, runs: [] });
    });

    it("D2521: a query hands the builds the stored discovery a failed read at start kept from them", async () => {
      const counts = await inTempDir(async (root) => {
        const store = new FirstReadFailingStore();
        store.discoveries.push(discovery(discovered("a")));
        return thenStopped(
          await begun(
            rootedAt(
              root,
              {},
              new ScriptedBuilds(),
              store,
              new ScriptedExecutor({
                ended: false,
                reason: BUILD_FAILED_REASON,
              }),
              HELD_BY_QUIET_WINDOW_MS,
            ),
          ),
          async ({ lifecycle, builds }) => {
            const before = builds.builds.length;
            lifecycle.summary();
            await flush();
            return { before, after: builds.builds.length };
          },
        );
      });
      expect(counts).toStrictEqual({ before: 0, after: 1 });
    });

    it("D2522: a run is stored under the fingerprint of its narrowed inputs, as answers compare it", async () => {
      const fingerprints = await inTempDir(async (root) =>
        thenStopped(
          await begun(
            rootedAt(
              root,
              {
                fingerprintOf: (path, narrowing) => ({
                  ok: true,
                  digest: `${path}-${narrowing === undefined ? "whole" : narrowingAt(narrowing, SETTLED_INPUTS.revision).kind}`,
                }),
              },
              new ScriptedBuilds(),
            ),
          ),
          async ({ store }) => [...store.runFingerprints],
        ),
      );
      expect(fingerprints).toStrictEqual([
        { kind: "digest", digest: "a-narrowed" },
      ]);
    });

    it("D2582: a run waiting for a build that never ends begins once the build has been ended at the bound", async () => {
      const runs = await inTempDir(async (root) => {
        fakeBoundTimers();
        try {
          return await thenStopped(
            await begun(
              rootedAt(root, {}, new ScriptedBuilds(() => heldForever())),
            ),
            async ({ executor }) => {
              const whileBuilding = [...executor.runs];
              await advanceBound(DEFAULT_BOUND_MS);
              vi.useRealTimers();
              return { whileBuilding, after: [...executor.runs] };
            },
          );
        } finally {
          vi.useRealTimers();
        }
      });
      expect(runs).toStrictEqual({ whileBuilding: [], after: ["a"] });
    });
  },
);

describe("an answer read after the dependency builds ended", () => {
  it("D2601: a query hands the builds' end to the view together with the stored discovery's id", async () => {
    const view = await inTempDir(async (root) =>
      thenStopped(
        await begun(
          rootedAt(root, { changedFails: ENDED_CAUSE }, new ScriptedBuilds()),
        ),
        async ({ lifecycle, inputs }) => {
          lifecycle.summary();
          const narrowing = inputs.narrowings.at(-1);
          return narrowing === undefined
            ? narrowing
            : notNarrowedKind(narrowingAt(narrowing, inputs.revision));
        },
      ),
    );
    expect(view).toStrictEqual({
      kind: NARROWING.widened,
      notNarrowed: "dependency-builds-ended",
    });
  });
});

/** An executor whose run rejects, as one that cannot start its child process does. */
class RunsThrow extends ScriptedExecutor {
  override run(): Promise<RunOutcome> {
    return Promise.reject(new Error("spawn EAGAIN"));
  }
}

/** An executor whose discovery rejects, as one that cannot start its child process does. */
class DiscoveryThrows extends ScriptedExecutor {
  override discover(): Promise<JobOutcome<TestDiscovery>> {
    return Promise.reject(new Error("spawn EAGAIN"));
  }
}

/** An executor whose close rejects. */
class CloseThrows extends ScriptedExecutor {
  override close(): Promise<void> {
    return Promise.reject(new Error("EPERM"));
  }
}

describe("a job that cannot end normally", () => {
  it("D2675: a run whose executor call throws ends with nothing stored, listed with the cause, and its change window is closed", async () => {
    const { lifecycle, inputs } = await begun(
      daemon(
        confirmed("a"),
        new RunsThrow({ ended: true, value: discovery(discovered("a")) }),
      ),
    );
    const [job] = lifecycle.status().unstoredJobs;
    expect({
      workspacePath: job?.workspacePath,
      namesCause: job?.reason.includes("spawn EAGAIN"),
      windowsClosed: inputs.jobsEnded === inputs.jobsBegun,
    }).toStrictEqual({
      workspacePath: "a",
      namesCause: true,
      windowsClosed: true,
    });
  });

  it("D2676: a discovery whose executor call throws ends with nothing stored, listed with the cause and no workspace, and its change window is closed", async () => {
    const { lifecycle, inputs } = await begun(
      daemon(
        confirmed("a"),
        new DiscoveryThrows({
          ended: true,
          value: discovery(discovered("a")),
        }),
      ),
    );
    const [job] = lifecycle.status().unstoredJobs;
    expect({
      listed: lifecycle.status().unstoredJobs.length,
      workspacePath: job?.workspacePath,
      namesCause: job?.reason.includes("spawn EAGAIN"),
      windowsClosed: inputs.jobsEnded === inputs.jobsBegun,
    }).toStrictEqual({
      listed: 1,
      workspacePath: undefined,
      namesCause: true,
      windowsClosed: true,
    });
  });

  it("D2677: a stop whose executor close rejects logs the error, and still closes the store and the endpoint", async () => {
    const { lifecycle, store, log, endpointCloses } = await begun(
      daemon(
        confirmed("a"),
        new CloseThrows({ ended: true, value: discovery(discovered("a")) }),
      ),
    );
    lifecycle.stop();
    await lifecycle.stopped();
    expect({
      logged: log.entries.some(
        (entry) =>
          entry.startsWith("error: closing the executor") &&
          entry.includes("EPERM"),
      ),
      storeClosed: store.closed,
      endpointCloses: endpointCloses.count,
    }).toStrictEqual({ logged: true, storeClosed: true, endpointCloses: 1 });
  });

  it("D2678: a run whose store write fails again on a retry is listed once, by its latest ending", async () => {
    const executor = new ScriptedExecutor({
      ended: true,
      value: discovery(discovered("a")),
    });
    const { lifecycle, inputs } = await begun(
      daemon(confirmed("a"), executor, new RecordingStore(["a"])),
    );
    inputs.endPeriodicReconciliation();
    await flush();
    expect({
      runs: executor.runs,
      unstored: lifecycle.status().unstoredJobs,
    }).toStrictEqual({
      runs: ["a", "a"],
      unstored: [{ workspacePath: "a", reason: "the store write failed" }],
    });
  });
});

/** A store whose first write of the given kind fails, as a locked database does once. */
class LockedOnce extends RecordingStore {
  #runFailed: boolean;
  #discoveryFailed: boolean;

  constructor(fails: "run" | "discovery") {
    super();
    this.#runFailed = fails !== "run";
    this.#discoveryFailed = fails !== "discovery";
  }

  override writeRun(bindings: StoreBindings, run: WorkspaceRun): StoredRun {
    if (!this.#runFailed) {
      this.#runFailed = true;
      throw new Error("database is locked");
    }
    return super.writeRun(bindings, run);
  }

  override writeDiscovery(
    bindings: StoreBindings,
    written: TestDiscovery,
  ): StoredDiscovery {
    if (!this.#discoveryFailed) {
      this.#discoveryFailed = true;
      throw new Error("database is locked");
    }
    return super.writeDiscovery(bindings, written);
  }
}

describe("what the daemon reports of a job once it has ended", () => {
  it("D2729: after a run ends, while the scheduler waits out the next quiet window, the activity is idle, whether the run ended or did not begin", async () => {
    const activities = await underFakeClock(async () => {
      const inputs = new StandInInputs();
      const ended = await activityWhileTheNextWindowWaits(
        daemon(
          confirmed("a"),
          new ScriptedExecutor(
            { ended: true, value: discovery(discovered("a")) },
            (path) => {
              inputs.moveRevision();
              return { ended: true, value: interrupted(path) };
            },
          ),
          new RecordingStore(),
          IDENTITY,
          inputs,
          new ScriptedBuilds(),
          1000,
        ),
        () => Promise.resolve(),
      );
      const held = holdingRun(1000);
      const unbegun = await activityWhileTheNextWindowWaits(held, async () => {
        held.inputs.moveRevision();
        held.inputs.settleHeld.resolve();
        await flush();
      });
      return { ended, unbegun };
    });
    expect(activities).toStrictEqual({
      ended: { state: "idle" },
      unbegun: { state: "idle" },
    });
  });

  it("D2730: a job that ended with nothing stored is no longer listed once a later attempt of it stores its record, for a run and for a discovery", async () => {
    const listedAfterARetry = async (
      store: LockedOnce,
    ): Promise<readonly unknown[]> => {
      const { lifecycle, inputs } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discovered("a")),
          }),
          store,
        ),
      );
      inputs.endPeriodicReconciliation();
      await flush();
      return lifecycle.status().unstoredJobs;
    };
    const runStore = new LockedOnce("run");
    runStore.seedDiscovery(discovery(discovered("a")), {
      kind: "digest",
      digest: DISCOVERY_DIGEST,
    });
    expect({
      run: await listedAfterARetry(runStore),
      discovery: await listedAfterARetry(new LockedOnce("discovery")),
    }).toStrictEqual({ run: [], discovery: [] });
  });

  it("D2739: a run whose executor died is run again when a periodic reconciliation ends, while it is still due", async () => {
    const executor = new ScriptedExecutor(
      { ended: true, value: discovery(discovered("a")) },
      () => ({ ended: false, reason: "the executor process 7 exited" }),
    );
    const { inputs } = await begun(daemon(confirmed("a"), executor));
    inputs.endPeriodicReconciliation();
    await flush();
    expect(executor.runs).toStrictEqual(["a", "a"]);
  });

  it("D2740: a run whose inputs changed while it ran, at a revision the change did not move, is run once more", async () => {
    const { executor } = await begun(
      scripted({}, (inputs, run) => {
        if (run === 1) inputs.recordPath("packages/a/src/a.ts");
      }),
    );
    expect(executor.runs).toStrictEqual(["a", "a"]);
  });

  it("D2747: a run that began with its inputs unsettled is not run once more at the same revision", async () => {
    const { executor } = await begun(
      scripted({
        fingerprintOf: () => ({ ok: false, reason: RECONCILING }),
      }),
    );
    expect(executor.runs).toStrictEqual(["a"]);
  });
});

describe("a job planned at a revision that then moved", () => {
  it("D2679: a run whose start finds the input revision moved since it was planned begins nothing, and runs only once the new revision has held still", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date", "performance"],
    });
    try {
      const { lifecycle, inputs, executor } = holdingRun(1000);
      lifecycle.begin();
      await flush();
      await vi.advanceTimersByTimeAsync(1000);
      await flush();
      inputs.moveRevision();
      inputs.settleHeld.resolve();
      await flush();
      await vi.advanceTimersByTimeAsync(999);
      await flush();
      const before = [...executor.runs];
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      lifecycle.stop();
      await lifecycle.stopped();
      expect({ before, after: [...executor.runs] }).toStrictEqual({
        before: [],
        after: ["a"],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Package workspaces `a` and `b`: selection puts a path under `a/` in Vitest workspace `a`'s inputs, and a path under
 * `b/` in no Vitest workspace's.
 */
const A_AND_B: DependencyInformation = {
  ...NO_DEPENDENCIES,
  packageWorkspaces: [workspace("a"), workspace("b")],
};
const INSIDE = "a/src/a.ts";
const OUTSIDE = "b/src/b.ts";
/** A legal Linux file name that Windows' path rules read as drive-relative, so selection refuses it. */
const REFUSED_PATH = "a:b.txt";
const NOT_FINGERPRINTED_LINE = "the run of a is stored not fingerprinted: ";
const KEPT_LINE =
  "the run of a is stored under its input fingerprint, since only paths outside its workspace's inputs changed while it ran";
const INTERRUPTED_REASON =
  "a change inside its workspace's inputs interrupted it, so nothing of it was stored";
const UNHEALTHY = "the input watcher is unhealthy: the watcher failed: ENOSPC";
const NOT_FINGERPRINTED = { kind: "not-fingerprinted" };
const PLACEMENT_FAILED =
  "error: placing the paths that changed during the run of a, so every one counts inside its inputs";

/** Workspace `path`, discovered with no test, whose one project lists `setupFiles`, root-relative. */
function listingSetupOf(
  path: string,
  setupFiles: readonly string[],
): WorkspaceDiscovery {
  return {
    ...discovered(path),
    selectionFacts: {
      reported: true,
      projects: [projectFacts({ setupFiles })],
    },
  };
}

/** Workspace `path`, discovered with no test, whose one project loads env files from `envDirectory`, root-relative. */
function listingEnvOf(path: string, envDirectory: string): WorkspaceDiscovery {
  return {
    ...discovered(path),
    selectionFacts: {
      reported: true,
      projects: [
        projectFacts({
          envSources: [{ envDirectory, envPrefixes: ["VITE_"], mode: "test" }],
        }),
      ],
    },
  };
}

/** A daemon over workspace `a`, started from `root`, whose every dependency build narrows over `dependencies`. */
function narrowedDaemon(
  root: string,
  inputs: StandInInputs,
  executor: ScriptedExecutor,
  dependencies: DependencyInformation = A_AND_B,
): Daemon {
  return daemon(
    { ...confirmed("a"), consumerRoot: root },
    executor,
    new RecordingStore(),
    { ...IDENTITY, consumerRoot: root },
    inputs,
    new ScriptedBuilds(() => ({ ended: true, value: dependencies })),
  );
}

/**
 * Dependency information listing package workspaces `a` and `b` as `A_AND_B` does, whose read throws once
 * `failing.on` is set, as a build that fails to place a run's changed paths.
 */
function failingOnceOn(failing: { on: boolean }): DependencyInformation {
  return {
    ...NO_DEPENDENCIES,
    get packageWorkspaces() {
      if (failing.on) {
        throw new Error("the build's package workspaces could not be read");
      }
      return A_AND_B.packageWorkspaces;
    },
  };
}

/**
 * Runs a daemon over narrowed builds in a root of its own, calling `during` in each run as `scripted` does, hands
 * `body` the daemon once it has run all it can, and stops it after.
 */
function narrowedRun<T>(
  during: (inputs: StandInInputs, run: number) => void | Promise<void>,
  body: (started: Daemon) => Promise<T>,
  inputs: StandInInputs = new StandInInputs(),
): Promise<T> {
  return inTempDir(async (root) => {
    const executor: ScriptedExecutor = new ScriptedExecutor(
      { ended: true, value: discovery(discovered("a")) },
      async (path) => {
        await during(inputs, executor.runs.length);
        return { ended: true, value: interrupted(path) };
      },
    );
    return thenStopped(
      await begun(narrowedDaemon(root, inputs, executor)),
      body,
    );
  });
}

/** An executor whose every run holds until an abort, which ends the run in progress with `aborted`. */
class HoldingExecutor extends ScriptedExecutor {
  readonly #aborted: RunOutcome;
  readonly #during: (run: number) => void;
  #held: Deferred<RunOutcome> | undefined;

  /** `during` is called as each run starts, with the run's count from 1. */
  constructor(
    aborted: RunOutcome,
    during: (run: number) => void,
    found: TestDiscovery = discovery(discovered("a")),
  ) {
    super({ ended: true, value: found });
    this.#aborted = aborted;
    this.#during = during;
  }

  override run(workspace: VitestWorkspace): Promise<RunOutcome> {
    this.runs.push(workspace.path);
    const held = new Deferred<RunOutcome>();
    this.#held = held;
    this.#during(this.runs.length);
    return held.promise;
  }

  override abort(purpose?: AbortPurpose): boolean {
    const reached = super.abort(purpose);
    this.#held?.resolve(this.#aborted);
    this.#held = undefined;
    return reached;
  }
}

/** What a run its abort reached returns: interrupted after its tests loaded. */
const INTERRUPTED_RUN: RunOutcome = {
  ended: true,
  value: ranWorkspace("a", ["passed"], "interrupted"),
};

/**
 * Runs `a` over narrowed builds with an executor that holds each run until an abort ends it with `aborted`. While the
 * first run holds, `a/src/a.ts` changes and the revision moves, so the next build places the change inside `a`'s
 * inputs. Hands `body` the daemon once that has settled, and stops it after.
 */
function withInterruptedRun<T>(
  aborted: RunOutcome,
  body: (started: Daemon) => Promise<T>,
): Promise<T> {
  return inTempDir(async (root) => {
    const inputs = new StandInInputs();
    const executor = new HoldingExecutor(aborted, (run) => {
      if (run !== 1) return;
      inputs.recordPath(INSIDE);
      inputs.moveRevision();
    });
    const started = await begun(narrowedDaemon(root, inputs, executor));
    await flush();
    return thenStopped(started, body);
  });
}

describe(
  "judging a run by its workspace's inputs",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D2862: a run during which only a path outside its workspace's inputs changed is stored under the fingerprint it started from", async () => {
      const fingerprints = await narrowedRun(
        (inputs) => inputs.recordPath(OUTSIDE),
        async ({ store }) => [...store.runFingerprints],
      );
      expect(fingerprints).toStrictEqual([
        { kind: "digest", digest: "a-digest" },
      ]);
    });

    it("D2889: a run stored under its fingerprint while paths outside its inputs changed is logged with those paths", async () => {
      const logged = await narrowedRun(
        (inputs) => inputs.recordPath(OUTSIDE),
        async ({ log }) =>
          log.entries.filter((entry) => entry.startsWith(KEPT_LINE)),
      );
      expect(logged).toStrictEqual([`${KEPT_LINE}: ${OUTSIDE}`]);
    });

    it("D2863: a run during which a path inside its workspace's inputs changed, with its fingerprint at the end the same, is stored not fingerprinted, the log naming the path", async () => {
      const outcome = await narrowedRun(
        (inputs, run) => {
          if (run === 1) inputs.recordPath(INSIDE);
        },
        async ({ store, log }) => ({
          stored: store.runFingerprints[0],
          logged: log.entries.filter((entry) =>
            entry.startsWith(NOT_FINGERPRINTED_LINE),
          ),
        }),
      );
      expect(outcome).toStrictEqual({
        stored: NOT_FINGERPRINTED,
        logged: [
          `${NOT_FINGERPRINTED_LINE}its inputs changed while it ran: ${INSIDE}`,
        ],
      });
    });

    it("D2864: a run during which a watcher failure was recorded is stored not fingerprinted, the log naming the failure", async () => {
      const outcome = await narrowedRun(
        (inputs, run) => {
          if (run === 1) inputs.recordCause(WATCHER_FAILED);
        },
        async ({ store, log }) => ({
          stored: [...store.runFingerprints],
          logged: log.entries.filter((entry) =>
            entry.startsWith(NOT_FINGERPRINTED_LINE),
          ),
        }),
      );
      expect(outcome).toStrictEqual({
        stored: [NOT_FINGERPRINTED],
        logged: [
          `${NOT_FINGERPRINTED_LINE}its inputs could not be vouched for while it ran: ${WATCHER_FAILED}`,
        ],
      });
    });

    it("D2890: a run whose workspace fingerprint could not be taken at its end is logged with why", async () => {
      const phase = { ended: false };
      const { log } = await begun(
        scripted(
          {
            fingerprintOf: () =>
              phase.ended
                ? { ok: false, reason: UNHEALTHY }
                : { ok: true, digest: "a-digest" },
          },
          () => {
            phase.ended = true;
          },
        ),
      );
      expect(
        log.entries.filter((entry) => entry.startsWith(NOT_FINGERPRINTED_LINE)),
      ).toStrictEqual([
        `${NOT_FINGERPRINTED_LINE}its workspace's input fingerprint could not be taken at its end: ${UNHEALTHY}`,
      ]);
    });

    it("D2886: a run during which an input changed, whose fingerprint could not be taken at its end, is not run once more at the same revision", async () => {
      const phase = { ended: false };
      const { executor } = await begun(
        scripted(
          {
            fingerprintOf: () =>
              phase.ended
                ? { ok: false, reason: UNHEALTHY }
                : { ok: true, digest: "a-digest" },
          },
          (inputs) => {
            inputs.recordPath(INSIDE);
            phase.ended = true;
          },
        ),
      );
      expect(executor.runs).toStrictEqual(["a"]);
    });

    it("D3018: a run during which a path inside its inputs changed, whose fingerprint could not be taken at its end, reads invalidated in the summary with the verdict's reason", async () => {
      const phase = { ended: false };
      const { lifecycle } = await begun(
        scripted(
          {
            fingerprintOf: () =>
              phase.ended
                ? { ok: false, reason: UNHEALTHY }
                : { ok: true, digest: "a-digest" },
          },
          (inputs) => {
            inputs.recordPath(INSIDE);
            phase.ended = true;
          },
          discoveredWithTest,
        ),
      );
      const answer = lifecycle.summary();
      expect(
        "workspaces" in answer
          ? answer.workspaces[0]?.latestRun?.invalidated
          : answer,
      ).toStrictEqual({
        reason: `its inputs changed while it ran: ${INSIDE}`,
        omittedCharacters: 0,
      });
    });

    it("D3019: a workspace whose run a change interrupted reads interrupted in an answer, naming the path, until the next round decides it", async () => {
      const executions = await inTempDir(async (root) => {
        const held: { daemon?: Daemon } = {};
        const inputs: StandInInputs = new StandInInputs({
          heldSettleIf: () =>
            held.daemon !== undefined &&
            held.daemon.executor.runs.length === 1 &&
            inputs.revision === 2 &&
            held.daemon.lifecycle.status().activity.state === "idle",
        });
        const executor = new HoldingExecutor(
          INTERRUPTED_RUN,
          (run) => {
            if (run !== 1) return;
            inputs.recordPath(INSIDE);
            inputs.moveRevision();
          },
          discovery(discoveredWithTest("a")),
        );
        held.daemon = narrowedDaemon(root, inputs, executor);
        const started = await begun(held.daemon);
        await flush();
        return thenStopped(started, async ({ lifecycle }) => {
          const answer = lifecycle.summary();
          return "schedule" in answer ? answer.schedule.workspaces : answer;
        });
      });
      expect(executions).toStrictEqual([
        {
          workspacePath: "a",
          state: "interrupted",
          interruptedBy: { named: [INSIDE], more: 0 },
        },
      ]);
    });

    it("D2870: a run a change inside its workspace's inputs made worthless is interrupted once the newer build has ended, stores nothing, is listed with the reason naming the path, and runs again", async () => {
      const outcome = await withInterruptedRun(
        INTERRUPTED_RUN,
        async ({ lifecycle, store, executor }) => ({
          runs: [...executor.runs],
          stored: store.runs.length,
          unstored: lifecycle.status().unstoredJobs,
        }),
      );
      expect(outcome).toStrictEqual({
        runs: ["a", "a"],
        stored: 0,
        unstored: [
          { workspacePath: "a", reason: `${INTERRUPTED_REASON}: ${INSIDE}` },
        ],
      });
    });

    it("D2888: a run's interruption is asked of the executor as an interruption, never as a stop", async () => {
      const purposes = await withInterruptedRun(
        INTERRUPTED_RUN,
        async ({ executor }) => [...executor.purposes],
      );
      expect(purposes).toStrictEqual([ABORT_PURPOSE.interruption]);
    });

    it("D2912: a run nothing changed during logs no line saying paths outside its inputs changed", async () => {
      const logged = await narrowedRun(
        () => undefined,
        async ({ log }) =>
          log.entries.filter((entry) => entry.startsWith(KEPT_LINE)),
      );
      expect(logged).toStrictEqual([]);
    });

    it("D2904: a run whose inputs moved while it ran only by a change outside its workspace's inputs is stored under the fingerprint it started from", async () => {
      const fingerprints = await narrowedRun(
        async (inputs, run) => {
          if (run !== 1) return;
          inputs.recordPath(OUTSIDE);
          inputs.moveRevision();
          await flush();
        },
        async ({ store }) => {
          // The run spent a flush waiting for the newer build, so it settles one flush later than a plain run.
          await flush();
          return [...store.runFingerprints];
        },
      );
      expect(fingerprints).toStrictEqual([
        { kind: "digest", digest: "a-digest" },
      ]);
    });

    it("D2905: a run whose inputs moved just before it returned is judged once its end revision's build has ended, so a change outside its inputs leaves it stored under its fingerprint", async () => {
      const inputs: StandInInputs = new StandInInputs({
        fingerprintOf: (path, narrowing) =>
          narrowing !== undefined &&
          narrowingAt(narrowing, inputs.revision).kind === NARROWING.building
            ? { ok: false, reason: "the dependency build has not ended" }
            : { ok: true, digest: `${path}-digest` },
      });
      const fingerprints = await narrowedRun(
        (running, run) => {
          if (run !== 1) return;
          running.recordPath(OUTSIDE);
          running.moveRevision();
        },
        async ({ store }) => [...store.runFingerprints],
        inputs,
      );
      expect(fingerprints).toStrictEqual([
        { kind: "digest", digest: "a-digest" },
      ]);
    });

    it("D2906: a run its interruption ended before its tests loaded stores nothing and is listed with the interruption's reason", async () => {
      const outcome = await withInterruptedRun(
        { ended: true, value: interrupted("a") },
        async ({ lifecycle, store }) => ({
          stored: store.runs.length,
          unstored: lifecycle.status().unstoredJobs,
        }),
      );
      expect(outcome).toStrictEqual({
        stored: 0,
        unstored: [
          { workspacePath: "a", reason: `${INTERRUPTED_REASON}: ${INSIDE}` },
        ],
      });
    });

    it("D2914: a run whose build fails to place its changed paths at the end verdict is stored not fingerprinted, the log naming the failed placement", async () => {
      const failing = { on: false };
      const outcome = await inTempDir(async (root) => {
        const inputs = new StandInInputs();
        const executor: ScriptedExecutor = new ScriptedExecutor(
          { ended: true, value: discovery(discovered("a")) },
          (path) => {
            if (executor.runs.length === 1) {
              inputs.recordPath(OUTSIDE);
              failing.on = true;
            }
            return { ended: true, value: interrupted(path) };
          },
        );
        return thenStopped(
          await begun(
            narrowedDaemon(root, inputs, executor, failingOnceOn(failing)),
          ),
          async ({ store, log }) => ({
            stored: store.runFingerprints[0],
            logged: log.entries.filter((entry) =>
              entry.startsWith(PLACEMENT_FAILED),
            ).length,
          }),
        );
      });
      expect(outcome).toStrictEqual({ stored: NOT_FINGERPRINTED, logged: 1 });
    });

    it("D2885: a run its executor returns finished although its interruption was asked is stored, judged by the change inside its inputs", async () => {
      const stored = await withInterruptedRun(
        { ended: true, value: ranWorkspace("a") },
        async ({ store }) => ({
          status: store.runs[0]?.status,
          fingerprint: store.runFingerprints[0],
        }),
      );
      expect(stored).toStrictEqual({
        status: "ran",
        fingerprint: NOT_FINGERPRINTED,
      });
    });
  },
);

const A_DIGEST: FingerprintResult = { ok: true, digest: "a-digest" };
const TRACKER_STOPPED = "the input tracker has stopped";
/** As many paths as a reason names before it counts the rest. */
const NAMED_PATHS = 20;

/** Why a view's inputs are not narrowed when selection refused one of their paths. */
const REFUSED_INPUTS: InputsNotNarrowed = {
  kind: SELECTION_REFUSED,
  reason: `selection refused the path ${REFUSED_PATH}`,
};

/**
 * The inputs at `revision` as a run's watch reads them, each workspace's fingerprint `fingerprint`, and not narrowed
 * for `notNarrowed` when it is given.
 */
function viewAt(
  revision: number,
  fingerprint: FingerprintResult = A_DIGEST,
  unavailable?: string,
  notNarrowed?: InputsNotNarrowed,
): CurrentInputs {
  return {
    facts: { ...SETTLED_INPUTS, revision },
    ...(unavailable === undefined ? {} : { unavailable }),
    ...(notNarrowed === undefined ? {} : { inputsNotNarrowed: notNarrowed }),
    snapshot: undefined,
    workspaceFingerprint: () => fingerprint,
    discoveryFingerprint: () => fingerprint,
    protectedFileChangedSince: () => undefined,
  };
}

/** The builds' state once a build over the discovery of workspace `a` ended at `revision`, placing paths over `dependencies`. */
function narrowedAt(
  revision: number,
  dependencies: DependencyInformation = A_AND_B,
): QueryNarrowing {
  const built = buildSelectionInput(
    discovery(discovered("a")),
    ABSENT_ROOT,
    NO_DECLARATION,
  );
  if (!built.built) throw new Error(built.reason);
  return builtAt(
    revision,
    new Narrowing(built.input, dependencies, () => undefined),
  );
}

/** The builds' state once the build at `revision` failed, so every path lies in every workspace's inputs. */
function failedBuildAt(revision: number): QueryNarrowing {
  return failedAt(revision, DEPENDENCY_BUILD_FAILED, BUILD_FAILED_REASON);
}

interface WatchCase {
  readonly entry?: WorkspaceDiscovery;
  /** The run's workspace fingerprint at its start. */
  readonly start?: FingerprintResult;
  /** The builds' state as the run starts, at revision 1. */
  readonly builds: QueryNarrowing;
  /** Whether each abort reaches the run's job; it does unless this says not. */
  readonly reaches?: boolean;
  /** Why every view's inputs are not narrowed, as a view says when selection refused its inputs. */
  readonly notNarrowed?: InputsNotNarrowed;
}

/**
 * A run's watch over stand-in parts, whose inputs and builds the test moves. No build is ever pending, so the watch
 * wakes at each change of the inputs.
 */
class WatchedRun {
  readonly windows = new JobWindows();
  readonly log = memoryLog();
  readonly watch: RunWatch;
  interrupts = 0;
  stopping = false;
  /** Makes the builds' next read throw, as a failure inside the watch would. */
  throwsOnce = false;
  #revision = 1;
  #builds: QueryNarrowing;
  #changes: (() => void)[] = [];
  readonly #notNarrowed: InputsNotNarrowed | undefined;

  constructor(watchCase: WatchCase) {
    this.#builds = watchCase.builds;
    this.#notNarrowed = watchCase.notNarrowed;
    const { window } = this.windows.open(undefined);
    this.watch = new RunWatch({
      entry: watchCase.entry ?? discovered("a"),
      window,
      startView: viewAt(1, watchCase.start, undefined, this.#notNarrowed),
      builds: {
        narrowing: () => this.#narrowing(),
        pending: () => false,
        ended: () => Promise.resolve(),
      },
      view: () => this.#view(this.#revision),
      inputsChanged: () =>
        new Promise((resolve) => this.#changes.push(resolve)),
      isStopping: () => this.stopping,
      interrupt: () => {
        this.interrupts += 1;
        return watchCase.reaches ?? true;
      },
      log: this.log,
    });
  }

  /** Moves the inputs to `revision`, where the builds' state is `builds`, and lets the watch wake to it. */
  async moveTo(
    revision: number,
    builds: QueryNarrowing = this.#builds,
  ): Promise<void> {
    this.#revision = revision;
    this.#builds = builds;
    const waiting = this.#changes;
    this.#changes = [];
    for (const resolve of waiting) resolve();
    await flush();
  }

  /** Judges the run at its end, at `revision` where the builds' state is `builds`, without waking the watch. */
  judgeAt(
    revision: number,
    builds: QueryNarrowing,
    view: CurrentInputs = this.#view(revision),
  ): RunJudgment {
    this.#revision = revision;
    this.#builds = builds;
    return this.watch.judge(view);
  }

  #view(revision: number): CurrentInputs {
    return viewAt(revision, A_DIGEST, undefined, this.#notNarrowed);
  }

  #narrowing(): QueryNarrowing {
    if (this.throwsOnce) {
      this.throwsOnce = false;
      throw new Error("EIO: the builds' state could not be read");
    }
    return this.#builds;
  }
}

/** Runs `body` over a watched run, then closes its watch. */
async function watched<T>(
  watchCase: WatchCase,
  body: (run: WatchedRun) => Promise<T> | T,
): Promise<T> {
  const run = new WatchedRun(watchCase);
  try {
    return await body(run);
  } finally {
    await run.watch.close();
  }
}

/** A judgment's kind, with the changed paths inside when it names them. */
function judged(judgment: RunJudgment): unknown {
  return judgment.kind === "changed-inside"
    ? { kind: judgment.kind, paths: judgment.paths }
    : { kind: judgment.kind };
}

describe("placing a run's changed paths by each build it saw", () => {
  it("D2865: a path only a build that ended while the run ran places inside its workspace's inputs leaves the run not fingerprinted", async () => {
    const judgment = await watched(
      { builds: narrowedAt(1, NO_DEPENDENCIES), reaches: false },
      async (run) => {
        run.windows.recordPath(INSIDE);
        await run.moveTo(2, narrowedAt(2));
        return judged(run.judgeAt(3, narrowedAt(3, NO_DEPENDENCIES)));
      },
    );
    expect(judgment).toStrictEqual({ kind: "changed-inside", paths: [INSIDE] });
  });

  it("D2866: a path only the build at the run's end revision places inside its workspace's inputs leaves the run not fingerprinted", async () => {
    const judgment = await watched(
      { builds: narrowedAt(1, NO_DEPENDENCIES) },
      (run) => {
        run.windows.recordPath(INSIDE);
        return judged(run.judgeAt(2, narrowedAt(2)));
      },
    );
    expect(judgment).toStrictEqual({ kind: "changed-inside", paths: [INSIDE] });
  });

  it("D2867: a test module the discovery lists for the workspace lies inside its inputs though no build's selection includes it", async () => {
    const module = "a/a.test.ts";
    const judgment = await watched(
      {
        entry: discoveredIn("a", ["a.test.ts"]),
        builds: narrowedAt(1, NO_DEPENDENCIES),
      },
      (run) => {
        run.windows.recordPath(module);
        return judged(run.judgeAt(1, narrowedAt(1, NO_DEPENDENCIES)));
      },
    );
    expect(judgment).toStrictEqual({ kind: "changed-inside", paths: [module] });
  });

  it("D3245: a setup file the discovery lists for the workspace lies inside its inputs, though the build places it in another package", async () => {
    const judgment = await watched(
      { entry: listingSetupOf("a", [SETUP_ELSEWHERE]), builds: narrowedAt(1) },
      (run) => {
        run.windows.recordPath(SETUP_ELSEWHERE);
        return judged(run.judgeAt(1, narrowedAt(1)));
      },
    );
    expect(judgment).toStrictEqual({
      kind: "changed-inside",
      paths: [SETUP_ELSEWHERE],
    });
  });

  it("D3246: an env file the discovery lists for the workspace lies inside its inputs, though the build places it in another package", async () => {
    const judgment = await watched(
      { entry: listingEnvOf("a", "b"), builds: narrowedAt(1) },
      (run) => {
        run.windows.recordPath(ENV_ELSEWHERE);
        return judged(run.judgeAt(1, narrowedAt(1)));
      },
    );
    expect(judgment).toStrictEqual({
      kind: "changed-inside",
      paths: [ENV_ELSEWHERE],
    });
  });

  it("D2868: a path inside the workspace's inputs that changed after the reason's naming cap still leaves the run not fingerprinted", async () => {
    const judgment = await watched({ builds: narrowedAt(1) }, (run) => {
      for (let index = 0; index < NAMED_PATHS; index += 1) {
        run.windows.recordPath(`b/src/b${index}.ts`);
      }
      run.windows.recordPath(INSIDE);
      return judged(run.judgeAt(1, narrowedAt(1)));
    });
    expect(judgment).toStrictEqual({ kind: "changed-inside", paths: [INSIDE] });
  });

  it("D2869: a watch that fails while the run runs counts every path the run saw change inside its workspace's inputs", async () => {
    const judgment = await watched({ builds: narrowedAt(1) }, async (run) => {
      run.windows.recordPath(OUTSIDE);
      run.throwsOnce = true;
      await run.moveTo(2);
      return judged(run.judgeAt(2, narrowedAt(2)));
    });
    expect(judgment).toStrictEqual({
      kind: "changed-inside",
      paths: [OUTSIDE],
    });
  });

  it("D2903: at revisions whose selection refused their inputs, a path the build places outside the workspace's inputs counts inside, and never interrupts the run", async () => {
    const outcome = await watched(
      { builds: narrowedAt(1), notNarrowed: REFUSED_INPUTS },
      async (run) => {
        run.windows.recordPath(OUTSIDE);
        await run.moveTo(2, narrowedAt(2));
        return {
          judgment: judged(run.judgeAt(2, narrowedAt(2))),
          interrupts: run.interrupts,
        };
      },
    );
    expect(outcome).toStrictEqual({
      judgment: { kind: "changed-inside", paths: [OUTSIDE] },
      interrupts: 0,
    });
  });

  it("D2887: a run whose end view can vouch for no inputs is judged by its unavailable end fingerprint, never by a build that view cannot place for", async () => {
    const judgment = await watched({ builds: narrowedAt(1) }, (run) => {
      run.windows.recordPath(OUTSIDE);
      return judged(
        run.judgeAt(
          2,
          failedBuildAt(2),
          viewAt(2, { ok: false, reason: TRACKER_STOPPED }, TRACKER_STOPPED),
        ),
      );
    });
    expect(judgment).toStrictEqual({ kind: "end-unavailable" });
  });
});

describe("interrupting a run in progress", () => {
  it("D2871: a change only a failed build places inside the workspace's inputs never interrupts the run", async () => {
    const interrupts = await watched({ builds: narrowedAt(1) }, async (run) => {
      run.windows.recordPath(OUTSIDE);
      await run.moveTo(2, failedBuildAt(2));
      return run.interrupts;
    });
    expect(interrupts).toBe(0);
  });

  it("D2872: a changed path selection refuses never interrupts the run", async () => {
    const interrupts = await watched({ builds: narrowedAt(1) }, async (run) => {
      run.windows.recordPath(REFUSED_PATH);
      await run.moveTo(2, narrowedAt(2));
      return run.interrupts;
    });
    expect(interrupts).toBe(0);
  });

  it("D2876: a change inside the workspace's inputs interrupts nothing until a newer revision's build has ended", async () => {
    const interrupts = await watched({ builds: narrowedAt(1) }, async (run) => {
      run.windows.recordPath(INSIDE);
      await run.moveTo(2);
      return run.interrupts;
    });
    expect(interrupts).toBe(0);
  });

  it("D2873: a run that started with no input fingerprint is never interrupted, whatever changed inside its workspace's inputs", async () => {
    const interrupts = await watched(
      { builds: narrowedAt(1), start: { ok: false, reason: RECONCILING } },
      async (run) => {
        run.windows.recordPath(INSIDE);
        await run.moveTo(2, narrowedAt(2));
        return run.interrupts;
      },
    );
    expect(interrupts).toBe(0);
  });

  it("D2874: once a stop is asked, a change inside the workspace's inputs never interrupts the run", async () => {
    const interrupts = await watched({ builds: narrowedAt(1) }, async (run) => {
      run.windows.recordPath(INSIDE);
      run.stopping = true;
      await run.moveTo(2, narrowedAt(2));
      return run.interrupts;
    });
    expect(interrupts).toBe(0);
  });

  it("D2911: a path inside the workspace's inputs recorded after a newer build has ended interrupts the run, though the revision did not move", async () => {
    const interrupts = await watched({ builds: narrowedAt(1) }, async (run) => {
      run.windows.recordPath(OUTSIDE);
      await run.moveTo(2, narrowedAt(2));
      run.windows.recordPath(INSIDE);
      await run.moveTo(2);
      return run.interrupts;
    });
    expect(interrupts).toBe(1);
  });

  it("D3250: a setup file the discovery lists for the workspace, changed while the run runs, interrupts it once a newer revision's build has ended, though that build places it in another package", async () => {
    const interrupts = await watched(
      { entry: listingSetupOf("a", [SETUP_ELSEWHERE]), builds: narrowedAt(1) },
      async (run) => {
        run.windows.recordPath(SETUP_ELSEWHERE);
        await run.moveTo(2, narrowedAt(2));
        return run.interrupts;
      },
    );
    expect(interrupts).toBe(1);
  });

  it("D2875: an interruption whose abort reached no job records no interruption", async () => {
    const outcome = await watched(
      { builds: narrowedAt(1), reaches: false },
      async (run) => {
        run.windows.recordPath(INSIDE);
        await run.moveTo(2, narrowedAt(2));
        return { asked: run.interrupts, interruption: run.watch.interruption };
      },
    );
    expect(outcome).toStrictEqual({ asked: 1, interruption: undefined });
  });
});

/** How many runs of `a` change an input before its runs change nothing, so a loop never held still ends. */
const REWRITING_RUNS = 4;
/** A test module of workspace `a` that lies in package `b`, so the narrowed build places it in `b` alone. */
const LISTED_ELSEWHERE = "b/src/b.test.ts";
/** A setup file of workspace `a`'s project that lies in package `b`, so the narrowed build places it in `b` alone. */
const SETUP_ELSEWHERE = "b/src/setup.ts";
/** An env file `a`'s project loads from package `b`, which selection places in `b` alone, since no import names it. */
const ENV_ELSEWHERE = "b/.env.local";
/** Flushes in which the daemon logs, builds and begins nothing, after which nothing more is coming until a job ends. */
const QUIET_FLUSHES = 2;
/** Flushes a daemon's runs may take before the test fails as never settling. */
const RUNS_END_FLUSHES = 200;

/**
 * An executor whose every run calls `during` with the run's count from 1, then holds until an interruption ends it,
 * interrupted after its tests loaded, or the test finishes it. Each discovery calls `discovering` first.
 */
class RewritingExecutor extends ScriptedExecutor {
  readonly #during: (run: number) => void;
  readonly #discovering: () => void;
  #held: Deferred<RunOutcome> | undefined;

  constructor(
    during: (run: number) => void,
    found: TestDiscovery,
    discovering: () => void,
  ) {
    super({ ended: true, value: found });
    this.#during = during;
    this.#discovering = discovering;
  }

  /** Whether a run has begun and not ended. */
  get holding(): boolean {
    return this.#held !== undefined;
  }

  override discover(): Promise<JobOutcome<TestDiscovery>> {
    this.#discovering();
    return super.discover();
  }

  override run(workspace: VitestWorkspace): Promise<RunOutcome> {
    this.runs.push(workspace.path);
    const held = new Deferred<RunOutcome>();
    this.#held = held;
    this.#during(this.runs.length);
    return held.promise;
  }

  override abort(purpose?: AbortPurpose): boolean {
    const reached = super.abort(purpose);
    this.#end(INTERRUPTED_RUN);
    return reached;
  }

  /** Ends the run holding as finished, as a run no change interrupted ends. */
  finish(): void {
    this.#end({ ended: true, value: ranWorkspace("a") });
  }

  #end(outcome: RunOutcome): void {
    this.#held?.resolve(outcome);
    this.#held = undefined;
  }
}

/**
 * Flushes until the daemon has gone quiet with no run holding. A run still holding once the daemon has gone quiet has
 * no interruption coming, so the test finishes it. Throws when the daemon never settles.
 */
async function untilRunsEnd(
  started: Daemon,
  executor: RewritingExecutor,
): Promise<void> {
  let quiet = 0;
  let seen = "";
  for (let flushes = 0; flushes < RUNS_END_FLUSHES; flushes += 1) {
    await flush();
    const now = `${started.log.entries.length}:${started.builds.builds.length}:${executor.runs.length}`;
    quiet = now === seen ? quiet + 1 : 0;
    seen = now;
    if (quiet < QUIET_FLUSHES) continue;
    if (!executor.holding) return;
    executor.finish();
    quiet = 0;
  }
  throw new Error(
    `the daemon's runs did not settle within ${RUNS_END_FLUSHES} flushes`,
  );
}

interface Rewrites {
  /**
   * The paths each run of `a` changes, given the run's count from 1, moving the input revision, or undefined when it
   * changes nothing; `INSIDE` for the first `REWRITING_RUNS` when absent.
   */
  readonly paths?: (run: number) => readonly string[] | undefined;
  /** Whether `a`'s fingerprint moves with the input revision, as it does when its own inputs change. */
  readonly fingerprintMoves?: boolean;
  /** The test modules of `a` the discovery lists, relative to `a`; none when absent. */
  readonly modules?: readonly string[];
  /** The env directory of `a`'s one project, root-relative; no project is reported when absent. */
  readonly envDirectory?: string;
  /** A path each discovery changes while it runs; each input revision is then rediscovered. */
  readonly discoveryChanges?: string;
  /** Runs once the runs have ended, with the committed digests by path, which the test may edit. */
  readonly afterRuns?: (
    started: Daemon,
    digests: Record<string, string>,
  ) => void;
}

/**
 * A daemon over narrowed builds each of whose runs of `a` changes a path as it runs, moving the input revision. The
 * committed digests change with each such path, so each round's selection sees what the last run changed.
 */
function rewritingDaemon<T>(
  rewrites: Rewrites,
  body: (started: Daemon) => Promise<T>,
): Promise<T> {
  return inTempDir(async (root) => {
    const digests: Record<string, string> = { [INSIDE]: "0", [OUTSIDE]: "0" };
    const { discoveryChanges } = rewrites;
    const inputs: StandInInputs = new StandInInputs({
      snapshot: () => inputsOf(digests),
      ...(rewrites.fingerprintMoves === true
        ? {
            fingerprintOf: (path: string): FingerprintResult => ({
              ok: true,
              digest: `${path}-digest-${inputs.revision}`,
            }),
          }
        : {}),
      ...(discoveryChanges === undefined
        ? {}
        : {
            discoveryFingerprintOf: (): FingerprintResult => ({
              ok: true,
              digest: `discovery-digest-${inputs.revision}`,
            }),
          }),
    });
    const pathsOf =
      rewrites.paths ??
      ((run: number) => (run <= REWRITING_RUNS ? [INSIDE] : undefined));
    const executor = new RewritingExecutor(
      (run) => {
        const paths = pathsOf(run);
        if (paths === undefined) return;
        for (const path of paths) {
          inputs.recordPath(path);
          digests[path] = `run-${run}`;
        }
        inputs.moveRevision();
      },
      discovery(
        rewrites.envDirectory === undefined
          ? discoveredIn("a", rewrites.modules ?? [])
          : listingEnvOf("a", rewrites.envDirectory),
      ),
      () => {
        if (discoveryChanges !== undefined) inputs.recordPath(discoveryChanges);
      },
    );
    const started = await begun(narrowedDaemon(root, inputs, executor));
    await untilRunsEnd(started, executor);
    if (rewrites.afterRuns !== undefined) {
      rewrites.afterRuns(started, digests);
      await untilRunsEnd(started, executor);
    }
    return thenStopped(started, body);
  });
}

describe(
  "holding a workspace whose runs keep changing its inputs",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3166: a workspace each of whose runs changes a path inside its inputs runs three times and no more", async () => {
      const runs = await rewritingDaemon({}, async ({ executor }) => [
        ...executor.runs,
      ]);
      expect(runs).toStrictEqual(["a", "a", "a"]);
    });

    it("D3167: the third run of a workspace whose runs change its inputs is not interrupted, though the first two are", async () => {
      const purposes = await rewritingDaemon({}, async ({ executor }) => [
        ...executor.purposes,
      ]);
      expect(purposes).toStrictEqual([
        ABORT_PURPOSE.interruption,
        ABORT_PURPOSE.interruption,
      ]);
    });

    it("D3168: the log says, as the third run begins, that no change will interrupt it, naming the path that changed each time", async () => {
      const logged = await rewritingDaemon({}, async ({ log }) =>
        log.entries.flatMap((entry) => {
          if (entry.startsWith("run started: a")) return ["run started"];
          if (!entry.startsWith("the run of a will not be interrupted")) {
            return [];
          }
          return [
            entry.includes(INSIDE) ? "not interrupted, naming it" : entry,
          ];
        }),
      );
      expect(logged).toStrictEqual([
        "run started",
        "run started",
        "run started",
        "not interrupted, naming it",
      ]);
    });

    it("D3169: a workspace whose runs change only a path outside its inputs is never held", async () => {
      const runs = await rewritingDaemon(
        {
          paths: (run) => (run <= REWRITING_RUNS ? [OUTSIDE] : undefined),
          fingerprintMoves: true,
        },
        async ({ executor }) => executor.runs.length,
      );
      expect(runs).toBe(REWRITING_RUNS + 1);
    });

    it("D3170: an edit outside a held workspace's inputs does not release it", async () => {
      const runs = await rewritingDaemon(
        {
          afterRuns: ({ inputs }, digests) => {
            digests[OUTSIDE] = "edited";
            inputs.moveRevision();
          },
        },
        async ({ executor }) => executor.runs.length,
      );
      expect(runs).toBe(3);
    });

    it("D3171: the round a hold begins in never logs the held workspace as holding current results, though selection chose it", async () => {
      const logged = await rewritingDaemon({}, async ({ log }) =>
        log.entries.filter((entry) => entry.startsWith("not run: a")),
      );
      expect(logged).toStrictEqual([]);
    });

    it("D3181: a workspace whose runs rewrite one of its listed test modules is held, though the build places that module in another package", async () => {
      const runs = await rewritingDaemon(
        {
          modules: [`../${LISTED_ELSEWHERE}`],
          paths: (run) =>
            run <= REWRITING_RUNS ? [LISTED_ELSEWHERE] : undefined,
        },
        async ({ executor }) => executor.runs.length,
      );
      expect(runs).toBe(3);
    });

    it("D3251: a workspace whose runs rewrite its listed env file is held, though the build places that file in another package", async () => {
      const runs = await rewritingDaemon(
        {
          envDirectory: "b",
          paths: (run) => (run <= REWRITING_RUNS ? [ENV_ELSEWHERE] : undefined),
        },
        async ({ executor }) => executor.runs.length,
      );
      expect(runs).toBe(3);
    });

    it("D3182: a workspace whose inputs each discovery changes is held through the discoveries' own reports", async () => {
      const runs = await rewritingDaemon(
        {
          discoveryChanges: INSIDE,
          fingerprintMoves: true,
          paths: (run) => (run <= REWRITING_RUNS ? [] : undefined),
        },
        async ({ executor }) => executor.runs.length,
      );
      expect(runs).toBe(3);
    });
  },
);

describe("placing a listed file by the spelling on disk", () => {
  it("D3262: with process.platform read as win32, an env file the discovery lists for the workspace, changed under another case of its name, lies inside its inputs though the build places it in another package", async () => {
    const onDisk = "b/.ENV.local";
    const judgment = await onPlatform("win32", () =>
      watched(
        { entry: listingEnvOf("a", "b"), builds: narrowedAt(1) },
        (run) => {
          run.windows.recordPath(onDisk);
          return judged(run.judgeAt(1, narrowedAt(1)));
        },
      ),
    );
    expect(judgment).toStrictEqual({
      kind: "changed-inside",
      paths: [onDisk],
    });
  });
});
