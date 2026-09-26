import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
const DEFECT_TEST = /\bit\("(D\d+):/g;

export const toPosix = (path) => path.split("\\").join("/");

function isSkipped(path) {
  return toPosix(path)
    .split("/")
    .some((part) => SKIPPED_DIRS.has(part));
}

function listSandboxPaths(root) {
  const nested = SANDBOX_DIRS.flatMap((dir) =>
    readdirSync(join(root, dir), { recursive: true })
      .map((file) => `${dir}/${toPosix(String(file))}`)
      .filter((file) => !isSkipped(file))
      .filter((file) => statSync(join(root, file)).isFile()),
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

export function buildCatalog(files) {
  const records = readRecords(files);
  const tests = indexTests(files);
  assertOneDefectPerTest(records, tests);
  assertAnchorsUnique(records, files);
  const testOf = new Map(tests.map((test) => [test.id, test.path]));
  const defects = records.map((record) => ({
    ...record,
    test: testOf.get(record.id),
  }));
  return { files, defects };
}

export const loadCatalog = (root) => buildCatalog(snapshotFiles(root));
