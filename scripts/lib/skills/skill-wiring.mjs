import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { toPosix } from "../paths.mjs";
import { docSection } from "../standards/doc-section.mjs";
import { TEMPLATE_FILE, templateProblems } from "./ticket.mjs";
import { findReferences } from "./wiring-refs.mjs";

export const SKILLS_DIR = ".claude/skills";
export const AGENTS_DIR = ".claude/agents";
const DOC_SECTION = "doc-section.mjs";
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SKIPPED_PATH = /(?:^|\/)\.scratch\//;
const NON_PATH_KEYS = new Set(["root", "scale"]);

function markdownFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return markdownFiles(path);
      return name.endsWith(".md") ? [path] : [];
    });
}

function scannedFiles(config) {
  return [
    ...markdownFiles(resolve(config.root, SKILLS_DIR)),
    ...markdownFiles(resolve(config.root, AGENTS_DIR)),
    ...markdownFiles(config.rules_dir),
  ];
}

function sourceClosure(entry, seen = new Set()) {
  if (seen.has(entry) || !existsSync(entry)) return "";
  seen.add(entry);
  const text = readFileSync(entry, "utf8");
  const imported = [...text.matchAll(IMPORT)].map((match) =>
    sourceClosure(resolve(dirname(entry), match[1]), seen),
  );
  return [text, ...imported].join("\n");
}

function flagDefined(source, flag) {
  const escaped = flag.replace(/[-]/g, "\\-");
  return new RegExp(`${escaped}(?![a-z0-9-])`).test(source);
}

function resolveDocArg(config, arg) {
  const key = /^\{cfg\.([a-z_]+)\}$/.exec(arg)?.[1];
  if (key === undefined || NON_PATH_KEYS.has(key)) return arg;
  const path = config[key];
  return typeof path === "string" ? toPosix(relative(config.root, path)) : arg;
}

function callProblems(config, call, closures) {
  const path = resolve(config.root, "scripts", call.script);
  if (!existsSync(path)) return [];
  if (!closures.has(path)) closures.set(path, sourceClosure(path));
  const source = closures.get(path);
  const problems = call.flags
    .filter((flag) => !flagDefined(source, flag))
    .map((flag) => `scripts/${call.script} has no ${flag} flag`);
  if (call.script === DOC_SECTION && call.quoted.length > 0) {
    const doc = resolveDocArg(config, call.firstArg);
    const run = docSection(config, [doc, ...call.quoted]);
    if (run.code !== 0) problems.push(run.err.trim());
  }
  return problems;
}

function exists(root, path) {
  return existsSync(resolve(root, path));
}

// A path under a config key: an unknown key is the cfg check's report.
function missingUnderKey(config, value) {
  const [, key, rest] = /^\{cfg\.([a-z_]+)\}\/(.*)$/.exec(value);
  const base = config[key];
  if (NON_PATH_KEYS.has(key) || typeof base !== "string") return false;
  return !existsSync(resolve(base, rest));
}

function missing(refs, isBroken, describe) {
  return refs
    .filter(({ value }) => isBroken(value))
    .map(({ line, value }) => ({ line, problem: describe(value) }));
}

function referenceProblems(config, file, refs, closures) {
  const issues = [
    ...missing(
      refs.script,
      (value) => !exists(config.root, `scripts/${value}`),
      (value) => `scripts/${value} does not exist`,
    ),
    ...refs.calls.flatMap((call) =>
      callProblems(config, call, closures).map((problem) => ({
        line: call.line,
        problem,
      })),
    ),
    ...missing(
      [...refs.agentPath, ...refs.agentName],
      (value) => !exists(config.root, `${AGENTS_DIR}/${value}.md`),
      (value) => `no agent ${AGENTS_DIR}/${value}.md`,
    ),
    ...missing(
      refs.cfg,
      (value) => NON_PATH_KEYS.has(value) || typeof config[value] !== "string",
      (value) => `{cfg.${value}} is not a flow config path key`,
    ),
    ...missing(
      refs.cfgPath,
      (value) => missingUnderKey(config, value),
      (value) => `${value} does not exist`,
    ),
    ...missing(
      refs.scale,
      (value) => !(value in config.scale),
      (value) => `scale.${value} is not a flow config switch`,
    ),
    ...missing(
      refs.docPath,
      (value) => !SKIPPED_PATH.test(value) && !exists(config.root, value),
      (value) => `${value} does not exist`,
    ),
  ];
  return issues.map(({ line, problem }) => `${file}:${line}: ${problem}`);
}

function linkProblems(config, path, file, refs) {
  return refs.link
    .filter(({ value }) => !existsSync(resolve(dirname(path), value)))
    .map(
      ({ line, value }) => `${file}:${line}: link ${value} does not resolve`,
    );
}

function templateContract(config) {
  const path = resolve(config.root, TEMPLATE_FILE);
  if (!existsSync(path)) return [];
  return templateProblems(readFileSync(path, "utf8")).map(
    (problem) => `${TEMPLATE_FILE}: ${problem}`,
  );
}

const text = (lines) => (lines.length === 0 ? "" : `${lines.join("\n")}\n`);

export function skillWiring(config, argv) {
  if (argv.length > 0)
    return { code: 1, out: "", err: "Usage: check-skill-wiring.mjs\n" };
  const closures = new Map();
  const files = scannedFiles(config);
  const problems = files.flatMap((path) => {
    const file = toPosix(relative(config.root, path));
    const refs = findReferences(readFileSync(path, "utf8"));
    return [
      ...referenceProblems(config, file, refs, closures),
      ...linkProblems(config, path, file, refs),
    ];
  });
  problems.push(...templateContract(config));
  if (problems.length > 0) return { code: 1, out: "", err: text(problems) };
  return {
    code: 0,
    out: text([
      `skill wiring: ${files.length} file(s) checked, every reference resolves.`,
    ]),
    err: "",
  };
}
