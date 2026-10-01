import { parseArgs } from "node:util";
import {
  DEFECT_STATE,
  DEFECT_STATES,
  errorText,
  queryDefects,
  type DefectCounts,
  type DefectsResponse,
  type DefectState,
  type GapModule,
  type ListedDefinition,
  type ListedInvalidEntry,
} from "@rt-test/daemon/client";
import {
  answerFields,
  contextLines,
  cutReasonText,
  INDENT,
  joinLines,
  LIST_SEPARATOR,
} from "../answer-text.js";
import {
  absolutePath,
  JSON_OPTION,
  nonEmptyPath,
  UsageError,
  type Command,
} from "../command.js";
import { oneLine, reported } from "../output.js";

const NAME = "defects";
const OPTIONS = {
  ...JSON_OPTION,
  root: { type: "string" },
} as const;
const MAX_PATH_POSITIONALS = 1;
const NONE = "none";
const INVALID_ENTRIES_HEADING = "Definition file problems:";
const NOT_RUNNABLE_HEADING = "Definitions that cannot run:";
const GAPS_HEADING = "Gaps by module:";
/** The states a definition reads before any falsification that withhold verified for a problem of its own. */
const PROBLEM_STATES: readonly DefectState[] = DEFECT_STATES.filter(
  (state) => state !== DEFECT_STATE.neverVerified,
);

export const defectsCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} [path] [--root <dir>] [--json]`,
  parse(args) {
    const { values, positionals } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    const pathArgument = pathPositional(positionals);
    const rootArgument = nonEmptyPath(values.root, "--root");
    return (io) =>
      reported(io, NAME, values.json === true, async (output) => {
        const root = absolutePath(io, rootArgument);
        const path =
          pathArgument === undefined
            ? undefined
            : absolutePath(io, pathArgument);
        let answer: DefectsResponse;
        try {
          answer = await queryDefects(root, path);
        } catch (error) {
          return output.fail(errorText(error), {
            consumerRoot: root,
            ...(path === undefined ? {} : { requestedPath: path }),
          });
        }
        return output.succeed(answerFields(answer), defectsText(answer));
      });
  },
};

/** The one optional `path` positional. */
function pathPositional(positionals: string[]): string | undefined {
  if (positionals.length > MAX_PATH_POSITIONALS) {
    throw new UsageError(
      `Unexpected argument: ${positionals.slice(MAX_PATH_POSITIONALS).join(" ")}`,
    );
  }
  return nonEmptyPath(positionals[0], "path");
}

function defectsText(answer: DefectsResponse): string {
  return joinLines([
    `RT Test defects for ${oneLine(answer.path)} in ${oneLine(answer.consumerRoot)}`,
    ...defectCountLines(answer.counts),
    ...invalidEntryLines(answer.invalidEntries),
    ...notRunnableLines(answer),
    `Tests in scope: ${answer.testsInScope}, of which ${answer.gaps} are gaps with no definition`,
    ...gapLines(answer.gapModules),
    ...contextLines(answer),
  ]);
}

function defectCountLines(counts: DefectCounts): string[] {
  const states = DEFECT_STATES.map(
    (state) => `${state} ${counts.states[state]}`,
  );
  return [
    `Defects: ${counts.total}, of which ${counts.invalidEntries} are definition file problems`,
    `States: ${states.join(LIST_SEPARATOR)}`,
  ];
}

function invalidEntryLines(entries: readonly ListedInvalidEntry[]): string[] {
  if (entries.length === 0) return [];
  return [
    INVALID_ENTRIES_HEADING,
    ...entries.map(
      (entry) =>
        `${INDENT}${entry.kind} ${oneLine(entry.path)}: ${cutReasonText(entry)}`,
    ),
  ];
}

/** Each listed definition that is invalid or whose anchor is missing, then how many of each the answer left out. */
function notRunnableLines(answer: DefectsResponse): string[] {
  const listed = answer.definitions.filter((definition) =>
    PROBLEM_STATES.includes(definition.state),
  );
  const unlisted = PROBLEM_STATES.filter(
    (state) => answer.definitionsNotListed[state] > 0,
  ).map((state) => `${answer.definitionsNotListed[state]} ${state}`);
  if (listed.length === 0 && unlisted.length === 0) return [];
  return [
    NOT_RUNNABLE_HEADING,
    ...listed.map((definition) => `${INDENT}${definitionText(definition)}`),
    ...(unlisted.length === 0
      ? []
      : [
          `${INDENT}and ${unlisted.join(LIST_SEPARATOR)} more not listed; ask for a narrower path`,
        ]),
  ];
}

function definitionText(definition: ListedDefinition): string {
  const name =
    definition.id === null
      ? `definition ${definition.position}`
      : oneLine(definition.id);
  const reason =
    definition.reason === undefined ? NONE : cutReasonText(definition.reason);
  return `${definition.state} ${name} in ${oneLine(definition.file)}: ${reason}`;
}

function gapLines(modules: readonly GapModule[]): string[] {
  if (modules.length === 0) return [];
  return [
    GAPS_HEADING,
    ...modules.map(
      (module) => `${INDENT}${oneLine(module.module)}: ${module.gaps}`,
    ),
  ];
}
