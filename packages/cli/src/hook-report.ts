import {
  CHANGE_KIND,
  CHANGE_KINDS,
  CURRENT,
  CURSOR_USE,
  FAILING_STATES,
  NOT_DETERMINED,
  TEST_STATES,
  type ChangeCounts,
  type ChangeStanding,
  type ChangesResponse,
  type EntryChange,
  type ListedChange,
  type NotDeterminedFacts,
  type TestCounts,
} from "@rt-test/daemon/client";
import {
  cutReasonText,
  DETAIL_SEPARATOR,
  entryText,
  firstErrorText,
  INDENT,
  joinLines,
  LIST_SEPARATOR,
  testText,
} from "./answer-text.js";
import { oneLine } from "./output.js";

/** The most changes a report names; it counts the rest by kind. */
const NAMED_CHANGES = 5;
const ERROR_LINE_CHARS = 200;
/**
 * A named change's test or entry, and each path or reason a line carries. With the fixed text, five named changes,
 * their error lines and the count lines stay far below Claude Code's 10,000-character cap on added context.
 */
const SUBJECT_CHARS = 400;
const PATH_CHARS = 300;
const REASON_CHARS = 500;
const CUT_MARK = " (cut)";

const LEAD = "RT Test:";
const SCOPE_TESTS = "tests covering the files this session edited";
const SCOPE = `the ${SCOPE_TESTS}`;
/** A reason that already ends a sentence, which the line ends itself. */
const FINAL_PERIOD = /\.$/;
const CHANGE_NOUNS: Nouns = { one: "change", many: "changes" };
const EDITED_FILE_NOUNS: Nouns = {
  one: "older edited file was",
  many: "older edited files were",
};
const ASKED_LEAD = "Asked about the";
const ASKED_TAIL = "most recently edited files only";
const LEFT_OUT = "left out";
const NOW = "now:";
const UNREAD_TAIL = "of the edited files could not be read";
const VERBS: Nouns = { one: "is", many: "are" };
const REPORT_TAIL = "failures first:";
const OUTSIDE_FAILING_LEAD = "Tests outside those files that are failing:";
const NO_CHANGES_LISTED = "no changes listed";
const NOT_DECIDED = "not decided for";
const NO_ANSWER_LEAD = "cannot tell what changed in";
const AT_LAST_REPORT = "at your last report:";
const FIRST_ERROR = "first error:";
const NO_STANDING = "none";
const ENTRY_APPEARED = "appeared";
const ENTRY_WENT_AWAY = "went away";
const LOSS_TAIL =
  "It says nothing more of this until the daemon answers again.";
const BASELINE_CAUSES: Record<
  | typeof CURSOR_USE.noneGiven
  | typeof CURSOR_USE.notIssued
  | typeof CURSOR_USE.expired,
  string
> = {
  [CURSOR_USE.noneGiven]: "you have had no report yet",
  [CURSOR_USE.notIssued]:
    "your last report came from another daemon life, such as before a restart",
  [CURSOR_USE.expired]:
    "your last report is older than the changes the daemon keeps",
};
const UNDECIDED_CAUSES: Record<
  typeof NOT_DETERMINED.inputsUnavailable | typeof NOT_DETERMINED.buildNotEnded,
  string
> = {
  [NOT_DETERMINED.inputsUnavailable]: "no input fingerprint can be computed",
  [NOT_DETERMINED.buildNotEnded]:
    "the dependency build at this input revision has not ended",
};

type DeterminedAnswer = Extract<ChangesResponse, { determined: true }>;

interface Nouns {
  readonly one: string;
  readonly many: string;
}

/** How many of the session's edited files a query asked about, and how many older ones it left out. */
export interface AskedPaths {
  readonly asked: number;
  readonly leftOut: number;
}

/**
 * What a batch's answer tells the agent: the changes since its last report, or, when no cursor of the agent's was
 * used, the counts in scope while a test there is failing or not current. Undefined when there is nothing to tell,
 * a not-determined answer included.
 */
export function batchText(
  answer: ChangesResponse,
  paths: AskedPaths,
): string | undefined {
  if (!answer.determined) return undefined;
  return answer.cursorUse === CURSOR_USE.used
    ? changesReport(answer, paths)
    : baselineLine(answer, answer.cursorUse);
}

/** The one line for a turn's end or the next prompt; undefined when no test in scope is failing or not current. */
export function standingLine(answer: ChangesResponse): string | undefined {
  if (!answer.determined) {
    return `${LEAD} ${NOT_DECIDED} ${SCOPE}, since ${undecidedText(answer.notDetermined).replace(FINAL_PERIOD, "")}.`;
  }
  const counts = countsText(answer.counts);
  return counts === undefined ? undefined : `${LEAD} ${counts}.`;
}

/** Told once for each loss of an answer. */
export function noAnswerLine(root: string, reason: string): string {
  return `${LEAD} ${NO_ANSWER_LEAD} ${SCOPE}: no answer for ${cut(oneLine(root), PATH_CHARS)}: ${cut(oneLine(reason.replace(FINAL_PERIOD, "")), REASON_CHARS)}. ${LOSS_TAIL}`;
}

/** Undefined when the answer lists and counts no change in scope. */
function changesReport(
  answer: DeterminedAnswer,
  paths: AskedPaths,
): string | undefined {
  const total = answer.changes.length + countOf(answer.omittedChanges);
  if (total === 0) return undefined;
  const named = answer.changes.slice(0, NAMED_CHANGES);
  const outsideFailing = failingCount(answer.outside.counts);
  return joinLines([
    `${LEAD} ${counted(total, CHANGE_NOUNS)} since your last report in ${SCOPE}, ${REPORT_TAIL}`,
    ...named.map((change) => `${INDENT}${changeText(change)}`),
    ...omittedLines(omittedByKind(answer)),
    ...(outsideFailing === 0
      ? []
      : [`${OUTSIDE_FAILING_LEAD} ${outsideFailing}`]),
    ...leftOutLines(paths),
  ]);
}

function baselineLine(
  answer: DeterminedAnswer,
  cause: keyof typeof BASELINE_CAUSES,
): string | undefined {
  const counts = countsText(answer.counts);
  if (counts === undefined) return undefined;
  return `${LEAD} ${NO_CHANGES_LISTED}, since ${BASELINE_CAUSES[cause]}; ${counts}.`;
}

function countsText(counts: TestCounts): string | undefined {
  const failing = failingCount(counts);
  const notCurrent = counts.tests - counts.freshness[CURRENT];
  if (failing === 0 && notCurrent === 0) return undefined;
  return `of the ${counts.tests} ${SCOPE_TESTS}, ${failing} ${verb(failing)} failing and ${notCurrent} ${verb(notCurrent)} not current`;
}

function counted(count: number, nouns: Nouns): string {
  return `${count} ${count === 1 ? nouns.one : nouns.many}`;
}

function verb(count: number): string {
  return count === 1 ? VERBS.one : VERBS.many;
}

function failingCount(counts: TestCounts): number {
  return TEST_STATES.filter((state) => FAILING_STATES[state]).reduce(
    (sum, state) => sum + counts.states[state],
    0,
  );
}

function undecidedText(facts: NotDeterminedFacts): string {
  if (facts.kind === NOT_DETERMINED.pathsUnread) {
    return `${facts.unread.length} ${UNREAD_TAIL}`;
  }
  return `${UNDECIDED_CAUSES[facts.kind]}: ${cut(cutReasonText(facts.reason), REASON_CHARS)}`;
}

function changeText(change: ListedChange): string {
  const detail =
    "test" in change
      ? [
          `${cut(testText(change.test, change.test.namePath), SUBJECT_CHARS)}: ${AT_LAST_REPORT} ${standingText(change.atCursor)}`,
          `${NOW} ${standingText(change.now)}`,
        ]
      : [entryChangeText(change)];
  const error =
    change.kind === CHANGE_KIND.failing
      ? [
          `${FIRST_ERROR} ${cut(firstErrorText(change.firstError), ERROR_LINE_CHARS)}`,
        ]
      : [];
  return [`${change.kind} ${detail.join(DETAIL_SEPARATOR)}`, ...error].join(
    DETAIL_SEPARATOR,
  );
}

function standingText(standing: ChangeStanding | undefined): string {
  return standing === undefined
    ? NO_STANDING
    : `${standing.state}, ${standing.freshness}`;
}

/** An entry is listed at the cursor or now, never both. */
function entryChangeText({ atCursor, now }: EntryChange): string {
  const phrase = now === undefined ? ENTRY_WENT_AWAY : ENTRY_APPEARED;
  const entry = now ?? atCursor;
  return entry === undefined
    ? phrase
    : `${cut(entryText(entry), SUBJECT_CHARS)}: ${phrase}`;
}

/** The answer's own omitted counts, plus the listed changes past `NAMED_CHANGES`. */
function omittedByKind(answer: DeterminedAnswer): ChangeCounts {
  const counts = { ...answer.omittedChanges };
  for (const change of answer.changes.slice(NAMED_CHANGES)) {
    counts[change.kind] += 1;
  }
  return counts;
}

function omittedLines(omitted: ChangeCounts): string[] {
  const total = countOf(omitted);
  if (total === 0) return [];
  const kinds = CHANGE_KINDS.filter((kind) => omitted[kind] > 0).map(
    (kind) => `${kind} ${omitted[kind]}`,
  );
  return [`${INDENT}and ${total} more: ${kinds.join(LIST_SEPARATOR)}`];
}

function leftOutLines({ asked, leftOut }: AskedPaths): string[] {
  if (leftOut === 0) return [];
  return [
    `${ASKED_LEAD} ${asked} ${ASKED_TAIL}; ${counted(leftOut, EDITED_FILE_NOUNS)} ${LEFT_OUT}.`,
  ];
}

function countOf(counts: ChangeCounts): number {
  return CHANGE_KINDS.reduce((sum, kind) => sum + counts[kind], 0);
}

/** At most `limit` characters, marked when cut. */
function cut(text: string, limit: number): string {
  const characters = Array.from(text);
  return characters.length <= limit
    ? text
    : `${characters.slice(0, limit).join("")}${CUT_MARK}`;
}
