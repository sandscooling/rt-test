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
import { describe, expect, it, vi } from "vitest";
import type { Executor, JobOutcome } from "../src/daemon/executor.js";
import { DaemonLifecycle } from "../src/daemon/lifecycle.js";
import type { DaemonIdentity } from "../src/daemon/protocol.js";
import type { FingerprintResult } from "../src/inputs/fingerprint.js";
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
import type { InputFacts } from "../src/query/answer.js";
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

function confirmed(...paths: readonly string[]): ConfirmedStart {
  return {
    consumerRoot: "/consumer",
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
  /** A workspace's current fingerprint, asked at its run's start and again at its end. */
  readonly fingerprintOf?: (workspacePath: string) => FingerprintResult;
  /** Why a file the discovery protects by path, which no watch covers, may have changed during the discovery. */
  readonly moduleChanged?: string | undefined;
  /** Why a file only protection's walk found may have changed during the discovery, which protection resolves with. */
  readonly walkChanged?: string;
  /**
   * Holds one wait for the inputs to settle, counted from 0 in call order (the discovery's, the guard's, then each
   * run's), until the test resolves `settleHeld` or the inputs stop.
   */
  readonly heldSettle?: number;
}

/** Inputs whose reconciliation, fingerprints and job verdicts the test scripts, recording each start and stop. */
class StandInInputs implements TrackedInputs {
  starts = 0;
  stops = 0;
  jobsBegun = 0;
  /** The discovery each protection was given, in call order. */
  readonly protected: (TestDiscovery | undefined)[] = [];
  /** The job start each protection was given, in call order. */
  readonly jobStarts: (number | undefined)[] = [];
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

  current(): CurrentInputs {
    const fingerprintOf =
      this.#script.fingerprintOf ??
      ((path: string): FingerprintResult => ({
        ok: true,
        digest: `${path}-digest`,
      }));
    return {
      facts: SETTLED_INPUTS,
      workspaceFingerprint: (entry) => fingerprintOf(entry.workspace.path),
      discoveryFingerprint: () => ({ ok: true, digest: DISCOVERY_DIGEST }),
      protectedFileChangedSince: () => this.#script.moduleChanged,
    };
  }

  settled(): Promise<void> {
    const call = this.#settles;
    this.#settles += 1;
    return call === this.#script.heldSettle
      ? this.settleHeld.promise
      : Promise.resolve();
  }

  beginJob(): JobMark {
    this.jobsBegun += 1;
    return new JobWindows().open(undefined);
  }

  async endJob(): Promise<JobVerdict> {
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
}

function daemon(
  start: ConfirmedStart,
  executor: ScriptedExecutor,
  store: RtTestStore = new RecordingStore(),
  identity: DaemonIdentity = IDENTITY,
  inputs: StandInInputs = new StandInInputs(),
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
    ): Promise<{ held: number; released: number }> {
      const { inputs } = await begun(scripted({ heldSettle }));
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

    it("D2082: a run's job begins only once the inputs have settled", async () => {
      expect(await jobsAroundHeldSettle(2)).toStrictEqual({
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
