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
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";
import type { DaemonLog } from "./daemon-log.js";
import { DependencyBuilds } from "./dependency-builds.js";
import { ABORT_PURPOSE, type Executor, type JobOutcome } from "./executor.js";
import {
  discoverySummary,
  interruptedRun,
  logMissingConfirmed,
  runToStore,
  storeFailureReason,
  threwOutcome,
  UnstoredJobs,
} from "./job-endings.js";
import type {
  DaemonActivity,
  DaemonIdentity,
  UnstoredJob,
} from "./protocol.js";
import {
  changedWhileRunning,
  keptAlthoughChanged,
  notKeptVerdict,
  RunWatch,
  runVerdict,
} from "./run-judgment.js";
import { Scheduler, type DiscoverReport, type RunReport } from "./scheduler.js";
import type { DaemonHandlers } from "./server.js";
import type { EndedRun } from "./workspace-schedule.js";

const DISCOVERY_STOPPED_REASON =
  "the stop arrived during the discovery, so it was not stored";
const UNCONFIRMED_RUN_REASON =
  "the discovery listed it, but the confirmed start does not, so it was not run";
const DISCOVERY_REFUSED_ENTRY =
  "warning: the latest stored discovery was refused as unreadable, so a discovery is due as if none were stored, and no workspace runs until it is stored";

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
 * begin. A discovery is stored under the input fingerprint it started from, or not fingerprinted when its inputs
 * moved while it ran; a run is judged by its workspace's inputs alone, and interrupted with nothing stored once a
 * change inside them makes it worthless.
 */
export class DaemonLifecycle implements DaemonHandlers {
  readonly identity: DaemonIdentity;
  readonly #parts: LifecycleParts;
  readonly #builds: DependencyBuilds;
  readonly #scheduler: Scheduler;
  #activity: DaemonActivity = { state: "discovering" };
  readonly #unstored: UnstoredJobs;
  #loggedRefusal: string | undefined;
  #sequence: Promise<void> = Promise.resolve();
  #stopping: Promise<void> | undefined;
  readonly #whenStopped: Promise<void>;
  #markStopped: () => void = () => undefined;

  constructor(parts: LifecycleParts) {
    this.identity = parts.identity;
    this.#parts = parts;
    this.#unstored = new UnstoredJobs(parts.log);
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
      awaitBuild: (subject) => this.#builds.awaitBuild(subject),
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
      unstoredJobs: this.#unstored.jobs(),
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

  /** Every read notes a refused discovery, so the log holds it whole before an answer quotes it cut. */
  #latestResults(): LatestResults {
    const results = this.#parts.store.readLatestResults(this.#parts.scope);
    this.#noteRefusal(results.discoveryRefusal);
    return results;
  }

  /** Logs each refusal of the latest discovery once, as the reason a discovery is due. */
  #noteRefusal(refusal: string | undefined): void {
    if (refusal === this.#loggedRefusal) return;
    this.#loggedRefusal = refusal;
    if (refusal !== undefined) {
      this.#parts.log.entry(`${DISCOVERY_REFUSED_ENTRY}: ${refusal}`);
    }
  }

  #view(): DaemonView {
    const { activity, unstoredJobs } = this.status();
    const { consumerRoot } = this.identity;
    const { schedule } = this.#scheduler;
    return { consumerRoot, activity, unstoredJobs, schedule };
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
    const bindings = this.#bindings(
      "the discovery",
      held,
      (): FingerprintResult => {
        const now = inputs.current();
        const print = now.discoveryFingerprint(discovery);
        // Checked again once composed: an unwatched file edited since the first check was read with content it never collected.
        const moved = now.protectedFileChangedSince(discovery, startedAt);
        return moved === undefined ? print : { ok: false, reason: moved };
      },
    );
    const stored = this.#store("the discovery", undefined, () =>
      this.#builds.use(this.#parts.store.writeDiscovery(bindings, discovery)),
    );
    if (stored) log.entry(`discovery ended: ${discoverySummary(discovery)}`);
    logMissingConfirmed(discovery, start.workspaces, log);
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
    let startInputs: CurrentInputs;
    let watch: RunWatch;
    try {
      startInputs = this.#runInputs();
      watch = new RunWatch({
        entry,
        window: mark.window,
        startView: startInputs,
        builds: this.#builds,
        view: () => this.#runInputs(),
        inputsChanged: () => inputs.changed(),
        isStopping: () => this.isStopping(),
        interrupt: () => executor.abort(ABORT_PURPOSE.interruption),
        log,
      });
    } catch (error) {
      await inputs.endJob(mark);
      throw error;
    }
    const revision = startInputs.facts.revision;
    const outcome = await executor
      .run(workspace, confirmed.configFile)
      .catch((error: unknown) => threwOutcome<WorkspaceRun>(error));
    watch.runReturned();
    try {
      await inputs.endJob(mark);
      return await this.#settleRun(entry, revision, outcome, watch);
    } finally {
      await watch.close();
    }
  }

  /**
   * Stores nothing for a run its interruption ended or that left no run to store. Otherwise stores the run, judged
   * once its end revision's build has ended, with no await between that wait and the view it is judged by.
   */
  async #settleRun(
    entry: WorkspaceDiscovery,
    revision: number,
    outcome: JobOutcome<WorkspaceRun | NotConfirmedRun>,
    watch: RunWatch,
  ): Promise<RunReport> {
    const { log } = this.#parts;
    const path = entry.workspace.path;
    const job = `the run of ${path}`;
    const report = (
      stored: boolean,
      changed: boolean,
      ended: EndedRun = {},
    ): RunReport => ({
      revision,
      stored,
      changedWhileRunning: changed,
      ...ended,
    });
    const { interruption, interruptedBy = [] } = watch;
    if (interruption !== undefined && interruptedRun(outcome)) {
      this.#nothingStored(path, interruption);
      return report(false, true, { interruptedBy });
    }
    const left = runToStore(outcome);
    if ("unstored" in left) {
      this.#nothingStored(path, left.unstored);
      return report(false, changedWhileRunning(watch.judge(this.#runInputs())));
    }
    const { run } = left;
    await this.#builds.awaitBuild(`the verdict on ${job}`);
    const judgment = watch.judge(this.#runInputs());
    const bindings = this.#bindings(
      job,
      runVerdict(judgment),
      () => watch.started,
    );
    let ended: EndedRun = {};
    const stored = this.#store(job, path, () => {
      const { runId } = this.#parts.store.writeRun(bindings, run);
      const notKept = notKeptVerdict(judgment);
      ended = notKept === undefined ? { runId } : { runId, notKept };
    });
    if (stored) {
      const kept = keptAlthoughChanged(judgment);
      if (kept !== undefined) log.entry(`${job} ${kept}`);
      log.entry(
        `run ended: ${path} ${run.status}${"execution" in run ? ` ${run.execution}` : ""}`,
      );
    }
    return report(stored, changedWhileRunning(judgment), ended);
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

  /** A run is fingerprinted over the builds' narrowing for the discovery they build over, as answers compare it. */
  #runInputs(): CurrentInputs {
    return this.#parts.inputs.current(this.#builds.narrowing());
  }

  /** The job's record is bound to `fingerprint` only when its verdict says so. */
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
      this.#unstored.unlist(workspacePath);
      return true;
    } catch (error) {
      this.#parts.log.error(`storing ${what}`, error);
      this.#nothingStored(workspacePath, storeFailureReason(error));
      return false;
    }
  }

  #nothingStored(workspacePath: string | undefined, reason: string): void {
    this.#unstored.list(workspacePath, reason);
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
