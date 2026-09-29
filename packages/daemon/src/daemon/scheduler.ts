import type { InputDigests } from "../inputs/input-inventory.js";
import type { CurrentInputs, TrackedInputs } from "../inputs/input-tracker.js";
import type { QueryNarrowing } from "../inputs/narrowed-inputs.js";
import { CURRENT } from "../query/answer.js";
import { fingerprintDigest, recordFreshness } from "../query/test-states.js";
import type { LatestResults } from "../store/open-store.js";
import type { StoredRun } from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import type { DaemonLog } from "./daemon-log.js";
import {
  DUE_REASON,
  GROUP_REASON,
  orderQueue,
  queueGroup,
  retryReason,
  staleReason,
  testModulesKey,
  type QueuedWorkspace,
} from "./due-workspaces.js";
import {
  changedPaths,
  explainRound,
  NO_SELECTION_CONSEQUENCE,
} from "./round-selection.js";

/** A target until measured: how long the input revision must hold still before any discovery or run starts. */
export const QUIET_WINDOW_MS = 1_000;

const IDLE_ENTRY = "idle: no confirmed workspace is due";
const NO_SNAPSHOT_ENTRY = `warning: no selection was made, because the inputs' digests cannot be read now, ${NO_SELECTION_CONSEQUENCE}`;
const FIRST_ROUND_ENTRY =
  "round without a selection: no previous round read the inputs to compare with";

/** What a discovery job left. */
export interface DiscoverReport {
  /** Whether a discovery record was stored. */
  readonly stored: boolean;
}

/** What a run job left. */
export interface RunReport {
  /** The input revision the run began at. */
  readonly revision: number;
  /** Whether a run record was stored. */
  readonly stored: boolean;
  /** Whether the run was stored not fingerprinted because its inputs changed while it ran. */
  readonly changedWhileRunning: boolean;
}

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
  /** Undefined when the job did not begin, as `discover` says. */
  readonly run: (
    entry: WorkspaceDiscovery,
    revision: number,
  ) => Promise<RunReport | undefined>;
  readonly idle: () => void;
}

/** What the scheduler holds of the last job it started for a workspace. */
interface Attempt {
  readonly revision: number;
  readonly modules: string;
  /** Whether the run ended with nothing stored. */
  readonly nothingStored: boolean;
  /** Whether its inputs changed while it ran at a revision the change did not move, so it runs once more. */
  readonly rerunOwed: boolean;
}

/** A confirmed workspace of the discovery in effect, with its latest stored run. */
interface EligibleWorkspace {
  readonly entry: WorkspaceDiscovery;
  readonly latest: StoredRun | undefined;
}

interface DueWorkspace extends EligibleWorkspace {
  readonly reason: string;
}

type Step =
  | { readonly kind: "discover"; readonly retry: boolean }
  | { readonly kind: "run"; readonly queued: QueuedWorkspace }
  | { readonly kind: "idle" }
  /** The inputs moved after the wait ended, so the waits begin again. */
  | { readonly kind: "again" };

/**
 * Decides what the daemon discovers and runs and when: once the input revision has held still and the dependency
 * build at it has ended, it discovers again when the discovery in effect is not current, then runs each confirmed
 * workspace whose latest run is not bound to its current fingerprint, one job at a time and planning again after each.
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
  #discoveryTriedAt: number | undefined;
  #discoveryNothingStored = false;
  readonly #attempts = new Map<string, Attempt>();
  /** By workspace, the revision and list of test modules its due entry was last logged for. */
  readonly #announced = new Map<string, string>();
  #periodicSeen = 0;
  #periodicOwed = false;
  #retryDiscovery = false;
  readonly #retryWorkspaces = new Set<string>();
  /** Whether a round has done or found work since the last idle entry. */
  #dirty = true;

  constructor(parts: SchedulerParts) {
    this.#parts = parts;
  }

  /** Runs until a stop; a step that throws is logged and tried again at the next change of the inputs. */
  async start(): Promise<void> {
    await this.#parts.inputs.firstReconciled();
    this.#periodicSeen = this.#parts.inputs.periodicReconciliations();
    while (!this.#isStopping()) {
      try {
        if (!(await this.#step())) return;
      } catch (error) {
        this.#parts.log.error("a scheduling step failed", error);
        await this.#untilChangeOrStop();
      }
    }
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
      await this.#discover(revision, next.retry);
      return true;
    }
    if (next.kind === "run") {
      await this.#run(next.queued, revision);
      return true;
    }
    return next.kind === "again" || this.#idle();
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
    for (;;) {
      if (!(await this.#quietWindow())) return undefined;
      await inputs.settled();
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
    const eligible = this.#eligible(view);
    this.#armRetries(view, eligible, revision);
    if (this.#discoveryDue(revision, view)) {
      const retry = this.#retryDiscovery;
      this.#discoveryTriedAt = revision;
      this.#retryDiscovery = false;
      this.#dirty = true;
      return { kind: "discover", retry };
    }
    const due = this.#due(revision, view, eligible);
    this.#explain(revision, view, eligible, due);
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
    const stored = view.results.discovery;
    this.#retryDiscovery =
      this.#discoveryNothingStored ||
      stored?.discovery.workspaces.some(
        (entry) => entry.status === "failed",
      ) === true;
    this.#retryWorkspaces.clear();
    for (const { entry, latest } of eligible) {
      const path = entry.workspace.path;
      const stale = staleReason(
        latest,
        fingerprintDigest(view.inputs.workspaceFingerprint(entry)),
      );
      const nothingStored =
        this.#attempts.get(path)?.nothingStored === true && stale !== undefined;
      if (retryReason(latest) !== undefined || nothingStored) {
        this.#retryWorkspaces.add(path);
      }
    }
    if (!this.#retryDiscovery && this.#retryWorkspaces.size === 0) return;
    this.#dirty = true;
    this.#parts.log.entry(
      `periodic reconciliation ended at input revision ${revision}: retrying ${this.#retryDiscovery ? "the discovery and " : ""}${this.#retryWorkspaces.size} workspaces`,
    );
  }

  /** The discovery in effect is not current at this settled revision, or its retry is owed. */
  #discoveryDue(revision: number, view: ScheduleView): boolean {
    if (this.#retryDiscovery) return true;
    if (this.#discoveryTriedAt === revision) return false;
    const stored = view.results.discovery;
    if (stored === undefined) return true;
    const current = fingerprintDigest(
      view.inputs.discoveryFingerprint(stored.discovery),
    );
    return recordFreshness(stored, current) !== CURRENT;
  }

  #eligible(view: ScheduleView): EligibleWorkspace[] {
    const runs = new Map(
      view.results.latestRuns.map((run) => [run.run.workspace.path, run]),
    );
    const workspaces = view.results.discovery?.discovery.workspaces ?? [];
    return workspaces
      .filter(
        (entry) =>
          entry.status !== "not-confirmed" &&
          confirmedEntry(this.#parts.start, entry.workspace) !== undefined,
      )
      .map((entry) => ({ entry, latest: runs.get(entry.workspace.path) }));
  }

  /** Each confirmed workspace whose latest run is not bound to its current fingerprint, or whose retry is owed. */
  #due(
    revision: number,
    view: ScheduleView,
    eligible: readonly EligibleWorkspace[],
  ): DueWorkspace[] {
    const due: DueWorkspace[] = [];
    for (const { entry, latest } of eligible) {
      const path = entry.workspace.path;
      const retry = this.#retryWorkspaces.has(path);
      const reason =
        staleReason(
          latest,
          fingerprintDigest(view.inputs.workspaceFingerprint(entry)),
        ) ??
        (retry ? (retryReason(latest) ?? DUE_REASON.nothingStored) : undefined);
      if (reason === undefined) continue;
      if (!retry && this.#ranAlready(path, revision, entry)) continue;
      due.push({ entry, latest, reason });
    }
    return due;
  }

  #ranAlready(
    path: string,
    revision: number,
    entry: WorkspaceDiscovery,
  ): boolean {
    const attempt = this.#attempts.get(path);
    return (
      attempt !== undefined &&
      attempt.revision === revision &&
      attempt.modules === testModulesKey(entry) &&
      !attempt.rerunOwed
    );
  }

  /** Logs the round's selection once after each change of revision, then each due workspace once for its revision. */
  #explain(
    revision: number,
    view: ScheduleView,
    eligible: readonly EligibleWorkspace[],
    due: readonly DueWorkspace[],
  ): void {
    if (this.#selectionOwed) {
      this.#selectionOwed = false;
      this.#directTargets = this.#selectRound(revision, view, eligible, due);
    }
    for (const { entry, reason } of due) {
      const path = entry.workspace.path;
      const key = `${revision}:${testModulesKey(entry)}`;
      if (this.#announced.get(path) === key) continue;
      this.#announced.set(path, key);
      this.#parts.log.entry(`due: ${path}, ${reason}`);
    }
  }

  #selectRound(
    revision: number,
    view: ScheduleView,
    eligible: readonly EligibleWorkspace[],
    due: readonly DueWorkspace[],
  ): ReadonlySet<string> {
    const { log, narrowing } = this.#parts;
    const now = view.inputs.snapshot?.digests;
    const before = this.#snapshot;
    if (now === undefined) {
      log.entry(NO_SNAPSHOT_ENTRY);
      return new Set();
    }
    this.#snapshot = now;
    if (before === undefined) {
      log.entry(FIRST_ROUND_ENTRY);
      return new Set();
    }
    const selection = explainRound(
      log,
      narrowing(),
      revision,
      changedPaths(before, now),
    );
    const dueNow = new Set(due.map(({ entry }) => entry.workspace.path));
    const confirmed = new Set(
      eligible.map(({ entry }) => entry.workspace.path),
    );
    for (const path of selection.selected) {
      if (confirmed.has(path) && !dueNow.has(path)) {
        log.entry(
          `not run: ${path} was selected, and holds results bound to its current input fingerprint`,
        );
      }
    }
    return selection.directTargets;
  }

  /** A discovery that did not begin keeps its retry; one that throws counts as having stored nothing. */
  async #discover(revision: number, retry: boolean): Promise<void> {
    this.#dirty = true;
    const before = this.#discoveryNothingStored;
    this.#discoveryNothingStored = true;
    const report = await this.#parts.discover(revision);
    if (report !== undefined) {
      this.#discoveryNothingStored = !report.stored;
      return;
    }
    this.#discoveryNothingStored = before;
    this.#retryDiscovery ||= retry;
  }

  async #run(queued: QueuedWorkspace, revision: number): Promise<void> {
    const { log } = this.#parts;
    const { entry, group } = queued;
    const path = entry.workspace.path;
    const modules = testModulesKey(entry);
    const before = this.#attempts.get(path);
    const isRerun =
      before?.rerunOwed === true &&
      before.revision === revision &&
      before.modules === modules;
    const retried = this.#retryWorkspaces.has(path);
    this.#retryWorkspaces.delete(path);
    // Nothing is stored until the run reports, so a run that throws is retried as one whose process died.
    this.#attempts.set(path, {
      revision,
      modules,
      nothingStored: true,
      rerunOwed: false,
    });
    this.#dirty = true;
    log.entry(`next in the queue: ${path}, ${GROUP_REASON[group]}`);
    const report = await this.#parts.run(entry, revision);
    if (report === undefined) {
      if (retried) this.#retryWorkspaces.add(path);
      return;
    }
    const unmoved =
      report.changedWhileRunning && report.revision === this.#revision();
    if (unmoved && isRerun) {
      log.entry(
        `the run of ${path} was stored not fingerprinted again because its inputs changed while it ran at input revision ${report.revision}, which the change did not move, so it is held until the input revision or its list of test modules changes`,
      );
    } else if (unmoved) {
      log.entry(
        `the run of ${path} was stored not fingerprinted because its inputs changed while it ran at input revision ${report.revision}, which the change did not move, so it runs once more`,
      );
    }
    this.#attempts.set(path, {
      revision: report.revision,
      modules,
      nothingStored: !report.stored,
      rerunOwed: unmoved && !isRerun,
    });
  }

  /** Logs once after work, then waits for a change of revision or a periodic reconciliation; false after a stop. */
  async #idle(): Promise<boolean> {
    if (this.#dirty) {
      this.#dirty = false;
      this.#parts.log.entry(IDLE_ENTRY);
      this.#parts.idle();
    }
    const { inputs } = this.#parts;
    while (!this.#isStopping()) {
      if (
        this.#revision() !== this.#roundRevision ||
        inputs.periodicReconciliations() > this.#periodicSeen
      ) {
        return true;
      }
      await this.#untilChangeOrStop();
    }
    return false;
  }
}
