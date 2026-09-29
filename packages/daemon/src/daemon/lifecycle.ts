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
import { errorText } from "../vitest/error-text.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import type { DaemonLog } from "./daemon-log.js";
import { DependencyBuilds } from "./dependency-builds.js";
import type { Executor, JobOutcome } from "./executor.js";
import type {
  DaemonActivity,
  DaemonIdentity,
  UnstoredJob,
} from "./protocol.js";
import { Scheduler, type DiscoverReport, type RunReport } from "./scheduler.js";
import type { DaemonHandlers } from "./server.js";

const DISCOVERY_STOPPED_REASON =
  "the stop arrived during the discovery, so it was not stored";
const UNCONFIRMED_RUN_REASON =
  "the discovery listed it, but the confirmed start does not, so it was not run";
/** The build a run waited on and one rebuild; a run waits through no more discards than these. */
const DISCARDS_A_RUN_WAITS_THROUGH = 2;
const JOB_THREW_REASON = "the job could not be run";
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
  /** Started with the scheduler and stopped before the store closes. */
  readonly inputs: TrackedInputs;
  /** How long the input revision must hold still before a discovery or run starts. */
  readonly quietWindowMs: number;
  /** Stops accepting connections and resolves once the endpoint is closed. */
  readonly closeEndpoint: () => Promise<void>;
}

/**
 * Once the first reconciliation of the inputs has ended, and after each change of the input revision, has its
 * scheduler discover again when the stored discovery is not current and run each confirmed workspace whose latest
 * run is not bound to its current fingerprint, answering status and queries throughout. Each job begins once the
 * input events seen before it are read, and a run once the dependency build at that revision has ended or none can
 * begin. Each is stored under the input fingerprint it started from, or not fingerprinted when its inputs moved
 * while it ran.
 */
export class DaemonLifecycle implements DaemonHandlers {
  readonly identity: DaemonIdentity;
  readonly #parts: LifecycleParts;
  readonly #builds: DependencyBuilds;
  readonly #scheduler: Scheduler;
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
    this.#scheduler = new Scheduler({
      inputs: parts.inputs,
      log: parts.log,
      start: parts.start,
      quietWindowMs: parts.quietWindowMs,
      isStopping: () => this.isStopping(),
      view: () => {
        const results = this.#latestResults();
        return { results, inputs: this.#queryInputs(results) };
      },
      narrowing: () => this.#builds.narrowing(),
      awaitBuild: (subject) => this.#awaitBuild(subject),
      discover: (revision) => this.#idleAfter(this.#discover(revision)),
      run: (entry, revision) => this.#idleAfter(this.#run(entry, revision)),
      idle: () => {
        this.#activity = { state: "idle" };
      },
    });
    this.#whenStopped = new Promise((resolve) => {
      this.#markStopped = resolve;
    });
  }

  begin(): void {
    this.#protectStoredDiscovery();
    this.#parts.inputs.start();
    this.#builds.start();
    this.#sequence = this.#scheduler
      .start()
      .catch((error: unknown) => {
        this.#parts.log.error("the scheduler failed", error);
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

  /** Undefined when the discovery did not begin: a stop, or a revision that moved since it was planned. */
  async #discover(
    plannedRevision: number,
  ): Promise<DiscoverReport | undefined> {
    const { log, executor, start, inputs } = this.#parts;
    this.#activity = { state: "discovering" };
    await inputs.settled();
    if (this.#beginsNothing(plannedRevision)) return undefined;
    log.entry("discovery started");
    const mark = inputs.beginJob();
    const startedAt = Date.now();
    const outcome = await executor
      .discover(start)
      .catch((error: unknown) => threwOutcome<TestDiscovery>(error));
    const verdict = await inputs.endJob(mark);
    if (!outcome.ended) {
      this.#nothingStored(undefined, outcome.reason);
      return { stored: false };
    }
    const discovery = outcome.value;
    const held = await this.#protectDiscovered(discovery, verdict, startedAt);
    if (this.isStopping()) {
      this.#nothingStored(undefined, DISCOVERY_STOPPED_REASON);
      return { stored: false };
    }
    const bindings = this.#bindings("the discovery", held, () =>
      inputs.current().discoveryFingerprint(discovery),
    );
    const stored = this.#store("the discovery", undefined, () =>
      this.#builds.use(this.#parts.store.writeDiscovery(bindings, discovery)),
    );
    log.entry(`discovery ended: ${discoverySummary(discovery)}`);
    this.#logMissingConfirmed(discovery);
    return { stored };
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
      return {
        fingerprinted: false,
        reason: DISCOVERY_STOPPED_REASON,
        changedWhileRunning: false,
      };
    const unwatched = inputs
      .current()
      .protectedFileChangedSince(discovery, startedAt);
    const guard = inputs.beginJob();
    const released = await inputs.protectInputs(discovery, startedAt);
    const guarded = await inputs.endJob(guard);
    if (!verdict.fingerprinted) return verdict;
    const changed = unwatched ?? released;
    if (changed !== undefined) {
      return {
        fingerprinted: false,
        reason: changed,
        changedWhileRunning: true,
      };
    }
    return guarded;
  }

  /** Undefined when the run did not begin: a stop, a revision that moved since it was planned, or a workspace the start does not confirm. */
  async #run(
    entry: WorkspaceDiscovery,
    plannedRevision: number,
  ): Promise<RunReport | undefined> {
    const { log, executor, start, inputs } = this.#parts;
    const { workspace } = entry;
    const confirmed = confirmedEntry(start, workspace);
    if (confirmed === undefined) {
      this.#nothingStored(workspace.path, UNCONFIRMED_RUN_REASON);
      return undefined;
    }
    this.#activity = { state: "running", workspacePath: workspace.path };
    await inputs.settled();
    if (this.#beginsNothing(plannedRevision)) return undefined;
    log.entry(`run started: ${workspace.path}`);
    const mark = inputs.beginJob();
    const startInputs = this.#runInputs();
    const started = startInputs.workspaceFingerprint(entry);
    const revision = startInputs.facts.revision;
    const outcome = await executor
      .run(workspace, confirmed.configFile)
      .catch((error: unknown) => threwOutcome<WorkspaceRun>(error));
    const verdict = await inputs.endJob(mark);
    const report = (stored: boolean): RunReport => ({
      revision,
      stored,
      changedWhileRunning:
        !verdict.fingerprinted && verdict.changedWhileRunning,
    });
    if (!outcome.ended) {
      this.#nothingStored(workspace.path, outcome.reason);
      return report(false);
    }
    const run = outcome.value;
    if (run.status === "not-confirmed") {
      this.#nothingStored(workspace.path, run.reason);
      return report(false);
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
    return report(stored);
  }

  /** A job starts only at the revision that was planned and settled, and never after a stop; otherwise the scheduler plans again. */
  #beginsNothing(plannedRevision: number): boolean {
    const moved =
      this.#parts.inputs.current().facts.revision !== plannedRevision;
    return this.isStopping() || moved;
  }

  /** Nothing runs once a job has returned, begun or not, while the scheduler waits to plan the next. */
  async #idleAfter<T>(job: Promise<T>): Promise<T> {
    try {
      return await job;
    } finally {
      this.#activity = { state: "idle" };
    }
  }

  /**
   * Waits for the dependency build at the settled revision, through one rebuild: a second build discarded in a row
   * while `subject` waits means its inputs keep moving, so it proceeds and a run is stored not fingerprinted.
   */
  async #awaitBuild(subject: string): Promise<void> {
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
          `${subject} proceeds without its dependency build, discarded ${inARow} times in a row while it waited: ${discards.reason}`,
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

  /** Returns whether the record was stored; a stored one leaves the list of jobs that stored nothing, and a failed write is logged and listed. */
  #store(
    what: string,
    workspacePath: string | undefined,
    write: () => unknown,
  ): boolean {
    try {
      write();
      this.#unlist(workspacePath);
      return true;
    } catch (error) {
      this.#parts.log.error(`storing ${what}`, error);
      this.#nothingStored(workspacePath, `the store write failed`);
      return false;
    }
  }

  /** Each job is listed once, by its latest ending, so a job retried at every periodic reconciliation cannot grow the list. */
  #nothingStored(workspacePath: string | undefined, reason: string): void {
    this.#unlist(workspacePath);
    this.#unstored.push(
      workspacePath === undefined ? { reason } : { workspacePath, reason },
    );
    this.#parts.log.entry(
      `${workspacePath === undefined ? "the discovery" : `the run of ${workspacePath}`} ended with nothing stored: ${reason}`,
    );
  }

  /** A job no longer listed as one that stored nothing: undefined names the discovery. */
  #unlist(workspacePath: string | undefined): void {
    const kept = this.#unstored.filter(
      (job) => job.workspacePath !== workspacePath,
    );
    this.#unstored.length = 0;
    this.#unstored.push(...kept);
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
    this.#scheduler.stop();
    // Before the tracker: its stop resolves every wait of the builds' rounds at once, which would spin them.
    const buildsStopped = this.#builds.stop();
    executor.abort();
    await inputs.stop();
    await this.#sequence;
    await buildsStopped;
    await this.#closing("the executor", () => executor.close());
    await this.#closing("the dependency build executor", () =>
      buildExecutor.close(),
    );
    await this.#closing("the store", () => store.close());
    await this.#closing("the endpoint", closeEndpoint);
    log.entry("stopped");
  }

  /** Each closer runs whatever an earlier one did, so no release is skipped. */
  async #closing(
    what: string,
    close: () => Promise<void> | void,
  ): Promise<void> {
    try {
      await close();
    } catch (error) {
      this.#parts.log.error(`closing ${what}`, error);
    }
  }
}

/** A job that threw ended with nothing, the same as one whose process died. */
function threwOutcome<T>(error: unknown): JobOutcome<T> {
  return { ended: false, reason: `${JOB_THREW_REASON}: ${errorText(error)}` };
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
