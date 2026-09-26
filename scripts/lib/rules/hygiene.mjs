import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { loadBlocks } from "./blocks.mjs";
import { DOC_NAMES, sources } from "./docs.mjs";

// Harness-defined homes of agent guidance; the workflow's own docs come from the flow config.
const HARNESS_GUIDANCE_FILES = ["AGENTS.md"];
const HARNESS_GUIDANCE_DIRS = [".claude/skills"];
const CONFIG_GUIDANCE_KEYS = [
  "rule_maintenance_guide",
  "code_change_standards",
  "adversarial_review_prompt",
];

const SHARED_PROVENANCE = [
  [/\b20\d{2}-\d{2}-\d{2}\b/, "a date"],
  [/\b(?:Ticket|Sprint)\s+#?\d/, "a ticket or sprint citation"],
  [
    /\((?:from|source:)\s[^)]*\b(?:ticket|sprint|review|audit|retrospective|session|commit|lint-harden)\b/i,
    "an origin note",
  ],
];
const RULE_PROVENANCE = [
  [/\bADR-\d{3,4}\b/, "an ADR citation"],
  [/\b(?:ported|adapted|copied|carried over|taken) from\b/i, "an origin note"],
  [/(?:^|[\s(])#\d+(?:\.\d+)*[a-z]?\b/, "a foreign rule id"],
];
const CITATION = /\b([CP]\d+)\b/g;

const posix = (path) => path.split(sep).join("/");

export function collectRules(docs, root) {
  return DOC_NAMES.flatMap((name) => {
    const spec = docs[name];
    const base = spec.file ?? spec.dir;
    return loadBlocks(spec).map((block) => ({
      id: block.anchor,
      label: posix(relative(root, spec.file ? base : join(base, block.file))),
      line: block.line,
      text: block.lines.join("\n"),
      guidance: false,
    }));
  });
}

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

function guidancePaths(root, config) {
  const files = [
    ...HARNESS_GUIDANCE_FILES.map((file) => join(root, file)),
    ...CONFIG_GUIDANCE_KEYS.map((key) => config[key]),
  ].filter((path) => existsSync(path));
  return [
    ...files,
    ...HARNESS_GUIDANCE_DIRS.flatMap((dir) => walkMarkdown(join(root, dir))),
    ...walkMarkdown(config.rules_dir),
  ];
}

// Guidance prose has no ids, so a line is keyed by its own text: the key survives a move and changes with the sentence.
export function lineId(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0;
  }
  return `L${(hash >>> 0).toString(36)}`;
}

export function collectGuidance(root, config) {
  return guidancePaths(root, config).flatMap((path) => {
    let fenced = false;
    const label = posix(relative(root, path));
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .flatMap((line, index) => {
        if (/^\s*```/.test(line)) fenced = !fenced;
        const text = line.trim();
        if (fenced || text === "" || text.startsWith("```")) return [];
        return [
          { id: lineId(text), label, line: index + 1, text, guidance: true },
        ];
      });
  });
}

function provenance(entry) {
  const patterns = entry.guidance
    ? SHARED_PROVENANCE
    : [...SHARED_PROVENANCE, ...RULE_PROVENANCE];
  for (const [pattern, what] of patterns) {
    const hit = pattern.exec(entry.text);
    if (hit)
      return [
        {
          kind: "PROVENANCE",
          detail: `${what}: ${JSON.stringify(hit[0].trim())}`,
        },
      ];
  }
  return [];
}

function citations(entry, ids) {
  if (entry.guidance) return [];
  const cited = new Set(
    [...entry.text.matchAll(CITATION)].map((match) => match[1]),
  );
  return [...cited]
    .filter((id) => id !== entry.id && !ids.has(id))
    .map((id) => ({
      kind: "CITATION",
      detail: `cites ${id}, which does not resolve`,
    }));
}

// Ids are unique across every rule doc; a Set of ids would silently collapse a second definition.
export function duplicateRules(entries) {
  const claims = new Map();
  for (const entry of entries.filter((e) => !e.guidance)) {
    claims.set(entry.id, [...(claims.get(entry.id) ?? []), entry]);
  }
  return [...claims.entries()]
    .filter(([, claimed]) => claimed.length > 1)
    .map(
      ([id, claimed]) =>
        `${id} is defined at ${claimed.map((e) => `${e.label}:${e.line}`).join(" and ")}`,
    );
}

export function findViolations(entries) {
  const ids = new Set(entries.filter((e) => !e.guidance).map((e) => e.id));
  return entries.flatMap((entry) =>
    [...citations(entry, ids), ...provenance(entry)].map((violation) => ({
      entry,
      violation,
      key: `${entry.label}::${entry.id}::${violation.kind}`,
    })),
  );
}

export function ruleDocChars(spec) {
  return sources(spec).reduce(
    (total, source) => total + readFileSync(source.path, "utf8").length,
    0,
  );
}
