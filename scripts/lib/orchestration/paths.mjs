import { isAbsolute, relative, resolve } from "node:path";
import { loadFlowConfig } from "../flow-config.mjs";

export const PATH_CLASS = Object.freeze({
  ORCHESTRATOR_ONLY: "orchestrator-only",
  CLAIMABLE: "claimable",
});

// The orchestrator skill's "Files you write", plus the workflow docs the owner kept with the
// orchestrator. A lane writes one only under a grant naming it.
const ORCHESTRATOR_ONLY_FILES = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  ".oxlintrc.json",
  "tsconfig.base.json",
  "vitest.config.ts",
];
const ORCHESTRATOR_ONLY_DIRS = ["docs", ".claude/skills", ".github"];
const ORCHESTRATOR_ONLY_KEYS = [
  "rules_dir",
  "checklist_dir",
  "sprints_dir",
  "sprint_status",
];
const AGENT_DOCS_TOP_LEVEL = /^_agent-docs\/[^/]+\.md$/;

export const comparable = (repoPath) => repoPath.toLowerCase();

const toSlash = (path) => path.replace(/\\/g, "/");

export function toRepoPath(root, input) {
  const slashed = toSlash(input);
  const absolute = isAbsolute(slashed) ? slashed : resolve(root, slashed);
  const rel = toSlash(relative(root, absolute));
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) {
    return null;
  }
  return rel;
}

// A path covers itself and everything beneath it; comparable paths only.
export const covers = (outer, inner) =>
  inner === outer || inner.startsWith(`${outer}/`);

export function pathRules(config = loadFlowConfig()) {
  const fromConfig = ORCHESTRATOR_ONLY_KEYS.map((key) =>
    toSlash(relative(config.root, config[key])),
  );
  return Object.freeze({
    owned: [
      ...ORCHESTRATOR_ONLY_FILES,
      ...ORCHESTRATOR_ONLY_DIRS,
      ...fromConfig,
    ].map(comparable),
  });
}

export function classifyPath(rules, repoPath) {
  const path = comparable(repoPath);
  const owned =
    rules.owned.some((root) => covers(root, path)) ||
    AGENT_DOCS_TOP_LEVEL.test(path);
  return owned ? PATH_CLASS.ORCHESTRATOR_ONLY : PATH_CLASS.CLAIMABLE;
}
