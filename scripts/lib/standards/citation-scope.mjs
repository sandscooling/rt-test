import { existsSync } from "node:fs";
import { relative } from "node:path";
import { toPosix } from "../paths.mjs";
import { readStatus } from "../planning/status.mjs";

const HARNESS_ROOTS = [
  "AGENTS.md",
  "README.md",
  "CONTRIBUTING.md",
  ".claude",
  "docs",
  "_agent-docs",
  "packages",
  "apps",
  "lint",
  "scripts",
  "test",
];
const CONFIG_ROOT_KEYS = [
  "requirements",
  "adr_dir",
  "glossary",
  "sprints_dir",
  "ticket_dir",
  "checklist_dir",
  "project_context",
  "rule_maintenance_guide",
  "rules_dir",
  "code_change_standards",
  "adversarial_review_prompt",
];
// Dated records and deliberate test inputs: re-pointing their citations would falsify them.
const RECORD_KEYS = ["design_decisions_dir"];
const FIXTURE_ROOTS = ["test/fixtures"];
const SKIPPED_SEGMENTS = new Set(["node_modules", "dist"]);
const ARTIFACT = /\.(?:md|ts|tsx|mts|cts|js|jsx|mjs|cjs|ya?ml)$/;
const SPRINT_FILE = /^sprint-([1-9]\d*)(?:-[^/]*)?\.md$/;
const DONE = "done";

const repoPath = (config, path) => toPosix(relative(config.root, path));
const within = (path, root) => path === root || path.startsWith(`${root}/`);

export function liveRoots(config) {
  const configured = CONFIG_ROOT_KEYS.map((key) =>
    repoPath(config, config[key]),
  );
  const all = [...new Set([...HARNESS_ROOTS, ...configured])];
  return all
    .filter(
      (root) => !all.some((other) => other !== root && within(root, other)),
    )
    .sort();
}

function doneWork(config) {
  const done = { tickets: new Set(), sprints: new Set() };
  if (!existsSync(config.sprint_status)) return done;
  const status = readStatus(config);
  for (const entry of status.tickets.values()) {
    if (entry.state === DONE) done.tickets.add(`${entry.key}.md`);
  }
  for (const [number, entry] of status.sprints) {
    if (entry.state === DONE) done.sprints.add(number);
  }
  return done;
}

function isDoneRecord(scope, path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  if (within(path, scope.ticketDir) && scope.done.tickets.has(name))
    return true;
  const sprint = SPRINT_FILE.exec(name);
  return (
    within(path, scope.sprintsDir) &&
    sprint !== null &&
    scope.done.sprints.has(sprint[1])
  );
}

export function citationScope(config) {
  const scope = {
    roots: liveRoots(config),
    excluded: [
      ...RECORD_KEYS.map((key) => repoPath(config, config[key])),
      ...FIXTURE_ROOTS,
    ],
    ticketDir: repoPath(config, config.ticket_dir),
    sprintsDir: repoPath(config, config.sprints_dir),
    done: doneWork(config),
  };
  return Object.freeze({
    isLive: (path) =>
      ARTIFACT.test(path) &&
      scope.roots.some((root) => within(path, root)) &&
      !isSkipped(scope, path) &&
      !isDoneRecord(scope, path),
    isSkipped: (path) => isSkipped(scope, path),
  });
}

function isSkipped(scope, path) {
  return (
    path.split("/").some((segment) => SKIPPED_SEGMENTS.has(segment)) ||
    scope.excluded.some((root) => within(path, root))
  );
}
