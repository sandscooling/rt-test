import type { InputDigests } from "../inputs/input-inventory.js";
import {
  NARROWING,
  narrowingAt,
  type QueryNarrowing,
} from "../inputs/narrowed-inputs.js";
import {
  FIRST_ROUND,
  INPUT_DIGESTS_UNREAD,
  NO_BUILD_ENDED,
  ROUND_SELECTION,
  SELECTION_REFUSED,
  type InputsNotNarrowed,
  type NoRoundSelection,
} from "../query/answer.js";
import {
  SELECTION_STATE,
  type BroadFallback,
  type ChainStep,
  type ChangedPathReport,
  type Selection,
  type SelectionCounts,
  type SelectionReason,
  type TestCount,
} from "../selection/selection-types.js";
import type { DaemonLog } from "./daemon-log.js";

const LIST_SEPARATOR = ", ";
const NO_SELECTION_CONSEQUENCE =
  "so every workspace whose latest run is not bound to its current fingerprint still runs";
const NO_BUILD_ENDED_REASON =
  "no dependency build ended at this input revision, because the wait for it was released";
const NO_SNAPSHOT_REASON = "the inputs' digests cannot be read now";
const NO_SNAPSHOT_ENTRY = `warning: no selection was made, because ${NO_SNAPSHOT_REASON}, ${NO_SELECTION_CONSEQUENCE}`;
const FIRST_ROUND_REASON = "no previous round read the inputs to compare with";
const FIRST_ROUND_ENTRY = `round without a selection: ${FIRST_ROUND_REASON}`;

/** What a round logged of its selection: the changed paths, fallbacks and counts, or why it made none. */
export type RoundExplanation = { readonly revision: number } & (
  | ({
      readonly state: typeof ROUND_SELECTION.made;
    } & Pick<Selection, "paths" | "fallbacks" | "counts">)
  | {
      readonly state: typeof ROUND_SELECTION.notMade;
      readonly kind: NoRoundSelection;
      readonly reason: string;
    }
);

/** What a round's selection gives the scheduler. */
interface RoundSelection {
  /** Workspaces owning a path that changed since the previous round; none when no selection was made. */
  readonly directTargets: ReadonlySet<string>;
  /** Workspaces some changed path selected; none when no selection was made. */
  readonly selected: ReadonlySet<string>;
  readonly explanation: RoundExplanation;
}

/** A round that selected nothing, because no selection was made, with the kind and reason the log gives. */
function unselectedRound(
  revision: number,
  kind: NoRoundSelection,
  reason: string,
): RoundSelection {
  return {
    directTargets: new Set(),
    selected: new Set(),
    explanation: { revision, state: ROUND_SELECTION.notMade, kind, reason },
  };
}

/** What a round's selection reads beside its revision. */
interface RoundReading {
  readonly log: DaemonLog;
  /** The dependency builds' state, read only when two snapshots can be compared. */
  readonly narrowing: () => QueryNarrowing;
  /** The inputs the latest round that made or tried a selection read. */
  readonly before: InputDigests | undefined;
  /** The inputs this round reads; undefined when their digests cannot be read now. */
  readonly now: InputDigests | undefined;
  /** The workspaces the round finds due, by path. */
  readonly due: readonly string[];
  /** The confirmed workspaces of the discovery in effect, by path. */
  readonly confirmed: readonly string[];
  readonly isHeld: (path: string) => boolean;
}

/**
 * The round's selection over the paths that changed since the previous round's snapshot, with the snapshot the next
 * round compares with: this round's when its digests could be read, otherwise the one it was given.
 */
export function selectRound(
  revision: number,
  reading: RoundReading,
): {
  readonly selection: RoundSelection;
  readonly snapshot: InputDigests | undefined;
} {
  const { log, before, now } = reading;
  if (now === undefined) {
    log.entry(NO_SNAPSHOT_ENTRY);
    return {
      selection: unselectedRound(
        revision,
        INPUT_DIGESTS_UNREAD,
        NO_SNAPSHOT_REASON,
      ),
      snapshot: before,
    };
  }
  if (before === undefined) {
    log.entry(FIRST_ROUND_ENTRY);
    return {
      selection: unselectedRound(revision, FIRST_ROUND, FIRST_ROUND_REASON),
      snapshot: now,
    };
  }
  const selection = explainRound(
    log,
    reading.narrowing(),
    revision,
    changedPaths(before, now),
  );
  const dueNow = new Set(reading.due);
  const confirmed = new Set(reading.confirmed);
  for (const path of selection.selected) {
    const holdsCurrent = !dueNow.has(path) && !reading.isHeld(path);
    if (confirmed.has(path) && holdsCurrent) {
      log.entry(
        `not run: ${path} was selected, and holds results bound to its current input fingerprint`,
      );
    }
  }
  return { selection, snapshot: now };
}

/** The paths whose digest changed, appeared or disappeared between two snapshots of the inputs, in path order. */
export function changedPaths(
  before: InputDigests,
  after: InputDigests,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
}

/**
 * Selects `changed` over the build that decides the inputs at `revision` and logs why each path selected what it did,
 * each broad fallback and the counts; when no build narrows the revision or selection refuses, logs why at warning
 * level and selects nothing.
 */
function explainRound(
  log: DaemonLog,
  narrowing: QueryNarrowing,
  revision: number,
  changed: readonly string[],
): RoundSelection {
  log.entry(
    `round at input revision ${revision}: ${changed.length} changed input paths`,
  );
  const at = narrowingAt(narrowing, revision);
  if (at.kind === NARROWING.narrowed) {
    const outcome = at.narrowing.select(changed);
    if (outcome.state !== SELECTION_STATE.refused) {
      return logSelection(log, revision, outcome);
    }
    return noSelection(log, revision, SELECTION_REFUSED, outcome.reason);
  }
  if (at.kind === NARROWING.widened) {
    const { kind, reason } = at.notNarrowed;
    return noSelection(log, revision, kind, reason);
  }
  return noSelection(
    log,
    revision,
    NO_BUILD_ENDED,
    noBuildEndedReason(at.notNarrowed),
  );
}

/** A failure recorded at an earlier revision is named beside the cause, never as it. */
function noBuildEndedReason(earlier: InputsNotNarrowed | undefined): string {
  return earlier === undefined
    ? NO_BUILD_ENDED_REASON
    : `${NO_BUILD_ENDED_REASON}; an earlier build ${earlier.kind}: ${earlier.reason}`;
}

function noSelection(
  log: DaemonLog,
  revision: number,
  kind: NoRoundSelection,
  reason: string,
): RoundSelection {
  log.entry(
    `warning: no selection was made (${kind}), ${NO_SELECTION_CONSEQUENCE}: ${reason}`,
  );
  return unselectedRound(revision, kind, reason);
}

function logSelection(
  log: DaemonLog,
  revision: number,
  selection: Selection,
): RoundSelection {
  const { paths, fallbacks, counts } = selection;
  for (const report of selection.paths) log.entry(pathText(report));
  for (const fallback of selection.fallbacks) log.entry(fallbackText(fallback));
  log.entry(countsText(selection.counts));
  return {
    directTargets: new Set(
      paths.flatMap(({ owner }) => (owner === undefined ? [] : [owner])),
    ),
    selected: new Set(selection.workspaces.map(({ path }) => path)),
    explanation: {
      revision,
      state: ROUND_SELECTION.made,
      paths,
      fallbacks,
      counts,
    },
  };
}

function pathText(report: ChangedPathReport): string {
  const owner = report.owner ?? "no package workspace";
  const chosen =
    report.selected.length === 0
      ? `selected no workspace${report.nothingSelected === undefined ? "" : `, ${report.nothingSelected.kind}: ${report.nothingSelected.detail}`}`
      : `selected ${report.selected
          .map(
            ({ workspace, reasons }) =>
              `${workspace} (${reasons.map(reasonText).join("; ")})`,
          )
          .join(LIST_SEPARATOR)}`;
  return `changed path ${report.path}, owned by ${owner}, ${chosen}${notRunnableText(report)}`;
}

/** The workspaces the path reached that cannot run, when it also selected one that can; otherwise the reason names them. */
function notRunnableText(report: ChangedPathReport): string {
  if (report.selected.length === 0 || report.notRunnable.length === 0) {
    return "";
  }
  const excluded = report.notRunnable.map(
    ({ workspace, reason }) => `${workspace.path} (${reason})`,
  );
  return `; not runnable: ${excluded.join(LIST_SEPARATOR)}`;
}

function reasonText(reason: SelectionReason): string {
  const from = reason.from === undefined ? "" : ` from ${reason.from}`;
  const steps = reason.steps.map(stepText).join(" then ");
  return `${reason.trigger}${from}${steps === "" ? "" : ` through ${steps}`}`;
}

function stepText(step: ChainStep): string {
  const detail = step.detail === "" ? "" : ` (${step.detail})`;
  return `${step.workspace} by ${step.via}${detail}`;
}

function fallbackText(fallback: BroadFallback): string {
  return `broad fallback to the ${fallback.scope} for ${fallback.path}, triggered by ${fallback.trigger}, from ${fallback.workspaces.join(LIST_SEPARATOR)}`;
}

function countsText(counts: SelectionCounts): string {
  return `selected ${countText(counts.selectedTests)} of ${countText(counts.totalTests)} tests and ${counts.selectedWorkspaces} of ${counts.totalWorkspaces.count} workspaces${counts.totalWorkspaces.complete ? "" : " (workspace total incomplete)"}, ${counts.notRunnableWorkspaces} not runnable`;
}

function countText(count: TestCount): string {
  return `${count.count}${count.complete ? "" : " (incomplete)"}`;
}
