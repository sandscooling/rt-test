import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { toPosix } from "../paths.mjs";

// A gate runs when this session named a dirty path under one of its `watches`: a flow-config key,
// or a literal repo path, where a trailing slash marks a folder.
// Only gates that are binary and green on a clean tree belong here.
export const GATES = Object.freeze([
  {
    script: "scripts/check-sprint-keys.mjs",
    watches: ["sprints_dir", "sprint_status"],
  },
  {
    script: "scripts/check-requirement-markers.mjs",
    watches: ["requirements", "sprints_dir", "ticket_dir"],
  },
  { script: "scripts/adr-index.mjs", watches: ["adr_dir"] },
  {
    script: "scripts/check-rule-hygiene.mjs",
    watches: [
      "checklist_dir",
      "project_context",
      "rule_maintenance_guide",
      "rules_dir",
      "code_change_standards",
      "adversarial_review_prompt",
      "AGENTS.md",
      ".claude/skills/",
    ],
  },
]);

const NAMING_FIELDS = ["file_path", "notebook_path", "path", "command"];
const WRITING_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Bash",
  "PowerShell",
]);
export const GIT_TIMEOUT_MS = 10_000;
// Every gate plus git stays inside the Stop hook's 150 s timeout in .claude/settings.json.
export const GATE_TIMEOUT_MS = 30_000;
const CONFIG_KEY = /^[a-z_]+$/;
const GIT_FAILED =
  "doc-integrity hook skipped: git status failed, so no documentation gate ran.\n";

const normalize = (s) => toPosix(s).toLowerCase();

function watchedPath(config, key) {
  if (!CONFIG_KEY.test(key)) {
    return { key, path: key.replace(/\/$/, ""), dir: key.endsWith("/") };
  }
  if (typeof config[key] !== "string") {
    throw new Error(`doc-integrity: unknown flow-config key ${key}`);
  }
  const rel = toPosix(relative(config.root, config[key]));
  return { key, path: rel, dir: key.endsWith("_dir") };
}

export function watchedPaths(config, gates = GATES) {
  const keys = new Set(gates.flatMap((gate) => gate.watches));
  return [...keys].map((key) => watchedPath(config, key));
}

function isUnder(path, watched) {
  const p = normalize(path);
  const w = normalize(watched.path);
  return watched.dir ? p.startsWith(`${w}/`) : p === w;
}

export function selectGates(config, paths, gates = GATES) {
  const watched = new Map(watchedPaths(config, gates).map((w) => [w.key, w]));
  return gates.filter((gate) =>
    gate.watches.some((key) => paths.some((p) => isUnder(p, watched.get(key)))),
  );
}

export function parsePorcelain(text) {
  return text
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));
}

export function namedByToolCalls(transcriptTexts) {
  const named = [];
  let sawToolUse = false;
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      node.type === "tool_use" &&
      node.input &&
      typeof node.input === "object"
    ) {
      sawToolUse = true;
      if (!WRITING_TOOLS.has(node.name)) return;
      for (const field of NAMING_FIELDS) {
        if (typeof node.input[field] === "string") {
          named.push(normalize(node.input[field]));
        }
      }
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  for (const text of transcriptTexts) {
    for (const line of text.split("\n")) {
      if (!line.includes('"tool_use"')) continue;
      try {
        visit(JSON.parse(line));
      } catch {
        // A live session's last line is often partly written.
        continue;
      }
    }
  }
  return sawToolUse ? named : null;
}

export function scopeToSession(paths, named) {
  if (named === null) return paths;
  return paths.filter((p) => {
    const rel = normalize(p);
    return named.some((s) => s.includes(rel));
  });
}

export function readTranscripts(transcriptPath) {
  if (typeof transcriptPath !== "string" || !existsSync(transcriptPath)) {
    return [];
  }
  const texts = [readFileSync(transcriptPath, "utf8")];
  const subagents = join(transcriptPath.replace(/\.jsonl$/, ""), "subagents");
  if (existsSync(subagents)) {
    for (const name of readdirSync(subagents)) {
      if (name.endsWith(".jsonl")) {
        texts.push(readFileSync(join(subagents, name), "utf8"));
      }
    }
  }
  return texts;
}

function dirtyPaths(root, watched) {
  const out = execFileSync(
    "git",
    [
      "--literal-pathspecs",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--no-renames",
      "--",
      ...watched.map((w) => w.path),
    ],
    { cwd: root, encoding: "utf8", timeout: GIT_TIMEOUT_MS },
  );
  return parsePorcelain(out);
}

export function runGateScript(root, script) {
  try {
    execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
      timeout: GATE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return null;
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    return out || "(exited non-zero with no output)";
  }
}

function sessionScope(transcriptPath) {
  try {
    return namedByToolCalls(readTranscripts(transcriptPath));
  } catch {
    return null;
  }
}

export function docIntegrity(config, input, options = {}) {
  const { gates = GATES, runGate = runGateScript } = options;
  if (input.stop_hook_active) return { code: 0, err: "" };
  const watched = watchedPaths(config, gates);
  let dirty;
  try {
    dirty = dirtyPaths(config.root, watched);
  } catch {
    return { code: 0, err: GIT_FAILED };
  }
  if (dirty.length === 0) return { code: 0, err: "" };
  const paths = scopeToSession(dirty, sessionScope(input.transcript_path));
  const failures = [];
  for (const gate of selectGates(config, paths, gates)) {
    const failure = runGate(config.root, gate.script);
    if (failure !== null) failures.push(`--- ${gate.script}\n${failure}`);
  }
  if (failures.length === 0) return { code: 0, err: "" };
  const err = `Documentation gates failed on files this session changed. Fix these before finishing:\n\n${failures.join("\n\n")}\n`;
  return { code: 2, err };
}
