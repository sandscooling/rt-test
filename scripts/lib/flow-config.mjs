import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FLOW_CONFIG_FILE = "_agent-docs/_flow-config.yaml";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PATH_KEYS = [
  "ticket_dir",
  "sprints_dir",
  "sprint_status",
  "requirements",
  "adr_dir",
  "glossary",
  "design_decisions_dir",
  "checklist_dir",
  "project_context",
  "rule_maintenance_guide",
  "code_change_standards",
  "adversarial_review_prompt",
];
const SWITCH = new Map([
  ["off", false],
  ["on", true],
]);
const SCALE_CHOICES = new Map([
  [
    "rule_selection",
    new Map([
      ["whole", "whole"],
      ["menu", "menu"],
    ]),
  ],
  [
    "checklist_fanout",
    new Map([
      ["1", 1],
      ["4", 4],
    ]),
  ],
  ["sprint_context", SWITCH],
  ["ctx_agents", SWITCH],
  ["doc_sections", SWITCH],
  ["prototype_ui", SWITCH],
]);
const KNOWN_KEYS = new Set([...PATH_KEYS, "scale"]);
const ENTRY = /^( *)([a-z][a-z0-9_]*):(.*)$/;
const DOUBLE_QUOTED = /^"([^"\\]*)"\s*(?:#.*)?$/;
const SINGLE_QUOTED = /^'([^']*)'\s*(?:#.*)?$/;
// Characters that open a YAML construct this subset does not implement.
const INDICATOR = /^[-?:,[\]{}&*!|>'"%@`]|: |:$/;
const YAML_NULL = /^(?:~|null|Null|NULL)$/;

export function loadFlowConfig(root = REPO_ROOT) {
  const base = resolve(root);
  const file = resolve(base, FLOW_CONFIG_FILE);
  const entries = parseEntries(readConfigText(file), file);
  const unknown = [...entries.keys()].filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(`${file}: unknown key(s) ${unknown.join(", ")}.`);
  }
  const config = { root: base };
  for (const key of PATH_KEYS) {
    config[key] = resolvePath(base, key, entries.get(key), file);
  }
  config.scale = readScale(entries.get("scale"), file);
  return Object.freeze(config);
}

function readConfigText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Cannot read flow config ${file}: ${error.message}`, {
      cause: error,
    });
  }
}

function parseEntries(text, file) {
  const top = new Map();
  let block;
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(?:#.*)?$/.test(line)) return;
    const where = `${file}:${index + 1}`;
    const match = ENTRY.exec(line);
    if (!match) throw new Error(`${where}: unsupported syntax: ${line}`);
    const [, indent, key, rest] = match;
    const value = parseScalar(rest, where);
    if (indent === "") {
      block =
        value === undefined ? { indent: undefined, map: new Map() } : undefined;
      addEntry(top, key, block ? block.map : value, where);
      return;
    }
    if (!block) throw new Error(`${where}: indented key outside a map.`);
    block.indent ??= indent;
    if (indent !== block.indent || value === undefined) {
      throw new Error(`${where}: only one level of nesting is supported.`);
    }
    addEntry(block.map, key, value, where);
  });
  return top;
}

function addEntry(map, key, value, where) {
  if (map.has(key)) throw new Error(`${where}: duplicate key ${key}.`);
  map.set(key, value);
}

function parseScalar(rest, where) {
  if (rest !== "" && !/^\s/.test(rest)) {
    throw new Error(`${where}: expected a space after the colon.`);
  }
  const text = rest.trim();
  const quoted = DOUBLE_QUOTED.exec(text) ?? SINGLE_QUOTED.exec(text);
  if (quoted) return quoted[1];
  const value = text.replace(/(?:^|\s+)#.*$/, "");
  if (value === "") return undefined;
  if (YAML_NULL.test(value) || INDICATOR.test(value)) {
    throw new Error(`${where}: unsupported value syntax: ${value}`);
  }
  return value;
}

function resolvePath(base, key, value, file) {
  if (value === undefined) {
    throw new Error(`${file}: missing required key ${key}.`);
  }
  if (typeof value !== "string" || value === "") {
    throw new Error(`${file}: ${key} must be a non-empty path.`);
  }
  const path = resolve(base, value);
  const inside = relative(base, path);
  const escapes = inside === ".." || inside.startsWith(`..${sep}`);
  if (isAbsolute(value) || escapes || isAbsolute(inside)) {
    throw new Error(`${file}: ${key} must stay inside the repository.`);
  }
  return path;
}

function readScale(scale, file) {
  if (!(scale instanceof Map)) {
    throw new Error(`${file}: scale must be a map of switches.`);
  }
  for (const key of scale.keys()) {
    if (!SCALE_CHOICES.has(key)) {
      throw new Error(`${file}: unknown scale key ${key}.`);
    }
  }
  const result = {};
  for (const [key, choices] of SCALE_CHOICES) {
    const value = scale.get(key);
    if (value === undefined) {
      throw new Error(`${file}: missing required key scale.${key}.`);
    }
    if (!choices.has(value)) {
      const allowed = [...choices.keys()].join(" | ");
      throw new Error(
        `${file}: scale.${key} must be ${allowed}, not ${value}.`,
      );
    }
    result[key] = choices.get(value);
  }
  return Object.freeze(result);
}
