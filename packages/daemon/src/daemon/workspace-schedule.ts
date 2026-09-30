import type { FingerprintResult } from "../inputs/fingerprint.js";
import { MAX_NAMED_CHANGES } from "../inputs/input-jobs.js";
import {
  DUE_REASON,
  EARLIER_DAEMON_LIFE,
  EXECUTION_STATE,
  IDLE_REASON,
  INVALIDATED,
  ROUND,
  ROUND_SELECTION,
  ROUND_WAIT,
  type ChoosingReason,
  type CutReason,
  type DueFacts,
  type DueReason,
  type ExplainedFallback,
  type ExplainedPath,
  type NamedList,
  type NotSelfChangingReason,
  type RoundFacts,
  type RoundWait,
  type ScheduleFacts,
  type SelectionExplanation,
  type SelfChangedPath,
  type WorkspaceExecution,
} from "../query/answer.js";
import { cutReason } from "../query/summary.js";
import { fingerprintDigest } from "../query/test-states.js";
import type { StoredRun } from "../store/stored-records.js";
import type {
  BroadFallback,
  ChangedPathReport,
  PathSelection,
} from "../selection/selection-types.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import type { JobsByPath } from "./change-record.js";
import { retryOwed, retryReason, staleReason } from "./due-workspaces.js";
import type { DaemonActivity } from "./protocol.js";
import type { RoundExplanation } from "./round-selection.js";
import { labelsInvalidated, type NotKeptVerdict } from "./run-judgment.js";

/** How many changed paths and broad fallbacks an answer names, and how many workspaces within each. */
export const MAX_EXPLAINED = 20;
/** How many of the reasons the latest round's selection chose it a queued workspace names. */
const MAX_CHOOSING_REASONS = 3;

type RecordedRound =
  | { readonly state: typeof ROUND.pending }
  | {
      readonly state: typeof ROUND.planned;
      readonly revision: number;
      /** Each workspace the plan found due whose run has not ended since, or is owed once more. */
      readonly due: Map<string, DueReason>;
    }
  | { readonly state: typeof ROUND.held; readonly failure: string };

type IdleExecution = Extract<
  WorkspaceExecution,
  { readonly state: typeof EXECUTION_STATE.idle }
>;

/** A run this daemon stored, with why it was stored not fingerprinted when it was. */
interface StoredVerdict {
  readonly runId: string;
  readonly notKept: NotKeptVerdict | undefined;
}

/** What a run job left that the schedule reads. */
export interface EndedRun {
  readonly runId?: string;
  readonly notKept?: NotKeptVerdict;
  readonly interruptedBy?: readonly string[];
}

/** What an answer reads the schedule against. */
export interface ScheduleQuery {
  readonly revision: number;
  readonly activity: DaemonActivity;
  /** The discovery in effect's workspaces; empty when none is stored. */
  readonly workspaces: readonly WorkspaceDiscovery[];
  readonly latestRuns: ReadonlyMap<string, StoredRun>;
  /** Why each workspace's run stored last was refused as unreadable, by workspace path; none of them is in `latestRuns`. */
  readonly refusedRuns: ReadonlyMap<string, string>;
  readonly fingerprint: (entry: WorkspaceDiscovery) => FingerprintResult;
}

/** What every answer reads of the schedule; reading starts nothing and changes nothing. */
export interface ScheduleReader {
  read(query: ScheduleQuery): {
    readonly schedule: ScheduleFacts;
    readonly latestSelection: SelectionExplanation;
  };
  round(revision: number): RoundFacts;
  /** The invalidated label's reason, only for the very run this daemon stored and held the verdict for. */
  invalidation(run: StoredRun): CutReason | undefined;
  /**
   * Resolves at the next change of the record: a round begins, waits, is planned or held, its selection is explained,
   * or a job begins, ends or throws.
   */
  moved(): Promise<void>;
}

export interface ScheduleParts {
  /** Whether the scheduler runs the workspace: the discovery lists it confirmed and the confirmed start holds it. */
  readonly confirmed: (entry: WorkspaceDiscovery) => boolean;
  /** Whether the last run attempted for the workspace ended with nothing stored. */
  readonly storedNothing: (path: string) => boolean;
  /** The paths that changed each time a held workspace became due, with their jobs; undefined when it is not held. */
  readonly heldBy: (path: string) => JobsByPath | undefined;
  /** The paths that changed each time the held discovery became due, with their jobs; undefined when it is not held. */
  readonly discoveryHeldBy: () => JobsByPath | undefined;
}

/** The scheduler's record of what it is doing with each confirmed workspace, and the one read every answer gives of it. */
export class WorkspaceSchedule implements ScheduleReader {
  readonly #parts: ScheduleParts;
  #round: RecordedRound = { state: ROUND.pending };
  /** What the scheduler waits for now, which a pending round names. */
  #wait: RoundWait = ROUND_WAIT.firstReconciliation;
  /** The revision the job in progress was planned at; undefined while none is. */
  #jobRevision: number | undefined;
  #explanation: RoundExplanation | undefined;
  /** By workspace, the reasons the latest selection chose it, indexed once per selection rather than per answer. */
  #chosen: ReadonlyMap<string, NamedList<ChoosingReason>> = new Map();
  /** Each workspace a change interrupted, until the next round decides it. */
  readonly #interrupted = new Set<string>();
  /** The paths that interrupted each workspace's last run, until its next run ends. */
  readonly #interruptions = new Map<string, readonly string[]>();
  /** Each workspace's latest run stored in this daemon life. */
  readonly #stored = new Map<string, StoredVerdict>();
  #movedWaiters: (() => void)[] = [];

  constructor(parts: ScheduleParts) {
    this.#parts = parts;
  }

  moved(): Promise<void> {
    return new Promise((resolve) => this.#movedWaiters.push(resolve));
  }

  #move(): void {
    const waiting = this.#movedWaiters;
    this.#movedWaiters = [];
    for (const resolve of waiting) resolve();
  }

  pending(waitsFor: RoundWait): void {
    this.#wait = waitsFor;
    this.#round = { state: ROUND.pending };
    this.#move();
  }

  /** A wait at the revision the latest plan read leaves that plan in effect, so its workspaces stay queued. */
  waiting(waitsFor: RoundWait, revision: number): void {
    const round = this.#round;
    this.#move();
    if (round.state === ROUND.planned && round.revision === revision) {
      this.#wait = waitsFor;
      return;
    }
    this.pending(waitsFor);
  }

  /** The round decided each workspace; every one not in `due` is idle. */
  planned(revision: number, due: ReadonlyMap<string, DueReason>): void {
    this.#round = { state: ROUND.planned, revision, due: new Map(due) };
    this.#interrupted.clear();
    this.#move();
  }

  /** A step failed, so no round comes until the next input change. */
  held(failure: string): void {
    this.#round = { state: ROUND.held, failure };
    this.#move();
  }

  selected(explanation: RoundExplanation): void {
    this.#explanation = explanation;
    this.#chosen = choosingIndex(explanation);
    this.#move();
  }

  /** Marks a job planned at `revision` in progress until it settles, begun or not. */
  async during<T>(job: Promise<T>, revision: number): Promise<T> {
    this.#jobRevision = revision;
    this.#move();
    try {
      return await job;
    } finally {
      this.#jobRevision = undefined;
      this.#move();
    }
  }

  /**
   * A run that began and returned leaves the plan's due list, unless it is owed once more at the same revision, when
   * it stays due as stored not fingerprinted. One that never began is not recorded, so it stays due.
   */
  runEnded(path: string, run: EndedRun, owedAgain: boolean): void {
    if (owedAgain && run.runId !== undefined) {
      this.#requeue(path, DUE_REASON.notFingerprinted);
    } else if (!owedAgain) {
      this.#leaveDue(path);
    }
    if (run.runId !== undefined) {
      this.#stored.set(path, { runId: run.runId, notKept: run.notKept });
    }
    this.#move();
    this.#interruptions.delete(path);
    if (run.interruptedBy === undefined) return;
    this.#interruptions.set(path, run.interruptedBy);
    this.#interrupted.add(path);
  }

  /** A run that threw has ended too, and it began, so its workspace's last interruption no longer describes its last run. */
  runThrew(path: string): void {
    this.#leaveDue(path);
    this.#interruptions.delete(path);
    this.#move();
  }

  #leaveDue(path: string): void {
    if (this.#round.state === ROUND.planned) this.#round.due.delete(path);
  }

  #requeue(path: string, due: DueReason): void {
    if (this.#round.state === ROUND.planned) this.#round.due.set(path, due);
  }

  read(query: ScheduleQuery): {
    readonly schedule: ScheduleFacts;
    readonly latestSelection: SelectionExplanation;
  } {
    const round = this.round(query.revision);
    const workspaces = query.workspaces
      .filter((entry) => this.#parts.confirmed(entry))
      .map((entry) => this.#execution(entry, round, query));
    const held =
      round.state === ROUND.pending ? undefined : this.#parts.discoveryHeldBy();
    return {
      schedule: {
        round,
        workspaces,
        ...(held === undefined
          ? {}
          : { selfChangingDiscovery: selfChangedList(held) }),
      },
      latestSelection: this.#latestSelection(),
    };
  }

  /**
   * A plan made at an older revision decides nothing for this one, so the next round is pending: on a job planned at
   * an earlier revision while one is in progress, and otherwise on what the scheduler waits for now.
   */
  round(revision: number): RoundFacts {
    const round = this.#round;
    if (round.state === ROUND.held) {
      return { state: round.state, failure: cutReason(round.failure) };
    }
    if (round.state === ROUND.planned && round.revision === revision) {
      return { state: round.state, revision };
    }
    const job = this.#jobRevision;
    return {
      state: ROUND.pending,
      waitsFor:
        job !== undefined && job !== revision
          ? ROUND_WAIT.jobInProgress
          : this.#wait,
    };
  }

  invalidation(run: StoredRun): CutReason | undefined {
    const notKept = this.#verdictOf(run);
    return notKept !== undefined && labelsInvalidated(notKept)
      ? cutReason(notKept.reason)
      : undefined;
  }

  #verdictOf(run: StoredRun): NotKeptVerdict | undefined {
    const stored = this.#stored.get(run.run.workspace.path);
    return stored?.runId === run.runId ? stored.notKept : undefined;
  }

  #execution(
    entry: WorkspaceDiscovery,
    round: RoundFacts,
    query: ScheduleQuery,
  ): WorkspaceExecution {
    const workspacePath = entry.workspace.path;
    const { activity } = query;
    if (
      activity.state === "running" &&
      activity.workspacePath === workspacePath
    ) {
      return { workspacePath, state: EXECUTION_STATE.running };
    }
    const interruption = this.#interruptions.get(workspacePath);
    const interruptedBy =
      interruption === undefined
        ? undefined
        : boundedList(interruption, MAX_NAMED_CHANGES);
    if (interruptedBy !== undefined && this.#interrupted.has(workspacePath)) {
      return {
        workspacePath,
        state: EXECUTION_STATE.interrupted,
        interruptedBy,
      };
    }
    const latest = query.latestRuns.get(workspacePath);
    const print = (): FingerprintResult => query.fingerprint(entry);
    const due = this.#dueAt(workspacePath, round);
    if (due !== undefined) {
      return {
        workspacePath,
        state: EXECUTION_STATE.queued,
        due: this.#dueFacts(due, latest, print),
        chosenBy: this.#chosen.get(workspacePath) ?? { named: [], more: 0 },
        ...(interruptedBy === undefined ? {} : { interruptedBy }),
      };
    }
    return {
      workspacePath,
      state: EXECUTION_STATE.idle,
      ...this.#notRunning(workspacePath, round, latest, print, query),
    };
  }

  /** The workspace's due reason while the latest plan, made at the answer's revision, holds it due. */
  #dueAt(path: string, round: RoundFacts): DueReason | undefined {
    const recorded = this.#round;
    if (round.state !== ROUND.planned || recorded.state !== ROUND.planned) {
      return undefined;
    }
    return recorded.due.get(path);
  }

  /** Why an idle workspace that is not current, or is due a retry, has no run begun; nothing while a round is pending. */
  #notRunning(
    path: string,
    round: RoundFacts,
    latest: StoredRun | undefined,
    print: () => FingerprintResult,
    { refusedRuns }: Pick<ScheduleQuery, "refusedRuns">,
  ): Pick<IdleExecution, "notRunning"> {
    if (round.state === ROUND.pending) return {};
    const current = print();
    const stale = staleReason(
      latest,
      fingerprintDigest(current),
      refusedRuns.has(path),
    );
    const due = stale ?? retryReason(latest);
    if (due === undefined) return {};
    const dueFacts = this.#dueFacts(due, latest, () => current);
    const held = this.#parts.heldBy(path);
    if (held !== undefined) {
      return {
        notRunning: {
          why: IDLE_REASON.selfChanging,
          due: dueFacts,
          selfChanged: selfChangedList(held),
        },
      };
    }
    const retrying =
      round.state === ROUND.planned &&
      retryOwed(latest, stale, this.#parts.storedNothing(path));
    return { notRunning: { why: idleReason(round, retrying), due: dueFacts } };
  }

  /** A run stored not fingerprinted names the verdict this daemon held for it, or reads as from an earlier daemon life. */
  #dueFacts(
    due: DueReason,
    latest: StoredRun | undefined,
    print: () => FingerprintResult,
  ): DueFacts {
    if (due === DUE_REASON.noCurrentFingerprint) {
      const current = print();
      return current.ok
        ? { kind: due }
        : { kind: due, detail: cutReason(current.reason) };
    }
    if (due !== DUE_REASON.notFingerprinted || latest === undefined) {
      return { kind: due };
    }
    const notKept = this.#verdictOf(latest);
    if (notKept === undefined) return { kind: EARLIER_DAEMON_LIFE };
    return {
      kind: labelsInvalidated(notKept) ? INVALIDATED : due,
      detail: cutReason(notKept.reason),
    };
  }

  #latestSelection(): SelectionExplanation {
    const explanation = this.#explanation;
    if (explanation === undefined) {
      return { state: ROUND_SELECTION.noRoundYet };
    }
    if (explanation.state === ROUND_SELECTION.notMade) {
      return { ...explanation, reason: cutReason(explanation.reason) };
    }
    return {
      state: explanation.state,
      revision: explanation.revision,
      paths: mappedList(explanation.paths, MAX_EXPLAINED, explainedPath),
      fallbacks: mappedList(
        explanation.fallbacks,
        MAX_EXPLAINED,
        explainedFallback,
      ),
      counts: explanation.counts,
    };
  }
}

/** A held round is tried again at the next input event or reconciliation, so no run waits on an input change alone. */
function idleReason(
  round: RoundFacts,
  retrying: boolean,
): NotSelfChangingReason {
  if (round.state === ROUND.held) return IDLE_REASON.roundHeld;
  return retrying
    ? IDLE_REASON.retryPending
    : IDLE_REASON.noRunUntilInputChange;
}

/** Each path and each of its jobs bounded as the interruption's paths are, since both come from the job window. */
function selfChangedList(held: JobsByPath): NamedList<SelfChangedPath> {
  return mappedList([...held], MAX_NAMED_CHANGES, ([path, jobs]) => ({
    path,
    jobs: mappedList([...jobs], MAX_NAMED_CHANGES, (workspacePath) =>
      workspacePath === undefined ? {} : { workspacePath },
    ),
  }));
}

/** Up to `bound` of `items`, counting the rest. */
export function boundedList<T>(
  items: readonly T[],
  bound: number,
): NamedList<T> {
  return {
    named: items.slice(0, bound),
    more: Math.max(0, items.length - bound),
  };
}

/** Slices before mapping, so no work is done for an item the answer leaves out. */
function mappedList<T, U>(
  items: readonly T[],
  bound: number,
  map: (item: T) => U,
): NamedList<U> {
  const { named, more } = boundedList(items, bound);
  return { named: named.map(map), more };
}

/** Every free-text reason and detail is cut, so the bound on each list bounds its bytes but for each chain's length. */
export function explainedPath(report: ChangedPathReport): ExplainedPath {
  const { nothingSelected } = report;
  return {
    ...report,
    selected: mappedList(report.selected, MAX_EXPLAINED, explainedSelection),
    notRunnable: mappedList(
      report.notRunnable,
      MAX_EXPLAINED,
      ({ workspace, reason }) => ({ workspace, ...cutReason(reason) }),
    ),
    nothingSelected:
      nothingSelected === undefined
        ? undefined
        : {
            kind: nothingSelected.kind,
            detail: cutReason(nothingSelected.detail),
          },
  };
}

function explainedSelection({
  workspace,
  reasons,
}: PathSelection): ExplainedPath["selected"]["named"][number] {
  return {
    workspace,
    reasons: reasons.map((reason) => ({
      ...reason,
      steps: reason.steps.map((step) => ({
        ...step,
        detail: cutReason(step.detail),
      })),
    })),
  };
}

function explainedFallback(fallback: BroadFallback): ExplainedFallback {
  return {
    ...fallback,
    workspaces: boundedList(fallback.workspaces, MAX_EXPLAINED),
  };
}

function fallbackKey(reason: Pick<BroadFallback, "path" | "trigger">): string {
  return JSON.stringify([reason.path, reason.trigger]);
}

/**
 * By workspace, the reasons the selection chose it, every one counted: named, up to their bound, only when the
 * explanation names its changed path and, for a broad fallback, the fallback too.
 */
function choosingIndex(
  explanation: RoundExplanation,
): Map<string, NamedList<ChoosingReason>> {
  const index = new Map<string, { named: ChoosingReason[]; more: number }>();
  if (explanation.state !== ROUND_SELECTION.made) return index;
  const { fallbacks } = explanation;
  const scopes = new Map(fallbacks.map((f) => [fallbackKey(f), f.scope]));
  const namedFallbacks = new Set(
    fallbacks.slice(0, MAX_EXPLAINED).map(fallbackKey),
  );
  explanation.paths.forEach((report, position) => {
    for (const [workspace, reason] of choosingReasons(report, scopes)) {
      const entry = index.get(workspace) ?? { named: [], more: 0 };
      index.set(workspace, entry);
      const nameable =
        position < MAX_EXPLAINED &&
        (reason.scope === undefined || namedFallbacks.has(fallbackKey(reason)));
      if (nameable && entry.named.length < MAX_CHOOSING_REASONS) {
        entry.named.push(reason);
      } else {
        entry.more += 1;
      }
    }
  });
  return index;
}

/** Each workspace the changed path selected, once per distinct trigger, with its fallback's scope when it was one. */
function choosingReasons(
  report: ChangedPathReport,
  scopes: ReadonlyMap<string, BroadFallback["scope"]>,
): [string, ChoosingReason][] {
  return report.selected.flatMap(({ workspace, reasons }) =>
    [...new Set(reasons.map(({ trigger }) => trigger))].map(
      (trigger): [string, ChoosingReason] => {
        const scope = scopes.get(fallbackKey({ path: report.path, trigger }));
        return [
          workspace,
          {
            path: report.path,
            trigger,
            ...(scope === undefined ? {} : { scope }),
          },
        ];
      },
    ),
  );
}
