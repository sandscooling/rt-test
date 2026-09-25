import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const manifestPath = require.resolve("vitest/package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const entry = resolve(dirname(manifestPath), manifest.bin.vitest);
const sourcePath = join(root, "src/evidence.ts");
const testPath = join(root, "test/evidence.test.ts");
const source = readFileSync(sourcePath, "utf8");
const testSource = readFileSync(testPath, "utf8");
const defects = JSON.parse(
  readFileSync(join(root, "test/defects.json"), "utf8"),
);
const testIds = [...testSource.matchAll(/it\("(D\d+):/g)].map(
  (match) => match[1],
);
const defectIds = defects.map((defect) => defect.id);
if (
  new Set(defectIds).size !== defectIds.length ||
  new Set(testIds).size !== testIds.length ||
  [...testIds].sort().join() !== [...defectIds].sort().join()
) {
  throw new Error("Every bootstrap test must have exactly one named defect.");
}
const scratch = join(root, "_agent-docs/.scratch");
mkdirSync(scratch, { recursive: true });
const sandbox = mkdtempSync(join(scratch, "core-defects-"));
const sandboxSource = join(sandbox, "src/evidence.ts");
const reportPath = join(sandbox, "result.json");

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
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error || result.signal) {
    throw new Error(
      `Bootstrap runner interrupted: ${result.error ?? result.signal}`,
    );
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    throw new Error(
      `Bootstrap runner produced no valid report: ${result.stderr}`,
    );
  }
  return { status: result.status, report };
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

try {
  mkdirSync(join(sandbox, "src"));
  mkdirSync(join(sandbox, "test"));
  copyFileSync(testPath, join(sandbox, "test/evidence.test.ts"));
  writeFileSync(sandboxSource, source);
  assertBaseline();
  for (const defect of defects) {
    if (source.split(defect.old).length !== 2) {
      throw new Error(`${defect.id}: mutation anchor must match exactly once.`);
    }
    writeFileSync(sandboxSource, source.replace(defect.old, defect.new));
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
    console.log(`${defect.id}: detected (${defect.defect})`);
  }
  writeFileSync(sandboxSource, source);
  assertBaseline();
  console.log(
    `${defects.length}/${defects.length} bootstrap defects detected; restored baseline green.`,
  );
  console.log(
    `Source SHA-256: ${createHash("sha256").update(source).digest("hex")}`,
  );
} finally {
  const child = relative(scratch, sandbox);
  if (
    !child ||
    child === ".." ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error("Refusing cleanup outside the task scratch directory.");
  }
  rmSync(sandbox, { recursive: true, force: true });
  if (
    readFileSync(sourcePath, "utf8") !== source ||
    readFileSync(testPath, "utf8") !== testSource
  ) {
    throw new Error(
      "Working files changed during verification; rerun on a stable revision.",
    );
  }
}
