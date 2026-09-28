import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { toPosix } from "../paths.mjs";

/** Names the file the exit witness appends to; set only on the Vitest main process the runner spawns. */
export const EXIT_RECORD_ENV = "RT_TEST_EXIT_RECORD";

export const EXIT_ENTRY = Object.freeze({
  STARTED: "started",
  UNCAUGHT: "uncaught",
  REJECTION: "rejection",
  EXIT_CALLED: "exit-called",
  EXITED: "exited",
});

/** How many unhandled errors and pending tests a verdict names before it only counts the rest. */
export const QUOTED_ITEMS = 10;
const STACK_HEAD_LINES = 4;
const MAX_CAUSES = 3;
const ERROR_TEXT_CHARS = 1500;
export const CUT_MARKER = "...";
export const NOT_FOUND = "ENOENT";
const PENDING = "pending";
const NO_EXIT =
  "recorded no exit, so it was killed, crashed below JavaScript, or could not write its record";

const cut = (text, chars) =>
  text.length <= chars
    ? text
    : `${text.slice(0, chars - CUT_MARKER.length)}${CUT_MARKER}`;

function ownText(error) {
  if (error === null || typeof error !== "object") return String(error);
  const text = String(error.stack || error.message || error);
  const head = text.split(/\r?\n/).slice(0, STACK_HEAD_LINES).join("\n");
  return typeof error.type === "string" ? `${error.type}: ${head}` : head;
}

/** An error's type, message and first stack frames, then those of each cause, bounded; never throws. */
export function errorText(error) {
  try {
    const parts = [ownText(error)];
    let cause = error?.cause;
    for (let depth = 0; cause != null && depth < MAX_CAUSES; depth += 1) {
      parts.push(`caused by: ${ownText(cause)}`);
      cause = cause.cause;
    }
    return cut(parts.join("\n"), ERROR_TEXT_CHARS);
  } catch (failure) {
    return `an error that could not be described (${String(failure)})`;
  }
}

const numbered = (items) =>
  items.map((item, index) => `(${index + 1}) ${item}`).join(" ");

function quotedList(items, total) {
  const shown = numbered(items.slice(0, QUOTED_ITEMS));
  return total > QUOTED_ITEMS
    ? `${shown} and ${total - QUOTED_ITEMS} more`
    : shown;
}

/** What Vitest said when it ended the run, or that it never said. */
export function runEndText(runEnd) {
  if (runEnd === null) {
    return "Vitest reported no run end";
  }
  const { reason, errors, errorCount } = runEnd;
  const lead = `Vitest ended the run with reason "${reason}"`;
  if (errorCount === 0) return `${lead} and no unhandled error`;
  return `${lead} and ${errorCount} unhandled error(s): ${quotedList(errors, errorCount)}`;
}

/** The exit witness's entries, one JSON line each; a line cut short by a kill is counted, not parsed. */
export function readExitRecord(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const problem =
      error.code === NOT_FOUND
        ? "left no exit record, so it ended before its exit witness loaded or the witness could not write"
        : `left an exit record that could not be read: ${error.message}`;
    return { entries: [], unreadable: 0, problem };
  }
  const entries = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      unreadable += 1;
    }
  }
  return { entries, unreadable, problem: null };
}

const entryText = {
  [EXIT_ENTRY.UNCAUGHT]: (entry) =>
    `an uncaught exception (${entry.origin}): ${entry.error}`,
  [EXIT_ENTRY.REJECTION]: (entry) => `an unhandled rejection: ${entry.error}`,
  [EXIT_ENTRY.EXIT_CALLED]: (entry) =>
    `a process.exit(${entry.code ?? ""}) call from ${entry.caller}`,
};

const exitOf = (record) =>
  record.entries.find((entry) => entry.kind === EXIT_ENTRY.EXITED);

const UNHANDLED_ENTRIES = new Set([EXIT_ENTRY.UNCAUGHT, EXIT_ENTRY.REJECTION]);

const recordedErrorCount = (record) =>
  record.entries.filter((entry) => UNHANDLED_ENTRIES.has(entry.kind)).length;

/** What the Vitest main process recorded about how it ended. */
export function exitRecordText(record) {
  const lead = "the Vitest process";
  if (record.problem !== null) return `${lead} ${record.problem}`;
  const events = record.entries
    .map((entry) => entryText[entry.kind]?.(entry))
    .filter((text) => text !== undefined);
  const parts = [];
  if (events.length > 0) {
    parts.push(`recorded ${quotedList(events, events.length)}`);
  }
  const exit = exitOf(record);
  parts.push(exit ? `exited with code ${exit.code}` : NO_EXIT);
  if (record.unreadable > 0) {
    parts.push(`left ${record.unreadable} unreadable record line(s)`);
  }
  return `${lead} ${parts.join(", then ")}`;
}

/**
 * Why a run did not end cleanly, whatever its report says: Vitest never reported its end, reported unhandled
 * errors, or its process recorded an unhandled error of its own, a process.exit call, or no exit, which a kill
 * leaves. Null for a clean end.
 */
export function uncleanEndProblem(run) {
  if (run.runEnd === null) return "Vitest reported no run end";
  if (run.runEnd.errorCount > 0) {
    return `Vitest reported ${run.runEnd.errorCount} unhandled error(s)`;
  }
  const recorded = recordedErrorCount(run.exitRecord);
  if (recorded > 0) {
    return `the Vitest process recorded ${recorded} unhandled error(s)`;
  }
  if (
    run.exitRecord.entries.some(
      (entry) => entry.kind === EXIT_ENTRY.EXIT_CALLED,
    )
  ) {
    return "the Vitest process was ended by a process.exit call, as a close timeout, a signal or a startup error ends it";
  }
  if (exitOf(run.exitRecord) === undefined) {
    return "the Vitest process recorded no exit";
  }
  return null;
}

/** The report's file-level errors and the tests it left pending, which a worker's death leaves behind. */
export function reportEvidence(report, sandbox) {
  const evidence = [];
  const fileErrors = report.testResults
    .filter((file) => file.message)
    .map((file) => `${toPosix(relative(sandbox, file.name))}: ${file.message}`);
  if (fileErrors.length > 0) {
    evidence.push(`file errors: ${fileErrors.join("; ")}`);
  }
  const pending = report.testResults.flatMap((file) =>
    file.assertionResults
      .filter((test) => test.status === PENDING)
      .map((test) => test.title),
  );
  if (pending.length > 0) {
    evidence.push(`tests left pending: ${quotedList(pending, pending.length)}`);
  }
  return evidence;
}
