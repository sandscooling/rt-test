import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { toPosix } from "../paths.mjs";
import { analyzeRequirements } from "../planning/requirements.mjs";
import { readStatus } from "../planning/status.mjs";
import { loadBlocks } from "../rules/blocks.mjs";
import { loadRuleDocs } from "../rules/docs.mjs";

export const USAGE = `Usage: check-sprint-context.mjs [--quiet]
  check-sprint-context.mjs --restamp <sprint number>`;

// A shortlist below THIN_IDS saves no scan; one above WIDE_SHARE of the
// checklist barely filters.
export const THIN_IDS = 15;
export const WIDE_SHARE = 0.3;
const SHA_LENGTH = 12;

const LIST_KEYS = ["checklist", "doc_ids", "requirements", "test_infra"];
const SCALAR_KEYS = [
  "sprint",
  "checklist_rule_count",
  "checklist_ids_sha",
  "partial",
];
const BUNDLE_NAME = /^sprint-([1-9]\d*)\.yaml$/;
const ENTRY = /^([a-z_]+):\s*(.*?)\s*$/;
const INLINE_LIST = /^\[(.*)\]$/;
const REQUIREMENT = /^N?FR[1-9]\d*$/;
const ADR = /^ADR-(\d{4})$/;

export function checklistStamp(ids) {
  const sorted = [...ids].sort();
  return {
    count: sorted.length,
    sha: createHash("sha256")
      .update(sorted.join(","))
      .digest("hex")
      .slice(0, SHA_LENGTH),
  };
}

export function parseBundle(text) {
  const bundle = { lists: {}, scalars: {}, problems: [] };
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(?:#.*)?$/.test(line)) return;
    const entry = ENTRY.exec(line);
    if (!entry) {
      bundle.problems.push(`line ${index + 1}: expected "key: value"`);
      return;
    }
    readEntry(bundle, entry[1], entry[2], index + 1);
  });
  return bundle;
}

function readEntry(bundle, key, value, line) {
  if (LIST_KEYS.includes(key)) {
    const list = INLINE_LIST.exec(value);
    if (!list) {
      bundle.problems.push(
        `line ${line}: ${key} must be an inline [a, b] list`,
      );
      return;
    }
    bundle.lists[key] = list[1]
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  } else if (SCALAR_KEYS.includes(key)) {
    bundle.scalars[key] = value;
  } else {
    bundle.problems.push(`line ${line}: unknown key ${key}`);
  }
}

function liveUniverse(config) {
  const { docs } = loadRuleDocs(config.root);
  const adrIds = existsSync(config.adr_dir)
    ? readdirSync(config.adr_dir)
        .map((name) => /^(\d{4})-/.exec(name)?.[1])
        .filter((id) => id !== undefined)
        .map((id) => `ADR-${id}`)
    : [];
  return {
    checklist: new Set(loadBlocks(docs.checklist).map((block) => block.anchor)),
    requirements: new Set(
      analyzeRequirements(config).requirements.map((entry) => entry.id),
    ),
    adrs: new Set(adrIds),
    sprints: readStatus(config).sprints,
  };
}

function docProblem(config, universe, id) {
  if (REQUIREMENT.test(id))
    return universe.requirements.has(id) ? undefined : "no such requirement";
  if (ADR.test(id)) return universe.adrs.has(id) ? undefined : "no such ADR";
  if (id.includes("/"))
    return existsSync(resolve(config.root, id))
      ? undefined
      : "path does not resolve";
  return "unrecognized form; use a requirement id, ADR-NNNN, or a repo path";
}

function anchorProblem(config, anchor) {
  const [path, symbol] = anchor.split("#");
  const full = resolve(config.root, path);
  if (!existsSync(full)) return "path does not resolve";
  if (symbol === undefined || readFileSync(full, "utf8").includes(symbol))
    return undefined;
  return `no ${symbol} in that file`;
}

function missingKeys(bundle) {
  const missing = [];
  if (bundle.scalars.sprint === undefined) missing.push("sprint");
  if (
    bundle.scalars.checklist_rule_count === undefined ||
    bundle.scalars.checklist_ids_sha === undefined
  )
    missing.push("stamp (checklist_rule_count and checklist_ids_sha)");
  if ((bundle.lists.checklist ?? []).length === 0) missing.push("checklist");
  return missing;
}

function fatalProblems(config, universe, name, bundle) {
  const sprint = BUNDLE_NAME.exec(name)[1];
  const problems = bundle.problems.map(
    (problem) => `MALFORMED ${name} ${problem}`,
  );
  const missing = missingKeys(bundle);
  if (missing.length > 0)
    problems.push(`MALFORMED ${name} missing: ${missing.join(", ")}`);
  if (bundle.scalars.sprint !== undefined && bundle.scalars.sprint !== sprint)
    problems.push(`MALFORMED ${name} says sprint ${bundle.scalars.sprint}`);
  if (!universe.sprints.has(sprint))
    problems.push(`ORPHAN ${name} sprint-${sprint} has no status key`);
  for (const id of bundle.lists.checklist ?? []) {
    if (!universe.checklist.has(id)) problems.push(`UNKNOWN-ID ${name} ${id}`);
  }
  for (const id of [
    ...(bundle.lists.doc_ids ?? []),
    ...(bundle.lists.requirements ?? []),
  ]) {
    const problem = docProblem(config, universe, id);
    if (problem !== undefined)
      problems.push(`DEAD-DOC ${name} ${id}: ${problem}`);
  }
  for (const anchor of bundle.lists.test_infra ?? []) {
    const problem = anchorProblem(config, anchor);
    if (problem !== undefined)
      problems.push(`DEAD-ANCHOR ${name} ${anchor}: ${problem}`);
  }
  return problems;
}

function warnings(universe, stamp, name, bundle) {
  const found = [];
  const { checklist_rule_count: count, checklist_ids_sha: sha } =
    bundle.scalars;
  if (
    count !== undefined &&
    (Number(count) !== stamp.count || sha !== stamp.sha)
  )
    found.push(
      `STALE ${name}: built against ${count} checklist rules, ${stamp.count} now; tickets fall back to a full read until it is appended to and restamped`,
    );
  const size = (bundle.lists.checklist ?? []).length;
  if (bundle.scalars.partial === "true" || size < THIN_IDS)
    found.push(
      `THIN ${name}: ${size} candidate ids${bundle.scalars.partial === "true" ? " (partial)" : ""}`,
    );
  if (
    universe.checklist.size > 0 &&
    size / universe.checklist.size > WIDE_SHARE
  )
    found.push(
      `WIDE ${name}: ${size} of ${universe.checklist.size} checklist rules`,
    );
  return found;
}

function restamp(dir, sprint, stamp) {
  const path = join(dir, `sprint-${sprint}.yaml`);
  if (!existsSync(path)) return { error: `no bundle for sprint ${sprint}` };
  const before = readFileSync(path, "utf8");
  const after = before
    .replace(
      /^checklist_rule_count:.*$/m,
      `checklist_rule_count: ${stamp.count}`,
    )
    .replace(/^checklist_ids_sha:.*$/m, `checklist_ids_sha: ${stamp.sha}`);
  if (
    !/^checklist_rule_count:/m.test(before) ||
    !/^checklist_ids_sha:/m.test(before)
  )
    return { error: `sprint-${sprint}.yaml lacks the two stamp keys to fill` };
  writeFileSync(path, after);
  return {
    note: `restamped sprint-${sprint}.yaml: ${stamp.count} rules, sha ${stamp.sha}`,
  };
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--quiet") return { quiet: true };
  if (argv.length === 0) return { quiet: false };
  if (
    argv.length === 2 &&
    argv[0] === "--restamp" &&
    /^[1-9]\d*$/.test(argv[1])
  )
    return { quiet: false, restamp: argv[1] };
  return undefined;
}

const text = (lines) => (lines.length === 0 ? "" : `${lines.join("\n")}\n`);
const done = (code, out, err) => ({ code, out: text(out), err: text(err) });

export function sprintContext(config, argv) {
  const args = parseArgs(argv);
  if (args === undefined) return done(1, [], [USAGE]);
  const dir = config.sprint_context_dir;
  const shown = toPosix(relative(config.root, dir));
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => BUNDLE_NAME.test(name))
        .sort()
    : [];
  if (args.restamp === undefined && files.length === 0)
    return done(
      0,
      args.quiet ? [] : [`No sprint-context bundles in ${shown}.`],
      [],
    );
  const universe = liveUniverse(config);
  const stamp = checklistStamp(universe.checklist);
  const out = [];
  if (args.restamp !== undefined) {
    const result = restamp(dir, args.restamp, stamp);
    if (result.error)
      return done(1, [], [`check-sprint-context: ${result.error}`]);
    out.push(result.note);
  }
  const fatal = [];
  const warned = [];
  for (const name of files) {
    const bundle = parseBundle(readFileSync(join(dir, name), "utf8"));
    fatal.push(...fatalProblems(config, universe, name, bundle));
    warned.push(...warnings(universe, stamp, name, bundle));
  }
  if (!args.quiet) out.push(...warned.map((line) => `warning: ${line}`));
  if (fatal.length > 0) return done(1, out, fatal);
  if (!args.quiet)
    out.push(
      `${files.length} bundle(s) in ${shown}: every id, pointer and anchor resolves.`,
    );
  return done(0, out, []);
}
