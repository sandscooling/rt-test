import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { isAtOrInside, isInside, toPosix } from "../paths.mjs";

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
const ROOT_PACKAGES = "node_modules";
const SKIPPED_DIRS = new Set([ROOT_PACKAGES, "dist"]);
const SCOPE_MARK = "@";
const TOOL_ENTRY_MARK = ".";
const DEFECT_TEST = /\bit\(\s*"(D\d+):/g;

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

export const isInSandboxDir = (path) =>
  SANDBOX_DIRS.some((dir) => path.startsWith(`${dir}/`));

const isSnapshotted = (path) => isInSandboxDir(path) && !isSkipped(path);

const realPath = (path) => realpathSync.native(path);

const isDirectoryAt = (path) =>
  existsSync(path) && statSync(path).isDirectory();

function realPaths(root) {
  const modules = join(root, ROOT_PACKAGES);
  return {
    root: realPath(root),
    modules: existsSync(modules) ? realPath(modules) : null,
  };
}

// Bun links each workspace dependency inside the workspace that uses it: a
// workspace package is recreated against the sandbox's own copy, and a
// third-party package keeps its absolute target in the root package store.
function workspaceLink(root, real, path) {
  const target = realPath(join(root, path));
  const inRepo = toPosix(relative(real.root, target));
  if (isSnapshotted(inRepo)) return { path, target: inRepo };
  if (real.modules && isInside(real.modules, target)) return { path, target };
  return null;
}

function workspaceLinks(root, real) {
  return SANDBOX_DIRS.flatMap((dir) => walkTree(root, dir).links)
    .filter((path) => isDirectoryAt(join(root, path)))
    .map((path) => workspaceLink(root, real, path))
    .filter((link) => link !== null);
}

// Dot entries are never linked: they hold the package manager's store and bin
// shims, and tool caches such as Vitest's, which stays inside each sandbox.
function packageNames(modules) {
  return readdirSync(modules)
    .filter((name) => !name.startsWith(TOOL_ENTRY_MARK))
    .flatMap((name) =>
      name.startsWith(SCOPE_MARK)
        ? readdirSync(join(modules, name)).map((inner) => `${name}/${inner}`)
        : [name],
    );
}

function assertOutsideSource(real, name, target) {
  if (isAtOrInside(real.root, target) && !isInside(real.modules, target)) {
    throw new Error(
      `${ROOT_PACKAGES}/${name} resolves to ${toPosix(relative(real.root, target)) || "."}, live source no sandbox can isolate; install with Bun's isolated linker, which links workspace packages inside each workspace.`,
    );
  }
}

function packageLinks(root, real) {
  if (!real.modules) return [];
  const modules = join(root, ROOT_PACKAGES);
  return packageNames(modules)
    .filter((name) => isDirectoryAt(join(modules, name)))
    .map((name) => {
      const target = realPath(join(modules, name));
      assertOutsideSource(real, name, target);
      return { path: `${ROOT_PACKAGES}/${name}`, target };
    });
}

// A sandbox lives outside the repository, so it reaches third-party code only
// through these links, and an import none of them answers fails to resolve.
export function recordLinks(root) {
  const real = realPaths(root);
  return [...workspaceLinks(root, real), ...packageLinks(root, real)].sort(
    (a, b) => a.path.localeCompare(b.path),
  );
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
  buildCatalog(snapshotFiles(root), recordLinks(root));
