import {
  activityText,
  FRESHNESS_VALUES,
  TEST_STATES,
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

/** The discovery's adapter version when it is not current, then the daemon's activity and each job it stored nothing for. */
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
  return [
    ...adapter,
    `Daemon: ${oneLine(activityText(answer.activity))}`,
    ...(unstored.length === 0
      ? []
      : ["Ended with nothing stored:", ...unstored]),
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
        `${INDENT}${entry.kind} ${oneLine(entryName(entry))}: ${firstLine(entry.reason)}${entry.omittedCharacters > 0 ? ` (${entry.omittedCharacters} more characters)` : ""}${errorCountText(entry)}`,
    ),
  ];
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
