import { MODIFIED_TIME_RESOLUTION_MS } from "../inputs/input-inventory.js";
import type { JobWindow } from "../inputs/input-jobs.js";
import type { JobsByPath, SubjectChanges } from "./change-record.js";
import type { DaemonLog } from "./daemon-log.js";
import {
  changesText,
  followOn,
  NO_COUNT,
  SELF_CHANGE_HOLD_COUNT,
  sharedPaths,
  type BegunRun,
  type HistoryReport,
  type SelfChangeCount,
} from "./run-history.js";

const UNTIL_EDIT =
  "begins no more until an edit or a change the daemon cannot attribute reaches the inputs";
const HELD_ENTRY = `held: the discovery ${UNTIL_EDIT}, since the daemon's own runs and discoveries changed the same inputs each of the ${SELF_CHANGE_HOLD_COUNT} times in a row it became due`;
const HELD_AGAIN_ENTRY = `held again: the discovery ${UNTIL_EDIT}, since the daemon's own runs and discoveries changed again inputs its latest hold named`;
const RELEASED_ENTRY = "the discovery is no longer held, since";
const EDITED_CAUSE =
  "an edit or a change the daemon cannot attribute reached the inputs";
const NONE_IN_EFFECT_CAUSE = "no discovery is in effect";
const CHANGED_AT_UNMOVED_REVISION =
  "because an input or a listed file changed while it ran at input revision";

/** What a discovery job left. */
export interface DiscoverReport extends Pick<HistoryReport, "window"> {
  /** Whether a discovery record was stored. */
  readonly stored: boolean;
  /** Whether it was stored not fingerprinted because an input or a listed file changed while it ran; false when nothing was stored. */
  readonly changedWhileRunning: HistoryReport["changedWhileRunning"];
}

/** The discovery in effect as a plan reads it. */
export interface DiscoveryInEffect {
  /** Whether it reads current at the plan's revision. */
  readonly current: boolean;
  /** Whether a current fingerprint over every input can be computed. */
  readonly fingerprinted: boolean;
}

/** The discovery's part of the change record, whose one owner records every job. */
interface DiscoveryChanges {
  /** What changed since the last discovery began; undefined when none has begun. */
  discoveryChanges(): SubjectChanges | undefined;
  discoveryBegan(): void;
  discoveryNotBegun(): void;
  discoveryEnded(window: JobWindow): void;
  discoveryThrew(): void;
}

interface DiscoveryHistoryParts {
  readonly log: DaemonLog;
  /** The input revision now. */
  readonly revision: () => number;
  /** When the scheduler last saw the input revision change, by `performance.now()`. */
  readonly changedAt: () => number;
  readonly changes: DiscoveryChanges;
}

/** What records a begun discovery's end, whichever way it ends. */
type BegunDiscovery = Omit<BegunRun, "ended" | "refused"> & {
  ended(report: DiscoverReport): void;
};

/** What the record holds of the last discovery begun. */
interface DiscoveryAttempt {
  /** The input revision it was planned at. */
  readonly revision: number;
  /** Whether it stored a record, under its fingerprint or not, so a count can follow it; false until it reports. */
  readonly stored: boolean;
  /** When the once-more discovery it is owed may begin, by `performance.now()`; undefined when none is owed. */
  readonly onceMoreFrom: number | undefined;
  /** The count it began at. */
  readonly startCount: SelfChangeCount;
}

/**
 * The last discovery the scheduler began: the revision it was tried at, whether it stored nothing, whether it is owed
 * once more since an input changed while it ran at a revision the change did not move, and how many times in a row
 * the discovery became due only through changes the daemon's own runs and discoveries made to the same input. It is
 * held at `SELF_CHANGE_HOLD_COUNT`, and held again at a count of 1 that changed a path its latest hold named, until an
 * edit or a change the daemon cannot attribute reaches the inputs, or no discovery is in effect.
 */
export class DiscoveryHistory {
  readonly #log: DaemonLog;
  readonly #revision: () => number;
  readonly #changedAt: () => number;
  readonly #changes: DiscoveryChanges;
  #attempt: DiscoveryAttempt | undefined;
  /** Whether the periodic reconciliation's retry is owed. */
  #retry = false;
  /** The count the latest plan decided. */
  #decided: SelfChangeCount = NO_COUNT;
  /** The paths that changed each time the held discovery became due, with their jobs; undefined while not held. */
  #held: JobsByPath | undefined;
  /** The paths the latest hold named, which a later count of 1 is compared with. */
  #latestHold: JobsByPath | undefined;

  constructor(parts: DiscoveryHistoryParts) {
    this.#log = parts.log;
    this.#revision = parts.revision;
    this.#changedAt = parts.changedAt;
    this.#changes = parts.changes;
  }

  /** The paths that changed each time the held discovery became due, with their jobs; undefined when it is not held. */
  heldBy(): JobsByPath | undefined {
    return this.#held;
  }

  /**
   * Releases the hold when an edit came since the last discovery began or none is in effect; otherwise, while not held,
   * decides the count of a discovery in effect that is not current and holds it at the bound or by its latest hold.
   */
  decide(inEffect: DiscoveryInEffect | undefined): void {
    const changes = this.#changes.discoveryChanges();
    if (this.#held !== undefined) {
      const cause = releaseCause(inEffect, changes);
      if (cause === undefined) return;
      this.#held = undefined;
      this.#log.entry(`${RELEASED_ENTRY} ${cause}`);
    }
    this.#decided =
      inEffect === undefined || inEffect.current
        ? NO_COUNT
        : this.#nextCount(inEffect, changes);
    this.#holdAt(this.#decided);
  }

  /** Arms the periodic reconciliation's retry, never for a held discovery; returns whether it is armed. */
  armRetry(listsFailed: boolean): boolean {
    this.#retry =
      this.#held === undefined &&
      (this.#attempt?.stored === false || listsFailed);
    return this.#retry;
  }

  /**
   * How long before a discovery may begin at this settled revision, 0 when at once; undefined when none is due: it is
   * held, or it was tried at this revision and owes no retry or once-more, or the discovery in effect is current.
   */
  due(
    revision: number,
    inEffect: DiscoveryInEffect | undefined,
  ): number | undefined {
    if (this.#held !== undefined) return undefined;
    const attempt = this.#attempt;
    const notCurrent = inEffect?.current !== true;
    if (attempt?.revision !== revision) {
      return this.#retry || notCurrent ? this.#restartedWait() : undefined;
    }
    if (attempt.onceMoreFrom !== undefined && notCurrent) {
      return untilTime(attempt.onceMoreFrom);
    }
    return this.#retry ? 0 : undefined;
  }

  /** A change that moved the revision during the once-more wait starts the wait again from that change. */
  #restartedWait(): number {
    const from = this.#attempt?.onceMoreFrom;
    const changedAt = this.#changedAt();
    return from !== undefined && changedAt < from
      ? untilTime(changedAt + MODIFIED_TIME_RESOLUTION_MS)
      : 0;
  }

  /** Marks the discovery begun at the count decided for it, as having stored nothing until it reports. */
  began(revision: number): BegunDiscovery {
    const before = this.#attempt;
    const retry = this.#retry;
    const isOnceMore =
      before?.onceMoreFrom !== undefined && before.revision === revision;
    const startCount = this.#decided;
    this.#retry = false;
    this.#changes.discoveryBegan();
    this.#attempt = {
      revision,
      stored: false,
      onceMoreFrom: undefined,
      startCount,
    };
    return {
      ended: (report) => {
        this.#changes.discoveryEnded(report.window);
        this.#ended({ revision, isOnceMore, startCount }, report);
      },
      notBegun: () => {
        this.#changes.discoveryNotBegun();
        this.#attempt = before;
        this.#retry ||= retry;
      },
      threw: () => this.#changes.discoveryThrew(),
    };
  }

  #ended(
    begun: Pick<DiscoveryAttempt, "revision" | "startCount"> & {
      readonly isOnceMore: boolean;
    },
    report: DiscoverReport,
  ): void {
    const { revision, isOnceMore, startCount } = begun;
    const unmoved =
      report.stored &&
      report.changedWhileRunning &&
      revision === this.#revision();
    if (unmoved && isOnceMore) {
      this.#log.entry(
        `the discovery was stored not fingerprinted again ${CHANGED_AT_UNMOVED_REVISION} ${revision}, which the change did not move, so no discovery begins at that revision again, apart from the periodic reconciliation's retry, until the input revision moves`,
      );
    } else if (unmoved) {
      this.#log.entry(
        `the discovery was stored not fingerprinted ${CHANGED_AT_UNMOVED_REVISION} ${revision}, which the change did not move, so it is discovered once more at that revision, no sooner than ${MODIFIED_TIME_RESOLUTION_MS} ms after it ended`,
      );
    }
    this.#attempt = {
      revision,
      stored: report.stored,
      onceMoreFrom:
        unmoved && !isOnceMore
          ? performance.now() + MODIFIED_TIME_RESOLUTION_MS
          : undefined,
      startCount,
    };
  }

  /** At the bound, or at a count of 1 that changed a path the latest hold named, the discovery is held. */
  #holdAt(count: SelfChangeCount): void {
    if (count.count >= SELF_CHANGE_HOLD_COUNT) {
      this.#hold(count.shared, HELD_ENTRY);
      return;
    }
    const latest = this.#latestHold;
    if (count.count !== 1 || latest === undefined) return;
    const again = sharedPaths(latest, count.shared);
    if (again.size > 0) this.#hold(again, HELD_AGAIN_ENTRY);
  }

  #hold(shared: JobsByPath, entry: string): void {
    this.#held = shared;
    this.#latestHold = shared;
    this.#retry = false;
    this.#log.entry(`${entry}: ${changesText(shared)}`);
  }

  #nextCount(
    inEffect: DiscoveryInEffect,
    changes: SubjectChanges | undefined,
  ): SelfChangeCount {
    const attempt = this.#attempt;
    if (attempt?.stored !== true || !inEffect.fingerprinted) return NO_COUNT;
    if (!unedited(changes) || changes.byJobs.size === 0) return NO_COUNT;
    return followOn(attempt.startCount, changes.byJobs);
  }
}

function untilTime(time: number): number {
  return Math.max(0, time - performance.now());
}

function releaseCause(
  inEffect: DiscoveryInEffect | undefined,
  changes: SubjectChanges | undefined,
): string | undefined {
  if (inEffect === undefined) return NONE_IN_EFFECT_CAUSE;
  return unedited(changes) ? undefined : EDITED_CAUSE;
}

/** No record reads as an edit, as does a change that reaches every input, so uncertainty never holds the discovery. */
function unedited(
  changes: SubjectChanges | undefined,
): changes is SubjectChanges {
  return (
    changes !== undefined && !changes.everywhere && changes.edits.size === 0
  );
}
