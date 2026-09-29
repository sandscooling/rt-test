import type { InputDigests } from "../inputs/input-inventory.js";
import {
  NARROWING,
  narrowingAt,
  type QueryNarrowing,
} from "../inputs/narrowed-inputs.js";
import { SELECTION_REFUSED, type InputsNotNarrowed } from "../query/answer.js";
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
export const NO_SELECTION_CONSEQUENCE =
  "so every workspace whose latest run is not bound to its current fingerprint still runs";
const NO_BUILD_ENDED_KIND = "no-build-ended";
const NO_BUILD_ENDED_REASON =
  "no dependency build ended at this input revision, because the wait for it was released";

/** What a round's selection gives the scheduler. */
export interface RoundSelection {
  /** Workspaces owning a path that changed since the previous round; none when no selection was made. */
  readonly directTargets: ReadonlySet<string>;
  /** Workspaces some changed path selected; none when no selection was made. */
  readonly selected: ReadonlySet<string>;
}

const NO_SELECTION: RoundSelection = {
  directTargets: new Set(),
  selected: new Set(),
};

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
export function explainRound(
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
      return logSelection(log, outcome);
    }
    return noSelection(log, SELECTION_REFUSED, outcome.reason);
  }
  if (at.kind === NARROWING.widened) {
    return noSelection(log, at.notNarrowed.kind, at.notNarrowed.reason);
  }
  return noSelection(
    log,
    NO_BUILD_ENDED_KIND,
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
  kind: string,
  reason: string,
): RoundSelection {
  log.entry(
    `warning: no selection was made (${kind}), ${NO_SELECTION_CONSEQUENCE}: ${reason}`,
  );
  return NO_SELECTION;
}

function logSelection(log: DaemonLog, selection: Selection): RoundSelection {
  for (const report of selection.paths) log.entry(pathText(report));
  for (const fallback of selection.fallbacks) log.entry(fallbackText(fallback));
  log.entry(countsText(selection.counts));
  return {
    directTargets: new Set(
      selection.paths.flatMap(({ owner }) =>
        owner === undefined ? [] : [owner],
      ),
    ),
    selected: new Set(selection.workspaces.map(({ path }) => path)),
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
