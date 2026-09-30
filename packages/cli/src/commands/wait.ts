import { parseArgs } from "node:util";
import {
  COVERAGE,
  errorText,
  MAX_WAIT_LIMIT_MS,
  queryWait,
  ROUND,
  WAIT_OUTCOME,
  type ListedCoverage,
  type NamedFailure,
  type WaitFile,
  type WaitOptions,
  type WaitResponse,
} from "@rt-test/daemon/client";
import {
  answerFields,
  contextLines,
  countLines,
  cutReasonText,
  executionLines,
  INDENT,
  joinLines,
  namedText,
  notDiscoveredLines,
  notNarrowedCause,
  pathSelectionText,
} from "../answer-text.js";
import {
  absolutePath,
  JSON_OPTION,
  nonEmptyPath,
  UsageError,
  type Command,
} from "../command.js";
import { oneLine, reported } from "../output.js";

const NAME = "wait";
const OPTIONS = {
  ...JSON_OPTION,
  root: { type: "string" },
  limit: { type: "string" },
} as const;
const MS_PER_SECOND = 1_000;
const MIN_LIMIT_SECONDS = 1;
const MAX_LIMIT_SECONDS = Math.floor(MAX_WAIT_LIMIT_MS / MS_PER_SECOND);
const DECIMAL_DIGITS = /^[0-9]+$/;
const LIST_SEPARATOR = "; ";
const NAME_PATH_SEPARATOR = " > ";
const FILES_HEADING = "Files:";
const FAILURES_HEADING = "Failures:";
const COVERING_HEADING = "Covering workspaces:";
const NO_COVERING_WORKSPACE = "Covering workspaces: none the daemon runs";
const NOTHING_COVERS = "covered by no test";
const EVERY_WORKSPACE_COVERS = "covered by every discovered workspace";
const COVERAGE_NOT_KNOWN = "its covering workspaces are not yet known";
const NO_ERROR_RECORDED = "no error was recorded";
const NOT_BOUND = "before it bound to an input revision";
const COVERAGE_NOT_YET_KNOWN =
  "Coverage: not yet known, so every test counts as covering";

type CoverageState = WaitResponse["coverage"]["state"];

export const waitCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} <file>... [--root <dir>] [--limit <seconds>] [--json]`,
  parse(args) {
    const { values, positionals } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    const fileArguments = requiredFiles(positionals);
    const rootArgument = nonEmptyPath(values.root, "--root");
    const options = waitOptions(values.limit);
    return (io) =>
      reported(io, NAME, values.json === true, async (output) => {
        const root = absolutePath(io, rootArgument);
        const files = fileArguments.map((file) => absolutePath(io, file));
        let answer: WaitResponse;
        try {
          answer = await queryWait(root, files, options);
        } catch (error) {
          return output.fail(errorText(error), {
            consumerRoot: root,
            requestedPaths: files,
          });
        }
        return output.succeed(answerFields(answer), waitText(answer));
      });
  },
};

function requiredFiles(positionals: string[]): string[] {
  if (positionals.length === 0) throw new UsageError("Missing file.");
  for (const file of positionals) nonEmptyPath(file, "file");
  return positionals;
}

/** Whole seconds in decimal digits, so no hex, exponent or padded form converts; the daemon's default when absent. */
function waitOptions(limit: string | undefined): WaitOptions {
  if (limit === undefined) return {};
  const seconds = DECIMAL_DIGITS.test(limit) ? Number(limit) : Number.NaN;
  if (!(seconds >= MIN_LIMIT_SECONDS && seconds <= MAX_LIMIT_SECONDS)) {
    throw new UsageError(
      `--limit takes a whole number of seconds from ${MIN_LIMIT_SECONDS} to ${MAX_LIMIT_SECONDS}; got ${JSON.stringify(limit)}`,
    );
  }
  return { limitMs: seconds * MS_PER_SECOND };
}

function waitText(answer: WaitResponse): string {
  const coverageKnown = answer.coverage.state !== COVERAGE.notYetKnown;
  return joinLines([
    headline(answer),
    coverageLine(answer.coverage),
    FILES_HEADING,
    ...answer.files.map(
      (file) => `${INDENT}${fileText(file, answer.coverage.state)}`,
    ),
    `Covering tests: ${answer.counts.tests}`,
    ...countLines(answer.counts),
    ...notDiscoveredLines(answer.notDiscovered),
    ...failureLines(answer.namedFailures),
    ...(coverageKnown && answer.workspaces.length === 0
      ? [NO_COVERING_WORKSPACE]
      : executionLines(
          answer.workspaces,
          answer.schedule.round.state === ROUND.held,
          COVERING_HEADING,
        )),
    ...(answer.outcome === WAIT_OUTCOME.superseded
      ? [`Changed paths: ${namedText(answer.changedPaths, oneLine)}`]
      : []),
    ...contextLines(answer),
  ]);
}

/** The outcome and the revisions; it says nothing of whether the covering tests pass. */
function headline(answer: WaitResponse): string {
  const lead = `RT Test wait in ${oneLine(answer.consumerRoot)}:`;
  const bound =
    answer.boundRevision === null
      ? NOT_BOUND
      : `bound to input revision ${answer.boundRevision}`;
  switch (answer.outcome) {
    case WAIT_OUTCOME.settled:
      return `${lead} settled at input revision ${answer.inputs.revision}, ${bound}`;
    case WAIT_OUTCOME.superseded:
      return `${lead} superseded by input revision ${answer.supersededAt}, ${bound}`;
    case WAIT_OUTCOME.unsettled:
      return `${lead} unsettled, its limit passed at input revision ${answer.inputs.revision}, ${bound}`;
  }
}

function coverageLine(coverage: WaitResponse["coverage"]): string {
  switch (coverage.state) {
    case COVERAGE.selected:
      return `Coverage: by selection at input revision ${coverage.revision}`;
    case COVERAGE.widened:
      return `Coverage: every discovered workspace at input revision ${coverage.revision}, since ${notNarrowedCause(coverage.widenedBy)}: ${cutReasonText(coverage.reason)}`;
    case COVERAGE.notYetKnown:
      return COVERAGE_NOT_YET_KNOWN;
  }
}

function fileText(file: WaitFile, coverage: CoverageState): string {
  const unread =
    file.unread === undefined
      ? []
      : [`could not be read: ${cutReasonText(file.unread)}`];
  return `${oneLine(file.path)}: ${[coveringText(file, coverage), ...unread].join(LIST_SEPARATOR)}`;
}

/** Selection's report, then the workspaces whose fingerprints list the file; a file neither reaches is covered by none. */
function coveringText(file: WaitFile, coverage: CoverageState): string {
  if (coverage === COVERAGE.widened) return EVERY_WORKSPACE_COVERS;
  const { selection, listed } = file;
  if (selection === undefined || listed === undefined) {
    return COVERAGE_NOT_KNOWN;
  }
  const listing =
    listed.named.length === 0 && listed.more === 0
      ? []
      : [`listed by ${namedText(listed, listedText)}`];
  const nothing =
    selection.selected.named.length === 0 && listing.length === 0
      ? [NOTHING_COVERS]
      : [];
  return [...nothing, pathSelectionText(selection), ...listing].join(
    LIST_SEPARATOR,
  );
}

function listedText({ workspacePath, listedAs }: ListedCoverage): string {
  return `${oneLine(workspacePath)} (${listedAs})`;
}

function failureLines(failures: WaitResponse["namedFailures"]): string[] {
  if (failures.named.length === 0) return [];
  return [
    FAILURES_HEADING,
    ...failures.named.map((failure) => `${INDENT}${failureText(failure)}`),
    ...(failures.more === 0 ? [] : [`${INDENT}and ${failures.more} more`]),
  ];
}

function failureText(failure: NamedFailure): string {
  const test =
    failure.testName === undefined
      ? ""
      : `${NAME_PATH_SEPARATOR}${failure.testName.map(oneLine).join(NAME_PATH_SEPARATOR)}`;
  const error =
    failure.firstError === null
      ? NO_ERROR_RECORDED
      : cutReasonText(failure.firstError);
  return `${oneLine(failure.workspacePath)} ${oneLine(failure.projectName)} ${oneLine(failure.modulePath)}${test}: ${failure.state}, ${failure.freshness}: ${error}`;
}
