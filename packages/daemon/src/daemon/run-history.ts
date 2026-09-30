import type { InputDigests } from "../inputs/input-inventory.js";
import { namedList, type JobWindow } from "../inputs/input-jobs.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import {
  ChangeRecord,
  type EditReport,
  type Job,
  type JobsByPath,
  type SubjectChanges,
} from "./change-record.js";
import type { DaemonLog } from "./daemon-log.js";
import { testModulesKey } from "./due-workspaces.js";
import {
  labelsInvalidated,
  pathsInside,
  type ChangePlacement,
} from "./run-judgment.js";
import type { EndedRun } from "./workspace-schedule.js";

/** How many times in a row a workspace or the discovery becomes due only through the daemon's own jobs' changes to the same input before it is held. */
export const SELF_CHANGE_HOLD_COUNT = 3;
/** The count whose run no change interrupts, so the run before a hold runs to its end. */
const UNINTERRUPTIBLE_COUNT = SELF_CHANGE_HOLD_COUNT - 1;
const HELD_ENTRY = `runs no more until an edit reaches its inputs, since the daemon's own runs and discoveries changed the same inputs each of the ${SELF_CHANGE_HOLD_COUNT} times in a row it became due`;
const RELEASED_ENTRY = "is no longer held, since an edit reached its inputs";
/** The discovery's subject in the change record, which no workspace path can equal. */
const DISCOVERY: Job = undefined;

/** The fields of a run job's report the run history reads. */
export interface HistoryReport extends Pick<
  EndedRun,
  "notKept" | "interruptedBy"
> {
  /** The input revision the run began at. */
  readonly revision: number;
  /** Whether a run record was stored. */
  readonly stored: boolean;
  /**
   * Whether its inputs changed while it ran with a fingerprint taken at its end, or a change interrupted it; such a
   * run was stored not fingerprinted, or nothing was stored.
   */
  readonly changedWhileRunning: boolean;
  /** What the tracker recorded while the job ran, with the committed digests at its start and end. */
  readonly window: JobWindow;
}

/** A workspace a round finds due, as the round reads it. */
export interface DueWorkspaceFacts {
  readonly entry: WorkspaceDiscovery;
  /** Whether it is due only for a periodic retry. */
  readonly retryOnly: boolean;
  /** Whether its current input fingerprint can be computed. */
  readonly fingerprinted: boolean;
  /** How the round's dependency build places changed paths. */
  readonly placement: ChangePlacement;
}

/** What records a begun run's end, whichever way it ends. */
export interface BegunRun {
  /** Records the run's report, returning whether it is owed once more. */
  ended(report: HistoryReport): boolean;
  /** The run never began, so the run it replaced is the last run begun again. */
  notBegun(): void;
  /** The run began and threw, so no count follows it. */
  threw(): void;
  /** The lifecycle refused the workspace, so the run never began and its attempt stays as having stored nothing. */
  refused(): void;
}

interface RunHistoryParts {
  readonly log: DaemonLog;
  /** The input revision now. */
  readonly revision: () => number;
}

/** How many times in a row a subject became due through its jobs' changes, and the paths every such time changed. */
export interface SelfChangeCount {
  readonly count: number;
  readonly shared: JobsByPath;
}

export const NO_COUNT: SelfChangeCount = { count: 0, shared: new Map() };

/** What the record holds of the last run begun for a workspace. */
interface Attempt {
  readonly revision: number;
  readonly modules: string;
  /** Whether the run ended with nothing stored. */
  readonly nothingStored: boolean;
  /** Whether its inputs changed while it ran at a revision the change did not move, so it runs once more. */
  readonly rerunOwed: boolean;
  /** The count the run began at. */
  readonly startCount: SelfChangeCount;
  /** Whether it ended as a count can follow: interrupted by a change, stored invalidated, or stored under its fingerprint. */
  readonly qualifies: boolean;
}

interface RunStart {
  readonly path: string;
  readonly modules: string;
  /** Whether it is the once-more run its workspace's last run was owed. */
  readonly isRerun: boolean;
  readonly startCount: SelfChangeCount;
}

/**
 * By workspace, the last run the scheduler began: whether it stored nothing, whether a run at a revision and list of
 * test modules is owed once more, since its inputs changed at a revision the change did not move, and how many times in
 * a row it became due only through changes the daemon's own runs and discoveries made to the same input, which holds
 * it at `SELF_CHANGE_HOLD_COUNT` until an edit reaches its inputs.
 */
export class RunHistory {
  readonly #log: DaemonLog;
  readonly #revision: () => number;
  readonly #attempts = new Map<string, Attempt>();
  readonly #changes = new ChangeRecord();
  /** By workspace, the count the latest round decided. */
  readonly #decided = new Map<string, SelfChangeCount>();
  readonly #held = new Map<string, SelfChangeCount>();

  constructor(parts: RunHistoryParts) {
    this.#log = parts.log;
    this.#revision = parts.revision;
  }

  /** Whether the last run attempted for the workspace ended with nothing stored. */
  storedNothing(path: string): boolean {
    return this.#attempts.get(path)?.nothingStored === true;
  }

  ranAlready(
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

  /** The committed digests a round read while no job ran; undefined when they could not be read. */
  observed(digests: InputDigests | undefined): void {
    this.#changes.observed(digests);
  }

  /** A caller's report of the input keys it edited, whose every change counts as an edit, never a job's. */
  reportEdits(keys: readonly string[]): EditReport {
    return this.#changes.reportEdits(keys);
  }

  discoveryBegan(): void {
    this.#changes.jobBegan(DISCOVERY);
  }

  discoveryNotBegun(): void {
    this.#changes.jobNotBegun(DISCOVERY);
  }

  discoveryEnded(window: JobWindow): void {
    this.#changes.jobEnded(window, DISCOVERY);
  }

  /** The discovery began and threw, so no count follows it. */
  discoveryThrew(): void {
    this.#changes.jobThrew(DISCOVERY);
  }

  /** What changed since the last discovery began; undefined when none has begun. */
  discoveryChanges(): SubjectChanges | undefined {
    return this.#changes.of(DISCOVERY);
  }

  isHeld(path: string): boolean {
    return this.#held.has(path);
  }

  /** The paths that changed each time a held workspace became due, with their jobs; undefined when it is not held. */
  heldBy(path: string): JobsByPath | undefined {
    return this.#held.get(path)?.shared;
  }

  /** Why no change may interrupt the workspace's next run, since one more count would hold it; undefined otherwise. */
  uninterruptible(path: string): string | undefined {
    const decided = this.#decided.get(path);
    if (decided?.count !== UNINTERRUPTIBLE_COUNT) return undefined;
    return `the daemon's own runs and discoveries changed ${changesText(decided.shared)} each of the ${decided.count} times in a row it became due, and one more holds it`;
  }

  /**
   * Decides the count of a workspace the round finds due, releasing its hold first when an edit reached its inputs.
   * Returns whether it is held, so no run of it begins.
   */
  decide(due: DueWorkspaceFacts): boolean {
    const path = due.entry.workspace.path;
    if (this.#held.has(path)) {
      if (!this.#edited(due, this.#changes.of(path))) return true;
      this.#held.delete(path);
      this.#log.entry(`${path} ${RELEASED_ENTRY}`);
    }
    const next = this.#nextCount(due);
    this.#decided.set(path, next);
    if (next.count < SELF_CHANGE_HOLD_COUNT) return false;
    this.#held.set(path, next);
    this.#log.entry(`held: ${path} ${HELD_ENTRY}: ${changesText(next.shared)}`);
    return true;
  }

  /** Marks the run begun at the count decided for it, as having stored nothing until it reports. */
  began(entry: WorkspaceDiscovery, revision: number): BegunRun {
    const path = entry.workspace.path;
    const modules = testModulesKey(entry);
    const before = this.#attempts.get(path);
    const isRerun =
      before?.rerunOwed === true &&
      before.revision === revision &&
      before.modules === modules;
    const startCount = this.#decided.get(path) ?? NO_COUNT;
    this.#changes.jobBegan(path);
    this.#attempts.set(path, {
      revision,
      modules,
      nothingStored: true,
      rerunOwed: false,
      startCount,
      qualifies: false,
    });
    return {
      ended: (report) => {
        this.#changes.jobEnded(report.window, path);
        return this.#ended({ path, modules, isRerun, startCount }, report);
      },
      notBegun: () => {
        this.#changes.jobNotBegun(path);
        if (before === undefined) this.#attempts.delete(path);
        else this.#attempts.set(path, before);
      },
      threw: () => this.#changes.jobThrew(path),
      refused: () => this.#changes.jobNotBegun(path),
    };
  }

  #ended(run: RunStart, report: HistoryReport): boolean {
    const { path, modules, isRerun, startCount } = run;
    const unmoved =
      report.changedWhileRunning && report.revision === this.#revision();
    if (unmoved && isRerun) {
      this.#log.entry(
        `the run of ${path} was stored not fingerprinted again because its inputs changed while it ran at input revision ${report.revision}, which the change did not move, so it is held until the input revision or its list of test modules changes`,
      );
    } else if (unmoved) {
      this.#log.entry(
        `the run of ${path} was stored not fingerprinted because its inputs changed while it ran at input revision ${report.revision}, which the change did not move, so it runs once more`,
      );
    }
    const owedAgain = unmoved && !isRerun;
    this.#attempts.set(path, {
      revision: report.revision,
      modules,
      nothingStored: !report.stored,
      rerunOwed: owedAgain,
      startCount,
      qualifies: qualifies(report),
    });
    return owedAgain;
  }

  #nextCount(due: DueWorkspaceFacts): SelfChangeCount {
    const path = due.entry.workspace.path;
    const attempt = this.#attempts.get(path);
    const changes = this.#changes.of(path);
    if (attempt?.qualifies !== true || due.retryOnly || !due.fingerprinted) {
      return NO_COUNT;
    }
    if (changes === undefined || this.#edited(due, changes)) return NO_COUNT;
    const placed = this.#inside(due, [...changes.byJobs.keys()]);
    if (placed === undefined) return NO_COUNT;
    const inside = new Set(placed);
    const caused = new Map(
      [...changes.byJobs].filter(([changed]) => inside.has(changed)),
    );
    return caused.size === 0 ? NO_COUNT : followOn(attempt.startCount, caused);
  }

  /** Whether an edit reached the workspace's inputs since its last run began; no record reads as one. */
  #edited(
    due: DueWorkspaceFacts,
    changes: SubjectChanges | undefined,
  ): boolean {
    if (changes === undefined || changes.everywhere) return true;
    const inside = this.#inside(due, [...changes.edits]);
    return inside === undefined || inside.length > 0;
  }

  /**
   * Undefined when the placement throws, which reads as an edit to the workspace's inputs, so uncertainty never holds
   * a workspace nor keeps it held.
   */
  #inside(
    due: DueWorkspaceFacts,
    paths: readonly string[],
  ): readonly string[] | undefined {
    try {
      return pathsInside(paths, due.entry, due.placement);
    } catch (error) {
      this.#log.error(
        `placing the paths that changed since the last run of ${due.entry.workspace.path}, so they count as an edit to its inputs`,
        error,
      );
      return undefined;
    }
  }
}

/** Interrupted by a change, stored with a verdict that labels it invalidated, or stored under its fingerprint. */
function qualifies(report: HistoryReport): boolean {
  if (report.interruptedBy !== undefined) return true;
  return (
    report.stored &&
    (report.notKept === undefined || labelsInvalidated(report.notKept))
  );
}

/** One more than `base` when a path it shares also changed this time; otherwise this time starts the count at 1. */
export function followOn(
  base: SelfChangeCount,
  caused: JobsByPath,
): SelfChangeCount {
  const shared = base.count > 0 ? sharedPaths(base.shared, caused) : new Map();
  return shared.size > 0
    ? { count: base.count + 1, shared }
    : { count: 1, shared: new Map(caused) };
}

/** Each path of `base` that also changed this time, with the jobs of both. */
export function sharedPaths(base: JobsByPath, caused: JobsByPath): JobsByPath {
  const shared = new Map<string, ReadonlySet<Job>>();
  for (const [path, jobs] of caused) {
    const before = base.get(path);
    if (before !== undefined) shared.set(path, new Set([...before, ...jobs]));
  }
  return shared;
}

export function changesText(shared: JobsByPath): string {
  return namedList(
    [...shared].map(
      ([path, jobs]) => `${path} (during ${namedList([...jobs].map(jobText))})`,
    ),
  );
}

function jobText(workspacePath: Job): string {
  return workspacePath === undefined
    ? "the discovery"
    : `the run of ${workspacePath}`;
}
