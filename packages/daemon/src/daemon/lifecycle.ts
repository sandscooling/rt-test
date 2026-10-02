import type { FingerprintResult } from "../inputs/fingerprint.js";
import type { CurrentInputs, TrackedInputs } from "../inputs/input-tracker.js";
import { narrowingAt, type QueryNarrowing } from "../inputs/narrowed-inputs.js";
import type {
  NoAnswer,
  PathStatusAnswer,
  RefusedQuery,
  SummaryAnswer,
  WaitAnswer,
} from "../query/answer.js";
import type { ChangesAnswer } from "../query/changes-answer.js";
import { defectsAnswer, type DefectsAnswer } from "../query/defects-answer.js";
import { resolveCallerPath } from "../query/caller-paths.js";
import { pathStatusAnswer, withoutFingerprints } from "../query/path-status.js";
import { summaryAnswer, type DaemonView } from "../query/summary.js";
import type { LatestResults, RtTestStore } from "../store/open-store.js";
import type { StoredDiscovery, StoreScope } from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import { collectionLog, listsToCarry, refreshLists } from "./carried-lists.js";
import { Changes, type ChangesMoment } from "./changes.js";
import type { DaemonLog } from "./daemon-log.js";
import { DependencyBuilds } from "./dependency-builds.js";
import { ABORT_PURPOSE, type Executor, type RunOutcome } from "./executor.js";
import { Falsification, type FalsificationParts } from "./falsification.js";
import {
  DISCOVERY_STOPPED_REASON,
  discoverySummary,
  interruptedRun,
  logMissingConfirmed,
  protectDiscovered,
  runStoredEntry,
  runToStore,
  storeBindings,
  storeFailureReason,
  threwOutcome,
  UnstoredJobs,
} from "./job-endings.js";
import type { DaemonActivity, DaemonIdentity } from "./protocol.js";
import { RefusalNotes } from "./refusal-notes.js";
import {
  changedWhileRunning,
  keptAlthoughChanged,
  notKeptVerdict,
  RunWatch,
  runVerdict,
} from "./run-judgment.js";
import type { DiscoverReport } from "./discovery-history.js";
import { Scheduler, type RunReport } from "./scheduler.js";
import type { ChangesQuery, DaemonHandlers, WaitQuery } from "./server.js";
import { StopSequence } from "./stop-sequence.js";
import { NOT_AWAITED_REASON, Waits } from "./waits.js";
import type { EndedRun } from "./workspace-schedule.js";

const NOT_INTERRUPTED =
  "will not be interrupted by a change, so it runs to its end, and a change inside its inputs while it runs leaves the run it stores invalidated";
const UNCONFIRMED_RUN_REASON =
  "the discovery listed it, but the confirmed start does not, so it was not run";

export interface LifecycleParts {
  readonly identity: DaemonIdentity;
  readonly scope: StoreScope;
  readonly start: ConfirmedStart;
  readonly store: RtTestStore;
  readonly log: DaemonLog;
  readonly executor: Executor;
  /** Its canary jobs run on `executor`, so a stop's abort of that executor reaches one. */
  readonly canaryGate: FalsificationParts["canaryGate"];
  /** Takes the dependency builds, so a build never waits behind a run. */
  readonly buildExecutor: Executor;
  /**
   * Holds each dependency build's parse record. Never the state directory: Windows watches the whole root, the state
   * directory in it by default, and a write around every parse overflows that watch.
   */
  readonly parseRecordDirectory: string;
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
 * change inside them makes it worthless. While nothing is due, it falsifies the waiting defect definitions of each
 * workspace whose Vitest install the canary gate holds a confirmed reading of, and takes a canary job first for an
 * install the gate holds no reading of.
 */
export class DaemonLifecycle implements DaemonHandlers {
  readonly identity: DaemonIdentity;
  readonly #parts: LifecycleParts;
  readonly #builds: DependencyBuilds;
  readonly #scheduler: Scheduler;
  readonly #waits: Waits;
  readonly #changes: Changes;
  readonly #falsification: Falsification;
  #activity: DaemonActivity = { state: "discovering" };
  readonly #unstored: UnstoredJobs;
  readonly #refusals: RefusalNotes;
  #sequence: Promise<void> = Promise.resolve();
  readonly #stopBegun = new AbortController();
  readonly stopSignal: AbortSignal = this.#stopBegun.signal;
  readonly #whenStopped: Promise<void>;
  #markStopped: () => void = () => undefined;

  constructor(parts: LifecycleParts) {
    this.identity = parts.identity;
    this.#parts = parts;
    this.#unstored = new UnstoredJobs(parts.log);
    this.#refusals = new RefusalNotes(parts.log);
    this.#builds = new DependencyBuilds({
      inputs: parts.inputs,
      executor: parts.buildExecutor,
      consumerRoot: parts.start.consumerRoot,
      parseRecordDirectory: parts.parseRecordDirectory,
      log: parts.log,
    });
    this.#falsification = new Falsification({
      ...parts,
      stopSignal: this.stopSignal,
      moment: () => this.#moment(),
      setActivity: (activity) => {
        this.#activity = activity;
      },
    });
    this.#scheduler = new Scheduler({
      inputs: parts.inputs,
      log: parts.log,
      start: parts.start,
      quietWindowMs: parts.quietWindowMs,
      isStopping: () => this.isStopping(),
      view: () => this.#moment(),
      narrowing: () => this.#builds.narrowing(),
      awaitBuild: (subject) => this.#builds.awaitBuild(subject),
      discover: (revision) => this.#idleAfter(this.#discover(revision)),
      run: (entry, revision, uninterruptible) =>
        this.#idleAfter(this.#run(entry, revision, uninterruptible)),
      falsify: (revision) =>
        this.#idleAfter(this.#falsification.look(revision)),
      idle: () => {
        this.#activity = { state: "idle" };
      },
    });
    const reading = {
      consumerRoot: parts.identity.consumerRoot,
      inputs: parts.inputs,
      builds: this.#builds,
      stopSignal: this.stopSignal,
      moment: () => this.#moment(),
    };
    this.#waits = new Waits({ ...reading, schedule: this.#scheduler.schedule });
    this.#changes = new Changes({
      ...reading,
      log: parts.log,
      reportEdits: (keys) => this.#scheduler.reportEdits(keys),
    });
    this.#whenStopped = new Promise((resolve) => {
      this.#markStopped = resolve;
    });
  }

  begin(): void {
    this.#protectStoredDiscovery();
    this.#parts.inputs.start();
    this.#builds.start();
    this.#changes.start();
    this.#sequence = this.#scheduler
      .start()
      .catch((error: unknown) => {
        this.#parts.log.error("the scheduler failed", error);
      })
      .finally(() => {
        this.#activity = { state: "idle" };
      });
  }

  status(): ReturnType<DaemonHandlers["status"]> {
    return {
      activity: this.#activity,
      stopping: this.isStopping(),
      unstoredJobs: [
        ...this.#unstored.jobs(),
        ...this.#falsification.entries(),
      ],
    };
  }

  summary(): SummaryAnswer | NoAnswer {
    const results = this.#latestResults();
    return summaryAnswer(results, this.#view(), this.#queryInputs(results));
  }

  /**
   * Reads the path through the tracker before it answers, and a refused path not at all. Once `signal` aborts nobody
   * waits for the answer, and a stop may have closed the store, so it reads nothing more.
   */
  async pathStatus(
    path: string,
    signal: AbortSignal,
  ): Promise<PathStatusAnswer | NoAnswer> {
    const target = resolveCallerPath(path, this.identity.consumerRoot);
    if (!target.ok) return { noAnswer: target.reason };
    const unread = await this.#parts.inputs.readNamed([target.path]);
    if (signal.aborted) return { noAnswer: NOT_AWAITED_REASON };
    const results = this.#latestResults();
    return pathStatusAnswer(
      target,
      results,
      this.#view(),
      withoutFingerprints(this.#queryInputs(results), unread),
    );
  }

  wait(
    query: WaitQuery,
    signal: AbortSignal,
  ): Promise<WaitAnswer | NoAnswer | RefusedQuery> {
    return this.#waits.wait(query, signal);
  }

  changes(
    query: ChangesQuery,
    signal: AbortSignal,
  ): Promise<ChangesAnswer | NoAnswer | RefusedQuery> {
    return this.#changes.answer(query, signal);
  }

  /** Hands over the moment as a call, since the answer takes it only once its file reads have ended. */
  defects(
    path: string | undefined,
    signal: AbortSignal,
  ): Promise<DefectsAnswer | NoAnswer> {
    return defectsAnswer({
      path,
      consumerRoot: this.identity.consumerRoot,
      stateDirectory: this.identity.stateDirectory,
      signal,
      moment: () => this.#moment(),
    });
  }

  /** The latest stored results, the daemon's view, and the inputs narrowed for them with the narrowing at their revision. */
  #moment(): ChangesMoment {
    const results = this.#latestResults();
    const query = this.#queryNarrowing(results);
    const inputs = this.#parts.inputs.current(query);
    const narrowing = narrowingAt(query, inputs.facts.revision);
    return { results, view: this.#view(), inputs, narrowing };
  }

  #queryInputs(results: LatestResults): CurrentInputs {
    return this.#parts.inputs.current(this.#queryNarrowing(results));
  }

  /**
   * The builds' state, which narrows the inputs only while they build over the stored discovery the answer reads, which
   * becomes theirs when a failed read at start left them none.
   */
  #queryNarrowing(results: LatestResults): QueryNarrowing {
    if (results.discovery !== undefined) this.#builds.use(results.discovery);
    return {
      ...this.#builds.narrowing(),
      discoveryId: results.discovery?.discoveryId,
    };
  }

  isStopping(): boolean {
    return this.stopSignal.aborted;
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

  /** Every read notes each refusal it holds, so the log holds it whole before an answer quotes it cut. */
  #latestResults(): LatestResults {
    const results = this.#parts.store.readLatestResults(this.#parts.scope);
    this.#refusals.note(results);
    return results;
  }

  #view(): DaemonView {
    const { activity, unstoredJobs } = this.status();
    const { consumerRoot } = this.identity;
    const { schedule } = this.#scheduler;
    return { consumerRoot, activity, unstoredJobs, schedule };
  }

  stop(): void {
    if (this.isStopping()) return;
    this.#stopBegun.abort();
    void this.#stopSequence()
      .catch((error: unknown) => {
        this.#parts.log.error("the stop sequence failed", error);
      })
      .finally(() => this.#markStopped());
  }

  #stopSequence(): Promise<void> {
    return new StopSequence(
      this.#parts,
      this.#scheduler,
      this.#builds,
      this.#sequence,
    ).run();
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
    const report = (stored: boolean, changed = false): DiscoverReport => ({
      stored,
      changedWhileRunning: stored && changed,
      window: mark.window,
    });
    const carried = listsToCarry(() => this.#latestResults(), log);
    const startedAt = Date.now();
    const outcome = await executor
      .discover(start, carried)
      .catch((error: unknown) => threwOutcome<TestDiscovery>(error));
    const verdict = await inputs.endJob(mark);
    if (!outcome.ended) {
      this.#nothingStored(undefined, outcome.reason);
      return report(false);
    }
    const discovery = outcome.value;
    for (const entry of collectionLog(outcome)) log.entry(entry);
    const held = await protectDiscovered(
      inputs,
      () => this.isStopping(),
      discovery,
      verdict,
      startedAt,
    );
    if (this.isStopping()) {
      this.#nothingStored(undefined, DISCOVERY_STOPPED_REASON);
      return report(false);
    }
    let movedOnceComposed = false;
    const bindings = storeBindings(
      this.#parts,
      "the discovery",
      held,
      (): FingerprintResult => {
        const now = inputs.current();
        const print = now.discoveryFingerprint(discovery);
        // Checked again once composed: an unwatched file edited since the first check was read with content it never collected.
        const moved = now.protectedFileChangedSince(discovery, startedAt);
        movedOnceComposed = moved !== undefined;
        return moved === undefined ? print : { ok: false, reason: moved };
      },
    );
    const stored = this.#store("the discovery", undefined, () =>
      this.#builds.use(this.#parts.store.writeDiscovery(bindings, discovery)),
    );
    if (stored) log.entry(`discovery ended: ${discoverySummary(discovery)}`);
    logMissingConfirmed(discovery, start.workspaces, log);
    const changed =
      movedOnceComposed || (!held.fingerprinted && held.changedWhileRunning);
    return report(stored, changed);
  }

  /**
   * Undefined when the run did not begin: a stop, a revision that moved since it was planned, or a workspace the start
   * does not confirm. `uninterruptible` says why no change may interrupt it, when none may.
   */
  async #run(
    entry: WorkspaceDiscovery,
    plannedRevision: number,
    uninterruptible: string | undefined,
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
    if (uninterruptible !== undefined) {
      log.entry(
        `the run of ${workspace.path} ${NOT_INTERRUPTED}: ${uninterruptible}`,
      );
    }
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
        interrupt:
          uninterruptible === undefined
            ? () => executor.abort(ABORT_PURPOSE.interruption)
            : () => false,
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
    outcome: RunOutcome,
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
      window: watch.window,
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
    const bindings = storeBindings(
      this.#parts,
      job,
      runVerdict(judgment),
      () => watch.started,
    );
    let ended: EndedRun = {};
    const stored = this.#store(job, path, () => {
      const { runId } = this.#parts.store.writeRun(bindings, run);
      log.entry(runStoredEntry(path, bindings));
      const notKept = notKeptVerdict(judgment);
      ended = notKept === undefined ? { runId } : { runId, notKept };
    });
    if (stored) {
      const kept = keptAlthoughChanged(judgment);
      if (kept !== undefined) log.entry(`${job} ${kept}`);
      log.entry(
        `run ended: ${path} ${run.status}${"execution" in run ? ` ${run.execution}` : ""}`,
      );
      refreshLists(this.#parts, path, outcome, (refreshed, what) => {
        this.#builds.use(refreshed);
        this.#waits.moved();
        this.#changes.stored(what);
      });
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

  /** Returns whether the record was stored; a stored one leaves the list of jobs that stored nothing, and a failed write is logged and listed. */
  #store(
    what: string,
    workspacePath: string | undefined,
    write: () => unknown,
  ): boolean {
    try {
      write();
      this.#unstored.unlist(workspacePath);
      this.#waits.moved();
      this.#changes.stored(`storing ${what}`);
      return true;
    } catch (error) {
      this.#parts.log.error(`storing ${what}`, error);
      this.#nothingStored(workspacePath, storeFailureReason(error));
      return false;
    }
  }

  #nothingStored(workspacePath: string | undefined, reason: string): void {
    this.#unstored.list(workspacePath, reason);
    this.#waits.moved();
  }
}
