import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Executor, JobOutcome } from "../src/daemon/executor.js";
import { DaemonLifecycle } from "../src/daemon/lifecycle.js";
import type { DaemonIdentity } from "../src/daemon/protocol.js";
import type { FingerprintResult } from "../src/inputs/fingerprint.js";
import {
  JobWindows,
  type JobMark,
  type JobVerdict,
} from "../src/inputs/input-jobs.js";
import type {
  CurrentInputs,
  TrackedInputs,
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
import { memoryLog, type MemoryLog } from "./daemon-harness.js";
import { inTempDir, within } from "./harness.js";

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
/** Longer than a stop of the scripted daemon takes, and short enough that a stop that never ends fails the test. */
const STOP_BOUND_MS = 2000;
const DISCOVERY_DIGEST = "discovery-digest";
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

interface InputsScript {
  /** Keeps the first reconciliation running until the test resolves `reconciled`. */
  readonly heldReconciliation?: boolean;
  /** Keeps every job's end waiting on the inputs until the inputs stop. */
  readonly heldJobEnds?: boolean;
  /** Each job's verdict, in the order the jobs end; a job past the list is fingerprinted. */
  readonly verdicts?: readonly JobVerdict[];
  /** A workspace's current fingerprint, asked at its run's start and again at its end. */
  readonly fingerprintOf?: (workspacePath: string) => FingerprintResult;
  /** Why a listed test module no watch covers may have changed during the discovery. */
  readonly moduleChanged?: string;
}

/** Inputs whose reconciliation, fingerprints and job verdicts the test scripts, recording each start and stop. */
class StandInInputs implements TrackedInputs {
  starts = 0;
  stops = 0;
  readonly reconciled = new Deferred<void>();
  readonly #released = new Deferred<void>();
  readonly #script: InputsScript;
  readonly #verdicts: JobVerdict[];

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
      testModuleChangedSince: () => this.#script.moduleChanged,
    };
  }

  beginJob(): JobMark {
    return new JobWindows().open(undefined);
  }

  async endJob(): Promise<JobVerdict> {
    if (this.#script.heldJobEnds === true) await this.#released.promise;
    return this.#verdicts.shift() ?? FINGERPRINTED;
  }

  stop(): Promise<void> {
    this.stops += 1;
    this.#released.resolve();
    this.reconciled.resolve();
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
        verdicts: [FINGERPRINTED, { fingerprinted: false, reason }],
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
      "the test module packages/a/gen/a.test.ts, which no watch covers, may have changed while the job ran";
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
    expect(
      await within(
        lifecycle.stopped().then(() => "stopped"),
        STOP_BOUND_MS,
      ),
    ).toBe("stopped");
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
