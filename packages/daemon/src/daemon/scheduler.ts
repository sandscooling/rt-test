import type { InputDigests } from "../inputs/input-inventory.js";
import type { CurrentInputs, TrackedInputs } from "../inputs/input-tracker.js";
import type { QueryNarrowing } from "../inputs/narrowed-inputs.js";
import { ROUND_WAIT, type DueReason, type RoundWait } from "../query/answer.js";
import { fingerprintDigest } from "../query/test-states.js";
import type { LatestResults } from "../store/open-store.js";
import type { StoredRun } from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import type { EditReport } from "./change-record.js";
import type { DaemonLog } from "./daemon-log.js";
import {
  DiscoveryHistory,
  discoveryInEffect,
  type DiscoverReport,
} from "./discovery-history.js";
import {
  DUE_REASON_TEXT,
  GROUP_REASON,
  orderQueue,
  queueGroup,
  retryOwed,
  retryReason,
  staleReason,
  testModulesKey,
  type QueuedWorkspace,
} from "./due-workspaces.js";
import { selectRound } from "./round-selection.js";
import {
  RunHistory,
  type BegunRun,
  type HistoryReport,
} from "./run-history.js";
import { roundPlacement } from "./run-judgment.js";
import {
  WorkspaceSchedule,
  type EndedRun,
  type ScheduleReader,
} from "./workspace-schedule.js";

/** A target until measured: how long the input revision must hold still before any discovery or run starts. */
export const QUIET_WINDOW_MS = 1_000;

const IDLE_ENTRY = "idle: no confirmed workspace is due";

/** What a run job left: with the stored run's id, its verdict when stored not fingerprinted, and what interrupted it. */
export interface RunReport extends EndedRun, HistoryReport {}

/** The latest stored results beside the inputs as they are now, read together. */
export interface ScheduleView {
  readonly results: LatestResults;
  readonly inputs: CurrentInputs;
}

export interface SchedulerParts {
  readonly inputs: TrackedInputs;
  readonly log: DaemonLog;
  readonly start: ConfirmedStart;
  readonly quietWindowMs: number;
  readonly isStopping: () => boolean;
  readonly view: () => ScheduleView;
  /** The dependency builds' state beside the discovery they build over. */
  readonly narrowing: () => QueryNarrowing;
  /** Resolves once the dependency build at the settled revision has ended, or none can. */
  readonly awaitBuild: (subject: string) => Promise<void>;
  /** Undefined when the job did not begin: a stop, or a revision that moved since `revision` was planned. */
  readonly discover: (revision: number) => Promise<DiscoverReport | undefined>;
  /**
   * Undefined when the job did not begin, as `discover` says, or when it refused a workspace the confirmed start does
   * not hold. `uninterruptible` says why no change may interrupt the run, when none may.
   */
  readonly run: (
    entry: WorkspaceDiscovery,
    revision: number,
    uninterruptible: string | undefined,
  ) => Promise<RunReport | undefined>;
  /**
   * Taken when a plan at `revision` finds no discovery and no workspace due: one look for waiting defect definitions
   * and at most one falsification job. Resolves true when the round is to be planned again, whether a job began or
   * the look only found a workspace it cannot send a job for.
   */
  readonly falsify: (revision: number) => Promise<boolean>;
  readonly idle: () => void;
}

/** A confirmed workspace of the discovery in effect, with its latest stored run. */
interface EligibleWorkspace {
  readonly entry: WorkspaceDiscovery;
  readonly latest: StoredRun | undefined;
  /** Whether the run stored last was refused as unreadable, which leaves no latest run. */
  readonly refused: boolean;
}

interface DueWorkspace extends EligibleWorkspace {
  readonly reason: DueReason;
}

type Step =
  | { readonly kind: "discover" }
  /** A once-more discovery waits out the end check's modification-time tolerance, or the next change of the inputs. */
  | { readonly kind: "wait"; readonly ms: number }
  | { readonly kind: "run"; readonly queued: QueuedWorkspace }
  | { readonly kind: "idle" }
  /** The inputs moved after the wait ended, so the waits begin again. */
  | { readonly kind: "again" };

/**
 * Decides what the daemon discovers and runs and when: once the input revision has held still and the dependency
 * build at it has ended, it discovers again when the discovery in effect is not current, then runs each confirmed
 * workspace whose latest run is not bound to its current fingerprint, one job at a time and planning again after each.
 * When none of those is due it takes one falsification look, and plans again after a job of it.
 */
export class Scheduler {
  readonly #parts: SchedulerParts;
  #stopped = false;
  /** Wakes every wait a stop must end. */
  readonly #stopWaiters = new Set<() => void>();
  #windowRevision: number | undefined;
  #windowStart = 0;
  /** The revision the latest plan read. */
  #roundRevision: number | undefined;
  #selectionOwed = false;
  /** The inputs the latest round that made or tried a selection read. */
  #snapshot: InputDigests | undefined;
  #directTargets: ReadonlySet<string> = new Set();
  readonly #runs: RunHistory;
  readonly #discoveries: DiscoveryHistory;
  /** By workspace, the revision and list of test modules its due entry was last logged for. */
  readonly #announced = new Map<string, string>();
  #periodicSeen = 0;
  #periodicOwed = false;
  readonly #retryWorkspaces = new Set<string>();
  /** Whether a round has done or found work since the last idle entry. */
  #dirty = true;
  readonly #schedule: WorkspaceSchedule;

  constructor(parts: SchedulerParts) {
    this.#parts = parts;
    this.#runs = new RunHistory({
      log: parts.log,
      revision: () => this.#revision(),
    });
    this.#discoveries = new DiscoveryHistory({
      log: parts.log,
      revision: () => this.#revision(),
      changedAt: () => this.#windowStart,
      changes: this.#runs,
    });
    this.#schedule = new WorkspaceSchedule({
      confirmed: (entry) => this.#confirmed(entry),
      storedNothing: (path) => this.#runs.storedNothing(path),
      heldBy: (path) => this.#runs.heldBy(path),
      discoveryHeldBy: () => this.#discoveries.heldBy(),
    });
  }

  /** What the scheduler is doing, as every answer reads it. */
  get schedule(): ScheduleReader {
    return this.#schedule;
  }

  /** Runs until a stop; a step that throws is logged and tried again at the next input event or reconciliation. */
  async start(): Promise<void> {
    await this.#parts.inputs.firstReconciled();
    this.#periodicSeen = this.#parts.inputs.periodicReconciliations();
    while (!this.#isStopping()) {
      try {
        if (!(await this.#step())) return;
      } catch (error) {
        this.#schedule.held(errorText(error));
        this.#parts.log.error("a scheduling step failed", error);
        await this.#untilChangeOrStop();
      }
    }
  }

  /** A caller's report of the input keys it edited, whose every change counts as an edit, never a job's. */
  reportEdits(keys: readonly string[]): EditReport {
    return this.#runs.reportEdits(keys);
  }

  /** Releases every wait, and with it the quiet window's timer; nothing starts after it. */
  stop(): void {
    this.#stopped = true;
    for (const wake of this.#stopWaiters) wake();
  }

  async #step(): Promise<boolean> {
    const revision = await this.#quiesce();
    if (revision === undefined) return false;
    const next = this.#plan(revision);
    if (next.kind === "discover") {
      await this.#discover(revision);
      return true;
    }
    if (next.kind === "wait") {
      await this.#untilChangeOrStop(next.ms);
      return true;
    }
    if (next.kind === "run") {
      await this.#run(next.queued, revision);
      return true;
    }
    if (next.kind === "again") return true;
    return (await this.#falsify(revision)) || this.#idle();
  }

  /** A job in progress at the planned revision leaves the plan in effect, and a later revision's round reads it. */
  async #falsify(revision: number): Promise<boolean> {
    const again = await this.#schedule.during(
      this.#parts.falsify(revision),
      revision,
    );
    if (again) this.#dirty = true;
    return again;
  }

  #isStopping(): boolean {
    return this.#stopped || this.#parts.isStopping();
  }

  #revision(): number {
    return this.#parts.inputs.current().facts.revision;
  }

  /**
   * The revision once it has held still for the quiet window, its events are read and its dependency build has ended;
   * undefined after a stop. A revision that moves during the waits starts them again.
   */
  async #quiesce(): Promise<number | undefined> {
    const { inputs, awaitBuild } = this.#parts;
    const waiting = (wait: RoundWait): void =>
      this.#schedule.waiting(wait, this.#revision());
    for (;;) {
      waiting(ROUND_WAIT.quietWindow);
      if (!(await this.#quietWindow())) return undefined;
      waiting(ROUND_WAIT.inputsSettling);
      await inputs.settled();
      waiting(ROUND_WAIT.dependencyBuild);
      await awaitBuild("the round");
      if (this.#isStopping()) return undefined;
      const revision = this.#revision();
      if (revision === this.#windowRevision) return revision;
    }
  }

  /** Resolves true once the revision has held still for the window, timed from its last change. */
  async #quietWindow(): Promise<boolean> {
    for (;;) {
      if (this.#isStopping()) return false;
      const revision = this.#revision();
      if (revision !== this.#windowRevision) {
        this.#windowRevision = revision;
        this.#windowStart = performance.now();
      }
      const remaining =
        this.#windowStart + this.#parts.quietWindowMs - performance.now();
      if (remaining <= 0) return true;
      await this.#untilChangeOrStop(remaining);
    }
  }

  /** Resolves at the next change of the inputs, a stop, or `timeoutMs`; each reaction it holds is released on the way out. */
  #untilChangeOrStop(timeoutMs?: number): Promise<void> {
    let release = (): void => undefined;
    const waited = new Promise<void>((resolve) => {
      const timer =
        timeoutMs === undefined ? undefined : setTimeout(resolve, timeoutMs);
      this.#stopWaiters.add(resolve);
      release = () => {
        clearTimeout(timer);
        this.#stopWaiters.delete(resolve);
      };
      void this.#parts.inputs.changed().then(resolve);
    });
    return waited.finally(release);
  }

  /** Reads no more than the state now and starts nothing, so the caller starts the step with no await between. */
  #plan(revision: number): Step {
    const view = this.#parts.view();
    if (view.inputs.facts.revision !== revision) return { kind: "again" };
    this.#noteRevision(revision);
    this.#runs.observed(view.inputs.snapshot?.comparedDigests);
    const inEffect = discoveryInEffect(view.results, view.inputs);
    this.#discoveries.decide(inEffect);
    const eligible = this.#eligible(view);
    this.#armRetries(view, eligible, revision);
    const wait = this.#discoveries.due(revision, inEffect);
    if (wait !== undefined) {
      this.#schedule.pending(ROUND_WAIT.rediscovery);
      if (wait > 0) return { kind: "wait", ms: wait };
      this.#dirty = true;
      return { kind: "discover" };
    }
    const due = this.#due(revision, view, eligible);
    this.#explain(revision, view, eligible, due);
    this.#schedule.planned(
      revision,
      new Map(due.map(({ entry, reason }) => [entry.workspace.path, reason])),
    );
    const [queued] = orderQueue(
      due.map(({ entry, reason, latest }) => ({
        entry,
        reason,
        group: queueGroup(entry.workspace.path, latest, this.#directTargets),
      })),
    );
    return queued === undefined ? { kind: "idle" } : { kind: "run", queued };
  }

  #noteRevision(revision: number): void {
    if (revision === this.#roundRevision) return;
    this.#roundRevision = revision;
    this.#selectionOwed = true;
    this.#dirty = true;
  }

  /** At most once per periodic reconciliation: what failed or crashed with no input change to blame, or stored nothing while still due, is due again. */
  #armRetries(
    view: ScheduleView,
    eligible: readonly EligibleWorkspace[],
    revision: number,
  ): void {
    const ended = this.#parts.inputs.periodicReconciliations();
    if (ended > this.#periodicSeen) {
      this.#periodicSeen = ended;
      this.#periodicOwed = true;
    }
    if (!this.#periodicOwed) return;
    this.#periodicOwed = false;
    const retryDiscovery = this.#discoveries.armRetry(
      view.results.discovery?.discovery.workspaces.some(
        (entry) => entry.status === "failed",
      ) === true,
    );
    this.#retryWorkspaces.clear();
    for (const { entry, latest, refused } of eligible) {
      const path = entry.workspace.path;
      if (this.#runs.isHeld(path)) continue;
      const stale = staleReason(
        latest,
        fingerprintDigest(view.inputs.workspaceFingerprint(entry)),
        refused,
      );
      if (retryOwed(latest, stale, this.#runs.storedNothing(path))) {
        this.#retryWorkspaces.add(path);
      }
    }
    if (!retryDiscovery && this.#retryWorkspaces.size === 0) return;
    this.#dirty = true;
    this.#parts.log.entry(
      `periodic reconciliation ended at input revision ${revision}: retrying ${retryDiscovery ? "the discovery and " : ""}${this.#retryWorkspaces.size} workspaces`,
    );
  }

  #eligible(view: ScheduleView): EligibleWorkspace[] {
    const runs = new Map(
      view.results.latestRuns.map((run) => [run.run.workspace.path, run]),
    );
    const refused = new Set(
      view.results.runRefusals.map((refusal) => refusal.workspacePath),
    );
    const workspaces = view.results.discovery?.discovery.workspaces ?? [];
    return workspaces
      .filter((entry) => this.#confirmed(entry))
      .map((entry) => ({
        entry,
        latest: runs.get(entry.workspace.path),
        refused: refused.has(entry.workspace.path),
      }));
  }

  /** The discovery lists the workspace confirmed and the confirmed start holds it, so it can run. */
  #confirmed(entry: WorkspaceDiscovery): boolean {
    return (
      entry.status !== "not-confirmed" &&
      confirmedEntry(this.#parts.start, entry.workspace) !== undefined
    );
  }

  /**
   * Each confirmed workspace whose latest run is not bound to its current fingerprint, or failed or crashed while its
   * retry is owed, and that its count does not hold.
   */
  #due(
    revision: number,
    view: ScheduleView,
    eligible: readonly EligibleWorkspace[],
  ): DueWorkspace[] {
    const placement = roundPlacement(view.inputs, this.#parts.narrowing());
    const due: DueWorkspace[] = [];
    for (const { entry, latest, refused } of eligible) {
      const path = entry.workspace.path;
      const retry = this.#retryWorkspaces.has(path);
      const print = view.inputs.workspaceFingerprint(entry);
      const stale = staleReason(latest, fingerprintDigest(print), refused);
      const reason = stale ?? (retry ? retryReason(latest) : undefined);
      if (reason === undefined) continue;
      const retryOnly = stale === undefined;
      const fingerprinted = print.ok;
      if (this.#runs.decide({ entry, retryOnly, fingerprinted, placement })) {
        this.#retryWorkspaces.delete(path);
        continue;
      }
      if (!retry && this.#runs.ranAlready(path, revision, entry)) continue;
      due.push({ entry, latest, refused, reason });
    }
    return due;
  }

  /** Logs the round's selection once after each change of revision, then each due workspace once for its revision. */
  #explain(
    revision: number,
    view: ScheduleView,
    eligible: readonly EligibleWorkspace[],
    due: readonly DueWorkspace[],
  ): void {
    if (this.#selectionOwed) {
      const { selection, snapshot } = selectRound(revision, {
        log: this.#parts.log,
        narrowing: this.#parts.narrowing,
        before: this.#snapshot,
        now: view.inputs.snapshot?.comparedDigests,
        due: due.map(({ entry }) => entry.workspace.path),
        confirmed: eligible.map(({ entry }) => entry.workspace.path),
        isHeld: (path) => this.#runs.isHeld(path),
      });
      this.#snapshot = snapshot;
      this.#selectionOwed = false;
      this.#directTargets = selection.directTargets;
      this.#schedule.selected(selection.explanation);
    }
    for (const { entry, reason } of due) {
      const path = entry.workspace.path;
      const key = `${revision}:${testModulesKey(entry)}`;
      if (this.#announced.get(path) === key) continue;
      this.#announced.set(path, key);
      this.#parts.log.entry(`due: ${path}, ${DUE_REASON_TEXT[reason]}`);
    }
  }

  /** A discovery that did not begin leaves the record as it was, its retry kept; one that throws counts as having stored nothing. */
  async #discover(revision: number): Promise<void> {
    this.#dirty = true;
    const begun = this.#discoveries.began(revision);
    let report: DiscoverReport | undefined;
    try {
      report = await this.#schedule.during(
        this.#parts.discover(revision),
        revision,
      );
    } catch (error) {
      begun.threw();
      throw error;
    }
    if (report === undefined) begun.notBegun();
    else begun.ended(report);
  }

  async #run(queued: QueuedWorkspace, revision: number): Promise<void> {
    const { log } = this.#parts;
    const { entry, group } = queued;
    const path = entry.workspace.path;
    const retried = this.#retryWorkspaces.has(path);
    this.#retryWorkspaces.delete(path);
    const uninterruptible = this.#runs.uninterruptible(path);
    const begun = this.#runs.began(entry, revision);
    this.#dirty = true;
    log.entry(`next in the queue: ${path}, ${GROUP_REASON[group]}`);
    const report = await this.#runJob(entry, revision, uninterruptible, begun);
    if (report === undefined) {
      const refusedAtPlan =
        !this.#isStopping() && this.#revision() === revision;
      // Defensive: the lifecycle refuses only what its start does not confirm, which #eligible leaves out. A refused
      // workspace keeps its attempt as having stored nothing, so each periodic reconciliation re-arms its retry.
      if (refusedAtPlan) {
        begun.refused();
        return;
      }
      begun.notBegun();
      if (retried) this.#retryWorkspaces.add(path);
      return;
    }
    const owedAgain = begun.ended(report);
    this.#schedule.runEnded(path, report, owedAgain);
  }

  /** A run that throws has ended as surely as one that returns, so it leaves the plan's due list before the throw goes on. */
  async #runJob(
    entry: WorkspaceDiscovery,
    revision: number,
    uninterruptible: string | undefined,
    begun: BegunRun,
  ): Promise<RunReport | undefined> {
    try {
      return await this.#schedule.during(
        this.#parts.run(entry, revision, uninterruptible),
        revision,
      );
    } catch (error) {
      this.#schedule.runThrew(entry.workspace.path);
      begun.threw();
      throw error;
    }
  }

  /**
   * Waits for a change of revision or a periodic reconciliation, logging once after work when neither has come since
   * the plan; false after a stop.
   */
  async #idle(): Promise<boolean> {
    const { inputs } = this.#parts;
    while (!this.#isStopping()) {
      if (
        this.#revision() !== this.#roundRevision ||
        inputs.periodicReconciliations() > this.#periodicSeen
      ) {
        return true;
      }
      if (this.#dirty) {
        this.#dirty = false;
        this.#parts.log.entry(IDLE_ENTRY);
        this.#parts.idle();
      }
      await this.#untilChangeOrStop();
    }
    return false;
  }
}
