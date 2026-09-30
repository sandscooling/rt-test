import { parseArgs } from "node:util";
import {
  CHANGE_KIND,
  CHANGE_KINDS,
  CURSOR_USE,
  NOT_DETERMINED,
  queryChanges,
  type ChangeCounts,
  type ChangeStanding,
  type ChangesOptions,
  type ChangesResponse,
  type CursorUse,
  type EntryChange,
  type ListedChange,
  type NotDeterminedFacts,
  type TestChange,
} from "@rt-test/daemon/client";
import {
  contextLines,
  countLines,
  coverageLine,
  cutReasonText,
  DETAIL_SEPARATOR,
  entryText,
  fileLines,
  firstErrorText,
  INDENT,
  joinLines,
  LIST_SEPARATOR,
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

const NAME = "changes";
const OPTIONS = {
  ...JSON_OPTION,
  root: { type: "string" },
  since: { type: "string" },
} as const;
const CHANGES_HEADING = "Changes:";
const UNREAD_HEADING = "Unread files:";
const NO_CURSOR =
  "Cursor: none, since this daemon life has recorded no moment yet";
const NO_STANDING = "none";
const NOT_DETERMINED_LEAD = "not determined";
const BASELINE_LEAD = "a baseline";
const NO_CURSOR_GIVEN = "no cursor was given";
const CURSOR_HANDED_BACK = "the given cursor is handed back unchanged";
const NO_TEST_IN_SCOPE = "no test is in scope";
const CHANGE_NOUNS: Nouns = { one: "change", many: "changes" };
const NAMED_FILE_NOUNS: Nouns = { one: "named file", many: "named files" };
const ENTRY_APPEARED = "entry appeared";
const ENTRY_WENT_AWAY = "entry went away";
const UNUSABLE_CURSOR: Record<
  typeof CURSOR_USE.notIssued | typeof CURSOR_USE.expired,
  string
> = {
  [CURSOR_USE.notIssued]:
    "the given cursor was not issued in this daemon's life",
  [CURSOR_USE.expired]:
    "the given cursor is older than the changes the daemon keeps",
};
const NOT_DETERMINED_CAUSES: Record<
  typeof NOT_DETERMINED.inputsUnavailable | typeof NOT_DETERMINED.buildNotEnded,
  string
> = {
  [NOT_DETERMINED.inputsUnavailable]: "no input fingerprint can be computed",
  [NOT_DETERMINED.buildNotEnded]:
    "the dependency build at this input revision has not ended",
};

type DeterminedResponse = Extract<ChangesResponse, { determined: true }>;

interface Nouns {
  readonly one: string;
  readonly many: string;
}

export const changesCommand: Command = {
  name: NAME,
  usage: `rt-test ${NAME} <file>... [--since <cursor>] [--root <dir>] [--json]`,
  parse(args) {
    const { values, positionals } = parseArgs({
      args,
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    const fileArguments = requiredFiles(positionals);
    const rootArgument = nonEmptyPath(values.root, "--root");
    const options = changesOptions(values.since);
    return fileQueryRun({
      name: NAME,
      json: values.json === true,
      rootArgument,
      fileArguments,
      query: (root, files) => queryChanges(root, files, options),
      text: changesText,
    });
  },
};

/** A cursor is opaque to the CLI, so only an empty one is refused here. */
function changesOptions(since: string | undefined): ChangesOptions {
  if (since === undefined) return {};
  if (since === "") throw new UsageError("The --since cursor is empty.");
  return { since };
}

function changesText(answer: ChangesResponse): string {
  return joinLines([
    headline(answer),
    answer.cursor === null ? NO_CURSOR : `Cursor: ${oneLine(answer.cursor)}`,
    ...(answer.determined
      ? determinedLines(answer)
      : unreadLines(answer.notDetermined)),
    ...contextLines(answer),
  ]);
}

/** Whether the answer lists changes, is a baseline or is not determined, and why; it says nothing of whether the tests pass. */
function headline(answer: ChangesResponse): string {
  const lead = `RT Test changes in ${oneLine(answer.consumerRoot)} at input revision ${answer.revision}:`;
  if (!answer.determined) {
    return [
      `${lead} ${NOT_DETERMINED_LEAD}, since ${notDeterminedText(answer.notDetermined)}`,
      ...givenCursorText(answer.cursorUse),
    ].join(DETAIL_SEPARATOR);
  }
  if (answer.cursorUse === CURSOR_USE.used) {
    const total = answer.changes.length + omittedCount(answer.omittedChanges);
    return [
      `${lead} ${counted(total, CHANGE_NOUNS)} in scope since the given cursor`,
      ...(answer.counts.tests === 0 ? [NO_TEST_IN_SCOPE] : []),
    ].join(DETAIL_SEPARATOR);
  }
  const cause =
    answer.cursorUse === CURSOR_USE.noneGiven
      ? NO_CURSOR_GIVEN
      : UNUSABLE_CURSOR[answer.cursorUse];
  return `${lead} ${BASELINE_LEAD}, since ${cause}`;
}

function givenCursorText(use: CursorUse): string[] {
  switch (use) {
    case CURSOR_USE.used:
      return [CURSOR_HANDED_BACK];
    case CURSOR_USE.noneGiven:
      return [];
    default:
      return [UNUSABLE_CURSOR[use]];
  }
}

function notDeterminedText(facts: NotDeterminedFacts): string {
  if (facts.kind === NOT_DETERMINED.pathsUnread) {
    return `${counted(facts.unread.length, NAMED_FILE_NOUNS)} could not be read`;
  }
  return `${NOT_DETERMINED_CAUSES[facts.kind]}: ${cutReasonText(facts.reason)}`;
}

function unreadLines(facts: NotDeterminedFacts): string[] {
  if (facts.kind !== NOT_DETERMINED.pathsUnread) return [];
  return [
    UNREAD_HEADING,
    ...facts.unread.map(
      ({ path, reason }) =>
        `${INDENT}${oneLine(path)}: ${cutReasonText(reason)}`,
    ),
  ];
}

function determinedLines(answer: DeterminedResponse): string[] {
  const { changes, counts, outside } = answer;
  const changedOutside =
    outside.changed === null
      ? ""
      : `, ${outside.changed} changed since the given cursor`;
  return [
    ...(changes.length === 0
      ? []
      : [
          CHANGES_HEADING,
          ...changes.map((change) => `${INDENT}${changeText(change)}`),
        ]),
    ...omittedLines(answer.omittedChanges),
    coverageLine(answer.coverage),
    ...fileLines(answer.files, answer.coverage.state),
    `Tests in scope: ${counts.tests}`,
    ...indented(countLines(counts)),
    `Tests outside scope: ${outside.counts.tests}${changedOutside}`,
    ...indented(countLines(outside.counts)),
  ];
}

function changeText(change: ListedChange): string {
  const subject =
    "test" in change ? testChangeText(change) : entryChangeText(change);
  const error =
    change.kind === CHANGE_KIND.failing
      ? [`first error: ${firstErrorText(change.firstError)}`]
      : [];
  return [`${change.kind} ${subject}`, ...error].join(DETAIL_SEPARATOR);
}

function testChangeText(change: TestChange): string {
  return [
    `${testText(change.test, change.test.namePath)}: at the cursor: ${standingText(change.atCursor)}`,
    `now: ${standingText(change.now)}`,
  ].join(DETAIL_SEPARATOR);
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
  return entry === undefined ? phrase : `${phrase}: ${entryText(entry)}`;
}

function omittedLines(omitted: ChangeCounts): string[] {
  const total = omittedCount(omitted);
  if (total === 0) return [];
  const kinds = CHANGE_KINDS.filter((kind) => omitted[kind] > 0).map(
    (kind) => `${kind} ${omitted[kind]}`,
  );
  return [`${INDENT}and ${total} more: ${kinds.join(LIST_SEPARATOR)}`];
}

function omittedCount(omitted: ChangeCounts): number {
  return CHANGE_KINDS.reduce((sum, kind) => sum + omitted[kind], 0);
}

function counted(count: number, nouns: Nouns): string {
  return `${count} ${count === 1 ? nouns.one : nouns.many}`;
}

function indented(lines: readonly string[]): string[] {
  return lines.map((line) => `${INDENT}${line}`);
}
