import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";

export const SANDBOX_DIRS = [
  "packages",
  "lint",
  "scripts",
  "test",
  ".claude/hooks",
];
export const SANDBOX_FILES = [
  "tsconfig.base.json",
  "tsconfig.json",
  "_agent-docs/_flow-config.yaml",
  ".claude/settings.json",
];
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);
const DEFECT_TEST = /\bit\(\s*"(D\d+):/g;

export const toPosix = (path) => path.split("\\").join("/");

function isSkipped(path) {
  return toPosix(path)
    .split("/")
    .some((part) => SKIPPED_DIRS.has(part));
}

// Node's recursive readdir enters junctions and directory symlinks, so walk
// by hand and report each link as a link, never as the content behind it.
export function walkTree(root, dir = "") {
  const files = [];
  const links = [];
  const visit = (at) => {
    for (const entry of readdirSync(join(root, at), { withFileTypes: true })) {
      const path = at ? `${at}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(path);
      else if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(dir);
  return { files, links };
}

function listSandboxPaths(root) {
  const nested = SANDBOX_DIRS.flatMap((dir) =>
    walkTree(root, dir).files.filter((file) => !isSkipped(file)),
  );
  return [...nested, ...SANDBOX_FILES].sort();
}

export function snapshotFiles(root) {
  return new Map(
    listSandboxPaths(root).map((path) => [
      path,
      readFileSync(join(root, path)),
    ]),
  );
}

const isSnapshotted = (path) =>
  SANDBOX_DIRS.some((dir) => path.startsWith(`${dir}/`)) && !isSkipped(path);

// Bun links each workspace dependency inside the workspace that uses it, so a
// sandbox recreates every link that resolves to a directory it copies.
function snapshotLinks(root) {
  const real = realpathSync(root);
  return SANDBOX_DIRS.flatMap((dir) => walkTree(root, dir).links)
    .filter((path) => existsSync(join(root, path)))
    .filter((path) => statSync(join(root, path)).isDirectory())
    .map((path) => ({
      path,
      target: toPosix(relative(real, realpathSync(join(root, path)))),
    }))
    .filter((link) => isSnapshotted(link.target))
    .sort((a, b) => a.path.localeCompare(b.path));
}

const text = (files, path) => files.get(path).toString("utf8");

function readRecords(files) {
  return [...files.keys()]
    .filter((path) => /(^|\/)defects\.json$/.test(path))
    .flatMap((source) =>
      JSON.parse(text(files, source)).map((record) => ({ ...record, source })),
    );
}

function indexTests(files) {
  const tests = [...files.keys()].filter((path) => path.endsWith(".test.ts"));
  return tests.flatMap((path) =>
    [...text(files, path).matchAll(DEFECT_TEST)].map((m) => ({
      id: m[1],
      path,
    })),
  );
}

function assertOneDefectPerTest(records, tests) {
  const testIds = tests.map((test) => test.id);
  const defectIds = records.map((record) => record.id);
  if (
    new Set(defectIds).size !== defectIds.length ||
    new Set(testIds).size !== testIds.length ||
    [...testIds].sort().join() !== [...defectIds].sort().join()
  ) {
    throw new Error("Every bootstrap test must have exactly one named defect.");
  }
}

function assertAnchorsUnique(records, files) {
  for (const record of records) {
    if (!files.has(record.file)) {
      throw new Error(`${record.id}: mutated file is not in the sandbox.`);
    }
    if (text(files, record.file).split(record.old).length !== 2) {
      throw new Error(`${record.id}: mutation anchor must match exactly once.`);
    }
  }
}

export function buildCatalog(files, links = []) {
  const records = readRecords(files);
  const tests = indexTests(files);
  assertOneDefectPerTest(records, tests);
  assertAnchorsUnique(records, files);
  const testOf = new Map(tests.map((test) => [test.id, test.path]));
  const defects = records.map((record) => ({
    ...record,
    test: testOf.get(record.id),
  }));
  return { files, links, defects };
}

export const loadCatalog = (root) =>
  buildCatalog(snapshotFiles(root), snapshotLinks(root));
