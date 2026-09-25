import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const SANDBOX_DIRS = ["packages", "lint", "test"];
const SANDBOX_FILES = ["tsconfig.base.json", "tsconfig.json"];
const SKIPPED_DIRS = new Set(["node_modules", "dist"]);
const require = createRequire(import.meta.url);
const manifestPath = require.resolve("vitest/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = resolve(dirname(manifestPath), manifest.bin.vitest);
const sandboxPaths = SANDBOX_DIRS.flatMap((dir) =>
  readdirSync(join(root, dir), { recursive: true })
    .map((file) => join(dir, String(file)))
    .filter((file) => !isSkipped(file)),
);
const defects = sandboxPaths
  .filter((file) => /(^|[\\/])defects\.json$/.test(file))
  .flatMap((file) => JSON.parse(readFileSync(join(root, file), "utf8")));
const testFiles = sandboxPaths.filter((file) => file.endsWith(".test.ts"));
const watched = new Map(
  [...testFiles, ...new Set(defects.map((defect) => defect.file))].map(
    (file) => [file, readFileSync(join(root, file), "utf8")],
  ),
);
assertOneDefectPerTest();
assertAnchorsUnique();

const scratch = join(root, "_agent-docs/.scratch");
mkdirSync(scratch, { recursive: true });
const sandbox = mkdtempSync(join(scratch, "core-defects-"));
assertInside(scratch, sandbox);
const reportPath = join(sandbox, "result.json");

function isSkipped(path) {
  return path.split(/[\\/]/).some((part) => SKIPPED_DIRS.has(part));
}

function assertOneDefectPerTest() {
  const testIds = testFiles.flatMap((file) =>
    [...watched.get(file).matchAll(/\bit\("(D\d+):/g)].map((m) => m[1]),
  );
  const defectIds = defects.map((defect) => defect.id);
  if (
    new Set(defectIds).size !== defectIds.length ||
    new Set(testIds).size !== testIds.length ||
    [...testIds].sort().join() !== [...defectIds].sort().join()
  ) {
    throw new Error("Every bootstrap test must have exactly one named defect.");
  }
}

function assertAnchorsUnique() {
  for (const defect of defects) {
    if (watched.get(defect.file).split(defect.old).length !== 2) {
      throw new Error(`${defect.id}: mutation anchor must match exactly once.`);
    }
  }
}

function assertInside(parent, child) {
  const path = relative(parent, child);
  if (
    !path ||
    path.startsWith(`..${sep}`) ||
    path === ".." ||
    isAbsolute(path)
  ) {
    throw new Error("Refusing a sandbox outside the task scratch directory.");
  }
}

function runTests(pattern) {
  rmSync(reportPath, { force: true });
  const args = [
    entry,
    "run",
    "--root",
    sandbox,
    "--config",
    join(root, "vitest.config.ts"),
    "--reporter=json",
    "--outputFile",
    reportPath,
  ];
  if (pattern) args.push("-t", `${pattern}:`);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error || result.signal) {
    throw new Error(
      `Bootstrap runner interrupted: ${result.error ?? result.signal}`,
    );
  }
  try {
    return {
      status: result.status,
      report: JSON.parse(readFileSync(reportPath, "utf8")),
    };
  } catch (error) {
    throw new Error(
      `Bootstrap runner produced no valid report: ${result.stderr}`,
      { cause: error },
    );
  }
}

function assertBaseline() {
  const { status, report } = runTests();
  if (
    status !== 0 ||
    report.numPassedTests !== defects.length ||
    report.numFailedTests !== 0
  ) {
    throw new Error(
      "The unmodified bootstrap baseline must pass every named test.",
    );
  }
}

function assertDetected(defect) {
  const { status, report } = runTests(defect.id);
  const failures = report.testResults.flatMap((file) =>
    file.assertionResults.filter((test) => test.status === "failed"),
  );
  const target = failures[0];
  if (
    status !== 1 ||
    report.numFailedTests !== 1 ||
    report.numPassedTests !== 0 ||
    failures.length !== 1 ||
    !target?.title.startsWith(`${defect.id}:`) ||
    !target.failureMessages.some((message) =>
      message.includes("AssertionError"),
    )
  ) {
    throw new Error(
      `${defect.id}: expected one named assertion failure; inspect the mutation.`,
    );
  }
}

try {
  for (const dir of SANDBOX_DIRS) {
    cpSync(join(root, dir), join(sandbox, dir), {
      recursive: true,
      filter: (path) => !isSkipped(relative(root, path)),
    });
  }
  for (const file of SANDBOX_FILES) {
    cpSync(join(root, file), join(sandbox, file));
  }
  assertBaseline();
  for (const defect of defects) {
    const original = watched.get(defect.file);
    const target = join(sandbox, defect.file);
    writeFileSync(target, original.replace(defect.old, defect.new));
    assertDetected(defect);
    writeFileSync(target, original);
    console.log(`${defect.id}: detected (${defect.defect})`);
  }
  assertBaseline();
  console.log(
    `${defects.length}/${defects.length} bootstrap defects detected; restored baseline green.`,
  );
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

for (const [file, content] of watched) {
  if (readFileSync(join(root, file), "utf8") !== content) {
    throw new Error(
      "Working files changed during verification; rerun on a stable revision.",
    );
  }
  const digest = createHash("sha256").update(content).digest("hex");
  console.log(`${file} SHA-256: ${digest}`);
}
