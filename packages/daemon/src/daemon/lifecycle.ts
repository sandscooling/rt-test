import type { FingerprintResult } from "../inputs/fingerprint.js";
import type { JobVerdict } from "../inputs/input-jobs.js";
import type { CurrentInputs, TrackedInputs } from "../inputs/input-tracker.js";
import type {
  NoAnswer,
  PathStatusAnswer,
  SummaryAnswer,
} from "../query/answer.js";
import { pathStatusAnswer } from "../query/path-status.js";
import { summaryAnswer, type DaemonView } from "../query/summary.js";
import type { LatestResults, RtTestStore } from "../store/open-store.js";
import { FINGERPRINT_DIGEST, NOT_FINGERPRINTED } from "../store/schema.js";
import type {
  StoreBindings,
  StoredDiscovery,
  StoreScope,
} from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import type { DaemonLog } from "./daemon-log.js";
import { DependencyBuilds } from "./dependency-builds.js";
import type { Executor } from "./executor.js";
import type {
  DaemonActivity,
  DaemonIdentity,
  UnstoredJob,
} from "./protocol.js";
import type { DaemonHandlers } from "./server.js";

const DISCOVERY_STOPPED_REASON =
  "the stop arrived during the discovery, so it was not stored";
const UNCONFIRMED_RUN_REASON =
  "the discovery listed it, but the confirmed start does not, so it was not run";
/** The build a run waited on and one rebuild; a run waits through no more discards than these. */
const DISCARDS_A_RUN_WAITS_THROUGH = 2;
const MOVED_DURING_RUN_REASON =
  "its workspace's input fingerprint at its end differs from the one at its start";

export interface LifecycleParts {
  readonly identity: DaemonIdentity;
  readonly scope: StoreScope;
  readonly start: ConfirmedStart;
  readonly store: RtTestStore;
  readonly log: DaemonLog;
  readonly executor: Executor;
  /** Takes the dependency builds, so a build never waits behind a run. */
  readonly buildExecutor: Executor;
  /** Started with the start sequence and stopped before the store closes. */
  readonly inputs: TrackedInputs;
  /** Stops accepting connections and resolves once the endpoint is closed. */
  readonly closeEndpoint: () => Promise<void>;
}

/**
 * Once the first reconciliation of the inputs has ended, discovers once, runs each confirmed workspace once, then
 * idles until a stop, answering status and queries throughout. Each job begins once the input events seen before
 * it are read, and a run once the dependency build at that revision has ended or none can begin. Each is stored
 * under the input fingerprint it started from, or not fingerprinted when its inputs moved while it ran.
 */
export class DaemonLifecycle implements DaemonHandlers {
  readonly identity: DaemonIdentity;
  readonly #parts: LifecycleParts;
  readonly #builds: DependencyBuilds;
  #activity: DaemonActivity = { state: "discovering" };
  readonly #unstored: UnstoredJob[] = [];
  #sequence: Promise<void> = Promise.resolve();
  #stopping: Promise<void> | undefined;
  readonly #whenStopped: Promise<void>;
  #markStopped: () => void = () => undefined;

  constructor(parts: LifecycleParts) {
    this.identity = parts.identity;
    this.#parts = parts;
    this.#builds = new DependencyBuilds({
      inputs: parts.inputs,
      executor: parts.buildExecutor,
      consumerRoot: parts.start.consumerRoot,
      stateDirectory: parts.identity.stateDirectory,
      log: parts.log,
    });
    this.#whenStopped = new Promise((resolve) => {
      this.#markStopped = resolve;
    });
  }

  begin(): void {
    this.#protectStoredDiscovery();
    this.#parts.inputs.start();
    this.#builds.start();
    this.#sequence = this.#startSequence()
      .catch((error: unknown) => {
        this.#parts.log.error("the start sequence failed", error);
      })
      .finally(() => {
        this.#activity = { state: "idle" };
      });
  }

  status(): {
    activity: DaemonActivity;
    stopping: boolean;
    unstoredJobs: readonly UnstoredJob[];
  } {
    return {
      activity: this.#activity,
      stopping: this.isStopping(),
      unstoredJobs: [...this.#unstored],
    };
  }

  summary(): SummaryAnswer | NoAnswer {
    const results = this.#latestResults();
    return summaryAnswer(results, this.#view(), this.#queryInputs(results));
  }

  pathStatus(path: string): PathStatusAnswer | NoAnswer {
    const results = this.#latestResults();
    return pathStatusAnswer(
      path,
      results,
      this.#view(),
      this.#queryInputs(results),
    );
  }

  /**
   * The inputs narrowed by the builds only while they build over the stored discovery the answer reads, which becomes
   * theirs when a failed read at start left them none.
   */
  #queryInputs(results: LatestResults): CurrentInputs {
    if (results.discovery !== undefined) this.#builds.use(results.discovery);
    return this.#parts.inputs.current({
      ...this.#builds.narrowing(),
      discoveryId: results.discovery?.discoveryId,
    });
  }

  isStopping(): boolean {
    return this.#stopping !== undefined;
  }

  /**
   * The first reconciliation leaves out no file the store's latest discovery, from an earlier life, protects, and the
   * dependency builds begin over it. A discovery that cannot be read gives none, so no declared pattern applies.
   */
  #protectStoredDiscovery(): void {
    const { inputs, log } = this.#parts;
    let stored: StoredDiscovery | undefined;
    try {
      stored = this.#latestResults().discovery;
    } catch (error) {
      log.error("reading the latest stored discovery", error);
      return;
    }
    this.#builds.use(stored);
    inputs.protectInputs(stored?.discovery).catch((error: unknown) => {
      log.error("protecting the stored discovery's files", error);
    });
  }

  #latestResults(): LatestResults {
    return this.#parts.store.readLatestResults(this.#parts.scope);
  }

  #view(): DaemonView {
    const { activity, unstoredJobs } = this.status();
    return { consumerRoot: this.identity.consumerRoot, activity, unstoredJobs };
  }

  stop(): void {
    this.#stopping ??= this.#stopSequence().finally(() => this.#markStopped());
  }

  /** Resolves once a stop has run to its end. */
  stopped(): Promise<void> {
    return this.#whenStopped;
  }

  async #startSequence(): Promise<void> {
    const { log, executor, start, inputs } = this.#parts;
    await inputs.firstReconciled();
    await inputs.settled();
    if (this.isStopping()) return;
    log.entry("discovery started");
    const mark = inputs.beginJob();
    const startedAt = Date.now();
    const outcome = await executor.discover(start);
    const verdict = await inputs.endJob(mark);
    if (!outcome.ended) {
      this.#nothingStored(undefined, outcome.reason);
      return;
    }
    const discovery = outcome.value;
    const held = await this.#protectDiscovered(discovery, verdict, startedAt);
    if (this.isStopping()) {
      this.#nothingStored(undefined, DISCOVERY_STOPPED_REASON);
      return;
    }
    const bindings = this.#bindings("the discovery", held, () =>
      inputs.current().discoveryFingerprint(discovery),
    );
    this.#store("the discovery", undefined, () =>
      this.#builds.use(this.#parts.store.writeDiscovery(bindings, discovery)),
    );
    log.entry(`discovery ended: ${discoverySummary(discovery)}`);
    this.#logMissingConfirmed(discovery);
    for (const entry of discovery.workspaces) {
      if (this.isStopping()) break;
      if (entry.status === "not-confirmed") continue;
      await this.#run(entry);
    }
    if (!this.isStopping())
      log.entry("idle: every confirmed workspace has run");
  }

  /**
   * Protects the discovery's files before its fingerprint is taken, so the stored digest counts them as every later
   * answer does. The tracker dropped the events of a file a pattern covered through the job, so the time of each one
   * the discovery names is read before protection moves it into the inputs, and protection reads the time of each one
   * only its walk finds; an input event during protection fails the fingerprint, and protection's own reads do not.
   */
  async #protectDiscovered(
    discovery: TestDiscovery,
    verdict: JobVerdict,
    startedAt: number,
  ): Promise<JobVerdict> {
    const { inputs } = this.#parts;
    await inputs.settled();
    if (this.isStopping())
      return { fingerprinted: false, reason: DISCOVERY_STOPPED_REASON };
    const unwatched = inputs
      .current()
      .protectedFileChangedSince(discovery, startedAt);
    const guard = inputs.beginJob();
    const released = await inputs.protectInputs(discovery, startedAt);
    const guarded = await inputs.endJob(guard);
    if (!verdict.fingerprinted) return verdict;
    const changed = unwatched ?? released;
    if (changed !== undefined) return { fingerprinted: false, reason: changed };
    return guarded;
  }

  async #run(entry: WorkspaceDiscovery): Promise<void> {
    const { log, executor, start, inputs } = this.#parts;
    const { workspace } = entry;
    const confirmed = confirmedEntry(start, workspace);
    if (confirmed === undefined) {
      this.#nothingStored(workspace.path, UNCONFIRMED_RUN_REASON);
      return;
    }
    this.#activity = { state: "running", workspacePath: workspace.path };
    await inputs.settled();
    await this.#awaitBuild(workspace.path);
    if (this.isStopping()) return;
    log.entry(`run started: ${workspace.path}`);
    const mark = inputs.beginJob();
    const started = this.#runInputs().workspaceFingerprint(entry);
    const outcome = await executor.run(workspace, confirmed.configFile);
    const verdict = await inputs.endJob(mark);
    if (!outcome.ended) {
      this.#nothingStored(workspace.path, outcome.reason);
      return;
    }
    const run = outcome.value;
    if (run.status === "not-confirmed") {
      this.#nothingStored(workspace.path, run.reason);
      return;
    }
    const bindings = this.#bindings(
      `the run of ${workspace.path}`,
      verdict,
      () => unmoved(started, this.#runInputs().workspaceFingerprint(entry)),
    );
    const stored = this.#store(
      `the run of ${workspace.path}`,
      workspace.path,
      () => this.#parts.store.writeRun(bindings, run),
    );
    if (stored) {
      log.entry(
        `run ended: ${workspace.path} ${run.status}${"execution" in run ? ` ${run.execution}` : ""}`,
      );
    }
  }

  /**
   * Waits for the dependency build at the settled revision, through one rebuild: a second build discarded in a row
   * while the run waits means its inputs keep moving, so the run proceeds and is stored not fingerprinted.
   */
  async #awaitBuild(workspacePath: string): Promise<void> {
    const builds = this.#builds;
    const waitedFrom = builds.discards().total;
    while (builds.pending()) {
      const discards = builds.discards();
      const inARow = Math.min(
        discards.total - waitedFrom,
        discards.consecutive,
      );
      if (inARow >= DISCARDS_A_RUN_WAITS_THROUGH) {
        this.#parts.log.entry(
          `the run of ${workspacePath} proceeds without its dependency build, discarded ${inARow} times in a row while it waited: ${discards.reason}`,
        );
        return;
      }
      await builds.ended();
      await this.#parts.inputs.settled();
    }
  }

  /** A run is fingerprinted over the builds' narrowing for the discovery they build over, as answers compare it. */
  #runInputs(): CurrentInputs {
    return this.#parts.inputs.current(this.#builds.narrowing());
  }

  /** The job's record is bound to its fingerprint only when its inputs held still from its start to its end. */
  #bindings(
    job: string,
    verdict: JobVerdict,
    fingerprint: () => FingerprintResult,
  ): StoreBindings {
    const { scope, log } = this.#parts;
    const print: FingerprintResult = verdict.fingerprinted
      ? fingerprint()
      : { ok: false, reason: verdict.reason };
    if (print.ok) {
      return {
        ...scope,
        inputFingerprint: { kind: FINGERPRINT_DIGEST, digest: print.digest },
      };
    }
    log.entry(`${job} is stored not fingerprinted: ${print.reason}`);
    return { ...scope, inputFingerprint: { kind: NOT_FINGERPRINTED } };
  }

  /** Returns whether the record was stored; a failed write is logged and listed, and the sequence goes on. */
  #store(
    what: string,
    workspacePath: string | undefined,
    write: () => unknown,
  ): boolean {
    try {
      write();
      return true;
    } catch (error) {
      this.#parts.log.error(`storing ${what}`, error);
      this.#nothingStored(workspacePath, `the store write failed`);
      return false;
    }
  }

  #nothingStored(workspacePath: string | undefined, reason: string): void {
    this.#unstored.push(
      workspacePath === undefined ? { reason } : { workspacePath, reason },
    );
    this.#parts.log.entry(
      `${workspacePath === undefined ? "the discovery" : `the run of ${workspacePath}`} ended with nothing stored: ${reason}`,
    );
  }

  #logMissingConfirmed(discovery: TestDiscovery): void {
    const found = new Set(
      discovery.workspaces.map((entry) => entry.workspace.path),
    );
    for (const confirmed of this.#parts.start.workspaces) {
      if (!found.has(confirmed.path)) {
        this.#parts.log.entry(
          `the confirmed workspace ${confirmed.path} was not found, so nothing of it was loaded`,
        );
      }
    }
  }

  async #stopSequence(): Promise<void> {
    const { log, executor, buildExecutor, store, closeEndpoint, inputs } =
      this.#parts;
    log.entry("stop requested");
    // Before the tracker: its stop resolves every wait of the builds' rounds at once, which would spin them.
    const buildsStopped = this.#builds.stop();
    executor.abort();
    await inputs.stop();
    await this.#sequence;
    await buildsStopped;
    await executor.close();
    await buildExecutor.close();
    try {
      store.close();
    } catch (error) {
      log.error("closing the store", error);
    }
    try {
      await closeEndpoint();
    } catch (error) {
      log.error("closing the endpoint", error);
    }
    log.entry("stopped");
  }
}

/** A run's fingerprint at its start, when its workspace's fingerprint at its end is the same one. */
function unmoved(
  started: FingerprintResult,
  ended: FingerprintResult,
): FingerprintResult {
  if (!started.ok) return started;
  if (!ended.ok) return ended;
  return started.digest === ended.digest
    ? started
    : { ok: false, reason: MOVED_DURING_RUN_REASON };
}

function discoverySummary(discovery: TestDiscovery): string {
  return discovery.workspaces
    .map((entry) => `${entry.workspace.path} ${entry.status}`)
    .join(", ");
}
