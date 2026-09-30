import { parseArgs } from "node:util";
import {
  COVERAGE,
  MAX_WAIT_LIMIT_MS,
  queryWait,
  ROUND,
  WAIT_OUTCOME,
  type NamedFailure,
  type WaitOptions,
  type WaitResponse,
} from "@rt-test/daemon/client";
import {
  contextLines,
  countLines,
  coverageLine,
  executionLines,
  fileLines,
  firstErrorText,
  INDENT,
  joinLines,
  namedText,
  notDiscoveredLines,
  testText,
} from "../answer-text.js";
import {
  JSON_OPTION,
  nonEmptyPath,
  requiredFiles,
  UsageError,
  type Command,
} from "../command.js";
import { fileQueryRun } from "../file-query.js";
import { oneLine } from "../output.js";

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
const FAILURES_HEADING = "Failures:";
const COVERING_HEADING = "Covering workspaces:";
const NO_COVERING_WORKSPACE = "Covering workspaces: none the daemon runs";
const NOT_BOUND = "before it bound to an input revision";

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
    return fileQueryRun({
      name: NAME,
      json: values.json === true,
      rootArgument,
      fileArguments,
      query: (root, files) => queryWait(root, files, options),
      text: waitText,
    });
  },
};

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
    ...fileLines(answer.files, answer.coverage.state),
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

function failureLines(failures: WaitResponse["namedFailures"]): string[] {
  if (failures.named.length === 0) return [];
  return [
    FAILURES_HEADING,
    ...failures.named.map((failure) => `${INDENT}${failureText(failure)}`),
    ...(failures.more === 0 ? [] : [`${INDENT}and ${failures.more} more`]),
  ];
}

function failureText(failure: NamedFailure): string {
  return `${testText(failure, failure.testName)}: ${failure.state}, ${failure.freshness}: ${firstErrorText(failure.firstError)}`;
}
