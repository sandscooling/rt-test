import {
  activityText,
  DEPENDENCY_BUILD_FAILED,
  DEPENDENCY_BUILD_TIMED_OUT,
  DEPENDENCY_BUILDS_ENDED,
  FRESHNESS_VALUES,
  NO_SELECTION_INPUT,
  RECONCILIATION_INCOMPLETE,
  SELECTION_REFUSED,
  TEST_STATES,
  WATCHER_UNHEALTHY,
  type CutReason,
  type InputFacts,
  type InputsNotNarrowed,
  type NotDiscoveredEntry,
  type PathStatusResponse,
  type SummaryResponse,
  type TestCounts,
} from "@rt-test/daemon/client";
import { oneLine } from "./output.js";

type Answer = SummaryResponse | PathStatusResponse;

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
 * then the daemon's activity and each job it stored nothing for.
 */
export function contextLines(answer: Answer): string[] {
  const { discovery, currentAdapterVersion } = answer;
  const adapter = discovery.adapterVersionCurrent
    ? []
    : [
        `The latest discovery was stored under adapter version ${discovery.adapterVersion}, not the current ${currentAdapterVersion}, so it is not current.`,
      ];
  const unstored = answer.unstoredJobs.map(
    (job) =>
      `${INDENT}${job.workspacePath === undefined ? "the discovery" : `the run of ${oneLine(job.workspacePath)}`}: ${firstLine(job.reason)}`,
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
    ...(unstored.length === 0
      ? []
      : ["Ended with nothing stored:", ...unstored]),
  ];
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
