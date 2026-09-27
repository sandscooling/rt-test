import { describe, expect, it } from "vitest";
import type { Executor, JobOutcome } from "../src/daemon/executor.js";
import { DaemonLifecycle } from "../src/daemon/lifecycle.js";
import type { DaemonIdentity } from "../src/daemon/protocol.js";
import { openStore, type RtTestStore } from "../src/store/open-store.js";
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
import { inTempDir } from "./harness.js";

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

function discovered(path: string): WorkspaceDiscovery {
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
    return { ...bindings, adapterVersion: 3, runId: "run", run };
  }

  writeDiscovery(
    bindings: StoreBindings,
    written: TestDiscovery,
  ): StoredDiscovery {
    if (this.closed) throw new Error("the store is closed");
    this.discoveries.push(written);
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

  close(): void {
    this.closed = true;
  }
}

interface Daemon {
  readonly lifecycle: DaemonLifecycle;
  readonly executor: ScriptedExecutor;
  readonly store: RecordingStore;
  readonly log: MemoryLog;
  readonly endpointCloses: { count: number };
}

function daemon(
  start: ConfirmedStart,
  executor: ScriptedExecutor,
  store: RtTestStore = new RecordingStore(),
): Daemon {
  const log = memoryLog();
  const endpointCloses = { count: 0 };
  const lifecycle = new DaemonLifecycle({
    identity: IDENTITY,
    scope: SCOPE,
    start,
    store,
    log,
    executor: executor as unknown as Executor,
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
  };
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
): { readonly started: Daemon; readonly held: Deferred<RunOutcome> } {
  const held = new Deferred<RunOutcome>();
  const executor = new ScriptedExecutor(
    { ended: true, value: discovery(...paths.map(discovered)) },
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

  it("D1453: the discovery and each run are stored under the worktree's project and worktree, not fingerprinted", async () => {
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
    const expected = {
      ...SCOPE,
      inputFingerprint: { kind: "not-fingerprinted" },
    };
    expect(bindings).toStrictEqual({ discovery: expected, runs: [expected] });
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
