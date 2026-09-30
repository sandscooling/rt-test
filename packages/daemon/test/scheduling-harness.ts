import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProjectInputs,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import {
  JobWindows,
  type JobMark,
  type JobVerdict,
} from "../src/inputs/input-jobs.js";
import type { InputDigests } from "../src/inputs/input-inventory.js";
import type {
  CurrentInputs,
  TrackedInputs,
} from "../src/inputs/input-tracker.js";
import type { QueryNarrowing } from "../src/inputs/narrowed-inputs.js";
import {
  NON_INPUTS_ABSENT,
  NON_INPUTS_FILE,
  type NonInputsDeclaration,
} from "../src/inputs/non-inputs.js";
import type { InputFacts } from "../src/query/answer.js";
import type { LatestResults, RtTestStore } from "../src/store/open-store.js";
import type {
  StoreBindings,
  StoredDiscovery,
  StoredRun,
  StoreScope,
} from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { ConfirmedStart } from "../src/vitest/confirmed-start.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { VitestWorkspace } from "../src/vitest/find-workspaces.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";

export const SCOPE: StoreScope = {
  projectIdentity: "/consumer/.git",
  worktreeIdentity: "/consumer",
};

/** Enough event-loop turns for a sequence whose jobs have all settled to reach its end. */
export const FLUSH_TURNS = 20;

export const DISCOVERY_DIGEST = "discovery-digest";

export const FINGERPRINTED: JobVerdict = { fingerprinted: true };

export const SETTLED_INPUTS: InputFacts = {
  revision: 1,
  reconciliation: { state: "complete" },
  lastReconciledAt: "2026-09-27T12:00:00.000Z",
  watcher: { state: "healthy" },
  pendingChanges: 0,
  gitUnread: [],
};

export function workspace(path: string): VitestWorkspace {
  return { path, directory: `/consumer/${path}` };
}

/**
 * The confirmed start's root, a name under the temp directory no test creates, so each build over it fails before its
 * job begins, whatever the host holds at `/consumer`.
 */
export const ABSENT_ROOT = join(
  tmpdir(),
  `rt-test-absent-root-${randomUUID()}`,
);

export function confirmed(...paths: readonly string[]): ConfirmedStart {
  return {
    consumerRoot: ABSENT_ROOT,
    workspaces: paths.map((path) => ({
      path,
      configFile: `${path}/vitest.config.mjs`,
    })),
  };
}

export function discovered(
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
export function discoveredWithTest(path: string): WorkspaceDiscovery {
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

export function discovery(
  ...entries: readonly WorkspaceDiscovery[]
): TestDiscovery {
  return { workspaces: entries, notRead: [] };
}

export function interrupted(path: string): WorkspaceRun {
  return { status: "interrupted-before-load", workspace: workspace(path) };
}

export class Deferred<T> {
  resolve: (value: T) => void = () => undefined;
  readonly promise = new Promise<T>((resolve) => {
    this.resolve = resolve;
  });
}

export const UNFINGERPRINTED: StoreBindings["inputFingerprint"] = {
  kind: "not-fingerprinted",
};

/** The fingerprint a record was stored under, as the digest a current fingerprint is compared with. */
export function digestOf(digest: string): StoreBindings["inputFingerprint"] {
  return { kind: "digest", digest };
}

/** Each run a recording store holds has its own id, so a later run of a workspace never shares an earlier one's. */
function runIdAt(index: number): string {
  return `run-${index}`;
}

/**
 * A store that records what was written to it, and refuses a write once closed, as a closed store does. It reads each
 * record back under the fingerprint, adapter version and run id it was written with.
 */
export class RecordingStore implements RtTestStore {
  readonly file = "/consumer/.rt-test/store.sqlite";
  readonly runs: WorkspaceRun[] = [];
  readonly discoveries: TestDiscovery[] = [];
  /** The fingerprint each run and each discovery was written under, in the order written. */
  readonly runFingerprints: StoreBindings["inputFingerprint"][] = [];
  readonly discoveryFingerprints: StoreBindings["inputFingerprint"][] = [];
  readonly runVersions: number[] = [];
  readonly discoveryVersions: number[] = [];
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
    this.seedRun(run, bindings.inputFingerprint);
    return {
      ...bindings,
      adapterVersion: VITEST_ADAPTER_VERSION,
      runId: runIdAt(this.runs.length - 1),
      run,
    };
  }

  writeDiscovery(
    bindings: StoreBindings,
    written: TestDiscovery,
  ): StoredDiscovery {
    if (this.closed) throw new Error("the store is closed");
    this.seedDiscovery(written, bindings.inputFingerprint);
    return {
      ...bindings,
      adapterVersion: VITEST_ADAPTER_VERSION,
      discoveryId: "discovery",
      discovery: written,
    };
  }

  /** Holds a run as an earlier life of the daemon stored it. */
  seedRun(
    run: WorkspaceRun,
    fingerprint: StoreBindings["inputFingerprint"],
    adapterVersion: number = VITEST_ADAPTER_VERSION,
  ): void {
    this.runs.push(run);
    this.runFingerprints.push(fingerprint);
    this.runVersions.push(adapterVersion);
  }

  /** Holds a discovery as an earlier life of the daemon stored it. */
  seedDiscovery(
    found: TestDiscovery,
    fingerprint: StoreBindings["inputFingerprint"],
    adapterVersion: number = VITEST_ADAPTER_VERSION,
  ): void {
    this.discoveries.push(found);
    this.discoveryFingerprints.push(fingerprint);
    this.discoveryVersions.push(adapterVersion);
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
    const last = this.discoveries.length - 1;
    const discovery = this.discoveries[last];
    const latest = new Map(
      this.runs.map((run, index) => [run.workspace.path, index]),
    );
    return {
      discovery:
        discovery === undefined
          ? undefined
          : {
              ...scope,
              inputFingerprint:
                this.discoveryFingerprints[last] ?? UNFINGERPRINTED,
              adapterVersion:
                this.discoveryVersions[last] ?? VITEST_ADAPTER_VERSION,
              discoveryId: "discovery",
              discovery,
            },
      discoveryRefusal: undefined,
      latestRuns: [...latest.values()].flatMap((index) => {
        const run = this.runs[index];
        return run === undefined
          ? []
          : [
              {
                ...scope,
                inputFingerprint:
                  this.runFingerprints[index] ?? UNFINGERPRINTED,
                adapterVersion:
                  this.runVersions[index] ?? VITEST_ADAPTER_VERSION,
                runId: runIdAt(index),
                run,
              },
            ];
      }),
    };
  }

  close(): void {
    this.closed = true;
  }
}

export interface InputsScript {
  /** Keeps the first reconciliation running until the test resolves `reconciled`. */
  readonly heldReconciliation?: boolean;
  /** Keeps every job's end waiting on the inputs until the inputs stop. */
  readonly heldJobEnds?: boolean;
  /**
   * Each job's verdict, in the order the jobs end: the discovery, the guard around its protection, then each run and
   * each build. A job past the list is fingerprinted. A run takes its place in the order, but is judged from its window.
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
  /** The discovery's current fingerprint; the one every discovery is stored under when absent. */
  readonly discoveryFingerprintOf?: () => FingerprintResult;
  /** The committed inputs each view carries; none when absent. */
  readonly snapshot?: () => ProjectInputs | undefined;
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
  /** Holds the first wait for the inputs to settle that begins while this answers true, until the test releases it. */
  readonly heldSettleIf?: () => boolean;
  /** Makes each wait for the inputs to settle reject with this text, once its hold, if any, is released. */
  readonly settleFails?: string;
  /** Makes each ask for the next change of the inputs throw this text, as only the dependency builds ask. */
  readonly changedFails?: string;
}

export const NO_DECLARATION: NonInputsDeclaration = {
  file: NON_INPUTS_FILE,
  state: NON_INPUTS_ABSENT,
};

/**
 * Inputs whose reconciliation, fingerprints and job verdicts the test scripts, recording each start and stop. The
 * revision moves only when the test moves it, and `changed()` resolves only then or at the stop.
 */
export class StandInInputs implements TrackedInputs {
  starts = 0;
  stops = 0;
  jobsBegun = 0;
  jobsEnded = 0;
  revision = SETTLED_INPUTS.revision;
  periodicEnded = 0;
  #changeWaiters: (() => void)[] = [];
  #stopped = false;
  /** The discovery each protection was given, in call order. */
  readonly protected: (TestDiscovery | undefined)[] = [];
  /** The job start each protection was given, in call order. */
  readonly jobStarts: (number | undefined)[] = [];
  /** The time each check for a protected file changing was measured from, in call order. */
  readonly changedSince: number[] = [];
  /** The narrowing each view of the inputs was asked for, in call order. */
  readonly narrowings: (QueryNarrowing | undefined)[] = [];
  readonly reconciled = new Deferred<void>();
  readonly settleHeld = new Deferred<void>();
  readonly #released = new Deferred<void>();
  readonly #script: InputsScript;
  readonly #verdicts: JobVerdict[];
  /** The window of each job running, which a run's verdict is judged from. */
  readonly #windows = new JobWindows();
  #settles = 0;
  #heldByCondition = false;

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
      snapshot: this.#script.snapshot?.(),
      workspaceFingerprint: (entry) =>
        fingerprintOf(entry.workspace.path, narrowing),
      discoveryFingerprint: () =>
        this.#script.discoveryFingerprintOf?.() ?? {
          ok: true,
          digest: DISCOVERY_DIGEST,
        },
      protectedFileChangedSince: (_discovery, since) => {
        this.changedSince.push(since);
        return this.#script.moduleChanged;
      },
    };
  }

  changed(): Promise<void> {
    if (this.#script.changedFails !== undefined) {
      throw new Error(this.#script.changedFails);
    }
    if (this.#stopped) return Promise.resolve();
    return new Promise((resolve) => this.#changeWaiters.push(resolve));
  }

  periodicReconciliations(): number {
    return this.periodicEnded;
  }

  /** Moves the revision, as a read that changed an input does, and signals the change. */
  moveRevision(): void {
    this.revision += 1;
    this.#signalChange();
  }

  /** Ends a periodic reconciliation with the revision unmoved, as the tracker signals it. */
  endPeriodicReconciliation(): void {
    this.periodicEnded += 1;
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
    const holds =
      call === this.#script.heldSettle ||
      (!this.#heldByCondition && this.#script.heldSettleIf?.() === true);
    if (holds && call !== this.#script.heldSettle) this.#heldByCondition = true;
    const held = holds ? this.settleHeld.promise : Promise.resolve();
    const { settleFails } = this.#script;
    if (settleFails === undefined) return held;
    return held.then(() => {
      throw new Error(settleFails);
    });
  }

  beginJob(): JobMark {
    this.jobsBegun += 1;
    return this.#windows.open(undefined, this.#vouchedDigests());
  }

  /** A discovery's or a build's verdict is scripted; a run's is judged from its window, which this closes. */
  async endJob(mark: JobMark): Promise<JobVerdict> {
    this.jobsEnded += 1;
    if (this.#script.heldJobEnds === true) await this.#released.promise;
    this.#windows.close(mark, undefined, this.#vouchedDigests());
    return this.#verdicts.shift() ?? FINGERPRINTED;
  }

  /** The scripted committed digests, none while the tracker is scripted as unable to vouch for its inputs, as the tracker keeps a window's. */
  #vouchedDigests(): InputDigests | undefined {
    if (this.#script.unavailable !== undefined) return undefined;
    return this.#script.snapshot?.()?.digests;
  }

  /** Records, for each job running, an input that changed, as the tracker records a read that changed one. */
  recordPath(path: string): void {
    this.#windows.recordPath(path);
  }

  /** Records, for each job running, a cause that names no input, as the tracker records a watcher failure. */
  recordCause(cause: string): void {
    this.#windows.recordCause(cause);
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

export async function flush(): Promise<void> {
  for (let turn = 0; turn < FLUSH_TURNS; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}
