import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TEMPLATE_FILE,
  applyFills,
  applyIds,
  checkTicket,
  parseSectionsFile,
  scaffold,
} from "./ticket.mjs";

export const USAGE = `Usage: fill-ticket.mjs <mode>
  --scaffold <ticket.md>                                 print the block set --fill accepts
  --fill <ticket.md> <sections-file>                     replace section bodies, all or nothing
  --ids <ticket.md> checklist=<ids> project-context=<ids>   set the rule-id markers
  --check <ticket.md>                                    fail on placeholders, PENDING or empty markers, a bad title, a Status line, lost structure`;

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROG = "fill-ticket";

class UsageError extends Error {}

function readFile(root, path, what) {
  const full = resolve(root, path);
  if (!existsSync(full)) throw new UsageError(`${what} not found: ${path}`);
  return readFileSync(full, "utf8");
}

function write(root, path, result, io, describe) {
  if (result.errors) {
    io.err(`${PROG}: NOTHING WAS WRITTEN. ${result.errors.length} problem(s):`);
    for (const error of result.errors) io.err(`  - ${error}`);
    return 1;
  }
  writeFileSync(resolve(root, path), result.text, "utf8");
  io.out(describe(result));
  return 0;
}

function runScaffold(root, [ticket], io) {
  if (ticket === undefined) throw new UsageError(USAGE);
  const { sections, skipped } = scaffold(readFile(root, ticket, "ticket"));
  io.err(
    `${PROG}: author against the blocks below. The title is an Edit, not a fill.`,
  );
  for (const reason of skipped) io.err(`  skipped: ${reason}`);
  io.out(sections.trimEnd());
  return 0;
}

function runFill(root, [ticket, sectionsFile], io) {
  if (ticket === undefined || sectionsFile === undefined)
    throw new UsageError(USAGE);
  const parsed = parseSectionsFile(
    readFile(root, sectionsFile, "sections file"),
  );
  const result = parsed.errors
    ? parsed
    : applyFills(readFile(root, ticket, "ticket"), parsed.blocks);
  return write(
    root,
    ticket,
    result,
    io,
    (done) =>
      `filled ${done.applied.length} section(s): ${done.applied
        .map(
          (entry) =>
            `${entry.name} (${entry.lines} lines${entry.keptComment ? ", comment kept" : ""})`,
        )
        .join("; ")}`,
  );
}

function runIds(root, [ticket, ...pairs], io) {
  if (ticket === undefined || pairs.length === 0) throw new UsageError(USAGE);
  const assignments = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at < 1)
      throw new UsageError(`bad assignment ${pair}; expected doc=ids`);
    assignments[pair.slice(0, at)] = pair.slice(at + 1);
  }
  const result = applyIds(readFile(root, ticket, "ticket"), assignments);
  return write(
    root,
    ticket,
    result,
    io,
    (done) => `set ${done.applied.join("; ")}`,
  );
}

function runCheck(root, [ticket], io) {
  if (ticket === undefined) throw new UsageError(USAGE);
  const problems = checkTicket(
    readFile(root, ticket, "ticket"),
    readFile(root, TEMPLATE_FILE, "ticket template"),
  );
  if (problems.length === 0) {
    io.out(
      "ticket complete: no placeholders, PENDING markers, or lost structure",
    );
    return 0;
  }
  io.err(`${PROG}: ${problems.length} problem(s):`);
  for (const problem of problems) io.err(`  - ${problem}`);
  return 1;
}

const MODES = new Map([
  ["--scaffold", runScaffold],
  ["--fill", runFill],
  ["--ids", runIds],
  ["--check", runCheck],
]);

export function runFillTicket(argv, io) {
  const root = io.root ?? REPO_ROOT;
  try {
    const mode = MODES.get(argv[0]);
    if (mode === undefined) throw new UsageError(USAGE);
    return mode(root, argv.slice(1), io);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.err(`${PROG}: ${error.message}`);
    return 1;
  }
}
