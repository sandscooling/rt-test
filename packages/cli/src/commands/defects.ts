import { parseArgs } from "node:util";
import {
  DEFECT_STATE,
  DEFECT_STATES,
  errorText,
  FRESHNESS_VALUES,
  NOT_RUNNABLE_STATES,
  queryDefects,
  UNDETECTED_VERDICTS,
  type DefectCounts,
  type DefectsResponse,
  type DefectState,
  type GapModule,
  type ListedDefinition,
  type ListedError,
  type ListedEvidence,
  type ListedInvalidEntry,
} from "@rt-test/daemon/client";
import {
  answerFields,
  contextLines,
  cutReasonText,
  DETAIL_SEPARATOR,
  INDENT,
  joinLines,
  LIST_SEPARATOR,
} from "../answer-text.js";
import {
  absolutePath,
  JSON_OPTION,
  nonEmptyPath,
  optionalPositional,
  type Command,
} from "../command.js";
import { oneLine, reported } from "../output.js";

const NAME = "defects";
const OPTIONS = {
  ...JSON_OPTION,
  root: { type: "string" },
} as const;
const NONE = "none";
const INVALID_ENTRIES_HEADING = "Definition file problems:";
const NOT_RUNNABLE_HEADING = "Definitions that cannot run:";
const UNDETECTED_HEADING = "Verdicts that are not a detection:";
const UNREADABLE_HEADING =
  "Never verified, with stored evidence that could not be read:";
const GAPS_HEADING = "Gaps by module:";
const NO_ERROR_NAME = "(no name)";
const NO_ERRORS = "none recorded";

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
    const pathArgument = optionalPositional(positionals, "path");
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

function defectsText(answer: DefectsResponse): string {
  return joinLines([
    `RT Test defects for ${oneLine(answer.path)} in ${oneLine(answer.consumerRoot)}`,
    ...defectCountLines(answer.counts),
    ...invalidEntryLines(answer.invalidEntries),
    ...sectionLines(
      NOT_RUNNABLE_HEADING,
      listedIn(answer, NOT_RUNNABLE_STATES).map(reasonedText),
    ),
    ...sectionLines(
      UNDETECTED_HEADING,
      listedIn(answer, UNDETECTED_VERDICTS).map(verdictText),
    ),
    ...sectionLines(
      UNREADABLE_HEADING,
      listedIn(answer, [DEFECT_STATE.neverVerified])
        .filter((definition) => definition.reason !== undefined)
        .map(reasonedText),
    ),
    notListedLine(answer.definitionsNotListed),
    `Tests in scope: ${answer.testsInScope}, of which ${answer.gaps} are gaps with no definition`,
    ...gapLines(answer.gapModules),
    ...contextLines(answer),
  ]);
}

/** Every count is printed whatever its value, so a scope where all is verified prints the same lines as any other. */
function defectCountLines(counts: DefectCounts): string[] {
  const problems =
    counts.invalidEntries === 1
      ? "1 is a definition file problem"
      : `${counts.invalidEntries} are definition file problems`;
  return [
    `Defects: ${counts.total}, of which ${problems}`,
    `Verified: ${counts.verified} of ${counts.total}; eligible: ${counts.eligible}`,
    `States: ${keyedCounts(DEFECT_STATES, counts.states)}`,
    `Evidence freshness: ${keyedCounts(FRESHNESS_VALUES, counts.freshness)}`,
    `Stale causes: ${namedCounts(counts.staleCauses)}`,
    `Unknown reasons: ${namedCounts(counts.unknownReasons)}`,
    `Evidence that could not be read: ${counts.unreadableEvidence}`,
  ];
}

function keyedCounts<K extends string>(
  keys: readonly K[],
  counts: Readonly<Record<K, number>>,
): string {
  return keys.map((key) => `${key} ${counts[key]}`).join(LIST_SEPARATOR);
}

/** Each count under the name the answer gives it, in the answer's order, so a name added later needs no wording here. */
function namedCounts(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .map(([name, count]) => `${name} ${count}`)
    .join(LIST_SEPARATOR);
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

function listedIn(
  answer: DefectsResponse,
  states: readonly DefectState[],
): ListedDefinition[] {
  return answer.definitions.filter((definition) =>
    states.includes(definition.state),
  );
}

function sectionLines(heading: string, entries: readonly string[]): string[] {
  if (entries.length === 0) return [];
  return [heading, ...entries.map((entry) => `${INDENT}${entry}`)];
}

/** How many definitions of each state the answer counted and did not list, printed whatever the numbers. */
function notListedLine(
  notListed: DefectsResponse["definitionsNotListed"],
): string {
  const narrower = DEFECT_STATES.some((state) => notListed[state] > 0)
    ? "; ask for a narrower path"
    : "";
  return `Definitions not listed: ${keyedCounts(DEFECT_STATES, notListed)}${narrower}`;
}

function definitionLead(definition: ListedDefinition): string {
  const name =
    definition.id === null
      ? `definition ${definition.position}`
      : oneLine(definition.id);
  return `${definition.state} ${name} in ${oneLine(definition.file)}`;
}

function reasonedText(definition: ListedDefinition): string {
  const reason =
    definition.reason === undefined ? NONE : cutReasonText(definition.reason);
  return `${definitionLead(definition)}: ${reason}`;
}

function verdictText(definition: ListedDefinition): string {
  const { evidence } = definition;
  const said = evidence === undefined ? NONE : evidenceText(evidence);
  return `${definitionLead(definition)}: ${said}`;
}

/** The verdict's reason with its detail, the errors it lists, what the answer cut, then the evidence's freshness. */
function evidenceText(evidence: ListedEvidence): string {
  const { reason, detail, errors, omittedCharacters } = evidence;
  return [
    ...(reason === undefined ? [] : [reasonText(reason, detail)]),
    ...(errors === undefined
      ? []
      : [errorsText(errors, evidence.errorsNotListed ?? 0)]),
    ...(omittedCharacters === undefined || omittedCharacters === 0
      ? []
      : [`${omittedCharacters} more characters of these names were cut`]),
    freshnessText(evidence),
  ].join(DETAIL_SEPARATOR);
}

function reasonText(reason: string, detail: unknown): string {
  return detail === undefined ? reason : `${reason} (${detailText(detail)})`;
}

/** A detail by each member's name and value, at any depth, so a reason added later needs no wording here. */
function detailText(detail: unknown): string {
  if (typeof detail === "string") return oneLine(detail);
  if (Array.isArray(detail)) {
    return `[${detail.map(detailText).join(LIST_SEPARATOR)}]`;
  }
  if (typeof detail !== "object" || detail === null) return String(detail);
  return Object.entries(detail)
    .map(([member, held]) => `${oneLine(member)} ${memberText(held)}`)
    .join(LIST_SEPARATOR);
}

function memberText(held: unknown): string {
  const nested =
    typeof held === "object" && held !== null && !Array.isArray(held);
  return nested ? `(${detailText(held)})` : detailText(held);
}

function errorsText(errors: readonly ListedError[], notListed: number): string {
  const listed = errors.map(
    (error) =>
      `${error.kind} ${error.name === undefined ? NO_ERROR_NAME : oneLine(error.name)}`,
  );
  const named = listed.length === 0 ? NO_ERRORS : listed.join(LIST_SEPARATOR);
  const more = notListed === 0 ? "" : ` and ${notListed} more not listed`;
  return `errors: ${named}${more}`;
}

function freshnessText(evidence: ListedEvidence): string {
  switch (evidence.freshness) {
    case "current":
      return `evidence ${evidence.freshness}`;
    case "stale":
      return `evidence ${evidence.freshness} (${evidence.staleCauses.join(LIST_SEPARATOR)})`;
    case "unknown":
      return `evidence ${evidence.freshness} (${evidence.unknownReasons.join(LIST_SEPARATOR)})`;
  }
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
