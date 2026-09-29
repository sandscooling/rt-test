import {
  mkdirSync,
  realpathSync,
  utimesSync,
  watch,
  writeFileSync,
  type PathLike,
  type WatchListener,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DependencyBuilds } from "../src/daemon/dependency-builds.js";
import type { Executor, JobOutcome } from "../src/daemon/executor.js";
import { DaemonLifecycle } from "../src/daemon/lifecycle.js";
import type { DaemonIdentity } from "../src/daemon/protocol.js";
import {
  ProjectInputs,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import {
  JobWindows,
  type JobMark,
  type JobVerdict,
} from "../src/inputs/input-jobs.js";
import {
  InputTracker,
  type CurrentInputs,
  type TrackedInputs,
} from "../src/inputs/input-tracker.js";
import {
  NARROWING,
  narrowingAt,
  type QueryNarrowing,
  type WorkspaceNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import {
  NON_INPUTS_ABSENT,
  NON_INPUTS_FILE,
  type NonInputsDeclaration,
} from "../src/inputs/non-inputs.js";
import type { InputFacts } from "../src/query/answer.js";
import type {
  DependencyInformation,
  SelectableWorkspace,
} from "../src/selection/selection-types.js";
import {
  openStore,
  type LatestResults,
  type RtTestStore,
} from "../src/store/open-store.js";
import type {
  StoreBindings,
  StoredDiscovery,
  StoredRun,
  StoreScope,
} from "../src/store/stored-records.js";
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
import { inTempDir, settle } from "./harness.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, watch: vi.fn<typeof actual.watch>(actual.watch) };
});

const { watch: realWatch } =
  await vi.importActual<typeof import("node:fs")>("node:fs");

const SCOPE: StoreScope = {
  projectIdentity: "/consumer/.git",
  worktreeIdentity: "/consumer",
};
const IDENTITY: DaemonIdentity = {
  pid: 4242,
  consumerRoot: "/consumer",
  ...SCOPE,
  stateDirectory: "/consumer/.rt-test",
  logFile: "/consumer/.rt-test/daemon.log",
  protocolVersion: 1,
};
/** Enough event-loop turns for a sequence whose jobs have all settled to reach its end. */
const FLUSH_TURNS = 20;
const CONFIG_NOT_CONFIRMED =
  "its config file is no longer the one confirmed at start";
const DISCOVERY_DIGEST = "discovery-digest";
/** A declared file written after an edit; once the tracker has handled its event, it has handled the edit's. */
const SENTINEL = "z.md";
const RECONCILIATION_ENDED = "input reconciliation ended";
const FINGERPRINTED: JobVerdict = { fingerprinted: true };
/** Why the tracker cannot vouch for its inputs, as it says while its watcher has failed. */
const WATCHER_FAILED = "the watcher failed: ENOSPC";
const SETTLED_INPUTS: InputFacts = {
  revision: 1,
  reconciliation: { state: "complete" },
  lastReconciledAt: "2026-09-27T12:00:00.000Z",
  watcher: { state: "healthy" },
  pendingChanges: 0,
  gitUnread: [],
};

function workspace(path: string): VitestWorkspace {
  return { path, directory: `/consumer/${path}` };
}

/**
 * The confirmed start's root, a name under the temp directory no test creates, so each build over it fails before its
 * job begins, whatever the host holds at `/consumer`.
 */
const ABSENT_ROOT = join(tmpdir(), `rt-test-absent-root-${randomUUID()}`);

function confirmed(...paths: readonly string[]): ConfirmedStart {
  return {
    consumerRoot: ABSENT_ROOT,
    workspaces: paths.map((path) => ({
      path,
      configFile: `${path}/vitest.config.mjs`,
    })),
  };
}

function discovered(
  path: string,
): Extract<WorkspaceDiscovery, { status: "discovered" }> {
  return {
    status: "discovered",
    workspace: workspace(path),
    vitestVersion: "5.0.1",
    tests: [],
    failedModules: [],
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
    selectionFacts: { reported: true, projects: [] },
  };
}

/** A discovered workspace holding one test, so a query has something to count. */
function discoveredWithTest(path: string): WorkspaceDiscovery {
  return {
    ...discovered(path),
    tests: [
      {
        identity: {
          workspacePath: path,
          projectName: "unit",
          modulePath: "a.test.ts",
          namePath: ["counts"],
          occurrence: 0,
        },
        isDuplicate: false,
        mode: "run",
      },
    ],
  };
}

function discovery(...entries: readonly WorkspaceDiscovery[]): TestDiscovery {
  return { workspaces: entries, notRead: [] };
}

function interrupted(path: string): WorkspaceRun {
  return { status: "interrupted-before-load", workspace: workspace(path) };
}

class Deferred<T> {
  resolve: (value: T) => void = () => undefined;
  readonly promise = new Promise<T>((resolve) => {
    this.resolve = resolve;
  });
}

type RunOutcome = JobOutcome<WorkspaceRun | NotConfirmedRun>;

/** An executor that answers each job from a script, and records the jobs it was given. */
class ScriptedExecutor implements Pick<
  Executor,
  "discover" | "run" | "abort" | "close"
> {
  readonly runs: string[] = [];
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

  abort(): void {
    this.aborts += 1;
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

  abort(): void {
    this.aborts += 1;
    this.#aborted.resolve({ ended: false, reason: BUILD_ABORTED });
    this.#aborted = new Deferred<BuildOutcome>();
  }

  close(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }
}

/** A store that records what was written to it, and refuses a write once closed, as a closed store does. */
class RecordingStore implements RtTestStore {
  readonly file = "/consumer/.rt-test/store.sqlite";
  readonly runs: WorkspaceRun[] = [];
  readonly discoveries: TestDiscovery[] = [];
  /** The fingerprint each run and each discovery was written under, in the order written. */
  readonly runFingerprints: StoreBindings["inputFingerprint"][] = [];
  readonly discoveryFingerprints: StoreBindings["inputFingerprint"][] = [];
  closed = false;
  readonly #failingRuns: ReadonlySet<string>;

  constructor(failingRuns: readonly string[] = []) {
    this.#failingRuns = new Set(failingRuns);
  }

  writeRun(bindings: StoreBindings, run: WorkspaceRun): StoredRun {
    if (this.closed) throw new Error("the store is closed");
    if (this.#failingRuns.has(run.workspace.path)) {
      throw new Error("database is locked");
    }
    this.runs.push(run);
    this.runFingerprints.push(bindings.inputFingerprint);
    return { ...bindings, adapterVersion: 3, runId: "run", run };
  }

  writeDiscovery(
    bindings: StoreBindings,
    written: TestDiscovery,
  ): StoredDiscovery {
    if (this.closed) throw new Error("the store is closed");
    this.discoveries.push(written);
    this.discoveryFingerprints.push(bindings.inputFingerprint);
    return {
      ...bindings,
      adapterVersion: 3,
      discoveryId: "discovery",
      discovery: written,
    };
  }

  readRuns(): StoredRun[] {
    return [];
  }

  readRun(): StoredRun | undefined {
    return undefined;
  }

  readLatestDiscovery(): StoredDiscovery | undefined {
    return undefined;
  }

  /** The discovery written last, and the run written last for each workspace. */
  readLatestResults(scope: StoreScope): LatestResults {
    const bindings: StoreBindings = {
      ...scope,
      inputFingerprint: { kind: "not-fingerprinted" },
    };
    const discovery = this.discoveries.at(-1);
    const latest = new Map(this.runs.map((run) => [run.workspace.path, run]));
    return {
      discovery:
        discovery === undefined
          ? undefined
          : {
              ...bindings,
              adapterVersion: 3,
              discoveryId: "discovery",
              discovery,
            },
      latestRuns: [...latest.values()].map((run) => ({
        ...bindings,
        adapterVersion: 3,
        runId: `run-${run.workspace.path}`,
        run,
      })),
    };
  }

  close(): void {
    this.closed = true;
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

interface InputsScript {
  /** Keeps the first reconciliation running until the test resolves `reconciled`. */
  readonly heldReconciliation?: boolean;
  /** Keeps every job's end waiting on the inputs until the inputs stop. */
  readonly heldJobEnds?: boolean;
  /**
   * Each job's verdict, in the order the jobs end: the discovery, the guard around its protection, then each run. A
   * job past the list is fingerprinted.
   */
  readonly verdicts?: readonly JobVerdict[];
  /**
   * A workspace's current fingerprint, asked at its run's start and again at its end, given the narrowing the view
   * was asked for.
   */
  readonly fingerprintOf?: (
    workspacePath: string,
    narrowing: QueryNarrowing | undefined,
  ) => FingerprintResult;
  /** Why the tracker cannot vouch for its inputs; undefined while it can. */
  readonly unavailable?: string;
  /** Why a file the discovery protects by path, which no watch covers, may have changed during the discovery. */
  readonly moduleChanged?: string | undefined;
  /** Why a file only protection's walk found may have changed during the discovery, which protection resolves with. */
  readonly walkChanged?: string;
  /**
   * Holds one wait for the inputs to settle, counted from 0 in call order (the discovery's, the guard's, then each
   * run's), until the test resolves `settleHeld` or the inputs stop.
   */
  readonly heldSettle?: number;
  /** Makes each wait for the inputs to settle reject with this text, once its hold, if any, is released. */
  readonly settleFails?: string;
  /** Makes each ask for the next change of the inputs throw this text, as only the dependency builds ask. */
  readonly changedFails?: string;
}

const NO_DECLARATION: NonInputsDeclaration = {
  file: NON_INPUTS_FILE,
  state: NON_INPUTS_ABSENT,
};

/**
 * Inputs whose reconciliation, fingerprints and job verdicts the test scripts, recording each start and stop. The
 * revision moves only when the test moves it, and `changed()` resolves only then or at the stop.
 */
class StandInInputs implements TrackedInputs {
  starts = 0;
  stops = 0;
  jobsBegun = 0;
  jobsEnded = 0;
  revision = SETTLED_INPUTS.revision;
  #changeWaiters: (() => void)[] = [];
  #stopped = false;
  /** The discovery each protection was given, in call order. */
  readonly protected: (TestDiscovery | undefined)[] = [];
  /** The job start each protection was given, in call order. */
  readonly jobStarts: (number | undefined)[] = [];
  /** The narrowing each view of the inputs was asked for, in call order. */
  readonly narrowings: (QueryNarrowing | undefined)[] = [];
  readonly reconciled = new Deferred<void>();
  readonly settleHeld = new Deferred<void>();
  readonly #released = new Deferred<void>();
  readonly #script: InputsScript;
  readonly #verdicts: JobVerdict[];
  #settles = 0;

  constructor(script: InputsScript = {}) {
    this.#script = script;
    this.#verdicts = [...(script.verdicts ?? [])];
  }

  start(): void {
    this.starts += 1;
    if (this.#script.heldReconciliation !== true) this.reconciled.resolve();
  }

  firstReconciled(): Promise<void> {
    return this.reconciled.promise;
  }

  current(narrowing?: QueryNarrowing): CurrentInputs {
    this.narrowings.push(narrowing);
    const fingerprintOf =
      this.#script.fingerprintOf ??
      ((path: string): FingerprintResult => ({
        ok: true,
        digest: `${path}-digest`,
      }));
    const { unavailable } = this.#script;
    return {
      facts: { ...SETTLED_INPUTS, revision: this.revision },
      ...(unavailable === undefined ? {} : { unavailable }),
      workspaceFingerprint: (entry) =>
        fingerprintOf(entry.workspace.path, narrowing),
      discoveryFingerprint: () => ({ ok: true, digest: DISCOVERY_DIGEST }),
      protectedFileChangedSince: () => this.#script.moduleChanged,
    };
  }

  changed(): Promise<void> {
    if (this.#script.changedFails !== undefined) {
      throw new Error(this.#script.changedFails);
    }
    if (this.#stopped) return Promise.resolve();
    return new Promise((resolve) => this.#changeWaiters.push(resolve));
  }

  /** Moves the revision, as a read that changed an input does, and signals the change. */
  moveRevision(): void {
    this.revision += 1;
    this.#signalChange();
  }

  nonInputsDeclaration(): NonInputsDeclaration {
    return NO_DECLARATION;
  }

  #signalChange(): void {
    const waiting = this.#changeWaiters;
    this.#changeWaiters = [];
    for (const resolve of waiting) resolve();
  }

  settled(): Promise<void> {
    const call = this.#settles;
    this.#settles += 1;
    const held =
      call === this.#script.heldSettle
        ? this.settleHeld.promise
        : Promise.resolve();
    const { settleFails } = this.#script;
    if (settleFails === undefined) return held;
    return held.then(() => {
      throw new Error(settleFails);
    });
  }

  beginJob(): JobMark {
    this.jobsBegun += 1;
    return new JobWindows().open(undefined);
  }

  async endJob(): Promise<JobVerdict> {
    this.jobsEnded += 1;
    if (this.#script.heldJobEnds === true) await this.#released.promise;
    return this.#verdicts.shift() ?? FINGERPRINTED;
  }

  protectInputs(
    discovery: TestDiscovery | undefined,
    jobStart?: number,
  ): Promise<string | undefined> {
    this.protected.push(discovery);
    this.jobStarts.push(jobStart);
    return Promise.resolve(this.#script.walkChanged);
  }

  stop(): Promise<void> {
    this.stops += 1;
    this.#stopped = true;
    this.#signalChange();
    this.#released.resolve();
    this.reconciled.resolve();
    this.settleHeld.resolve();
    return Promise.resolve();
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

/** A daemon over one confirmed workspace `a`, discovered and run once, with inputs the test scripts. */
function scripted(script: InputsScript): Daemon {
  const executor = new ScriptedExecutor({
    ended: true,
    value: discovery(discovered("a")),
  });
  return daemon(
    confirmed("a"),
    executor,
    new RecordingStore(),
    IDENTITY,
    new StandInInputs(script),
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
  readonly storedFingerprint: string | undefined;
}

/**
 * Runs the start sequence to idle with a real input tracker and store, over a consumer whose `rt-test.json` declares
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
    }),
    closeEndpoint: () => Promise.resolve(),
  });
  try {
    lifecycle.begin();
    const idle = await eventually(() => log.entries.includes(IDLE_ENTRY));
    const answer = lifecycle.summary();
    return {
      held,
      idle,
      discoveryFreshness:
        "discovery" in answer ? answer.discovery.freshness : answer,
      storedFingerprint:
        store.readLatestDiscovery(SCOPE)?.inputFingerprint.kind,
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
    }),
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

async function flush(): Promise<void> {
  for (let turn = 0; turn < FLUSH_TURNS; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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
      scripted({
        verdicts: [
          FINGERPRINTED,
          FINGERPRINTED,
          { fingerprinted: false, reason },
        ],
      }),
    );
    expect({
      runs: store.runFingerprints,
      logged: log.entries.filter((entry) =>
        entry.includes("stored not fingerprinted"),
      ),
    }).toStrictEqual({
      runs: [{ kind: "not-fingerprinted" }],
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
    expect(store.runFingerprints).toStrictEqual([
      { kind: "not-fingerprinted" },
    ]);
  });

  it("D1879: a discovery during which a listed test module no watch covers may have changed is stored not fingerprinted, naming the module", async () => {
    const moduleChanged =
      "packages/a/gen/a.test.ts, which the discovery protects and no watch covers, may have changed while the job ran";
    const { store, log } = await begun(scripted({ moduleChanged }));
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
      });
    });

    it("D1988: a test module a declared pattern hid through the discovery's job, edited during it, leaves the discovery stored not fingerprinted", async () => {
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
        discoveryFreshness: "unknown",
        storedFingerprint: "not-fingerprinted",
      });
    });

    it("D1989: an input event while the discovery's test modules are protected leaves the discovery stored not fingerprinted", async () => {
      const reason = "its inputs changed while it ran: packages/a/src/a.ts";
      const { store } = await begun(
        scripted({
          verdicts: [FINGERPRINTED, { fingerprinted: false, reason }],
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
  "beginning each job once the inputs settle",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    /** How many jobs have begun while the given wait is held, and how many once it is released. */
    async function jobsAroundHeldSettle(
      heldSettle: number,
      script: InputsScript = {},
    ): Promise<{ held: number; released: number }> {
      const { inputs } = await begun(scripted({ ...script, heldSettle }));
      const held = inputs.jobsBegun;
      inputs.settleHeld.resolve();
      await flush();
      return { held, released: inputs.jobsBegun };
    }

    it("D2080: the discovery's job begins only once the inputs have settled", async () => {
      expect(await jobsAroundHeldSettle(0)).toStrictEqual({
        held: 0,
        released: 3,
      });
    });

    it("D2081: the guard around protecting the discovery's test modules begins only once the inputs have settled", async () => {
      expect(await jobsAroundHeldSettle(1)).toStrictEqual({
        held: 1,
        released: 3,
      });
    });

    // A pending dependency build waits for the inputs itself, so the run's own wait shows only with none pending, as
    // while the tracker cannot vouch for its inputs.
    it("D2082: a run's job begins only once the inputs have settled", async () => {
      expect(
        await jobsAroundHeldSettle(2, { unavailable: WATCHER_FAILED }),
      ).toStrictEqual({
        held: 2,
        released: 3,
      });
    });

    it("D2083: a stop while the guard waits for the inputs to settle begins no guard job", async () => {
      const { lifecycle, inputs } = await begun(scripted({ heldSettle: 1 }));
      lifecycle.stop();
      await lifecycle.stopped();
      expect(inputs.jobsBegun).toBe(1);
    });

    it("D2084: a stop while a run waits for the inputs to settle starts no run", async () => {
      const { lifecycle, executor } = await begun(scripted({ heldSettle: 2 }));
      lifecycle.stop();
      await lifecycle.stopped();
      expect(executor.runs).toStrictEqual([]);
    });

    it("D2090: a declared test module that changes while the guard waits for the inputs to settle leaves the discovery stored not fingerprinted", async () => {
      const moduleChange = { settled: false };
      const { inputs, store } = await begun(
        scripted({
          heldSettle: 1,
          get moduleChanged() {
            return moduleChange.settled
              ? "src/a.test.ts, which the discovery protects and no watch covers, may have changed while the job ran"
              : undefined;
          },
        }),
      );
      moduleChange.settled = true;
      inputs.settleHeld.resolve();
      await flush();
      expect(store.discoveryFingerprints).toStrictEqual([
        { kind: "not-fingerprinted" },
      ]);
    });

    it("D2092: a stop while the discovery waits for the inputs to settle starts no discovery", async () => {
      const { lifecycle, executor } = await begun(scripted({ heldSettle: 0 }));
      lifecycle.stop();
      await lifecycle.stopped();
      expect(executor.discoveries).toBe(0);
    });

    it("D2088: while a run waits for the inputs to settle, the activity names its workspace", async () => {
      const { lifecycle } = await begun(scripted({ heldSettle: 2 }));
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

  it("D1455: after a discovery that ended with nothing stored, the activity is idle", async () => {
    const executor = new ScriptedExecutor({
      ended: false,
      reason: "the executor process 7 exited during the job (exit code 1)",
    });
    const { lifecycle } = await begun(daemon(confirmed("a"), executor));
    expect(lifecycle.status().activity).toStrictEqual({ state: "idle" });
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
});

describe("stopping", () => {
  it("D1459: a stop aborts the job in progress", async () => {
    const { started } = heldAt("a", ["a", "b"]);
    const { lifecycle, executor } = await begun(started);
    lifecycle.stop();
    await flush();
    expect(executor.aborts).toBe(1);
  });

  it("D1460: the workspaces not yet run when the stop arrives are never run", async () => {
    const { started, held } = heldAt("a", ["a", "b"]);
    const { lifecycle, executor } = await begun(started);
    lifecycle.stop();
    await flush();
    held.resolve({ ended: true, value: interrupted("a") });
    await lifecycle.stopped();
    expect(executor.runs).toStrictEqual(["a"]);
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

  it("D1953: a stop during the first reconciliation of the inputs starts no discovery", async () => {
    const { lifecycle, executor } = await begun(
      scripted({ heldReconciliation: true }),
    );
    lifecycle.stop();
    await lifecycle.stopped();
    expect(executor.discoveries).toBe(0);
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
});

const BUILT: BuildOutcome = { ended: true, value: NO_DEPENDENCIES };
const BUILD_FAILED_REASON =
  "the executor process 7 exited during the job (exit code 1)";
const BUILD_FAILED: BuildOutcome = {
  ended: false,
  reason: BUILD_FAILED_REASON,
};
const EDITED_REASON = "its inputs changed while it ran: packages/a/src/a.ts";
const EDITED: JobVerdict = { fingerprinted: false, reason: EDITED_REASON };
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

  override abort(): void {
    super.abort();
    this.#finish.resolve(BUILT);
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
): Daemon {
  return daemon(
    { ...confirmed("a"), consumerRoot: root },
    executor,
    store,
    { ...IDENTITY, consumerRoot: root },
    new StandInInputs(script),
    builds,
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
      const outcome = await inTempDir(async (root) =>
        thenStopped(
          await begun(
            rootedAt(
              root,
              {
                verdicts: [FINGERPRINTED, FINGERPRINTED, EDITED, EDITED],
                fingerprintOf: failingWhileBuilding,
              },
              new ScriptedBuilds((index) => (index < 2 ? BUILT : held.promise)),
            ),
          ),
          async ({ store, log }) => ({
            runs: [...store.runFingerprints],
            logged: log.entries.filter(
              (entry) =>
                entry.includes(PROCEEDS_WITHOUT_BUILD) &&
                entry.includes(EDITED_REASON),
            ).length,
          }),
        ),
      );
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
