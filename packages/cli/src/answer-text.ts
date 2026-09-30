import {
  activityText,
  DEPENDENCY_BUILD_FAILED,
  DEPENDENCY_BUILD_TIMED_OUT,
  DEPENDENCY_BUILDS_ENDED,
  DUE_REASON,
  EARLIER_DAEMON_LIFE,
  EXECUTION_STATE,
  FIRST_ROUND,
  FRESHNESS_VALUES,
  IDLE_REASON,
  INPUT_DIGESTS_UNREAD,
  INVALIDATED,
  NO_BUILD_ENDED,
  NO_SELECTION_INPUT,
  RECONCILIATION_INCOMPLETE,
  ROUND,
  ROUND_SELECTION,
  roundText,
  SELECTION_REFUSED,
  TEST_STATES,
  WATCHER_UNHEALTHY,
  type ChoosingReason,
  type CutReason,
  type DueFacts,
  type ExplainedFallback,
  type ExplainedPath,
  type IdleReason,
  type InputFacts,
  type InputsNotNarrowed,
  type NamedList,
  type NoRoundSelection,
  type NotDiscoveredEntry,
  type PathStatusResponse,
  type ScheduleDueReason,
  type SelectionExplanation,
  type SelfChangedPath,
  type SummaryResponse,
  type TestCounts,
  type WorkspaceExecution,
} from "@rt-test/daemon/client";
import { oneLine } from "./output.js";

type Answer = SummaryResponse | PathStatusResponse;
type NotRunning = NonNullable<
  Extract<
    WorkspaceExecution,
    { readonly state: typeof EXECUTION_STATE.idle }
  >["notRunning"]
>;

export const INDENT = "  ";
const LIST_SEPARATOR = ", ";
const LINE_BREAK = "\n";
/** A reason from a Windows tool may end its lines with CRLF. */
const REASON_LINE_BREAK = /\r?\n/;
const TRAILING_LINE_BREAKS = /(\r?\n)+$/;
const ERRORS_SUFFIX = "errors";
const NONE = "none";
const NOT_DISCOVERED_HEADING = "Not discovered:";
const UNFINGERPRINTED_HEADING =
  "No current input fingerprint, so no result of these reads current:";
const NOT_YET_RECONCILED = "none has ended yet";
const NOT_NARROWED_WARNING =
  "Warning: no workspace's inputs are narrowed to those its selection includes, since";
const NOT_NARROWED_CAUSES: Record<InputsNotNarrowed["kind"], string> = {
  [DEPENDENCY_BUILD_FAILED]: "the last dependency build failed",
  [DEPENDENCY_BUILD_TIMED_OUT]: "the last dependency build timed out",
  [DEPENDENCY_BUILDS_ENDED]:
    "the dependency builds stopped working for the rest of the daemon's life",
  [NO_SELECTION_INPUT]: "the discovery yields no selection input",
  [SELECTION_REFUSED]: "selection refused an input's path",
};
const NO_SELECTION_CAUSES: Record<NoRoundSelection, string> = {
  ...NOT_NARROWED_CAUSES,
  [NO_BUILD_ENDED]: "no dependency build ended at the round's input revision",
  [INPUT_DIGESTS_UNREAD]: "the inputs' digests could not be read",
  [FIRST_ROUND]:
    "it was the first round of this daemon life, with no earlier round to compare with",
};
const DUE_PHRASES: Record<ScheduleDueReason, string> = {
  [DUE_REASON.noRun]: "it has no stored run",
  [DUE_REASON.anotherAdapterVersion]:
    "its latest run was stored under another adapter version",
  [DUE_REASON.notFingerprinted]: "its latest run was stored not fingerprinted",
  [INVALIDATED]: "its latest run is invalidated",
  [EARLIER_DAEMON_LIFE]:
    "its latest run was stored not fingerprinted in an earlier daemon life",
  [DUE_REASON.noCurrentFingerprint]:
    "its current input fingerprint cannot be computed",
  [DUE_REASON.inputsChanged]: "its inputs differ from those of its latest run",
  [DUE_REASON.failedRun]: "its latest run failed",
  [DUE_REASON.crashedRun]: "its latest run crashed",
};
const SELF_CHANGING_CAUSE =
  "because the daemon's own runs and discoveries keep changing its inputs";
const IDLE_PHRASES: Record<IdleReason, string> = {
  [IDLE_REASON.retryPending]: "a retry is pending",
  [IDLE_REASON.noRunUntilInputChange]:
    "no run comes until the next input change",
  [IDLE_REASON.roundHeld]: "no run comes until the held round is tried again",
  [IDLE_REASON.selfChanging]: `no run comes until an edit reaches its inputs or the daemon sees a change it cannot attribute, ${SELF_CHANGING_CAUSE}`,
};
/** Trying a held round again decides the hold again, so it may release a held workspace. */
const SELF_CHANGING_IN_HELD_ROUND = `no run comes until an edit reaches its inputs, the daemon sees a change it cannot attribute, or the daemon tries the held round again at the next input event or reconciliation, which may release it, ${SELF_CHANGING_CAUSE}`;
const SELF_CHANGED_LEAD = "the same inputs changed each time it became due";
const DISCOVERY_JOB = "the discovery";
const RUN_JOB = "the run of";
const DETAIL_SEPARATOR = "; ";
const INCOMPLETE_MARK = " (incomplete)";
const NO_OWNER = "no package workspace";
const EXECUTION_HEADING = "Execution:";

/** The answer's fields for `--json`, without the daemon protocol's own. */
export function answerFields(answer: Answer): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...answer };
  delete fields["type"];
  delete fields["protocolVersion"];
  return fields;
}

/** A set's counts by state and by freshness; a state with no test is left out, a freshness never is. */
export function countLines(counts: TestCounts): string[] {
  const states = TEST_STATES.filter((state) => counts.states[state] > 0).map(
    (state) => `${state} ${counts.states[state]}`,
  );
  const freshness = FRESHNESS_VALUES.map(
    (value) => `${value} ${counts.freshness[value]}`,
  );
  return [
    `States: ${states.length === 0 ? NONE : states.join(LIST_SEPARATOR)}`,
    `Freshness: ${freshness.join(LIST_SEPARATOR)}`,
  ];
}

/**
 * The discovery's adapter version when it is not current and its freshness, the inputs the answer was given from,
 * then the daemon's activity, its round, each workspace's execution state, each job it stored nothing for, and the
 * latest selection.
 */
export function contextLines(answer: Answer): string[] {
  const { discovery, currentAdapterVersion } = answer;
  const adapter = discovery.adapterVersionCurrent
    ? []
    : [
        `The latest discovery was stored under adapter version ${discovery.adapterVersion}, not the current ${currentAdapterVersion}, so it is not current.`,
      ];
  const unstored = answer.unstoredJobs.map(
    (job) => `${INDENT}${jobText(job)}: ${firstLine(job.reason)}`,
  );
  const unfingerprinted = answer.unfingerprintedWorkspaces.map(
    (workspace) =>
      `${INDENT}${oneLine(workspace.workspacePath)}: ${firstLine(workspace.reason)}`,
  );
  return [
    ...adapter,
    `Discovery freshness: ${discovery.freshness}`,
    ...inputLines(answer.inputs),
    ...(answer.nonInputsUnusable === undefined
      ? []
      : [`Warning: ${firstLine(answer.nonInputsUnusable)}`]),
    ...(answer.inputsNotNarrowed === undefined
      ? []
      : [
          `${NOT_NARROWED_WARNING} ${NOT_NARROWED_CAUSES[answer.inputsNotNarrowed.kind]}: ${firstLine(answer.inputsNotNarrowed.reason)}`,
        ]),
    ...(unfingerprinted.length === 0
      ? []
      : [UNFINGERPRINTED_HEADING, ...unfingerprinted]),
    `Daemon: ${oneLine(activityText(answer.activity))}`,
    `Round: ${firstLine(roundText(answer.schedule.round))}`,
    ...executionLines(
      answer.schedule.workspaces,
      answer.schedule.round.state === ROUND.held,
    ),
    ...(unstored.length === 0
      ? []
      : ["Ended with nothing stored:", ...unstored]),
    ...selectionLines(answer.latestSelection),
  ];
}

function executionLines(
  workspaces: readonly WorkspaceExecution[],
  roundHeld: boolean,
): string[] {
  if (workspaces.length === 0) return [];
  return [
    EXECUTION_HEADING,
    ...workspaces.map(
      (workspace) =>
        `${INDENT}${oneLine(workspace.workspacePath)}: ${executionText(workspace, roundHeld)}`,
    ),
  ];
}

function executionText(
  workspace: WorkspaceExecution,
  roundHeld: boolean,
): string {
  switch (workspace.state) {
    case EXECUTION_STATE.running:
      return workspace.state;
    case EXECUTION_STATE.interrupted:
      return `${workspace.state} by a change to ${namedText(workspace.interruptedBy, oneLine)}`;
    case EXECUTION_STATE.queued:
      return [
        `${workspace.state}: ${dueText(workspace.due)}`,
        ...(isEmpty(workspace.chosenBy)
          ? []
          : [chosenText(workspace.chosenBy)]),
        ...(workspace.interruptedBy === undefined
          ? []
          : [
              `its last run was interrupted by a change to ${namedText(workspace.interruptedBy, oneLine)}`,
            ]),
      ].join(DETAIL_SEPARATOR);
    case EXECUTION_STATE.idle:
      return workspace.notRunning === undefined
        ? workspace.state
        : `${workspace.state}: ${notRunningText(workspace.notRunning, roundHeld)}`;
  }
}

function notRunningText(notRunning: NotRunning, roundHeld: boolean): string {
  const { why, due, selfChanged } = notRunning;
  const phrase =
    roundHeld && why === IDLE_REASON.selfChanging
      ? SELF_CHANGING_IN_HELD_ROUND
      : IDLE_PHRASES[why];
  const text = `${phrase}, since ${dueText(due)}`;
  if (selfChanged === undefined) return text;
  return [
    text,
    `${SELF_CHANGED_LEAD}: ${namedText(selfChanged, selfChangedText)}`,
  ].join(DETAIL_SEPARATOR);
}

function selfChangedText({ path, jobs }: SelfChangedPath): string {
  return `${oneLine(path)} (during ${namedText(jobs, jobText)})`;
}

function jobText({
  workspacePath,
}: SelfChangedPath["jobs"]["named"][number]): string {
  return workspacePath === undefined
    ? DISCOVERY_JOB
    : `${RUN_JOB} ${oneLine(workspacePath)}`;
}

function dueText(due: DueFacts): string {
  const detail =
    due.detail === undefined ? "" : `: ${cutReasonText(due.detail)}`;
  return `${DUE_PHRASES[due.kind]}${detail}`;
}

/** A workspace chosen only for reasons whose path or fallback the answer leaves out gets a count, not an empty list. */
function chosenText(chosenBy: NamedList<ChoosingReason>): string {
  return chosenBy.named.length === 0
    ? `chosen for ${chosenBy.more} reasons the latest selection does not name`
    : `chosen by ${namedText(chosenBy, choosingText)}`;
}

function choosingText(reason: ChoosingReason): string {
  const fallback =
    reason.scope === undefined
      ? ""
      : `, a broad fallback to the ${reason.scope}`;
  return `${oneLine(reason.path)} (${reason.trigger}${fallback})`;
}

function isEmpty<T>(list: NamedList<T>): boolean {
  return list.named.length === 0 && list.more === 0;
}

/** The items an answer named, then how many it left out. */
function namedText<T>(list: NamedList<T>, text: (item: T) => string): string {
  const named = list.named.map(text).join(LIST_SEPARATOR);
  return list.more === 0 ? named : `${named} and ${list.more} more`;
}

function selectionLines(selection: SelectionExplanation): string[] {
  switch (selection.state) {
    case ROUND_SELECTION.noRoundYet:
      return ["Latest selection: no round has planned in this daemon life"];
    case ROUND_SELECTION.notMade:
      return [
        `Latest selection: none was made at input revision ${selection.revision}, since ${NO_SELECTION_CAUSES[selection.kind]}: ${cutReasonText(selection.reason)}`,
      ];
    case ROUND_SELECTION.made:
      return [
        `Latest selection, at input revision ${selection.revision}: ${countsText(selection.counts)}`,
        ...selection.paths.named.map((path) => `${INDENT}${pathText(path)}`),
        ...moreLines(selection.paths.more, "changed paths"),
        ...selection.fallbacks.named.map(
          (fallback) => `${INDENT}${fallbackText(fallback)}`,
        ),
        ...moreLines(selection.fallbacks.more, "broad fallbacks"),
      ];
  }
}

type SelectionCounts = Extract<
  SelectionExplanation,
  { readonly state: typeof ROUND_SELECTION.made }
>["counts"];
type TestCount = SelectionCounts["selectedTests"];
type SelectionReason =
  ExplainedPath["selected"]["named"][number]["reasons"][number];

function countsText(counts: SelectionCounts): string {
  const { totalWorkspaces } = counts;
  const workspaces = `${counts.selectedWorkspaces} of ${totalWorkspaces.count}${totalWorkspaces.complete ? "" : INCOMPLETE_MARK}`;
  return `selected ${countText(counts.selectedTests)} of ${countText(counts.totalTests)} tests and ${workspaces} workspaces, ${counts.notRunnableWorkspaces} not runnable`;
}

function countText(count: TestCount): string {
  return `${count.count}${count.complete ? "" : INCOMPLETE_MARK}`;
}

function moreLines(more: number, what: string): string[] {
  return more === 0 ? [] : [`${INDENT}and ${more} more ${what}`];
}

/** The workspaces the path reached that cannot run, bounded and counted, whether or not it selected any. */
function pathText(path: ExplainedPath): string {
  const owner = path.owner === undefined ? NO_OWNER : oneLine(path.owner);
  const notRunnable = isEmpty(path.notRunnable)
    ? ""
    : `; not runnable: ${namedText(path.notRunnable, (excluded) => `${oneLine(excluded.workspace.path)} (${cutReasonText(excluded)})`)}`;
  return `changed path ${oneLine(path.path)}, owned by ${owner}, ${selectedText(path)}${notRunnable}`;
}

/** A path that selected none only because its workspaces cannot run gives its kind; the not-runnable list says the rest. */
function selectedText(path: ExplainedPath): string {
  if (isEmpty(path.selected)) {
    const none = path.nothingSelected;
    if (none === undefined) return "selected no workspace";
    const detail = isEmpty(path.notRunnable)
      ? `: ${cutReasonText(none.detail)}`
      : "";
    return `selected no workspace, ${none.kind}${detail}`;
  }
  return `selected ${namedText(
    path.selected,
    ({ workspace, reasons }) =>
      `${oneLine(workspace)} (${reasons.map(reasonText).join(DETAIL_SEPARATOR)})`,
  )}`;
}

function reasonText(reason: SelectionReason): string {
  const from = reason.from === undefined ? "" : ` from ${oneLine(reason.from)}`;
  const steps = reason.steps
    .map((step) => {
      const detail =
        step.detail.reason === "" ? "" : ` (${cutReasonText(step.detail)})`;
      return `${oneLine(step.workspace)} by ${step.via}${detail}`;
    })
    .join(" then ");
  return `${reason.trigger}${from}${steps === "" ? "" : ` through ${steps}`}`;
}

function fallbackText(fallback: ExplainedFallback): string {
  return `broad fallback to the ${fallback.scope} for ${oneLine(fallback.path)}, triggered by ${fallback.trigger}, from ${namedText(fallback.workspaces, oneLine)}`;
}

/** The input revision, reconciliation, watcher and pending changes an answer was given from, with their reasons. */
function inputLines(inputs: InputFacts): string[] {
  const { reconciliation, watcher } = inputs;
  const reconciled =
    inputs.lastReconciledAt === undefined
      ? NOT_YET_RECONCILED
      : `ended ${inputs.lastReconciledAt}`;
  return [
    `Input revision: ${inputs.revision}`,
    `Reconciliation: ${reconciliation.state === RECONCILIATION_INCOMPLETE ? `${reconciliation.state}: ${firstLine(reconciliation.reason)}` : reconciliation.state}`,
    `Last reconciliation: ${reconciled}`,
    `Watcher: ${watcher.state === WATCHER_UNHEALTHY ? `${watcher.state}: ${firstLine(watcher.reason)}` : watcher.state}`,
    ...(inputs.pendingChanges === 0
      ? []
      : [`Changed paths not yet read: ${inputs.pendingChanges}`]),
    ...inputs.gitUnread.map((reason) => `Warning: ${firstLine(reason)}`),
  ];
}

export function notDiscoveredLines(
  entries: readonly NotDiscoveredEntry[],
  heading = NOT_DISCOVERED_HEADING,
): string[] {
  if (entries.length === 0) return [];
  return [
    heading,
    ...entries.map(
      (entry) =>
        `${INDENT}${entry.kind} ${oneLine(entryName(entry))}: ${cutReasonText(entry)}${errorCountText(entry)}`,
    ),
  ];
}

/** A reason an answer cut, as its first line and a count of what the cut left out. */
export function cutReasonText(cut: CutReason): string {
  return `${firstLine(cut.reason)}${cut.omittedCharacters > 0 ? ` (${cut.omittedCharacters} more characters)` : ""}`;
}

function errorCountText(entry: NotDiscoveredEntry): string {
  return "errorCount" in entry ? ` (${entry.errorCount} ${ERRORS_SUFFIX})` : "";
}

export function joinLines(lines: readonly string[]): string {
  return lines.join(LINE_BREAK);
}

function entryName(entry: NotDiscoveredEntry): string {
  if ("source" in entry) return entry.source;
  if ("modulePath" in entry) {
    return `${entry.workspacePath} ${entry.projectName} ${entry.modulePath}`;
  }
  if ("projectName" in entry) {
    return `${entry.workspacePath} ${entry.projectName}`;
  }
  return entry.workspacePath;
}

/** The first line of a reason, marked when more of it is in the `--json` answer or the store. */
function firstLine(reason: string): string {
  const [first = "", ...rest] = reason
    .replace(TRAILING_LINE_BREAKS, "")
    .split(REASON_LINE_BREAK);
  return rest.length === 0 ? oneLine(first) : `${oneLine(first)} (more lines)`;
}
