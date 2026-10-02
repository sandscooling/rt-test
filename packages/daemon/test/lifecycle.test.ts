import {
  mkdirSync,
  readFileSync,
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
import { readingWait, STANDING } from "../src/daemon/canary-gate.js";
import { DependencyBuilds } from "../src/daemon/dependency-builds.js";
import {
  ABORT_PURPOSE,
  type DiscoverOutcome,
  type Executor,
  type JobOutcome,
  type RunOutcome as ListedRunOutcome,
} from "../src/daemon/executor.js";
import { JOB_TIME_BOUND_MS } from "../src/daemon/falsification.js";
import { MAX_JOB_DEFINITIONS } from "../src/daemon/falsification-plan.js";
import {
  DaemonLifecycle,
  type LifecycleParts,
} from "../src/daemon/lifecycle.js";
import {
  PROTOCOL_VERSION,
  type DaemonActivity,
  type DaemonIdentity,
  type UnstoredJob,
} from "../src/daemon/protocol.js";
import {
  CANARY_READING,
  NO_READING_KIND,
  type CanaryReading,
} from "../src/falsify/canary-set.js";
import {
  FALSIFIER_VERSION,
  type DefectExperiment,
  type ExperimentRecord,
  type FalsificationJob,
} from "../src/falsify/experiment-record.js";
import type { ExperimentFacts } from "../src/falsify/fact-types.js";
import { wholeDigest } from "../src/inputs/input-inventory.js";
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
  WorkspaceCollection,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { VitestWorkspace } from "../src/vitest/find-workspaces.js";
import type {
  NotConfirmedRun,
  WorkspaceRun,
} from "../src/vitest/run-workspace.js";
import {
  listedModules,
  type ModuleTests,
  type WorkspaceLists,
} from "../src/vitest/test-lists.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  IDLE_ENTRY,
  eventually,
  memoryLog,
  type MemoryLog,
} from "./daemon-harness.js";
import {
  APPLIED,
  baseline,
  CLEAN_JOB,
  detection,
  EMPTY_RUN,
  mutatedRun,
  ranOnce,
  ranReply,
  SURVIVING_TEST,
} from "./experiment-facts.js";
import { inTempDir, projectFacts, settle, WAITING } from "./harness.js";
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
  DISCOVERED_VITEST_VERSION,
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
  digestOf,
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
/** Where each start here has a build create its parse record: a directory apart from the identity's state directory. */
const PARSE_RECORD_DIRECTORY = "/user/rt-test";
/** The signal of a request whose client still waits for its answer. */
function stillWaited(): AbortSignal {
  return new AbortController().signal;
}

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
 * and the parse record directory each was given. Each answer waits for the next event-loop turn, as a child process's
 * reply does, so builds that repeat without end still let `flush` return. An abort ends every held build, as the real
 * executor ends its job.
 */
class ScriptedBuilds implements Pick<
  Executor,
  "buildDependencies" | "abort" | "close"
> {
  readonly builds: (readonly string[])[] = [];
  readonly directories: string[] = [];
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
    parseRecordDirectory: string,
  ): Promise<BuildOutcome> {
    const index = this.builds.length;
    this.builds.push(workspaces.map(({ workspace }) => workspace.path));
    this.directories.push(parseRecordDirectory);
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

type CanaryGateStandIn = LifecycleParts["canaryGate"];

/** A gate that holds a confirmed reading of every install, so each workspace's falsification job is sent. */
const CONFIRMING_GATE: CanaryGateStandIn = {
  standing: () => ({ state: STANDING.confirmed }),
  take: () =>
    Promise.reject(new Error("a gate that confirms every install takes none")),
};

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
  canaryGate: CanaryGateStandIn = CONFIRMING_GATE,
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
    canaryGate,
    buildExecutor: builds as unknown as Executor,
    parseRecordDirectory: PARSE_RECORD_DIRECTORY,
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

/** A run of the workspace that ran each module `entry` lists, every listed test passed, so it vouches for those lists. */
function ranAsListed(entry: WorkspaceDiscovery): WorkspaceRun {
  if (entry.status !== "discovered") {
    throw new Error(`${entry.workspace.path} is not discovered`);
  }
  return {
    status: "ran",
    workspace: entry.workspace,
    vitestVersion: entry.vitestVersion,
    execution: "completed",
    modules: listedModules(entry).map(({ projectName, modulePath, tests }) => ({
      projectName,
      modulePath,
      state: "ran",
      tests: tests.map(({ identity, isDuplicate }) => ({
        identity,
        isDuplicate,
        execution: "finished",
        outcome: "passed",
        errors: [],
      })),
      errors: [],
    })),
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
    forceStopped: false,
  };
}

/**
 * Runs `during` inside the discovery's job, as an edit while Vitest collects would, and ends the job once it settles.
 * Each run ends as `runs` gives it, interrupted before its load when absent.
 */
class EditingExecutor extends ScriptedExecutor {
  readonly #during: () => Promise<unknown>;

  constructor(
    found: TestDiscovery,
    during: () => Promise<unknown>,
    runs?: (path: string) => RunOutcome,
  ) {
    super({ ended: true, value: found }, runs);
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
 * Each run of the workspace ran the listed test, so a run vouches for the discovery's list of the module.
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
  const listing: WorkspaceDiscovery = {
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
  };
  const found = discovery(listing);
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
    executor: new EditingExecutor(
      found,
      async () => {
        held = await during(module, handled);
      },
      () => ({ ended: true, value: ranAsListed(listing) }),
    ) as unknown as Executor,
    canaryGate: CONFIRMING_GATE,
    buildExecutor: failingBuilds(),
    parseRecordDirectory: PARSE_RECORD_DIRECTORY,
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
    canaryGate: CONFIRMING_GATE,
    buildExecutor: failingBuilds(),
    parseRecordDirectory: PARSE_RECORD_DIRECTORY,
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

/** Stops the daemon, then gives each log entry saying a discovery is owed a discovery once more at its revision. */
async function onceMoreEntries(started: Daemon): Promise<string[]> {
  started.lifecycle.stop();
  await started.lifecycle.stopped();
  return started.log.entries.filter((entry) =>
    entry.includes("so it is discovered once more at that revision"),
  );
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
        entry.startsWith("the discovery is stored not fingerprinted"),
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
        entry.startsWith("the discovery is stored not fingerprinted"),
      ),
    }).toStrictEqual({
      discovery: [{ kind: "not-fingerprinted" }],
      logged: [`the discovery is stored not fingerprinted: ${walkChanged}`],
    });
  });

  it("D3327: a discovery whose job window named an input changing while it ran, at a revision the change did not move, is owed a discovery once more", async () => {
    const started = await begun(
      scripted({
        verdicts: [
          {
            fingerprinted: false,
            reason: "its inputs changed while it ran: packages/a/gen/a.ts",
            changedWhileRunning: true,
          },
        ],
      }),
    );
    expect(await onceMoreEntries(started)).toHaveLength(1);
  });

  it("D3328: a discovery during which a file only protection's walk found may have changed is owed a discovery once more", async () => {
    const started = await begun(
      scripted({
        walkChanged:
          "docs/new.test.ts, an input the tracker had not read before protection changed, may have changed while the job ran",
      }),
    );
    expect(await onceMoreEntries(started)).toHaveLength(1);
  });

  it("D3329: a discovery during which a listed module the inputs leave out changed after protection's check, before the fingerprint, is owed a discovery once more", async () => {
    const held: { daemon?: Daemon } = {};
    held.daemon = scripted({
      // The edit lands once the discovery's protection has begun, after its own check of the module and before the fingerprint.
      get moduleChanged() {
        return held.daemon?.inputs.protected.some(
          (protectedDiscovery) => protectedDiscovery !== undefined,
        ) === true
          ? "packages/a/gen/a.test.ts, which the discovery protects and the inputs leave out, may have changed while the job ran"
          : undefined;
      },
    });
    const started = await begun(held.daemon);
    expect(await onceMoreEntries(started)).toHaveLength(1);
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
     * against the store's file, the daemon and its consumer root, and returns the refusals the log quotes.
     */
    function afterIdle(
      after: (
        file: string,
        lifecycle: DaemonLifecycle,
        root: string,
      ) => void | Promise<void>,
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
          { ...IDENTITY, consumerRoot: dir },
        );
        return begunThenStopped(started, async ({ lifecycle, log }) => {
          await after(store.file, lifecycle, dir);
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
      const refusals = await afterIdle(async (file, lifecycle, root) => {
        alterStore(file, MADE_UNREADABLE);
        await lifecycle.pathStatus(join(root, "a"), stillWaited());
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

    describe("stored defect evidence the store refuses as unreadable", () => {
      const EVIDENCE_REFUSED_BEFORE = "warning: the stored evidence of defect ";
      const EVIDENCE_REFUSED_AFTER =
        " was refused as unreadable, so the defect reads never verified until a new verdict replaces it: ";

      /** Gives the stored evidence of `defectId` facts no reader can rebuild, through a second connection. */
      function setEvidenceFacts(
        file: string,
        defectId: string,
        facts: string,
      ): void {
        alterStore(
          file,
          `UPDATE defect_evidence SET facts = '${facts}' WHERE defect_id = '${defectId}'`,
        );
      }

      /** The whole entry the daemon logs for `defectId`'s evidence refused for its facts `facts`. */
      function evidenceRefusalEntry(defectId: string, facts: string): string {
        return `${EVIDENCE_REFUSED_BEFORE}${defectId}${EVIDENCE_REFUSED_AFTER}The store holds an unreadable JSON field job: ${facts}`;
      }

      /**
       * Runs a daemon over a readable store to idle, stores a detection for each of `defectIds` as a job's reply
       * gives them, then runs `after` against the store's file and the daemon, and returns the log's evidence
       * refusal entries.
       */
      function afterEvidenceStored(
        defectIds: readonly string[],
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
            store.writeEvidence(
              { ...SCOPE, inputFingerprintDigest: "a-digest" },
              ranReply(
                defectIds.map((defectId) => ({
                  defectId,
                  facts: detection(),
                  mutationFileDigest: `file-digest-${defectId}`,
                })),
              ),
              new Map(
                defectIds.map((defectId) => [
                  defectId,
                  `definition-digest-${defectId}`,
                ]),
              ),
            );
            after(store.file, lifecycle);
            return log.entries.filter((entry) =>
              entry.startsWith(EVIDENCE_REFUSED_BEFORE),
            );
          });
        });
      }

      it("D3956: an evidence refusal a summary reads is logged, naming its defect, with its whole text", async () => {
        const facts = `{"job":"${"x".repeat(1500)}"}`;
        const entries = await afterEvidenceStored(
          ["D1", "D2"],
          (file, lifecycle) => {
            setEvidenceFacts(file, "D1", facts);
            lifecycle.summary();
          },
        );
        expect(entries).toStrictEqual([evidenceRefusalEntry("D1", facts)]);
      });

      it("D3957: an evidence refusal read again is logged once, and a second defect's refusal for the same reason is logged too", async () => {
        const facts = '{"job":5}';
        const entries = await afterEvidenceStored(
          ["D1", "D2"],
          (file, lifecycle) => {
            setEvidenceFacts(file, "D1", facts);
            lifecycle.summary();
            lifecycle.summary();
            setEvidenceFacts(file, "D2", facts);
            lifecycle.summary();
          },
        );
        expect(entries).toStrictEqual([
          evidenceRefusalEntry("D1", facts),
          evidenceRefusalEntry("D2", facts),
        ]);
      });

      it("D4001: a second defect's evidence refused for the reason already logged for another is logged too", async () => {
        const facts = '{"job":5}';
        const entries = await afterEvidenceStored(
          ["D1", "D2"],
          (file, lifecycle) => {
            setEvidenceFacts(file, "D1", facts);
            lifecycle.summary();
            setEvidenceFacts(file, "D2", facts);
            lifecycle.summary();
          },
        );
        expect(entries).toStrictEqual([
          evidenceRefusalEntry("D1", facts),
          evidenceRefusalEntry("D2", facts),
        ]);
      });
    });
  },
);

describe(
  "beginning each job once the inputs settle",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    /**
     * How many jobs have begun while the given wait is held, and how many once it is released: the discovery, the
     * guard around its protection, the run, and the window the falsification look opens once nothing is due.
     */
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
        released: 4,
      });
    });

    it("D2081: the guard around protecting the discovery's test modules begins only once the inputs have settled", async () => {
      expect(await jobsAroundHeldSettle(2)).toStrictEqual({
        held: 1,
        released: 4,
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
        released: 4,
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
    void lifecycle.pathStatus("/consumer/a", stillWaited());
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
    void lifecycle.pathStatus("/consumer/a", stillWaited());
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
      const answer = await lifecycle.pathStatus(join(root, "b"), stillWaited());
      return "unstoredJobs" in answer ? answer.unstoredJobs : answer;
    });
    expect(jobs).toStrictEqual([
      { workspacePath: "a", reason: "the store write failed" },
    ]);
  });

  it("D3377: a path status reads its resolved path by name first and answers only once that read ends, from the inputs as it left them", async () => {
    const outcome = await inTempDir(async (root) => {
      const inputs = new StandInInputs({ heldNamedRead: true });
      const { lifecycle } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discoveredWithTest("a")),
          }),
          new RecordingStore(),
          { ...IDENTITY, consumerRoot: root },
          inputs,
        ),
      );
      let readEnded = false;
      let answeredBeforeRead = false;
      const answer = lifecycle.pathStatus(root, stillWaited()).then((done) => {
        answeredBeforeRead = !readEnded;
        return done;
      });
      await flush();
      readEnded = true;
      const readRevision = inputs.revision + 1;
      inputs.moveRevision();
      inputs.namedReadHeld.resolve();
      const done = await answer;
      return {
        answeredBeforeRead,
        read: inputs.namedReads,
        revisionIsTheRead:
          "noAnswer" in done ? done : done.inputs.revision === readRevision,
      };
    });
    expect(outcome).toStrictEqual({
      answeredBeforeRead: false,
      read: [["."]],
      revisionIsTheRead: true,
    });
  });

  it("D3378: a path status whose request aborts while its named read runs answers that nobody waits for it", async () => {
    const answer = await inTempDir(async (root) => {
      const inputs = new StandInInputs({ heldNamedRead: true });
      const { lifecycle } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discoveredWithTest("a")),
          }),
          new RecordingStore(),
          { ...IDENTITY, consumerRoot: root },
          inputs,
        ),
      );
      const request = new AbortController();
      const answered = lifecycle.pathStatus(root, request.signal);
      await flush();
      request.abort();
      inputs.namedReadHeld.resolve();
      return answered;
    });
    expect(answer).toStrictEqual({
      noAnswer: "nobody waits for the answer any more",
    });
  });

  it("D3420: a path status whose named read found a path it could not read answers each workspace unfingerprinted, the reason naming the path", async () => {
    const unfingerprinted = await inTempDir(async (root) => {
      const inputs = new StandInInputs({
        unreadNamed: [
          { path: "a/new.ts", reason: "EBUSY: resource busy or locked" },
        ],
      });
      const { lifecycle } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor({
            ended: true,
            value: discovery(discoveredWithTest("a")),
          }),
          new RecordingStore(),
          { ...IDENTITY, consumerRoot: root },
          inputs,
        ),
      );
      const answer = await lifecycle.pathStatus(root, stillWaited());
      return "noAnswer" in answer ? answer : answer.unfingerprintedWorkspaces;
    });
    expect(unfingerprinted).toStrictEqual([
      {
        workspacePath: "a",
        reason:
          "the status could not read what it names: a/new.ts (EBUSY: resource busy or locked)",
      },
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
    parseRecordDirectory: string,
  ): Promise<BuildOutcome> {
    void super.buildDependencies(
      consumerRoot,
      workspaces,
      parseRecordDirectory,
    );
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
      parseRecordDirectory: PARSE_RECORD_DIRECTORY,
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

    it("D4261: a dependency build is told to create its parse record in the directory the lifecycle was given for it, not in the state directory", async () => {
      const directories = await inTempDir(async (root) =>
        thenStopped(
          await begun(rootedAt(root, {}, new ScriptedBuilds())),
          async ({ builds }) => [...builds.directories],
        ),
      );
      expect(directories).toStrictEqual([PARSE_RECORD_DIRECTORY]);
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
  /**
   * A path each discovery changes while it runs. The discovery's current fingerprint cannot be computed, so each input
   * revision is rediscovered and no count holds the discovery itself.
   */
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
              ok: false,
              reason: `the input set at revision ${inputs.revision} cannot be established`,
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

describe("a wait the lifecycle answers", () => {
  it("D3445: a wait on a file its running workspace covers settles once that run has ended, with no further change of the inputs", async () => {
    const outcome = await inTempDir(async (root) => {
      const held = new Deferred<RunOutcome>();
      const request = new AbortController();
      const { lifecycle } = await begun(
        daemon(
          confirmed("a"),
          new ScriptedExecutor(
            { ended: true, value: discovery(discoveredWithTest("a")) },
            () => held.promise,
          ),
          new RecordingStore(),
          { ...IDENTITY, consumerRoot: root },
          new StandInInputs({ snapshot: () => inputsOf({ "a/a.ts": "a" }) }),
        ),
      );
      try {
        let answer: unknown = WAITING;
        void lifecycle
          .wait(
            { paths: [join(root, "a", "a.ts")], limitMs: 60_000 },
            request.signal,
          )
          .then((done) => {
            answer =
              "outcome" in done
                ? { outcome: done.outcome, givenAt: done.inputs.revision }
                : done;
          });
        await flush();
        const whileRunning = answer;
        held.resolve({ ended: true, value: ranWorkspace("a") });
        await flush();
        return { whileRunning, afterRun: answer };
      } finally {
        request.abort();
        lifecycle.stop();
        await lifecycle.stopped();
      }
    });
    expect(outcome).toStrictEqual({
      whileRunning: WAITING,
      afterRun: { outcome: "settled", givenAt: 1 },
    });
  });
});

/**
 * The runs of `a` by a daemon over narrowed builds each of whose first `REWRITING_RUNS` runs changes `INSIDE` as it
 * runs, moving the input revision, while the agent, having saved that file, names it as edited in a changes request
 * the lifecycle answers during the run.
 */
function runsWhileTheAgentReports(): Promise<number> {
  return inTempDir(async (root) => {
    const file = join(root, INSIDE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    const digests: Record<string, string> = { [INSIDE]: "0", [OUTSIDE]: "0" };
    const inputs = new StandInInputs({ snapshot: () => inputsOf(digests) });
    const at: { daemon?: Daemon } = {};
    const answers: Promise<unknown>[] = [];
    const executor = new RewritingExecutor(
      (run) => {
        if (run > REWRITING_RUNS || at.daemon === undefined) return;
        answers.push(
          at.daemon.lifecycle.changes(
            { paths: [file], since: undefined, edited: [file] },
            new AbortController().signal,
          ),
        );
        inputs.recordPath(INSIDE);
        digests[INSIDE] = `run-${run}`;
        inputs.moveRevision();
      },
      discovery(discoveredIn("a", [])),
      () => undefined,
    );
    at.daemon = narrowedDaemon(root, inputs, executor);
    const started = await begun(at.daemon);
    await untilRunsEnd(started, executor);
    await Promise.all(answers);
    return thenStopped(started, async () => executor.runs.length);
  });
}

describe(
  "an agent's edits reported through the lifecycle",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3598: a workspace each of whose runs changes an input the agent names as edited in a changes request during the run is never held", async () => {
      expect(await runsWhileTheAgentReports()).toBe(REWRITING_RUNS + 1);
    });
  },
);

describe("answering a defects query", () => {
  it("D3708: a defects query naming a path answers for that path, never the whole worktree", async () => {
    const answered = await inTempDir(async (root) => {
      const executor = new ScriptedExecutor({
        ended: true,
        value: discovery(discoveredWithTest("a"), discoveredWithTest("b")),
      });
      const { lifecycle } = await begun(
        daemon(confirmed("a", "b"), executor, new RecordingStore(), {
          ...IDENTITY,
          consumerRoot: root,
        }),
      );
      const answer = await lifecycle.defects(join(root, "a"), stillWaited());
      return "noAnswer" in answer
        ? answer
        : { path: answer.path, testsInScope: answer.testsInScope };
    });
    expect(answered).toStrictEqual({ path: "a", testsInScope: 1 });
  });
});

type FalsifyOutcome = JobOutcome<FalsificationJob>;

/** One falsification job the executor was given. */
interface SentJob {
  readonly workspacePath: string;
  readonly configFile: string;
  readonly experiments: readonly DefectExperiment[];
  readonly assertionErrors: readonly string[];
}

/** A job that stays in progress until an abort or the test ends it. */
const HELD = "held";

interface JobScript {
  /** What each job replies, given the job and its index from 0; every experiment detected when absent. */
  readonly replies?: (
    job: SentJob,
    call: number,
  ) => FalsifyOutcome | typeof HELD;
  /** What an abort that finds a held job makes it reply; the job stays held when absent. */
  readonly aborted?: (job: SentJob, call: number) => FalsifyOutcome | undefined;
}

const TEST_ENDED: FalsifyOutcome = { ended: false, reason: "the test ended" };
/** The module every hand-built discovery and run of the rig holds its tests in. */
const TEST_MODULE = "a.test.ts";

/**
 * An executor that also answers each falsification job from a script, and records the jobs it was given. An abort
 * answers whether it found a job as `abortFinds` says, and ends a held job it found as the script says.
 */
class FalsifyingExecutor extends ScriptedExecutor {
  readonly jobs: SentJob[] = [];
  abortFinds = true;
  readonly #script: JobScript;
  #held: Deferred<FalsifyOutcome> | undefined;

  constructor(
    discovery: JobOutcome<TestDiscovery>,
    runs: (path: string) => RunOutcome,
    script: JobScript,
  ) {
    super(discovery, runs);
    this.#script = script;
  }

  falsify(
    entry: VitestWorkspace,
    configFile: string,
    experiments: readonly DefectExperiment[],
    assertionErrors: readonly string[],
  ): Promise<FalsifyOutcome> {
    const job = {
      workspacePath: entry.path,
      configFile,
      experiments,
      assertionErrors,
    };
    this.jobs.push(job);
    const reply =
      this.#script.replies?.(job, this.jobs.length - 1) ?? replied(job);
    if (reply !== HELD) return Promise.resolve(reply);
    this.#held = new Deferred<FalsifyOutcome>();
    return this.#held.promise;
  }

  /** Ends the held job with `outcome`, as its executor's reply does. */
  end(outcome: FalsifyOutcome): void {
    this.#held?.resolve(outcome);
    this.#held = undefined;
  }

  override abort(purpose: AbortPurpose = ABORT_PURPOSE.stop): boolean {
    super.abort(purpose);
    const job = this.jobs.at(-1);
    if (this.abortFinds && this.#held !== undefined && job !== undefined) {
      const left = this.#script.aborted?.(job, this.jobs.length - 1);
      if (left !== undefined) this.end(left);
    }
    return this.abortFinds;
  }
}

type InstallStanding = ReturnType<CanaryGateStandIn["standing"]>;
type UnreadInstall = Parameters<CanaryGateStandIn["take"]>[0];
type VitestInstall = UnreadInstall["install"];

/** The install a scripted gate says a workspace resolves unless its case says another; no test reads either directory. */
const INSTALL: VitestInstall = {
  directory: "/installs/vitest-5.0.1",
  version: "5.0.1",
};
const OTHER_INSTALL: VitestInstall = {
  directory: "/installs/vitest-4.1.11",
  version: "4.1.11",
};

interface GateScript {
  /** The install each workspace resolves, or what the gate says of one that resolves no supported Vitest; `INSTALL` when absent. */
  readonly resolves?: (workspacePath: string) => VitestInstall | string;
  /** What each canary job reads, given its index from 0, or `HELD`; confirmed when absent. */
  readonly readings?: (call: number) => CanaryReading | typeof HELD;
}

function confirmedReading(install: VitestInstall): CanaryReading {
  return { status: CANARY_READING.confirmed, vitestVersion: install.version };
}

/**
 * A stand-in for the canary gate that takes no reading: each canary job reads what the case scripts, or stays in
 * progress until the test ends it. As the gate does, it keeps a reading that is confirmed or disagreed by install and
 * nothing of a no reading, and words what it keeps through the gate's own wording.
 */
class ScriptedGate implements CanaryGateStandIn {
  /** The workspace each standing was asked about, in call order. */
  readonly asked: string[] = [];
  /** The workspace each canary job was taken for, in call order. */
  readonly canaryJobs: string[] = [];
  readonly #script: GateScript;
  readonly #kept = new Map<string, CanaryReading>();
  #held: Deferred<CanaryReading> | undefined;

  constructor(script: GateScript = {}) {
    this.#script = script;
  }

  standing(entry: VitestWorkspace): InstallStanding {
    this.asked.push(entry.path);
    const resolved = this.#script.resolves?.(entry.path) ?? INSTALL;
    if (typeof resolved === "string") {
      return { state: STANDING.waits, what: resolved };
    }
    const kept = this.#kept.get(resolved.directory);
    if (kept === undefined) {
      return { state: STANDING.unread, workspace: entry, install: resolved };
    }
    const wait = readingWait(resolved, kept);
    return wait === undefined
      ? { state: STANDING.confirmed }
      : { state: STANDING.waits, ...wait };
  }

  async take({ workspace: entry, install }: UnreadInstall) {
    const call = this.canaryJobs.length;
    this.canaryJobs.push(entry.path);
    const scripted = this.#script.readings?.(call) ?? confirmedReading(install);
    const reading = scripted === HELD ? await this.#hold() : scripted;
    if (reading.status !== CANARY_READING.none) {
      this.#kept.set(install.directory, reading);
    }
    return reading;
  }

  #hold(): Promise<CanaryReading> {
    this.#held = new Deferred<CanaryReading>();
    return this.#held.promise;
  }

  /** Ends the canary job in progress with `reading`, as its executor's reply does. */
  end(reading: CanaryReading): void {
    this.#held?.resolve(reading);
    this.#held = undefined;
  }
}

/** An experiment that ran in a job whose restored baseline left no record, so its judgement has no verdict. */
const NO_VERDICT: ExperimentFacts = {
  baseline: baseline(),
  job: CLEAN_JOB,
  run: mutatedRun(),
  confirming: { status: "ran", ...mutatedRun() },
};
const NO_VERDICT_REASON = "restored-baseline-unrecorded";
const SURVIVED: ExperimentFacts = ranOnce({ test: SURVIVING_TEST });
/** An experiment the job decided before any run: no module holds its test, which reads invalid experiment. */
const DECIDED: ExperimentFacts = {
  job: CLEAN_JOB,
  notRun: { kind: "no-module" },
};
const INTERRUPTED: ExperimentFacts = {
  baseline: baseline(),
  job: CLEAN_JOB,
  notRun: { kind: "interrupted" },
};
const CONFIRMING_INTERRUPTED: ExperimentFacts = {
  baseline: baseline(),
  job: CLEAN_JOB,
  run: mutatedRun(),
  confirming: { status: "interrupted" },
};

/** The digest a job records of a mutation's file: of its text as the file stands. */
function fileDigest(file: string): string {
  return wholeDigest(readFileSync(file, "utf8"));
}

/** The reply of a job that ran to its end and gave each experiment what `factsOf` gives its defect; a detection when absent. */
function ranOver(
  job: SentJob,
  factsOf: (defectId: string) => ExperimentFacts = () => detection(),
): Extract<FalsificationJob, { status: "ran" }> {
  return {
    ...ranReply(
      job.experiments.map(({ defectId, mutation }) => ({
        defectId,
        facts: factsOf(defectId),
        mutationFileDigest: fileDigest(mutation.file),
      })),
    ),
    workspace: workspace(job.workspacePath),
  };
}

function replied(
  job: SentJob,
  factsOf?: (defectId: string) => ExperimentFacts,
): FalsifyOutcome {
  return { ended: true, value: ranOver(job, factsOf) };
}

/** How an abort left a job. */
interface AbortedJob {
  /** The definition whose run the abort ended; none when a baseline was the run in progress. */
  readonly running?: string;
  /** Whether the abort ended that definition's confirming run rather than its first. */
  readonly inConfirming?: boolean;
  /** Whether the first baseline had ended; true when absent. */
  readonly baselineEnded?: boolean;
  /** Definitions the job decided before any run, which carry a verdict. */
  readonly decided?: readonly string[];
}

/** What an abort left of each experiment, in the job's order: those before the running one ran, those after it did not. */
function leftBy(job: SentJob, how: AbortedJob): ExperimentFacts[] {
  const ids = job.experiments.map(({ defectId }) => defectId);
  const at = how.running === undefined ? ids.length : ids.indexOf(how.running);
  return ids.map((defectId, index) => {
    if (how.decided?.includes(defectId) === true) return DECIDED;
    if (how.baselineEnded === false || index > at) return INTERRUPTED;
    if (index < at) return NO_VERDICT;
    return how.inConfirming === true ? CONFIRMING_INTERRUPTED : INTERRUPTED;
  });
}

function recordOf(
  experiment: DefectExperiment,
  facts: ExperimentFacts,
): ExperimentRecord {
  const { defectId, mutation } = experiment;
  const mutationFileDigest = fileDigest(mutation.file);
  if ("notRun" in facts) {
    const kind =
      facts.notRun.kind === "no-module" ? "no-module" : "interrupted";
    return {
      defectId,
      status: "not-run",
      reason: { kind },
      mutationFileDigest,
    };
  }
  return {
    defectId,
    status: "ran",
    run: EMPTY_RUN,
    mutation: [APPLIED],
    ...(facts.confirming?.status === "interrupted"
      ? { confirming: { status: "interrupted" as const } }
      : {}),
    mutationFileDigest,
  };
}

/** The reply of a job whose experiments read `facts`, in its order, each record as the job leaves it. */
function repliedWith(
  job: SentJob,
  facts: readonly ExperimentFacts[],
  more: { readonly interrupted: boolean; readonly baselineEnded: boolean },
): FalsifyOutcome {
  const reply = ranOver(job, (defectId) => {
    const index = job.experiments.findIndex(
      (experiment) => experiment.defectId === defectId,
    );
    return facts[index] ?? INTERRUPTED;
  });
  return {
    ended: true,
    value: {
      ...reply,
      interrupted: more.interrupted,
      ...(more.baselineEnded
        ? { baseline: { ran: true as const, record: EMPTY_RUN } }
        : {}),
      experiments: job.experiments.map((experiment, index) =>
        recordOf(experiment, facts[index] ?? INTERRUPTED),
      ),
    },
  };
}

/** The reply of a job an abort ended as `how` says: marked interrupted, with no restored baseline. */
function aborted(job: SentJob, how: AbortedJob = {}): FalsifyOutcome {
  return repliedWith(job, leftBy(job, how), {
    interrupted: true,
    baselineEnded: how.baselineEnded !== false,
  });
}

/** The reply of a job that decided every experiment before any run, so it ran no baseline. */
function decidedBeforeAnyRun(job: SentJob): FalsifyOutcome {
  return repliedWith(
    job,
    job.experiments.map(() => DECIDED),
    { interrupted: false, baselineEnded: false },
  );
}

function sourceOf(path: string): string {
  return `${path}/src/${path}.ts`;
}

/** The definition `id` of the test `t<index>` of `path`, whose mutation is that test's own line of the workspace's source. */
function definitionOf(
  id: string,
  path = "a",
  index = 0,
  more: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id,
    defect: `f${index} returns another number`,
    required: `f${index} returns ${index}`,
    test: { module: `${path}/${TEST_MODULE}`, name: [`t${index}`] },
    mutation: {
      file: sourceOf(path),
      old: `return ${index};`,
      new: `return ${index} + 1;`,
    },
    ...more,
  };
}

interface FalsifyingCase extends JobScript {
  /** How many tests each confirmed workspace holds, by its path; one test of `a` when absent. */
  readonly tests?: Readonly<Record<string, number>>;
  /** Each run of a workspace; one in which every test passed when absent. */
  readonly ran?: (path: string) => WorkspaceRun;
  /**
   * The definition files under `defects/`, by name; `all.json` defining every test, workspace by workspace, as
   * `<PATH><index>`, when absent.
   */
  readonly files?: Readonly<Record<string, readonly unknown[]>>;
  /** What `rt-test.json` holds beside the definition files' pattern. */
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly inputs?: StandInInputs;
  readonly store?: RecordingStore;
  /** The confirmed start; one confirming every workspace when absent. */
  readonly start?: ConfirmedStart;
  readonly quietWindowMs?: number;
  /** The canary gate; one that holds a confirmed reading of every install when absent. */
  readonly gate?: ScriptedGate;
}

interface Falsifying extends Daemon {
  readonly executor: FalsifyingExecutor;
  readonly root: string;
}

function testsOf(given: FalsifyingCase): Readonly<Record<string, number>> {
  return given.tests ?? { a: 1 };
}

function indexes(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

function writeFiles(
  root: string,
  files: Readonly<Record<string, string>>,
): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

/** Writes the consumer a case describes: each workspace's source, the definition files and `rt-test.json`. */
function writeConsumer(root: string, given: FalsifyingCase): void {
  const tests = Object.entries(testsOf(given));
  const files = given.files ?? {
    "all.json": tests.flatMap(([path, count]) =>
      indexes(count).map((index) =>
        definitionOf(`${path.toUpperCase()}${index}`, path, index),
      ),
    ),
  };
  writeFiles(root, {
    "rt-test.json": JSON.stringify({
      defects: ["defects/*.json"],
      ...given.settings,
    }),
    ...Object.fromEntries(
      tests.map(([path, count]) => [
        sourceOf(path),
        indexes(count)
          .map(
            (index) => `export function f${index}() {\n  return ${index};\n}\n`,
          )
          .join(""),
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(files).map(([name, definitions]) => [
        `defects/${name}`,
        JSON.stringify({ defects: definitions }),
      ]),
    ),
  });
}

/**
 * Runs `body` over a daemon begun in a consumer written under a temporary directory: each workspace discovered with
 * its tests and run once with every test passed, and its definitions waiting. The daemon is stopped when `body` ends.
 */
function falsifying<T>(
  given: FalsifyingCase,
  body: (started: Falsifying) => Promise<T>,
): Promise<T> {
  return inTempDir(async (root) => {
    writeConsumer(root, given);
    const tests = testsOf(given);
    const paths = Object.keys(tests);
    const executor = new FalsifyingExecutor(
      {
        ended: true,
        value: discovery(
          ...paths.map((path) =>
            discoveredIn(
              path,
              indexes(tests[path] ?? 0).map(() => TEST_MODULE),
            ),
          ),
        ),
      },
      (path) => ({
        ended: true,
        value:
          given.ran?.(path) ??
          ranWorkspace(
            path,
            indexes(tests[path] ?? 0).map(() => "passed"),
          ),
      }),
      given,
    );
    const started = daemon(
      given.start ?? confirmed(...paths),
      executor,
      given.store ?? new RecordingStore(),
      {
        ...IDENTITY,
        consumerRoot: root,
        stateDirectory: join(root, ".rt-test"),
      },
      given.inputs ?? new StandInInputs(),
      new ScriptedBuilds(),
      given.quietWindowMs ?? NO_QUIET_WINDOW_MS,
      given.gate,
    );
    started.lifecycle.begin();
    try {
      return await body({ ...started, executor, root });
    } finally {
      executor.end(TEST_ENDED);
      given.gate?.end(INTERRUPTED_READING);
      started.lifecycle.stop();
      await started.lifecycle.stopped();
    }
  });
}

/** How long a wait for the daemon lets the event loop turn, on the process's own clock, which no test fakes. */
const REACH_BOUND_NS = 15_000_000_000n;

/**
 * Lets the event loop turn until `ready`, since a look's file reads end on no turn a test can count. It resolves at
 * the bound whether or not the daemon got there, with whether it did, so one that never does fails the test's own
 * assertion. A test whose expected value a daemon that did nothing would also give asserts that answer.
 */
async function reached(ready: () => boolean): Promise<boolean> {
  const deadline = process.hrtime.bigint() + REACH_BOUND_NS;
  while (!ready() && process.hrtime.bigint() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return ready();
}

/** Until `count` falsification jobs have been sent; whether they were. */
function sent(started: Falsifying, count: number): Promise<boolean> {
  return reached(() => started.executor.jobs.length >= count);
}

/** Until the scheduler has gone idle `count` times, and whether it did: it logs so each time a look takes nothing after work. */
function idled(started: Falsifying, count = 1): Promise<boolean> {
  return reached(
    () =>
      started.log.entries.filter((entry) => entry === IDLE_ENTRY).length >=
      count,
  );
}

/** Ends a periodic reconciliation with the revision unmoved, and waits for the look the plan after it takes; whether it was taken. */
async function afterPeriodicReconciliation(
  started: Falsifying,
): Promise<boolean> {
  const { inputs } = started;
  const windows = inputs.jobsEnded;
  inputs.endPeriodicReconciliation();
  const looked = await reached(() => inputs.jobsEnded > windows);
  await flush();
  return looked;
}

/** The ids each job sent held, in the order the jobs were sent. */
function jobIds(started: Falsifying): string[][] {
  return started.executor.jobs.map((job) =>
    job.experiments.map(({ defectId }) => defectId),
  );
}

function falsificationEntries(started: Falsifying): UnstoredJob[] {
  return started.lifecycle
    .status()
    .unstoredJobs.filter((job) => job.kind === "falsification");
}

/** Each defect the store holds evidence for, with its verdict. */
function storedVerdicts(started: Falsifying): Record<string, string> {
  return Object.fromEntries(
    started.store
      .readLatestResults(SCOPE)
      .evidence.map(({ defectId, verdict }) => [defectId, verdict]),
  );
}

/** Inputs whose workspaces' fingerprints change when the test sets `edited`, as an edit inside every workspace does. */
class EditableInputs extends StandInInputs {
  edited = false;

  constructor() {
    super({
      fingerprintOf: (path) => ({
        ok: true,
        digest: this.edited ? `${path}-edited` : `${path}-digest`,
      }),
    });
  }
}

/** Why a job's window does not vouch for its inputs, when an event named one while it ran at an unmoved revision. */
const NAMED_EVENT: JobVerdict = {
  fingerprinted: false,
  reason: "an input event named a/src/a.ts while the job ran",
  changedWhileRunning: true,
};

/** Inputs whose next job to end reads the verdict the test set, as a job reads an event that named an input. */
class NamingInputs extends StandInInputs {
  named: JobVerdict | undefined;

  override async endJob(
    mark: Parameters<StandInInputs["endJob"]>[0],
  ): Promise<JobVerdict> {
    const verdict = await super.endJob(mark);
    const { named } = this;
    this.named = undefined;
    return named ?? verdict;
  }
}

describe(
  "which waiting definitions a falsification job takes",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4050: a definition that is invalid, whose anchor is missing, or whose test holds no current pass is given no experiment, and the others are", async () => {
      const jobs = await falsifying(
        {
          tests: { a: 4 },
          ran: (path) =>
            ranWorkspace(path, ["passed", "passed", "failed", "passed"]),
          files: {
            "all.json": [
              definitionOf("INVALID", "a", 0, { mutation: undefined }),
              definitionOf("NO-ANCHOR", "a", 1, {
                mutation: {
                  file: sourceOf("a"),
                  old: "return 99;",
                  new: "return 98;",
                },
              }),
              definitionOf("NO-PASS", "a", 2),
              definitionOf("GOOD", "a", 3),
            ],
          },
        },
        async (started) => {
          await idled(started);
          return jobIds(started);
        },
      );
      expect(jobs).toStrictEqual([["GOOD"]]);
    });

    it("D4051: a definition whose evidence reads current is not waiting, so a later input revision that leaves it current starts no job for it", async () => {
      const jobs = await falsifying({ tests: { a: 2 } }, async (started) => {
        await idled(started);
        started.inputs.moveRevision();
        const idledAgain = await idled(started, 2);
        return { idledAgain, jobs: jobIds(started) };
      });
      expect(jobs).toStrictEqual({ idledAgain: true, jobs: [["A0", "A1"]] });
    });

    it("D4052: each experiment holds its definition's id, its resolved test's identity, and its mutation with the file as an absolute path", async () => {
      const experiments = await falsifying({}, async (started) => {
        await sent(started, 1);
        const file = join(started.root, "a", "src", "a.ts");
        return started.executor.jobs[0]?.experiments.map((experiment) => ({
          ...experiment,
          mutation: {
            ...experiment.mutation,
            file:
              experiment.mutation.file === file
                ? "<root>/a/src/a.ts"
                : experiment.mutation.file,
          },
        }));
      });
      expect(experiments).toStrictEqual([
        {
          defectId: "A0",
          test: {
            workspacePath: "a",
            projectName: "unit",
            modulePath: "a.test.ts",
            namePath: ["t0"],
            occurrence: 0,
          },
          mutation: {
            file: "<root>/a/src/a.ts",
            old: "return 0;",
            new: "return 0 + 1;",
          },
        },
      ]);
    });

    it("D4053: a job is handed its workspace's confirmed config file and the assertion error names rt-test.json declares", async () => {
      const handed = await falsifying(
        { settings: { assertionErrors: ["HtmlElementTypeError"] } },
        async (started) => {
          await sent(started, 1);
          const [job] = started.executor.jobs;
          return {
            configFile: job?.configFile,
            assertionErrors: job?.assertionErrors,
          };
        },
      );
      expect(handed).toStrictEqual({
        configFile: "a/vitest.config.mjs",
        assertionErrors: ["HtmlElementTypeError"],
      });
    });

    it("D4054: a job holds at most 25 definitions, and the next job holds the rest", async () => {
      const sizes = await falsifying(
        { tests: { a: MAX_JOB_DEFINITIONS + 1 } },
        async (started) => {
          await idled(started);
          return jobIds(started).map((ids) => ids.length);
        },
      );
      expect(sizes).toStrictEqual([25, 1]);
    });

    it("D4055: a job holds only the definitions of the first waiting definition's workspace, in the listing's order, and the next job the other workspace's", async () => {
      const jobs = await falsifying(
        {
          tests: { a: 1, b: 2 },
          files: {
            "1.json": [definitionOf("B0", "b", 0)],
            "2.json": [definitionOf("A0", "a", 0), definitionOf("B1", "b", 1)],
          },
        },
        async (started) => {
          await idled(started);
          return started.executor.jobs.map((job) => ({
            workspacePath: job.workspacePath,
            ids: job.experiments.map(({ defectId }) => defectId),
          }));
        },
      );
      expect(jobs).toStrictEqual([
        { workspacePath: "b", ids: ["B0", "B1"] },
        { workspacePath: "a", ids: ["A0"] },
      ]);
    });

    it("D4056: the waiting definitions are taken in the order a defects answer lists them, a survivor whose evidence is stale before a never verified one that precedes it in its file", async () => {
      const inputs = new EditableInputs();
      const jobs = await falsifying(
        {
          tests: { a: 3 },
          inputs,
          replies: (job) =>
            replied(job, (id) => (id === "A2" ? SURVIVED : NO_VERDICT)),
        },
        async (started) => {
          await idled(started);
          inputs.edited = true;
          inputs.moveRevision();
          await idled(started, 2);
          return jobIds(started);
        },
      );
      expect(jobs).toStrictEqual([
        ["A0", "A1", "A2"],
        ["A2", "A0", "A1"],
      ]);
    });
  },
);

describe(
  "what a falsification job stores",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4057: each verdict a job's reply carries is stored bound to its definition's digest, so a defects answer then reads it with evidence freshness current", async () => {
      const read = await falsifying({ tests: { a: 2 } }, async (started) => {
        await idled(started);
        const answer = await started.lifecycle.defects(
          undefined,
          stillWaited(),
        );
        return "noAnswer" in answer
          ? answer
          : answer.definitions.map(({ id, state, evidence }) => ({
              id,
              state,
              freshness: evidence?.freshness,
            }));
      });
      expect(read).toStrictEqual([
        { id: "A0", state: "detected", freshness: "current" },
        { id: "A1", state: "detected", freshness: "current" },
      ]);
    });

    it("D4058: a job's whole reply is stored in one write, bound to the digest of the workspace's fingerprint its standings were read at", async () => {
      const writes = await falsifying({ tests: { a: 2 } }, async (started) => {
        await idled(started);
        return started.store.evidenceWrites.map((write) => ({
          bindings: write.bindings,
          defects: [...write.definitionDigests.keys()],
        }));
      });
      expect(writes).toStrictEqual([
        {
          bindings: { ...SCOPE, inputFingerprintDigest: "a-digest" },
          defects: ["A0", "A1"],
        },
      ]);
    });

    it("D4059: the verdicts of a job in which no run happened, each decided before any run, are stored", async () => {
      const stored = await falsifying(
        { replies: decidedBeforeAnyRun },
        async (started) => {
          await idled(started);
          return storedVerdicts(started);
        },
      );
      expect(stored).toStrictEqual({ A0: "invalid-experiment" });
    });

    it("D4060: nothing of a job is stored when an event named an input while it ran, though the input revision and the workspace's fingerprint are as at its start", async () => {
      const inputs = new NamingInputs();
      const writes = await falsifying(
        {
          inputs,
          replies: (job) => {
            inputs.named = NAMED_EVENT;
            return replied(job);
          },
        },
        async (started) => ({
          idled: await idled(started),
          writes: started.store.evidenceWrites.length,
        }),
      );
      expect(writes).toStrictEqual({ idled: true, writes: 0 });
    });

    it("D4061: a workspace whose job an event named an input during, at a revision that did not move, gets no further job, and its entry says which event and what ends the wait", async () => {
      const inputs = new NamingInputs();
      const outcome = await falsifying(
        {
          tests: { a: 26 },
          inputs,
          replies: (job) => {
            inputs.named = NAMED_EVENT;
            return replied(job);
          },
        },
        async (started) => {
          await idled(started);
          const [entry] = falsificationEntries(started);
          return {
            jobs: started.executor.jobs.length,
            namesTheEvent: entry?.reason.includes(NAMED_EVENT.reason),
            saysWhatEndsTheWait: entry?.reason.includes(
              "until the input revision changes",
            ),
          };
        },
      );
      expect(outcome).toStrictEqual({
        jobs: 1,
        namesTheEvent: true,
        saysWhatEndsTheWait: true,
      });
    });

    it("D4062: a reply that carries no verdict is never handed to the store", async () => {
      const writes = await falsifying(
        { replies: (job) => replied(job, () => NO_VERDICT) },
        async (started) => ({
          idled: await idled(started),
          writes: started.store.evidenceWrites.length,
        }),
      );
      expect(writes).toStrictEqual({ idled: true, writes: 0 });
    });

    it("D4063: a stop during a job stores nothing of it and leaves no definition and no workspace waiting", async () => {
      const outcome = await falsifying(
        {
          tests: { a: 2 },
          replies: () => HELD,
          aborted: (job) => aborted(job, { running: "A0", decided: ["A1"] }),
        },
        async (started) => {
          const jobSent = await sent(started, 1);
          started.lifecycle.stop();
          await started.lifecycle.stopped();
          return {
            jobSent,
            writes: started.store.evidenceWrites.length,
            entries: falsificationEntries(started),
          };
        },
      );
      expect(outcome).toStrictEqual({ jobSent: true, writes: 0, entries: [] });
    });

    it("D4157: a stop that lands while a look reads the definition files ends the look as one that took nothing, and no scheduling step is logged as failed", async () => {
      const look = { armed: false, held: false };
      let planned = (): boolean => false;
      // The scheduler's own wait for the inputs comes while the round at the new revision is pending, the look's once it is planned.
      const inputs = new StandInInputs({
        heldSettleIf: () => {
          look.held = look.armed && planned();
          return look.held;
        },
      });
      const outcome = await falsifying({ inputs }, async (started) => {
        planned = () => {
          const answer = started.lifecycle.summary();
          return (
            !("noAnswer" in answer) && answer.schedule.round.state === "planned"
          );
        };
        await idled(started);
        look.armed = true;
        inputs.moveRevision();
        await reached(() => look.held);
        // Registered behind the look's own wait, so the stop lands once the look has begun its read.
        const stopping = inputs.settleHeld.promise.then(() => {
          started.lifecycle.stop();
        });
        inputs.settleHeld.resolve();
        await stopping;
        await started.lifecycle.stopped();
        return {
          heldInTheLook: look.held,
          failedSteps: started.log.entries.filter((entry) =>
            entry.includes("a scheduling step failed"),
          ).length,
        };
      });
      expect(outcome).toStrictEqual({ heldInTheLook: true, failedSteps: 0 });
    });
  },
);

describe(
  "a falsification job a change of the input revision ends",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    /** A job of three definitions, held until an abort ends it while `A0` runs; every other job gives no verdict. */
    function endedWhileA0Runs(held: readonly number[]): FalsifyingCase {
      return {
        tests: { a: 3 },
        replies: (job, call) =>
          held.includes(call) ? HELD : replied(job, () => NO_VERDICT),
        aborted: (job) => aborted(job, { running: "A0" }),
      };
    }

    it("D4064: a change of the input revision while a job runs aborts the job as an interruption", async () => {
      const purposes = await falsifying(
        endedWhileA0Runs([0]),
        async (started) => {
          await sent(started, 1);
          started.inputs.moveRevision();
          await reached(() => started.executor.aborts > 0);
          return [...started.executor.purposes];
        },
      );
      expect(purposes).toStrictEqual([ABORT_PURPOSE.interruption]);
    });

    it("D4065: a periodic reconciliation that ends while a job runs, the input revision unmoved, does not abort the job", async () => {
      const aborts = await falsifying(
        endedWhileA0Runs([0]),
        async (started) => {
          const jobSent = await sent(started, 1);
          started.inputs.endPeriodicReconciliation();
          await flush();
          return { jobSent, aborts: started.executor.aborts };
        },
      );
      expect(aborts).toStrictEqual({ jobSent: true, aborts: 0 });
    });

    it("D4066: one input change that ends a job marks none of its definitions, so the one that was running is taken first again", async () => {
      const jobs = await falsifying(endedWhileA0Runs([0]), async (started) => {
        await sent(started, 1);
        started.inputs.moveRevision();
        await idled(started);
        return jobIds(started);
      });
      expect(jobs).toStrictEqual([
        ["A0", "A1", "A2"],
        ["A0", "A1", "A2"],
      ]);
    });

    it("D4067: a definition that was the one running when an input change ended its job, in two jobs in a row, is left without a verdict and not taken at the revision the second returned at", async () => {
      const outcome = await falsifying(
        endedWhileA0Runs([0, 1]),
        async (started) => {
          await sent(started, 1);
          started.inputs.moveRevision();
          await sent(started, 2);
          started.inputs.moveRevision();
          await idled(started);
          return {
            third: jobIds(started)[2],
            names: falsificationEntries(started).map((entry) =>
              entry.reason.includes("A0 (repeated-input-change)"),
            ),
          };
        },
      );
      expect(outcome).toStrictEqual({ third: ["A1", "A2"], names: [true] });
    });

    it("D4068: a job that ran to its end between two jobs an input change ended while one definition ran ends that run of endings, so the definition is taken again", async () => {
      const jobs = await falsifying(
        endedWhileA0Runs([0, 2]),
        async (started) => {
          await sent(started, 1);
          started.inputs.moveRevision();
          await idled(started);
          started.inputs.moveRevision();
          await sent(started, 3);
          started.inputs.moveRevision();
          await idled(started, 2);
          return jobIds(started)[3];
        },
      );
      expect(jobs).toStrictEqual(["A0", "A1", "A2"]);
    });

    it("D4069: once a job has returned, a later change of the input revision aborts nothing", async () => {
      const aborts = await falsifying({}, async (started) => {
        await idled(started);
        started.inputs.moveRevision();
        const idledAgain = await idled(started, 2);
        return { idledAgain, aborts: started.executor.aborts };
      });
      expect(aborts).toStrictEqual({ idledAgain: true, aborts: 0 });
    });
  },
);

/** What every workspace's entry says ends its wait. */
const WORKSPACE_WAIT_ENDS = "until the input revision changes";
const EXECUTOR_DIED =
  "the executor process 7 exited during the job (exit code 1)";
const FAILED_TO_LOAD: FalsificationJob = {
  status: "failed",
  workspace: workspace("a"),
  vitestVersion: DISCOVERED_VITEST_VERSION,
  error: "Error: config boom",
};

/** A reply of a shape no executor sends, as a value that crossed a process boundary can be. */
function replyOf(value: unknown): FalsifyOutcome {
  return { ended: true, value: value as FalsificationJob };
}

describe(
  "a falsification job the time bound ends",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    /**
     * Runs `body` under the fake clock once a job of three definitions is in progress, held until an abort, which
     * leaves it as `how` says. Every later job runs to its end and gives no verdict.
     */
    function heldForTheBound<T>(
      how: AbortedJob,
      body: (started: Falsifying) => Promise<T>,
    ): Promise<T> {
      return underFakeClock(() =>
        falsifying(
          {
            tests: { a: 3 },
            replies: (job, call) =>
              call === 0 ? HELD : replied(job, () => NO_VERDICT),
            aborted: (job) => aborted(job, how),
          },
          async (started) => {
            await sent(started, 1);
            return body(started);
          },
        ),
      );
    }

    /** The jobs sent once the bound ended the first, and whether each falsification entry names the bound and a baseline. */
    async function afterTheBoundInABaseline(how: AbortedJob): Promise<unknown> {
      return heldForTheBound(how, async (started) => {
        await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
        await idled(started);
        return {
          jobs: jobIds(started),
          saysTheBoundInABaseline: falsificationEntries(started).map(
            ({ reason }) =>
              reason.includes("time bound") && reason.includes("baseline"),
          ),
        };
      });
    }

    const ONE_JOB_AND_THE_WORKSPACE_WAITS = {
      jobs: [["A0", "A1", "A2"]],
      saysTheBoundInABaseline: [true],
    };

    it("D4070: a job that has not ended 10 minutes after it was sent is aborted as an interruption, and no sooner", async () => {
      const purposes = await heldForTheBound(
        { running: "A0" },
        async (started) => {
          await vi.advanceTimersByTimeAsync(599_999);
          const before = [...started.executor.purposes];
          await vi.advanceTimersByTimeAsync(1);
          return { before, after: [...started.executor.purposes] };
        },
      );
      expect(purposes).toStrictEqual({
        before: [],
        after: [ABORT_PURPOSE.interruption],
      });
    });

    it("D4071: the definition that was running when the bound ended its job is left without a verdict, named with the bound, and the job's other definitions are taken again at once", async () => {
      const outcome = await heldForTheBound(
        { running: "A1" },
        async (started) => {
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          await idled(started);
          return {
            next: jobIds(started)[1],
            names: falsificationEntries(started).map(({ reason }) =>
              reason.includes("A1 (time-bound)"),
            ),
          };
        },
      );
      expect(outcome).toStrictEqual({ next: ["A0", "A2"], names: [true] });
    });

    it("D4072: a definition the bound left without a verdict is taken again once the input revision moves, after every other definition", async () => {
      const third = await heldForTheBound(
        { running: "A0" },
        async (started) => {
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          await idled(started);
          started.inputs.moveRevision();
          await idled(started, 2);
          return jobIds(started)[2];
        },
      );
      expect(third).toStrictEqual(["A1", "A2", "A0"]);
    });

    it("D4073: the verdicts carried by the reply of a job the bound ended are stored", async () => {
      const stored = await heldForTheBound(
        { running: "A1", decided: ["A2"] },
        async (started) => {
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          await idled(started);
          return storedVerdicts(started);
        },
      );
      expect(stored).toStrictEqual({ A2: "invalid-experiment" });
    });

    it("D4074: a job the bound ended in its first baseline names no definition, so its workspace gets no further job and no definition is left behind the others", async () => {
      expect(
        await afterTheBoundInABaseline({ baselineEnded: false }),
      ).toStrictEqual(ONE_JOB_AND_THE_WORKSPACE_WAITS);
    });

    it("D4075: a job the bound ended in its restored baseline, every experiment run, names no definition, so its workspace gets no further job", async () => {
      expect(await afterTheBoundInABaseline({})).toStrictEqual(
        ONE_JOB_AND_THE_WORKSPACE_WAITS,
      );
    });

    it("D4076: an experiment whose confirming run the bound ended is the one that was running, not the experiment after it", async () => {
      const next = await heldForTheBound(
        { running: "A0", inConfirming: true },
        async (started) => {
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          await idled(started);
          return jobIds(started)[1];
        },
      );
      expect(next).toStrictEqual(["A1", "A2"]);
    });

    it("D4077: a bound whose abort found no job in progress ended nothing, so the reply that follows is read as the job's own", async () => {
      const says = await underFakeClock(() =>
        falsifying({ replies: () => HELD }, async (started) => {
          await sent(started, 1);
          started.executor.abortFinds = false;
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          started.executor.end({ ended: true, value: FAILED_TO_LOAD });
          await idled(started);
          const [entry] = falsificationEntries(started);
          return {
            theFailure: entry?.reason.includes("config boom"),
            theBound: entry?.reason.includes("time bound"),
          };
        }),
      );
      expect(says).toStrictEqual({ theFailure: true, theBound: false });
    });

    it("D4078: a reply that holds every run, from a job whose last run had ended when the bound's abort reached it, is stored as a job that ran to its end", async () => {
      const outcome = await underFakeClock(() =>
        falsifying(
          { replies: () => HELD, aborted: (job) => replied(job) },
          async (started) => {
            await sent(started, 1);
            await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
            await idled(started);
            return {
              stored: storedVerdicts(started),
              entries: falsificationEntries(started),
            };
          },
        ),
      );
      expect(outcome).toStrictEqual({
        stored: { A0: "detected" },
        entries: [],
      });
    });
  },
);

describe(
  "a workspace whose falsification job did not run or could not be stored",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    /** How many jobs a workspace was sent, and what its entry holds of `fragments`, once its job ended as `outcome`. */
    async function afterJob(
      outcome: FalsifyOutcome,
      fragments: readonly string[],
      given: FalsifyingCase = {},
    ): Promise<unknown> {
      return falsifying(
        { replies: () => outcome, ...given },
        async (started) => {
          await idled(started);
          const [entry] = falsificationEntries(started);
          return {
            jobs: started.executor.jobs.length,
            workspacePath: entry?.workspacePath,
            kind: entry?.kind,
            missing: [...fragments, WORKSPACE_WAIT_ENDS].filter(
              (fragment) => entry?.reason.includes(fragment) !== true,
            ),
          };
        },
      );
    }

    /** One job, then none: the workspace's one entry, marked as a falsification's, says each fragment asked for. */
    const WAITS_AFTER_ONE_JOB = {
      jobs: 1,
      workspacePath: "a",
      kind: "falsification",
      missing: [],
    };

    it("D4079: a definition of a job that ran to its end is not taken again at that revision, with a verdict or without, and a periodic reconciliation does not lift that", async () => {
      const jobs = await falsifying(
        { replies: (job) => replied(job, () => NO_VERDICT) },
        async (started) => {
          await idled(started);
          const looked = await afterPeriodicReconciliation(started);
          return { looked, jobs: jobIds(started) };
        },
      );
      expect(jobs).toStrictEqual({ looked: true, jobs: [["A0"]] });
    });

    it("D4080: a workspace whose job was refused for an on-disk module cache gets no further job, and its entry names the projects and their settings", async () => {
      expect(
        await afterJob(
          replyOf({
            status: "refused",
            workspace: workspace("a"),
            vitestVersion: DISCOVERED_VITEST_VERSION,
            falsifierVersion: FALSIFIER_VERSION,
            unhandledErrors: [],
            refusal: {
              kind: "module-cache",
              caches: [
                { projectName: "unit", setting: "experimental.fsModuleCache" },
              ],
            },
          }),
          ["unit", "experimental.fsModuleCache"],
        ),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4081: a workspace whose job was refused because its Vitest instance could not be prepared gets no further job, and its entry says why", async () => {
      expect(
        await afterJob(
          replyOf({
            status: "refused",
            workspace: workspace("a"),
            vitestVersion: DISCOVERED_VITEST_VERSION,
            falsifierVersion: FALSIFIER_VERSION,
            unhandledErrors: [],
            refusal: { kind: "not-prepared", error: "Error: no reach setup" },
          }),
          ["Error: no reach setup"],
        ),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4082: a workspace whose Vitest is not supported gets no further job, and its entry says why it is not", async () => {
      expect(
        await afterJob(
          replyOf({
            status: "unsupported",
            workspace: workspace("a"),
            vitest: { supported: false, reason: "Vitest 3.2.4 is too old" },
          }),
          ["Vitest 3.2.4 is too old"],
        ),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4083: a workspace whose job replied that its config is not the one confirmed gets no further job, and its entry says so", async () => {
      expect(
        await afterJob(
          replyOf({
            status: "not-confirmed",
            workspace: workspace("a"),
            reason: CONFIG_NOT_CONFIRMED,
          }),
          [CONFIG_NOT_CONFIRMED],
        ),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4084: a workspace that failed to load in its job gets no further job, and its entry holds the failure", async () => {
      expect(
        await afterJob(replyOf(FAILED_TO_LOAD), ["Error: config boom"]),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4085: a workspace whose executor ended without a reply gets no further job, and its entry says how the executor ended", async () => {
      expect(
        await afterJob({ ended: false, reason: EXECUTOR_DIED }, [
          EXECUTOR_DIED,
        ]),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4086: a reply whose job is not an object is a job that did not run, so its workspace gets no further job", async () => {
      expect(await afterJob(replyOf(null), [])).toStrictEqual(
        WAITS_AFTER_ONE_JOB,
      );
    });

    it("D4087: a reply of a status no job has is a job that did not run, so its workspace gets no further job", async () => {
      expect(await afterJob(replyOf({ status: "mystery" }), [])).toStrictEqual(
        WAITS_AFTER_ONE_JOB,
      );
    });

    it("D4088: a reply that reads ran without its list of judgements is a job that did not run, so its workspace gets no further job", async () => {
      expect(
        await afterJob(replyOf({ ...ranReply([]), judgements: "none" }), []),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4089: a workspace the confirmed start no longer holds is sent no job and gets none, and its entry says the confirmed start does not hold it", async () => {
      const store = new RecordingStore();
      store.seedDiscovery(discovery(discoveredIn("a", [TEST_MODULE])), {
        kind: "digest",
        digest: DISCOVERY_DIGEST,
      });
      store.seedRun(ranWorkspace("a"), { kind: "digest", digest: "a-digest" });
      expect(
        await afterJob(
          TEST_ENDED,
          ["the confirmed start does not hold the workspace"],
          { store, start: confirmed() },
        ),
      ).toStrictEqual({ ...WAITS_AFTER_ONE_JOB, jobs: 0 });
    });

    it("D4090: a workspace whose verdicts the store could not write gets no further job, and its entry says they could not be stored", async () => {
      const store = new RecordingStore();
      store.failingEvidence = "database is locked";
      expect(
        await afterJob(TEST_ENDED, ["could not be stored"], {
          tests: { a: MAX_JOB_DEFINITIONS + 1 },
          store,
          replies: (job) => replied(job),
        }),
      ).toStrictEqual(WAITS_AFTER_ONE_JOB);
    });

    it("D4091: a workspace whose executor ended without a reply after the bound's abort gets no further job, and its entry names the bound and how the executor ended", async () => {
      const outcome = await underFakeClock(() =>
        falsifying(
          {
            replies: () => HELD,
            aborted: () => ({ ended: false, reason: EXECUTOR_DIED }),
          },
          async (started) => {
            await sent(started, 1);
            await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
            await idled(started);
            const [entry] = falsificationEntries(started);
            return {
              jobs: started.executor.jobs.length,
              missing: [
                "time bound",
                EXECUTOR_DIED,
                WORKSPACE_WAIT_ENDS,
              ].filter((fragment) => entry?.reason.includes(fragment) !== true),
            };
          },
        ),
      );
      expect(outcome).toStrictEqual({ jobs: 1, missing: [] });
    });

    /** A load error longer than an answer keeps of a reason, over several lines. */
    const LONG_ERROR = `Error: config boom\n${"x".repeat(3000)}\n    at load`;

    it("D4092: a long, multi-line error ahead of it leaves what ends the wait on the reason's one line, inside the 1,000 characters an answer keeps", async () => {
      const reason = await falsifying(
        {
          replies: () => replyOf({ ...FAILED_TO_LOAD, error: LONG_ERROR }),
        },
        async (started) => {
          await idled(started);
          const [entry] = falsificationEntries(started);
          const text = entry?.reason ?? "";
          return {
            lines: text.split("\n").length,
            waitEndsBy:
              text.includes(WORKSPACE_WAIT_ENDS) &&
              text.indexOf(WORKSPACE_WAIT_ENDS) + WORKSPACE_WAIT_ENDS.length <=
                1000,
          };
        },
      );
      expect(reason).toStrictEqual({ lines: 1, waitEndsBy: true });
    });

    it("D4093: the log holds the whole of an error a workspace's entry cuts", async () => {
      const logged = await falsifying(
        {
          replies: () => replyOf({ ...FAILED_TO_LOAD, error: LONG_ERROR }),
        },
        async (started) => {
          await idled(started);
          return started.log.entries.filter((entry) =>
            entry.includes(LONG_ERROR),
          ).length;
        },
      );
      expect(logged).toBe(1);
    });

    it("D4160: in an entry of both parts read through an answer, a long error ahead of them leaves what ends the definitions' wait inside the 1,000 characters the answer keeps", async () => {
      const says = await falsifying(
        {
          tests: { a: MAX_JOB_DEFINITIONS + 1 },
          replies: (job, call) =>
            call === 0
              ? replied(job, () => NO_VERDICT)
              : replyOf({ ...FAILED_TO_LOAD, error: LONG_ERROR }),
        },
        async (started) => {
          await idled(started);
          const answer = started.lifecycle.summary();
          const jobs = "noAnswer" in answer ? [] : answer.unstoredJobs;
          const text =
            jobs.find((job) => job.kind === "falsification")?.reason ?? "";
          return {
            cutByTheAnswer: text.endsWith(
              "more characters are in the daemon log)",
            ),
            workspaceWaitEnds: text.includes(WORKSPACE_WAIT_ENDS),
            definitionsWaitEnds: text.includes(
              "until the input revision, the definition or the declared assertion error names change",
            ),
          };
        },
      );
      expect(says).toStrictEqual({
        cutByTheAnswer: true,
        workspaceWaitEnds: true,
        definitionsWaitEnds: true,
      });
    });

    it("D4094: a look that throws after it opened its window on the tracker closes the window before the throw goes on", async () => {
      const windows = await falsifying(
        {
          replies: () => {
            throw new Error("the executor could not take the job");
          },
        },
        async (started) => {
          await sent(started, 1);
          await flush();
          return {
            begun: started.inputs.jobsBegun,
            ended: started.inputs.jobsEnded,
          };
        },
      );
      expect(windows).toStrictEqual({ begun: 4, ended: 4 });
    });

    it("D4159: a look that took nothing closes the window it opened on the tracker", async () => {
      const windows = await falsifying({}, async (started) => {
        await idled(started);
        return {
          begun: started.inputs.jobsBegun,
          ended: started.inputs.jobsEnded,
        };
      });
      expect(windows).toStrictEqual({ begun: 5, ended: 5 });
    });
  },
);

/** A store whose run writes fail while the test says so, as a locked database fails them. */
class RunFailingStore extends RecordingStore {
  failingRuns = false;

  override writeRun(bindings: StoreBindings, run: WorkspaceRun): StoredRun {
    if (this.failingRuns) throw new Error("database is locked");
    return super.writeRun(bindings, run);
  }
}

/** A case whose every job runs to its end and gives no definition a verdict. */
const NO_VERDICTS: FalsifyingCase = {
  replies: (job) => replied(job, () => NO_VERDICT),
};

describe(
  "what answers and status say of falsification",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4095: while a falsification job runs, the activity reads falsifying, with its workspace and the number of definitions in the job", async () => {
      const activity = await falsifying(
        { tests: { a: 2 }, replies: () => HELD },
        async (started) => {
          await sent(started, 1);
          return started.lifecycle.status().activity;
        },
      );
      expect(activity).toStrictEqual({
        state: "falsifying",
        workspacePath: "a",
        definitions: 2,
      });
    });

    it("D4096: after a job a change ended, while the scheduler waits out the next quiet window, the activity is idle", async () => {
      const activity = await underFakeClock(() =>
        falsifying(
          {
            quietWindowMs: 1000,
            replies: () => HELD,
            aborted: (job) => aborted(job, { running: "A0" }),
          },
          async (started) => {
            await flush();
            await vi.advanceTimersByTimeAsync(1000);
            await sent(started, 1);
            started.inputs.moveRevision();
            await reached(() =>
              started.log.entries.some((entry) =>
                entry.startsWith("falsification ended"),
              ),
            );
            await flush();
            return started.lifecycle.status().activity;
          },
        ),
      );
      expect(activity).toStrictEqual({ state: "idle" });
    });

    it("D4097: a workspace's falsification entry is marked as a falsification job, and stands beside the entry of that workspace's run that stored nothing", async () => {
      const inputs = new EditableInputs();
      const store = new RunFailingStore();
      const jobs = await falsifying(
        { ...NO_VERDICTS, inputs, store },
        async (started) => {
          await idled(started);
          store.failingRuns = true;
          inputs.edited = true;
          inputs.moveRevision();
          await idled(started, 2);
          inputs.edited = false;
          inputs.moveRevision();
          await idled(started, 3);
          return started.lifecycle
            .status()
            .unstoredJobs.map(({ workspacePath, kind }) => ({
              workspacePath,
              kind: kind ?? "a run",
            }));
        },
      );
      expect(jobs).toStrictEqual([
        { workspacePath: "a", kind: "a run" },
        { workspacePath: "a", kind: "falsification" },
      ]);
    });

    it("D4098: a workspace whose reply could not be stored and whose definitions got no verdict has one entry, what happened to the workspace before its definitions", async () => {
      const inputs = new NamingInputs();
      const entries = await falsifying(
        {
          inputs,
          replies: (job) => {
            inputs.named = NAMED_EVENT;
            return replied(job, () => NO_VERDICT);
          },
        },
        async (started) => {
          await idled(started);
          return falsificationEntries(started).map(({ reason }) => ({
            workspaceFirst:
              reason.includes(NAMED_EVENT.reason) &&
              reason.indexOf(NAMED_EVENT.reason) < reason.indexOf("A0 ("),
          }));
        },
      );
      expect(entries).toStrictEqual([{ workspaceFirst: true }]);
    });

    it("D4099: an entry names at most 20 of the definitions left without a verdict and counts the rest", async () => {
      const names = await falsifying(
        { ...NO_VERDICTS, tests: { a: 22 } },
        async (started) => {
          await idled(started);
          const reason = falsificationEntries(started)[0]?.reason ?? "";
          return {
            named: reason.match(/A\d+ \(/g)?.length,
            countsTheRest: reason.endsWith(" and 2 more"),
          };
        },
      );
      expect(names).toStrictEqual({ named: 20, countsTheRest: true });
    });

    it("D4100: an entry says what ends its definitions' wait before it names one, each with its reason, and holds no mutation text", async () => {
      const says = await falsifying(NO_VERDICTS, async (started) => {
        await idled(started);
        const reason = falsificationEntries(started)[0]?.reason ?? "";
        const name = reason.indexOf("A0 (");
        return {
          endsBeforeTheName: [
            "the input revision",
            "the definition",
            "the declared assertion error names",
          ].map((end) => reason.includes(end) && reason.indexOf(end) < name),
          namesItsReason: reason.includes(`A0 (${NO_VERDICT_REASON})`),
          holdsMutationText: reason.includes("return 0"),
        };
      });
      expect(says).toStrictEqual({
        endsBeforeTheName: [true, true, true],
        namesItsReason: true,
        holdsMutationText: false,
      });
    });

    it("D4101: the entry of definitions left without a verdict leaves the list once the input revision moves", async () => {
      const entries = await falsifying(NO_VERDICTS, async (started) => {
        await idled(started);
        const before = falsificationEntries(started).length;
        started.inputs.moveRevision();
        return { before, after: falsificationEntries(started).length };
      });
      expect(entries).toStrictEqual({ before: 1, after: 0 });
    });

    it("D4102: the entry of a workspace whose job did not run leaves the list once the input revision moves", async () => {
      const entries = await falsifying(
        { replies: () => replyOf(FAILED_TO_LOAD) },
        async (started) => {
          await idled(started);
          const before = falsificationEntries(started).length;
          started.inputs.moveRevision();
          return { before, after: falsificationEntries(started).length };
        },
      );
      expect(entries).toStrictEqual({ before: 1, after: 0 });
    });

    it("D4103: a summary carries a falsification entry marked as one", async () => {
      const jobs = await falsifying(NO_VERDICTS, async (started) => {
        await idled(started);
        const answer = started.lifecycle.summary();
        return "noAnswer" in answer
          ? answer
          : answer.unstoredJobs.map(({ workspacePath, kind }) => ({
              workspacePath,
              kind,
            }));
      });
      expect(jobs).toStrictEqual([
        { workspacePath: "a", kind: "falsification" },
      ]);
    });

    it("D4104: while a workspace is falsified, a summary reads its execution state idle beside the falsifying activity, and the job has stored no run and no discovery", async () => {
      const read = await falsifying(
        { replies: () => HELD },
        async (started) => {
          await sent(started, 1);
          const answer = started.lifecycle.summary();
          return "noAnswer" in answer
            ? answer
            : {
                activity: answer.activity.state,
                execution: answer.schedule.workspaces,
                runs: started.store.runs.length,
                discoveries: started.store.discoveries.length,
              };
        },
      );
      expect(read).toStrictEqual({
        activity: "falsifying",
        execution: [{ workspacePath: "a", state: "idle" }],
        runs: 1,
        discoveries: 1,
      });
    });
  },
);

describe(
  "what the log says of falsification",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4106: the log names a job as it starts: its workspace, the number of definitions, and the first definition's id and state", async () => {
      const entries = await falsifying({ tests: { a: 2 } }, async (started) => {
        await idled(started);
        return started.log.entries.filter((entry) =>
          entry.startsWith("falsification started"),
        );
      });
      expect(entries).toStrictEqual([
        "falsification started: a, definitions 2, first A0 (never-verified)",
      ]);
    });

    it("D4107: the log names a job as it ends: how it ended, the verdicts stored of each kind, each definition left without one with its reason, and its wall time", async () => {
      const entries = await falsifying(
        {
          tests: { a: 3 },
          replies: (job) =>
            replied(job, (id) =>
              id === "A0" ? detection() : id === "A1" ? SURVIVED : NO_VERDICT,
            ),
        },
        async (started) => {
          await idled(started);
          return started.log.entries
            .filter((entry) => entry.startsWith("falsification ended"))
            .map((entry) => entry.replace(/\d+ ms$/, "<n> ms"));
        },
      );
      expect(entries).toStrictEqual([
        `falsification ended: a, it ran to its end; verdicts stored: 1 detected, 1 survived; left without a verdict 1: A2 (${NO_VERDICT_REASON}); <n> ms`,
      ]);
    });

    it("D4109: a look that found definitions waiting and took none is logged once for each input revision, naming the revision", async () => {
      const logged = await falsifying(NO_VERDICTS, async (started) => {
        const noneTaken = (): string[] =>
          started.log.entries.filter((entry) =>
            entry.startsWith(
              "falsification: none of the waiting definitions is taken",
            ),
          );
        await idled(started);
        await afterPeriodicReconciliation(started);
        const atOneRevision = noneTaken();
        started.inputs.moveRevision();
        await idled(started, 2);
        return {
          atOneRevision: atOneRevision.map((entry) =>
            entry.includes("input revision 1"),
          ),
          afterAMove: noneTaken().length,
        };
      });
      expect(logged).toStrictEqual({ atOneRevision: [true], afterAMove: 2 });
    });

    it("D4158: the entry for a look that took none counts the definitions of a workspace that gets no further job apart from those given no further experiment", async () => {
      const entries = await falsifying(
        {
          tests: { a: 2, b: 1 },
          replies: (job) =>
            job.workspacePath === "a"
              ? replyOf(FAILED_TO_LOAD)
              : replied(job, () => NO_VERDICT),
        },
        async (started) => {
          await idled(started);
          return started.log.entries.filter((entry) =>
            entry.startsWith("falsification: "),
          );
        },
      );
      expect(entries).toStrictEqual([
        "falsification: none of the waiting definitions is taken at input revision 1: waiting 3, of which in a workspace that gets no further falsification job until the input revision changes 2, and given no further experiment at this revision 1",
      ]);
    });
  },
);

/** No reading, as a canary job whose executor's process died gives it. */
const NO_READING: CanaryReading = {
  status: CANARY_READING.none,
  kind: NO_READING_KIND.noReply,
  detail: EXECUTOR_DIED,
};
/** No reading, as a canary job an abort ended gives it. */
const INTERRUPTED_READING: CanaryReading = {
  status: CANARY_READING.none,
  kind: NO_READING_KIND.interrupted,
};
const DISAGREED_CANARY = "in-test-site";
/** A reading under `INSTALL` in which one canary read survived where unclear, as no assertion, is named for it. */
const DISAGREED: CanaryReading = {
  status: CANARY_READING.disagreed,
  vitestVersion: INSTALL.version,
  canaries: [
    {
      id: DISAGREED_CANARY,
      read: { verdict: "survived" },
      named: { verdict: "unclear", reason: "not-an-assertion" },
    },
  ],
};
/** More canaries than a reason names, each named at a length at which the ones it names pass what an answer keeps. */
const MANY_DISAGREED: CanaryReading = {
  status: CANARY_READING.disagreed,
  vitestVersion: INSTALL.version,
  canaries: indexes(24).map((index) => ({
    id: `a-canary-with-a-long-name-${index}`,
    read: { verdict: "unclear", reason: "not-an-assertion" },
    named: { verdict: "invalid-experiment", reason: "hook-not-passed" },
  })),
};
/** What a refused workspace's entry says ends its refusal. */
const ANOTHER_INSTALL_ENDS = "another Vitest install";
/** How the log begins the entry of a mark made for workspace `a`. */
const MARK_OF_A = "the falsification of a waits";
/** What a gate says of a workspace that resolves no supported Vitest, as a scripted gate hands it over. */
const NO_SUPPORTED_VITEST =
  "its job was not sent, since its workspace resolves no supported Vitest (Vitest 3.2.4, supported 4.1.x || 5.x): Vitest 3.2.4 is outside the supported range";

/** Until `count` canary jobs have been taken; whether they were. */
function canaryJobsTaken(gate: ScriptedGate, count = 1): Promise<boolean> {
  return reached(() => gate.canaryJobs.length >= count);
}

function marksOfA(started: Falsifying): number {
  return started.log.entries.filter((entry) => entry.startsWith(MARK_OF_A))
    .length;
}

function markedWorkspaces(started: Falsifying): (string | undefined)[] {
  return falsificationEntries(started).map(
    ({ workspacePath }) => workspacePath,
  );
}

/**
 * What a refusal's reason holds of what it has to say, and in what order: the Vitest version, the falsifier version,
 * the canary that disagreed with what it read and what is named for it, then what ends the refusal.
 */
function refusalSays(reason: string): unknown {
  const fragments = [
    `Vitest ${INSTALL.version}`,
    `falsifier version ${FALSIFIER_VERSION}`,
    DISAGREED_CANARY,
    "survived",
    "unclear",
    "not-an-assertion",
    ANOTHER_INSTALL_ENDS,
    "restart",
  ];
  const places = fragments.map((fragment) => reason.indexOf(fragment));
  return {
    missing: fragments.filter((_, index) => (places[index] ?? -1) < 0),
    inThatOrder: places.every(
      (place, index) => index === 0 || place > (places[index - 1] ?? -1),
    ),
    saysTheRevisionEndsIt: reason.includes(WORKSPACE_WAIT_ENDS),
  };
}

const WHOLE_REFUSAL = {
  missing: [],
  inThatOrder: true,
  saysTheRevisionEndsIt: false,
};

/** Inputs that run `atClose` once, as the next window on the tracker closes, as a change or a stop that lands then does. */
class ClosingInputs extends StandInInputs {
  atClose: (() => void) | undefined;

  override async endJob(
    mark: Parameters<StandInInputs["endJob"]>[0],
  ): Promise<JobVerdict> {
    const verdict = await super.endJob(mark);
    const { atClose } = this;
    this.atClose = undefined;
    atClose?.();
    return verdict;
  }
}

describe(
  "a falsification job waits for its install's canary reading",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4166: a workspace whose Vitest install is unread is sent no falsification job while the look's canary job runs, and its own job once the reading is confirmed", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const order = await falsifying({ gate }, async (started) => {
        await reached(
          () => gate.canaryJobs.length > 0 || started.executor.jobs.length > 0,
        );
        const whileReading = {
          canaryJobs: [...gate.canaryJobs],
          jobs: jobIds(started),
        };
        gate.end(confirmedReading(INSTALL));
        await idled(started);
        return {
          whileReading,
          after: { canaryJobs: [...gate.canaryJobs], jobs: jobIds(started) },
        };
      });
      expect(order).toStrictEqual({
        whileReading: { canaryJobs: ["a"], jobs: [] },
        after: { canaryJobs: ["a"], jobs: [["A0"]] },
      });
    });

    it("D4167: once a canary job has confirmed its install, the scheduler plans again, so the workspace's own job follows with no change of the inputs", async () => {
      const gate = new ScriptedGate();
      const outcome = await falsifying({ gate }, async (started) => ({
        idled: await idled(started),
        canaryJobs: [...gate.canaryJobs],
        jobs: jobIds(started),
      }));
      expect(outcome).toStrictEqual({
        idled: true,
        canaryJobs: ["a"],
        jobs: [["A0"]],
      });
    });

    it("D4168: no canary job is taken for a workspace the confirmed start no longer holds, though its install is unread", async () => {
      const gate = new ScriptedGate();
      const store = new RecordingStore();
      store.seedDiscovery(discovery(discoveredIn("a", [TEST_MODULE])), {
        kind: "digest",
        digest: DISCOVERY_DIGEST,
      });
      store.seedRun(ranWorkspace("a"), { kind: "digest", digest: "a-digest" });
      const outcome = await falsifying(
        { gate, store, start: confirmed() },
        async (started) => ({
          idled: await idled(started),
          canaryJobs: [...gate.canaryJobs],
          saysTheStartDoesNotHoldIt: falsificationEntries(started).map(
            ({ reason }) =>
              reason.includes(
                "the confirmed start does not hold the workspace",
              ),
          ),
        }),
      );
      expect(outcome).toStrictEqual({
        idled: true,
        canaryJobs: [],
        saysTheStartDoesNotHoldIt: [true],
      });
    });

    it("D4169: a change of the input revision that lands while a look closes its window leaves that look without a canary job, so the one taken is planned at the new revision and marks there", async () => {
      const inputs = new ClosingInputs();
      const armed = { once: false };
      const gate = new ScriptedGate({
        resolves: () => {
          if (!armed.once) inputs.atClose = () => inputs.moveRevision();
          armed.once = true;
          return INSTALL;
        },
        readings: (call) =>
          call === 0 ? NO_READING : confirmedReading(INSTALL),
      });
      const outcome = await falsifying({ gate, inputs }, async (started) => ({
        idled: await idled(started),
        canaryJobs: [...gate.canaryJobs],
        marked: markedWorkspaces(started),
      }));
      expect(outcome).toStrictEqual({
        idled: true,
        canaryJobs: ["a"],
        marked: ["a"],
      });
    });

    it("D4170: a stop that lands while a look closes its window leaves that look without a canary job", async () => {
      const inputs = new ClosingInputs();
      const stop: { now?: () => void } = {};
      const gate = new ScriptedGate({
        resolves: () => {
          inputs.atClose = stop.now;
          return INSTALL;
        },
      });
      const outcome = await falsifying({ gate, inputs }, async (started) => {
        stop.now = () => started.lifecycle.stop();
        const asked = await reached(() => gate.asked.length > 0);
        await started.lifecycle.stopped();
        return { asked, canaryJobs: [...gate.canaryJobs] };
      });
      expect(outcome).toStrictEqual({ asked: true, canaryJobs: [] });
    });
  },
);

describe(
  "a workspace whose install's canary reading disagreed",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4171: a refused workspace is sent no falsification job at that input revision or the next, where it is marked again from the kept reading with no canary job, while a workspace on a confirmed install is falsified", async () => {
      const gate = new ScriptedGate({
        resolves: (path) => (path === "a" ? INSTALL : OTHER_INSTALL),
        readings: (call) =>
          call === 0 ? DISAGREED : confirmedReading(OTHER_INSTALL),
      });
      const outcome = await falsifying(
        { tests: { a: 1, b: 1 }, gate },
        async (started) => {
          await idled(started);
          const marked = markedWorkspaces(started);
          started.inputs.moveRevision();
          const onceTheRevisionMoved = markedWorkspaces(started);
          await idled(started, 2);
          return {
            canaryJobs: [...gate.canaryJobs],
            jobs: started.executor.jobs.map((job) => ({
              workspacePath: job.workspacePath,
              ids: job.experiments.map(({ defectId }) => defectId),
            })),
            stored: storedVerdicts(started),
            marked,
            onceTheRevisionMoved,
            atTheNextLook: markedWorkspaces(started),
          };
        },
      );
      expect(outcome).toStrictEqual({
        canaryJobs: ["a", "b"],
        jobs: [{ workspacePath: "b", ids: ["B0"] }],
        stored: { B0: "detected" },
        marked: ["a"],
        onceTheRevisionMoved: [],
        atTheNextLook: ["a"],
      });
    });

    it("D4172: the reason of a workspace the look refused on its own canary job names the Vitest version, the falsifier version and the canary with what it read and what is named, then what ends the refusal, which no change of the input revision does", async () => {
      const gate = new ScriptedGate({ readings: () => DISAGREED });
      const says = await falsifying({ gate }, async (started) => {
        await idled(started);
        return refusalSays(falsificationEntries(started)[0]?.reason ?? "");
      });
      expect(says).toStrictEqual(WHOLE_REFUSAL);
    });

    it("D4173: at a later input revision, the reason made from the kept reading still says what ends the refusal, and not that a change of the input revision does", async () => {
      const gate = new ScriptedGate({ readings: () => DISAGREED });
      const says = await falsifying({ gate }, async (started) => {
        await idled(started);
        started.inputs.moveRevision();
        await idled(started, 2);
        return refusalSays(falsificationEntries(started)[0]?.reason ?? "");
      });
      expect(says).toStrictEqual(WHOLE_REFUSAL);
    });

    it("D4174: a refusal that names more canaries than an answer keeps leaves what ends it inside the 1,000 characters of the answer, on one line, and says how much more the log holds", async () => {
      const gate = new ScriptedGate({ readings: () => MANY_DISAGREED });
      const says = await falsifying({ gate }, async (started) => {
        await idled(started);
        const answer = started.lifecycle.summary();
        const jobs = "noAnswer" in answer ? [] : answer.unstoredJobs;
        const text =
          jobs.find((job) => job.kind === "falsification")?.reason ?? "";
        return {
          lines: text.split("\n").length,
          namesTheFirstCanary: text.includes("a-canary-with-a-long-name-0 ("),
          saysTheLogHoldsMore: text.includes(
            "more characters are in the daemon log)",
          ),
          refusalEndsBy:
            text.includes(ANOTHER_INSTALL_ENDS) &&
            text.indexOf(ANOTHER_INSTALL_ENDS) + ANOTHER_INSTALL_ENDS.length <=
              1000,
        };
      });
      expect(says).toStrictEqual({
        lines: 1,
        namesTheFirstCanary: true,
        saysTheLogHoldsMore: true,
        refusalEndsBy: true,
      });
    });

    it("D4175: a canary job that a change of the input revision ended marks no workspace at the revision that passed, and the canaries run again at the new one", async () => {
      const gate = new ScriptedGate({
        readings: (call) => (call === 0 ? HELD : confirmedReading(INSTALL)),
      });
      const outcome = await falsifying({ gate }, async (started) => {
        await canaryJobsTaken(gate);
        started.inputs.moveRevision();
        await flush();
        gate.end(NO_READING);
        await idled(started);
        return {
          marks: marksOfA(started),
          canaryJobs: [...gate.canaryJobs],
          jobs: jobIds(started),
        };
      });
      expect(outcome).toStrictEqual({
        marks: 0,
        canaryJobs: ["a", "a"],
        jobs: [["A0"]],
      });
    });

    it("D4176: a canary job that a stop ended marks no workspace", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const outcome = await falsifying({ gate }, async (started) => {
        const taken = await canaryJobsTaken(gate);
        started.lifecycle.stop();
        gate.end(NO_READING);
        await started.lifecycle.stopped();
        return { taken, entries: falsificationEntries(started) };
      });
      expect(outcome).toStrictEqual({ taken: true, entries: [] });
    });
  },
);

describe(
  "a canary job that gave no reading, and a workspace with no supported Vitest",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4177: a workspace whose canary job gave no reading is sent no job and marked until the input revision changes, its entry naming the Vitest version and what happened, and the canaries run again at the next revision", async () => {
      const gate = new ScriptedGate({ readings: () => NO_READING });
      const outcome = await falsifying({ gate }, async (started) => {
        await reached(
          () =>
            started.log.entries.includes(IDLE_ENTRY) ||
            gate.canaryJobs.length > 1,
        );
        const atOneRevision = gate.canaryJobs.length;
        const [entry] = falsificationEntries(started);
        started.inputs.moveRevision();
        await canaryJobsTaken(gate, atOneRevision + 1);
        return {
          canaryJobsAtOneRevision: atOneRevision,
          jobs: started.executor.jobs.length,
          workspacePath: entry?.workspacePath,
          kind: entry?.kind,
          missing: [
            `Vitest ${INSTALL.version}`,
            EXECUTOR_DIED,
            WORKSPACE_WAIT_ENDS,
          ].filter((fragment) => entry?.reason.includes(fragment) !== true),
          canaryJobsOnceTheRevisionMoved: gate.canaryJobs.length,
        };
      });
      expect(outcome).toStrictEqual({
        canaryJobsAtOneRevision: 1,
        jobs: 0,
        workspacePath: "a",
        kind: "falsification",
        missing: [],
        canaryJobsOnceTheRevisionMoved: 2,
      });
    });

    it("D4178: a workspace that resolves no supported Vitest is sent no job and taken no canary job, and its entry holds what the gate said and that a change of the input revision ends the wait", async () => {
      const gate = new ScriptedGate({ resolves: () => NO_SUPPORTED_VITEST });
      const outcome = await falsifying({ gate }, async (started) => {
        const idledOnce = await idled(started);
        const [entry] = falsificationEntries(started);
        return {
          idled: idledOnce,
          canaryJobs: [...gate.canaryJobs],
          jobs: started.executor.jobs.length,
          workspacePath: entry?.workspacePath,
          kind: entry?.kind,
          missing: [NO_SUPPORTED_VITEST, WORKSPACE_WAIT_ENDS].filter(
            (fragment) => entry?.reason.includes(fragment) !== true,
          ),
        };
      });
      expect(outcome).toStrictEqual({
        idled: true,
        canaryJobs: [],
        jobs: 0,
        workspacePath: "a",
        kind: "falsification",
        missing: [],
      });
    });

    it("D4179: a change of the input revision while a canary job runs aborts the job as an interruption", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const outcome = await falsifying({ gate }, async (started) => {
        const taken = await canaryJobsTaken(gate);
        started.inputs.moveRevision();
        await flush();
        return { taken, purposes: [...started.executor.purposes] };
      });
      expect(outcome).toStrictEqual({
        taken: true,
        purposes: [ABORT_PURPOSE.interruption],
      });
    });

    it("D4180: a canary job the time bound ended that gave no reading marks its workspace in the bound's words, with what happened and what ends the wait", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const outcome = await underFakeClock(() =>
        falsifying({ gate }, async (started) => {
          await canaryJobsTaken(gate);
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          const purposes = [...started.executor.purposes];
          gate.end(NO_READING);
          await idled(started);
          const [entry] = falsificationEntries(started);
          return {
            purposes,
            canaryJobs: gate.canaryJobs.length,
            missing: ["time bound", EXECUTOR_DIED, WORKSPACE_WAIT_ENDS].filter(
              (fragment) => entry?.reason.includes(fragment) !== true,
            ),
          };
        }),
      );
      expect(outcome).toStrictEqual({
        purposes: [ABORT_PURPOSE.interruption],
        canaryJobs: 1,
        missing: [],
      });
    });

    it("D4181: once a canary job has returned, its time bound aborts nothing, whatever job follows it", async () => {
      const gate = new ScriptedGate();
      const outcome = await underFakeClock(() =>
        falsifying({ gate }, async (started) => {
          const idledOnce = await idled(started);
          await vi.advanceTimersByTimeAsync(JOB_TIME_BOUND_MS);
          return {
            idled: idledOnce,
            canaryJobs: [...gate.canaryJobs],
            jobs: jobIds(started),
            aborts: started.executor.aborts,
          };
        }),
      );
      expect(outcome).toStrictEqual({
        idled: true,
        canaryJobs: ["a"],
        jobs: [["A0"]],
        aborts: 0,
      });
    });
  },
);

describe(
  "what the tracker, status and answers hold of a canary job",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4182: while a canary job runs, no window is open on the tracker, so a change it records then is an edit as one in idle time is", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const windows = await falsifying({ gate }, async (started) => {
        const taken = await canaryJobsTaken(gate);
        return {
          taken,
          open: started.inputs.jobsBegun - started.inputs.jobsEnded,
        };
      });
      expect(windows).toStrictEqual({ taken: true, open: 0 });
    });

    it("D4183: while a canary job runs, the activity reads falsifying, with the workspace the look picked and 0 definitions, however many the workspace has waiting", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const activity = await falsifying(
        { tests: { a: 2 }, gate },
        async (started) => {
          await canaryJobsTaken(gate);
          return started.lifecycle.status().activity;
        },
      );
      expect(activity).toStrictEqual({
        state: "falsifying",
        workspacePath: "a",
        definitions: 0,
      });
    });

    it("D4184: while a canary job runs, a summary reads the activity falsifying beside its workspace's execution state idle, and the job has stored no run, no discovery and no evidence", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const read = await falsifying({ gate }, async (started) => {
        await canaryJobsTaken(gate);
        const answer = started.lifecycle.summary();
        return "noAnswer" in answer
          ? answer
          : {
              activity: answer.activity.state,
              execution: answer.schedule.workspaces,
              runs: started.store.runs.length,
              discoveries: started.store.discoveries.length,
              evidenceWrites: started.store.evidenceWrites.length,
            };
      });
      expect(read).toStrictEqual({
        activity: "falsifying",
        execution: [{ workspacePath: "a", state: "idle" }],
        runs: 1,
        discoveries: 1,
        evidenceWrites: 0,
      });
    });
  },
);

/** How many jobs the log names as started falsification jobs. */
function startEntries(started: Falsifying): number {
  return started.log.entries.filter((entry) =>
    entry.startsWith("falsification started"),
  ).length;
}

describe(
  "what an entry and the log say of a workspace the gate left waiting",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4201: a canary job that gave no reading while no time bound was reached is marked with what happened, and not in the bound's words", async () => {
      const gate = new ScriptedGate({ readings: () => NO_READING });
      const says = await falsifying({ gate }, async (started) => {
        await idled(started);
        const reason = falsificationEntries(started)[0]?.reason ?? "";
        return {
          whatHappened: reason.includes(EXECUTOR_DIED),
          theBound: reason.includes("time bound"),
        };
      });
      expect(says).toStrictEqual({ whatHappened: true, theBound: false });
    });

    it("D4202: the log's entry for a refused workspace's mark says what ends the refusal, and not that a change of the input revision does", async () => {
      const gate = new ScriptedGate({ readings: () => DISAGREED });
      const logged = await falsifying({ gate }, async (started) => {
        await idled(started);
        return started.log.entries
          .filter((entry) => entry.startsWith(MARK_OF_A))
          .map((entry) => ({
            saysWhatEndsTheRefusal: entry.includes(ANOTHER_INSTALL_ENDS),
            saysTheRevisionEndsIt: entry.includes(WORKSPACE_WAIT_ENDS),
          }));
      });
      expect(logged).toStrictEqual([
        { saysWhatEndsTheRefusal: true, saysTheRevisionEndsIt: false },
      ]);
    });

    it("D4204: the log names no falsification job as started for a workspace while its canary job runs, once the look refused it, or when a later look refuses it from the kept reading", async () => {
      const gate = new ScriptedGate({ readings: () => HELD });
      const outcome = await falsifying({ gate }, async (started) => {
        const taken = await canaryJobsTaken(gate);
        const whileTheCanariesRun = startEntries(started);
        gate.end(DISAGREED);
        await idled(started);
        const onceRefused = startEntries(started);
        started.inputs.moveRevision();
        await idled(started, 2);
        return {
          taken,
          whileTheCanariesRun,
          onceRefused,
          refusedAgainAtTheNextRevision: startEntries(started),
          jobs: started.executor.jobs.length,
        };
      });
      expect(outcome).toStrictEqual({
        taken: true,
        whileTheCanariesRun: 0,
        onceRefused: 0,
        refusedAgainAtTheNextRevision: 0,
        jobs: 0,
      });
    });
  },
);

interface ListingReports {
  /** What the discovery's job reports of each confirmed workspace's collection. */
  readonly collection?: readonly WorkspaceCollection[];
  /** The test lists each run's job reports beside its run. */
  readonly lists?: readonly ModuleTests[];
}

/**
 * A scripted executor that records the lists each discovery was handed, and reports a collection beside its discovery
 * and test lists beside each run, as the executor process does.
 */
class ListingExecutor extends ScriptedExecutor {
  readonly carried: (readonly WorkspaceLists[])[] = [];
  readonly #reports: ListingReports;

  constructor(
    found: TestDiscovery,
    ran: (path: string) => WorkspaceRun,
    reports: ListingReports = {},
  ) {
    super({ ended: true, value: found }, (path) => ({
      ended: true,
      value: ran(path),
    }));
    this.#reports = reports;
  }

  override async discover(
    _start?: ConfirmedStart,
    carried: readonly WorkspaceLists[] = [],
  ): Promise<DiscoverOutcome> {
    this.carried.push(carried);
    const outcome = await super.discover();
    const { collection } = this.#reports;
    return outcome.ended && collection !== undefined
      ? { ...outcome, collection }
      : outcome;
  }

  override async run(workspace: VitestWorkspace): Promise<ListedRunOutcome> {
    const outcome = await super.run(workspace);
    const { lists } = this.#reports;
    return outcome.ended && lists !== undefined
      ? { ...outcome, lists }
      : outcome;
  }
}

const LISTED_MODULE = "a.test.ts";

/** One test of workspace `a`'s listed module, as a discovery lists it. */
function listedTest(name: string): ModuleTests["tests"][number] {
  return {
    identity: {
      workspacePath: "a",
      projectName: "unit",
      modulePath: LISTED_MODULE,
      namePath: [name],
      occurrence: 0,
    },
    isDuplicate: false,
    mode: "run",
  };
}

/** The list `ranWorkspace` records for workspace `a`, as a run's job reports it. */
const RUN_LISTS: readonly ModuleTests[] = [
  { projectName: "unit", modulePath: LISTED_MODULE, tests: [listedTest("t0")] },
];
const REFRESH_FAILURE = "database is locked";

/** A recording store that reads back the discovery written last, as the store does. */
class ReadingBackStore extends RecordingStore {
  override readLatestDiscovery(): StoredDiscovery | undefined {
    return this.readLatestResults(SCOPE).discovery;
  }
}

/** A store whose write of any discovery after its first throws, as a locked database would. */
class RefreshFailingStore extends ReadingBackStore {
  override writeDiscovery(
    bindings: StoreBindings,
    written: TestDiscovery,
  ): StoredDiscovery {
    if (this.discoveries.length > 0) throw new Error(REFRESH_FAILURE);
    return super.writeDiscovery(bindings, written);
  }
}

/** An executor whose discovery lists the test `counts` in `a`'s module, and whose run of `a` records and lists `t0` there. */
function differingRunLists(): ListingExecutor {
  return new ListingExecutor(
    discovery(discoveredWithTest("a")),
    (path) => ranWorkspace(path),
    { lists: RUN_LISTS },
  );
}

/** Runs a daemon over `a` whose run's lists differ from its discovery's to the end of its start sequence, then stops it. */
async function afterDifferingRunLists(
  store: RecordingStore = new ReadingBackStore(),
): Promise<Daemon> {
  const started = await begun(
    daemon(confirmed("a"), differingRunLists(), store),
  );
  return thenStopped(started, () => Promise.resolve(started));
}

/** The log's entry for each workspace's collection, after a discovery whose job reported two workspaces. */
async function collectionEntries(): Promise<string[]> {
  const failed: WorkspaceDiscovery = {
    status: "failed",
    workspace: workspace("b"),
    vitestVersion: DISCOVERED_VITEST_VERSION,
    error: "config boom",
  };
  const executor = new ListingExecutor(
    discovery(discovered("a"), failed),
    (path) => ranWorkspace(path),
    {
      collection: [
        {
          workspacePath: "a",
          status: "discovered",
          listed: 3,
          collected: 1,
          carried: 2,
          wallMs: 12,
        },
        {
          workspacePath: "b",
          status: "failed",
          listed: 0,
          collected: 0,
          carried: 0,
          wallMs: 7,
        },
      ],
    },
  );
  const started = await begun(daemon(confirmed("a", "b"), executor));
  return thenStopped(started, () =>
    Promise.resolve(
      started.log.entries.filter((entry) => entry.startsWith("discovery of ")),
    ),
  );
}

describe("a rediscovery's carried lists and a run's own lists", () => {
  it("D4327: a rediscovery is handed the list a stored run vouches for, read from the store's latest results", async () => {
    const listed = discoveredWithTest("a");
    const store = new RecordingStore();
    // Stored under an earlier fingerprint, so the discovery is due and the daemon discovers again.
    store.seedDiscovery(discovery(listed), digestOf("an-earlier-digest"));
    store.seedRun(ranAsListed(listed), digestOf("a-digest"));
    const executor = new ListingExecutor(discovery(listed), (path) =>
      ranWorkspace(path),
    );
    const started = await begun(daemon(confirmed("a"), executor, store));
    await thenStopped(started, () => Promise.resolve());
    expect(executor.carried[0]).toStrictEqual([
      {
        workspacePath: "a",
        modules: [
          {
            projectName: "unit",
            modulePath: LISTED_MODULE,
            tests: [listedTest("counts")],
          },
        ],
      },
    ]);
  });

  it("D4328: a stored run whose lists differ from the discovery's stores the discovery again with the run's lists, under the fingerprint it was stored under", async () => {
    const { store } = await afterDifferingRunLists();
    const [entry] = store.discoveries.at(-1)?.workspaces ?? [];
    expect({
      discoveries: store.discoveries.length,
      listed:
        entry?.status === "discovered"
          ? entry.tests.map((test) => test.identity.namePath)
          : entry,
      fingerprints: store.discoveryFingerprints,
    }).toStrictEqual({
      discoveries: 2,
      listed: [["t0"]],
      fingerprints: [digestOf(DISCOVERY_DIGEST), digestOf(DISCOVERY_DIGEST)],
    });
  });

  it("D4329: the log says how many test modules a run's lists replaced in the discovery", async () => {
    const { log } = await afterDifferingRunLists();
    expect(
      log.entries.filter((entry) => entry.includes("stored again")),
    ).toStrictEqual([
      "the run of a collected 1 test modules whose tests differ from the discovery's, so the discovery is stored again with the run's lists",
    ]);
  });

  it("D4330: a discovery that cannot be stored again with a run's lists is logged, and the run stays stored with its job listed as one that stored", async () => {
    const started = await afterDifferingRunLists(new RefreshFailingStore());
    expect({
      runs: started.store.runs.length,
      unstored: started.lifecycle.status().unstoredJobs,
      logged: started.log.entries.filter((entry) =>
        entry.startsWith("error: storing the discovery with the test lists"),
      ),
    }).toStrictEqual({
      runs: 1,
      unstored: [],
      logged: [
        `error: storing the discovery with the test lists of the run of a: Error: ${REFRESH_FAILURE}`,
      ],
    });
  });

  it("D4332: the log gives a discovered workspace's line with its test modules listed, collected and carried, and its time", async () => {
    const entries = await collectionEntries();
    expect(
      entries.filter((entry) => entry.startsWith("discovery of a:")),
    ).toStrictEqual([
      "discovery of a: 3 test modules listed, 1 collected, 2 carried, in 12 ms",
    ]);
  });

  it("D4333: the log gives a workspace that was not discovered its line with how it ended and its time", async () => {
    const entries = await collectionEntries();
    expect(
      entries.filter((entry) => entry.startsWith("discovery of b:")),
    ).toStrictEqual(["discovery of b: failed, in 7 ms"]);
  });
});
