import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { toPosix } from "./catalog.mjs";

const RUN_TIMEOUT_MS = 120_000;
const ASSERTION_FAILURE = /^AssertionError: /;

function vitestEntry() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("vitest/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return resolve(dirname(manifestPath), manifest.bin.vitest);
}

export function vitestArgs({ entry, config, sandbox, report, files, pattern }) {
  const args = [
    entry,
    "run",
    "--root",
    sandbox,
    "--config",
    config,
    "--reporter=json",
    "--outputFile",
    report,
  ];
  for (const file of files ?? []) args.push(join(sandbox, file));
  if (pattern) args.push("-t", `${pattern}:`);
  return args;
}

function spawnRun(args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd,
      timeout: RUN_TIMEOUT_MS,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (status, signal) => {
      if (signal) fail(new Error(`Bootstrap runner interrupted: ${signal}`));
      else done({ status, stderr });
    });
  });
}

export function createVitestRunner({ root, entry = vitestEntry() }) {
  const config = join(root, "vitest.config.ts");
  return async ({ sandbox, report, files, pattern }) => {
    rmSync(report, { force: true });
    const args = vitestArgs({ entry, config, sandbox, report, files, pattern });
    const { status, stderr } = await spawnRun(args, root);
    try {
      return { status, report: JSON.parse(readFileSync(report, "utf8")) };
    } catch (error) {
      throw new Error(`Bootstrap runner produced no valid report: ${stderr}`, {
        cause: error,
      });
    }
  };
}

const testsOf = (report) =>
  report.testResults.flatMap((file) => file.assertionResults);

const reportedFiles = (report, sandbox) =>
  report.testResults
    .map((file) => toPosix(relative(sandbox, file.name)))
    .sort();

const idOf = (title) => /^(D\d+):/.exec(title)?.[1];

export const testFilesOf = (defects) =>
  [...new Set(defects.map((defect) => defect.test))].sort();

export function baselineProblem({ status, report }, sandbox, defects, files) {
  const passed = testsOf(report)
    .filter((test) => test.status === "passed")
    .map((test) => idOf(test.title));
  const ids = defects.map((defect) => defect.id);
  if (
    status !== 0 ||
    report.numFailedTests !== 0 ||
    report.numPassedTests !== ids.length ||
    [...passed].sort().join() !== [...ids].sort().join()
  ) {
    const failed = testsOf(report)
      .filter((test) => test.status === "failed")
      .map(
        (test) => `${test.title}: ${test.failureMessages[0]?.split("\n")[0]}`,
      );
    return `the unmodified baseline must pass every named test and no other (passed ${report.numPassedTests} for ${ids.length} named; failed: ${failed.join("; ") || "none"})`;
  }
  if (files && reportedFiles(report, sandbox).join() !== files.join()) {
    return "the baseline ran a different set of test files";
  }
  return null;
}

export function detectionProblem({ status, report }, sandbox, defect) {
  const failures = testsOf(report).filter((test) => test.status === "failed");
  const target = failures[0];
  if (reportedFiles(report, sandbox).join() !== defect.test) {
    return `expected a run of ${defect.test} alone`;
  }
  if (
    status !== 1 ||
    report.numFailedTests !== 1 ||
    report.numPassedTests !== 0 ||
    failures.length !== 1 ||
    !target?.title.startsWith(`${defect.id}:`) ||
    !target.failureMessages.some((message) => ASSERTION_FAILURE.test(message))
  ) {
    return "expected one named assertion failure; inspect the mutation";
  }
  return null;
}
