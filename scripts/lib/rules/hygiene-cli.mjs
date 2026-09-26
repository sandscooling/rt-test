import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadBlocks } from "./blocks.mjs";
import { DOC_NAMES, RuleError, docLabel, loadRuleDocs } from "./docs.mjs";
import { collectGuidance, collectRules, findViolations } from "./hygiene.mjs";
import { scaleSignals, scaleWarnings } from "./scale.mjs";

export const BASELINE_FILE = "scripts/rule-hygiene-baseline.json";

export const USAGE = `Usage: check-rule-hygiene.mjs [--all | --update-baseline]
  (no flag)           exit 1 on a violation missing from the baseline
  --all               list every violation, baselined ones included
  --update-baseline   accept the current set of violations`;

const KINDS = ["CITATION", "PROVENANCE"];

function parseArgs(argv) {
  const args = { all: false, update: false };
  for (const arg of argv) {
    if (arg === "--all") args.all = true;
    else if (arg === "--update-baseline") args.update = true;
    else throw new RuleError(`Unknown argument: ${arg}\n${USAGE}`);
  }
  return args;
}

function assertRulesRead(docs) {
  for (const name of DOC_NAMES) {
    if (loadBlocks(docs[name]).length === 0) {
      throw new RuleError(
        `no rules found in ${docLabel(docs[name])}, so the check examined nothing.`,
      );
    }
  }
}

function readBaseline(path) {
  if (!existsSync(path)) return [];
  const accepted = JSON.parse(readFileSync(path, "utf8")).accepted;
  if (!Array.isArray(accepted)) {
    throw new RuleError(`${path}: expected an "accepted" array.`);
  }
  return accepted;
}

function updateBaseline(path, all, io) {
  const previous = readBaseline(path);
  const now = [...new Set(all.map((found) => found.key))].sort();
  writeFileSync(path, `${JSON.stringify({ accepted: now }, null, 2)}\n`);
  io.out(
    `rule-hygiene: baseline written, ${now.length} accepted violation(s).`,
  );
  const cleared = previous.filter((key) => !now.includes(key)).length;
  if (cleared > 0) io.out(`  ${cleared} cleared since the last baseline.`);
  return 0;
}

function printViolations(shown, accepted, heading, io) {
  if (shown.length === 0) return;
  io.out(`\n=== ${heading}: ${shown.length} ===\n`);
  for (const kind of KINDS) {
    const group = shown.filter((found) => found.violation.kind === kind);
    if (group.length === 0) continue;
    io.out(`  ${kind} (${group.length}):`);
    for (const { entry, violation, key } of group) {
      const anchor = entry.guidance ? `"${entry.text.slice(0, 60)}"` : entry.id;
      const flag = accepted.has(key) ? " [baselined]" : "";
      io.out(
        `    ${entry.label}:${entry.line}  ${anchor}  ${violation.detail}${flag}`,
      );
    }
    io.out("");
  }
}

function printScale(docs, scale, io) {
  const signals = scaleSignals(docs);
  io.out(
    `scale: ${signals.rules} rules (${signals.checklistRules} checklist, ${signals.contextRules} project-context), ${signals.ruleDocChars} rule-doc chars, ${signals.shards} checklist shard(s).`,
  );
  for (const warning of scaleWarnings(signals, scale)) {
    io.out(`SCALE WARNING: ${warning}`);
  }
}

function check(args, all, entries, baselinePath, io) {
  const accepted = new Set(readBaseline(baselinePath));
  const fresh = all.filter((found) => !accepted.has(found.key));
  const heading = args.all ? "ALL VIOLATIONS" : "NEW RULE-HYGIENE VIOLATIONS";
  printViolations(args.all ? all : fresh, accepted, heading, io);
  const rules = entries.filter((entry) => !entry.guidance).length;
  io.out(
    `rule-hygiene: ${rules} rules + ${entries.length - rules} guidance lines, ${all.length} violation(s), ${accepted.size} baselined, ${fresh.length} new.`,
  );
  const fixed = [...accepted].filter(
    (key) => !all.some((found) => found.key === key),
  );
  if (fixed.length > 0) {
    io.out(
      `  ${fixed.length} baselined violation(s) are fixed. Run --update-baseline to shrink it.`,
    );
  }
  if (fresh.length === 0) return 0;
  io.out(
    "\nA rule states the rule and nothing about where it came from: git holds the history. Cut the date,\ncitation or origin note, and cite only rule ids that exist.",
  );
  return 1;
}

export function runRuleHygiene(argv, io) {
  try {
    const args = parseArgs(argv);
    const { config, docs } = loadRuleDocs(io.root);
    assertRulesRead(docs);
    const entries = [
      ...collectRules(docs, config.root),
      ...collectGuidance(config.root, config),
    ];
    const all = findViolations(entries);
    const baselinePath = join(config.root, BASELINE_FILE);
    if (args.update) return updateBaseline(baselinePath, all, io);
    const status = check(args, all, entries, baselinePath, io);
    printScale(docs, config.scale, io);
    return status;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    io.err(`check-rule-hygiene: ${error.message}`);
    return 1;
  }
}
