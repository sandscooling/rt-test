import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LONGEST_TEST_TIMEOUT_MS } from "../../../test/scripts/longest-test-timeout.mjs";
import {
  childProcessesOf,
  endProcess,
  isRunWatchdog,
} from "../../../test/scripts/run-cleanup.mjs";
import { toPosix } from "../paths.mjs";
import { PROGRESS_EVENT, PROGRESS_MARKER } from "./progress-reporter.mjs";

/** A test may stay silent for its whole timeout, and a hook after it for as long again. */
export const IDLE_WINDOW_MS = 2 * LONGEST_TEST_TIMEOUT_MS;
/** How long a stopped Vitest may take to act on the stop before it is killed outright. */
const KILL_GRACE_MS = 10_000;
const KILL_SIGNAL = "SIGKILL";
const PROGRESS_REPORTER = fileURLToPath(
  new URL("./progress-reporter.mjs", import.meta.url),
);
const PROGRESS_EVENTS = new Set(Object.values(PROGRESS_EVENT));
const ASSERTION_FAILURE = /^AssertionError: /;
const NO_MESSAGE = "no failure message";

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
    `--reporter=${PROGRESS_REPORTER}`,
    "--outputFile",
    report,
  ];
  for (const file of files ?? []) args.push(join(sandbox, file));
  if (pattern) args.push("-t", `${pattern}:`);
  return args;
}

/** The reporter's event on a line, which another process's partial write may precede; undefined on any other line. */
function progressEntry(line) {
  const at = line.indexOf(PROGRESS_MARKER);
  if (at === -1) return undefined;
  try {
    const entry = JSON.parse(line.slice(at + PROGRESS_MARKER.length));
    return PROGRESS_EVENTS.has(entry?.event) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** Follows the reporter's lines: the tests still running, and each timeout past the idle window's basis. */
function progressLog() {
  const running = new Map();
  const overLong = [];
  let last = "none";
  const checkLimit = (what, timeoutMs) => {
    if (timeoutMs > LONGEST_TEST_TIMEOUT_MS) {
      overLong.push(`${what} (${timeoutMs} ms)`);
    }
  };
  const apply = {
    [PROGRESS_EVENT.LIMITS]: (entry) => {
      checkLimit("the global teardown", entry.teardownTimeout);
      for (const hooks of entry.hookTimeouts ?? []) {
        checkLimit(`the hooks of project ${hooks.project}`, hooks.timeout);
      }
    },
    [PROGRESS_EVENT.STARTED]: (entry) => {
      running.set(entry.test, (running.get(entry.test) ?? 0) + 1);
      checkLimit(entry.test, entry.timeout);
    },
    [PROGRESS_EVENT.FINISHED]: (entry) => {
      const left = (running.get(entry.test) ?? 1) - 1;
      if (left > 0) running.set(entry.test, left);
      else running.delete(entry.test);
    },
  };
  return {
    overLong,
    running: () => [...running.keys()],
    get last() {
      return last;
    },
    /** Takes in one stdout line, and says whether it was progress. */
    read(line) {
      const entry = progressEntry(line);
      if (entry === undefined) return false;
      last = `${entry.event} ${entry.test ?? entry.module ?? entry.hook ?? ""}`;
      apply[entry.event]?.(entry);
      return true;
    },
  };
}

function followLines(stream, onLine) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop();
    for (const line of lines) onLine(line.replace(/\r$/, ""));
  });
}

const overLongText = (log) =>
  `${log.overLong.join("; ")} declares a timeout above LONGEST_TEST_TIMEOUT_MS (${LONGEST_TEST_TIMEOUT_MS} ms) in test/scripts/longest-test-timeout.mjs, which the verifier's idle window is sized from; raise that constant`;

function stallText(log, idleWindowMs, stopProblem) {
  const running =
    log.running().join("; ") ||
    "no test reported (collecting, in a hook, tearing down, or in a test whose start Vitest had not yet sent)";
  return [
    `Vitest made no progress for ${idleWindowMs} ms and was stopped; still running: ${running}; last progress: ${log.last}`,
    ...(log.overLong.length > 0 ? [overLongText(log)] : []),
    ...(stopProblem === undefined ? [] : [stopProblem]),
  ].join("; ");
}

/**
 * Ends the Vitest main process, then the processes it started directly, its pool workers, which it leaves running
 * when it is killed. The run watchdog is spared, since it ends the daemons a stopped run started once the main
 * process is gone; those daemons are the workers' children, so ending the workers leaves them to it. Returns why
 * the workers could not be listed, if they could not.
 */
function stopRun(child) {
  let workers = [];
  let problem;
  try {
    workers = childProcessesOf(child.pid).filter(
      (worker) => !isRunWatchdog(worker.commandLine),
    );
  } catch (error) {
    problem = `its workers could not be listed, so any still running were left: ${error.message}`;
  }
  child.kill();
  const escalate = setTimeout(() => child.kill(KILL_SIGNAL), KILL_GRACE_MS);
  child.once("exit", () => {
    clearTimeout(escalate);
    for (const worker of workers) endProcess(worker.pid);
  });
  return problem;
}

function spawnRun(args, cwd, idleWindowMs) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const log = progressLog();
    let stalled = false;
    let stopProblem;
    const stopStalled = () => {
      stalled = true;
      stopProblem = stopRun(child);
    };
    let idle = setTimeout(stopStalled, idleWindowMs);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    followLines(child.stdout, (line) => {
      if (!log.read(line) || stalled) return;
      clearTimeout(idle);
      idle = setTimeout(stopStalled, idleWindowMs);
    });
    child.on("error", (error) => {
      clearTimeout(idle);
      fail(error);
    });
    const failStalled = () =>
      fail(new Error(stallText(log, idleWindowMs, stopProblem)));
    // A worker still holding the stopped process's pipes delays "close" until the worker is ended.
    child.on("exit", () => {
      if (stalled) failStalled();
    });
    child.on("close", (status, signal) => {
      clearTimeout(idle);
      if (stalled) failStalled();
      else if (signal)
        fail(new Error(`Bootstrap runner interrupted: ${signal}`));
      else if (log.overLong.length > 0) fail(new Error(overLongText(log)));
      else done({ status, stderr });
    });
  });
}

export function createVitestRunner({
  root,
  entry = vitestEntry(),
  idleWindowMs = IDLE_WINDOW_MS,
}) {
  const config = join(root, "vitest.config.ts");
  return async ({ sandbox, report, files, pattern }) => {
    rmSync(report, { force: true });
    const args = vitestArgs({ entry, config, sandbox, report, files, pattern });
    const { status, stderr } = await spawnRun(args, root, idleWindowMs);
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

const failedLines = (report) =>
  testsOf(report)
    .filter((test) => test.status === "failed")
    .map(
      (test) =>
        `${test.title}: ${(test.failureMessages[0] || NO_MESSAGE).split(/\r?\n/)[0]}`,
    )
    .join("; ") || "none";

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
    return `the unmodified baseline must pass every named test and no other (passed ${report.numPassedTests} for ${ids.length} named; failed: ${failedLines(report)})`;
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
    return `expected one named assertion failure; inspect the mutation (exit ${status}; passed ${report.numPassedTests}; failed: ${failedLines(report)})`;
  }
  return null;
}
