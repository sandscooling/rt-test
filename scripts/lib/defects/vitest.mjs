import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LONGEST_TEST_TIMEOUT_MS } from "../../../test/scripts/longest-test-timeout.mjs";
import {
  childProcessesOf,
  endRecorded,
  isRunWatchdog,
} from "../../../test/scripts/run-cleanup.mjs";
import { toPosix } from "../paths.mjs";
import { PROGRESS_EVENT, PROGRESS_MARKER } from "./progress-reporter.mjs";
import {
  CUT_MARKER,
  EXIT_RECORD_ENV,
  exitRecordText,
  NOT_FOUND,
  readExitRecord,
  reportEvidence,
  runEndText,
  uncleanEndProblem,
} from "./run-evidence.mjs";

/** A test may stay silent for its whole timeout, and a hook after it for as long again. */
export const IDLE_WINDOW_MS = 2 * LONGEST_TEST_TIMEOUT_MS;
/** How long a stopped Vitest may take to act on the stop before it is killed outright. */
const KILL_GRACE_MS = 10_000;
const KILL_SIGNAL = "SIGKILL";
/** Once the main process has gone, its id no longer proves which processes are its workers. */
const EXITED_BEFORE_STOP =
  "its main process had exited before the stop, so its workers could not be told from other processes and any still running were left";
const PROGRESS_REPORTER = fileURLToPath(
  new URL("./progress-reporter.mjs", import.meta.url),
);
const EXIT_WITNESS = new URL("./exit-witness.mjs", import.meta.url).href;
/** Names the exit record beside the report, so whatever removes the report's folder removes the record too. */
export const EXIT_RECORD_SUFFIX = ".exit-record.jsonl";
const PROGRESS_EVENTS = new Set(Object.values(PROGRESS_EVENT));
const ASSERTION_FAILURE = /^AssertionError: /;
const NO_MESSAGE = "no failure message";
const REPORT_HEAD_CHARS = 200;
const STDOUT_TAIL_LINES = 20;
const STDOUT_TAIL_CHARS = 2000;

function vitestEntry() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("vitest/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  return resolve(dirname(manifestPath), manifest.bin.vitest);
}

export function vitestArgs({ entry, config, sandbox, report, files, pattern }) {
  const args = [
    "--import",
    EXIT_WITNESS,
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
  let ended = null;
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
    [PROGRESS_EVENT.RUN_ENDED]: (entry) => {
      const errors = Array.isArray(entry.errors)
        ? entry.errors.map(String)
        : [];
      ended = {
        reason: String(entry.reason),
        errorCount: Number.isInteger(entry.errorCount)
          ? entry.errorCount
          : errors.length,
        errors,
      };
    },
  };
  return {
    overLong,
    running: () => [...running.keys()],
    get last() {
      return last;
    },
    /** How Vitest said the run ended, or null when it never said. */
    get ended() {
      return ended;
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
  stream.on("end", () => {
    if (pending !== "") onLine(pending.replace(/\r$/, ""));
  });
}

/** Keeps the last non-blank stdout lines that were not progress, for a failure to quote. */
function stdoutTail() {
  const lines = [];
  return {
    add(line) {
      if (line.trim() === "") return;
      lines.push(line.slice(-STDOUT_TAIL_CHARS));
      if (lines.length > STDOUT_TAIL_LINES) lines.shift();
    },
    text() {
      const all = lines.join("\n");
      if (all.length <= STDOUT_TAIL_CHARS) return all;
      return `${CUT_MARKER}${all.slice(CUT_MARKER.length - STDOUT_TAIL_CHARS)}`;
    },
  };
}

/** The output on a stdout line that was not progress: all of it, or what another process wrote before the event. */
const outputOf = (line, progressed) =>
  progressed ? line.slice(0, line.indexOf(PROGRESS_MARKER)) : line;

const elapsedMs = (from, to) => Math.round(to - from);

const overLongText = (log) =>
  `${log.overLong.join("; ")} declares a timeout above LONGEST_TEST_TIMEOUT_MS (${LONGEST_TEST_TIMEOUT_MS} ms) in test/scripts/longest-test-timeout.mjs, which the verifier's idle window is sized from; raise that constant`;

const orEmpty = (output) => output || "(empty)";

/** How the run ended, by Vitest's word and by its process's, then its stderr and stdout tail, as a failure quotes them. */
const outputEvidence = (run) => [
  runEndText(run.runEnd),
  exitRecordText(run.exitRecord),
  `stderr: ${orEmpty(run.stderr)}`,
  `stdout tail: ${orEmpty(run.stdoutTail)}`,
];

const withOutputEvidence = (problem, run) =>
  [problem, ...outputEvidence(run)].join("; ");

/** A verdict on a run that wrote a report: its problem, what the report says went wrong, then the output evidence. */
const withRunEvidence = (problem, run, sandbox) =>
  [
    problem,
    ...reportEvidence(run.report, sandbox),
    ...outputEvidence(run),
  ].join("; ");

function stallText(log, idleWindowMs, stopProblem, output) {
  const running =
    log.running().join("; ") ||
    "no test reported (collecting, in a hook, tearing down, or in a test whose start Vitest had not yet sent)";
  return [
    `Vitest made no progress for ${idleWindowMs} ms and was stopped; still running: ${running}; last progress: ${log.last}`,
    ...(log.overLong.length > 0 ? [overLongText(log)] : []),
    ...(stopProblem === undefined ? [] : [stopProblem]),
    ...outputEvidence(output),
  ].join("; ");
}

/**
 * Ends the Vitest main process, then the processes it started directly, its pool workers, which it leaves running
 * when it is killed. The run watchdog is spared, since it ends the daemons a stopped run started once the main
 * process is gone; those daemons are the workers' children, so ending the workers leaves them to it. A worker is
 * ended only while its id still names the process listed. Returns the stop at once; its `problem`, why the workers
 * could not be listed or ended, is final before the runner's own exit listener reads it.
 */
function stopRun(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { problem: EXITED_BEFORE_STOP };
  }
  const stop = { problem: undefined };
  let workers = [];
  try {
    workers = childProcessesOf(child.pid).filter(
      (worker) => !isRunWatchdog(worker.commandLine),
    );
  } catch (error) {
    stop.problem = `its workers could not be listed, so any still running were left: ${error.message}`;
  }
  child.kill();
  const escalate = setTimeout(() => child.kill(KILL_SIGNAL), KILL_GRACE_MS);
  // Ahead of the runner's own exit listener, which writes the stall report.
  child.prependOnceListener("exit", () => {
    clearTimeout(escalate);
    stop.problem ??= endWorkers(workers);
  });
  return stop;
}

/** Ends each listed worker still running as the process listed, and says why they could not be, if they could not. */
function endWorkers(workers) {
  try {
    endRecorded(workers);
    return undefined;
  } catch (error) {
    return `its workers could not be checked before they were ended, so any still running were left: ${error.message}`;
  }
}

function spawnRun(args, cwd, idleWindowMs, exitRecord) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: { ...process.env, [EXIT_RECORD_ENV]: exitRecord },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const startedAt = performance.now();
    const log = progressLog();
    const tail = stdoutTail();
    let exitedAt;
    let stalled = false;
    let stop;
    const stopStalled = () => {
      stalled = true;
      stop = stopRun(child);
      // Its exit has passed, and a worker holding the pipes can keep "close" away for good.
      if (exitedAt !== undefined) failStalled();
    };
    let idle = setTimeout(stopStalled, idleWindowMs);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    followLines(child.stdout, (line) => {
      const progressed = log.read(line);
      tail.add(outputOf(line, progressed));
      if (!progressed || stalled) return;
      clearTimeout(idle);
      idle = setTimeout(stopStalled, idleWindowMs);
    });
    child.on("error", (error) => {
      clearTimeout(idle);
      fail(error);
    });
    const runOutput = () => ({
      stderr,
      stdoutTail: tail.text(),
      runEnd: log.ended,
      exitRecord: readExitRecord(exitRecord),
    });
    let stallReported = false;
    const failStalled = () => {
      if (stallReported) return;
      stallReported = true;
      fail(new Error(stallText(log, idleWindowMs, stop.problem, runOutput())));
    };
    const failWithOutput = (problem) =>
      fail(new Error(withOutputEvidence(problem, runOutput())));
    // A worker still holding the stopped process's pipes delays "close" until the worker is ended.
    child.on("exit", () => {
      exitedAt = performance.now();
      if (stalled) failStalled();
    });
    child.on("close", (status, signal) => {
      clearTimeout(idle);
      const closedAt = performance.now();
      if (stalled) failStalled();
      else if (signal)
        failWithOutput(`Bootstrap runner interrupted: ${signal}`);
      else if (log.overLong.length > 0) failWithOutput(overLongText(log));
      else
        done({
          status,
          ...runOutput(),
          exitMs:
            exitedAt === undefined ? null : elapsedMs(startedAt, exitedAt),
          closeLagMs:
            exitedAt === undefined ? null : elapsedMs(exitedAt, closedAt),
        });
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
    const exitRecord = `${report}${EXIT_RECORD_SUFFIX}`;
    rmSync(report, { force: true });
    rmSync(exitRecord, { force: true });
    const args = vitestArgs({ entry, config, sandbox, report, files, pattern });
    const run = await spawnRun(args, root, idleWindowMs, exitRecord);
    const read = readReport(report);
    if (read.problem === undefined) {
      return {
        status: run.status,
        report: read.report,
        stderr: run.stderr,
        stdoutTail: run.stdoutTail,
        runEnd: run.runEnd,
        exitRecord: run.exitRecord,
      };
    }
    throw new Error(noReportText(run, read.problem), { cause: read.error });
  };
}

function readReport(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    const problem =
      error.code === NOT_FOUND
        ? "the report was never written"
        : `the report could not be read: ${error.message}`;
    return { problem, error };
  }
  const text = bytes.toString("utf8");
  const described = () =>
    `the report (${bytes.length} bytes, starting ${JSON.stringify(text.slice(0, REPORT_HEAD_CHARS))})`;
  let report;
  try {
    report = JSON.parse(text);
  } catch (error) {
    return { problem: `${described()} is not JSON: ${error.message}`, error };
  }
  if (!Array.isArray(report?.testResults)) {
    return { problem: `${described()} holds no testResults list` };
  }
  return { report };
}

const msOrUnknown = (ms) => (ms === null ? "unknown" : `${ms} ms`);

function noReportText(run, problem) {
  return [
    `Bootstrap runner produced no valid report: ${problem}`,
    `exit status ${run.status}, exited ${msOrUnknown(run.exitMs)} after start, closed ${msOrUnknown(run.closeLagMs)} after exit`,
    ...outputEvidence(run),
  ].join("; ");
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

export function baselineProblem(run, sandbox, defects, files) {
  const { status, report } = run;
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
    return withRunEvidence(
      `the unmodified baseline must pass every named test and no other (passed ${report.numPassedTests} for ${ids.length} named; failed: ${failedLines(report)})`,
      run,
      sandbox,
    );
  }
  if (files && reportedFiles(report, sandbox).join() !== files.join()) {
    return withRunEvidence(
      "the baseline ran a different set of test files",
      run,
      sandbox,
    );
  }
  const unclean = uncleanEndProblem(run);
  if (unclean !== null) {
    return withRunEvidence(
      `the unmodified baseline did not end cleanly: ${unclean}`,
      run,
      sandbox,
    );
  }
  return null;
}

export function detectionProblem(run, sandbox, defect) {
  const { status, report } = run;
  const failures = testsOf(report).filter((test) => test.status === "failed");
  const target = failures[0];
  if (reportedFiles(report, sandbox).join() !== defect.test) {
    return withRunEvidence(
      `expected a run of ${defect.test} alone`,
      run,
      sandbox,
    );
  }
  if (
    status !== 1 ||
    report.numFailedTests !== 1 ||
    report.numPassedTests !== 0 ||
    failures.length !== 1 ||
    !target?.title.startsWith(`${defect.id}:`) ||
    !target.failureMessages.some((message) => ASSERTION_FAILURE.test(message))
  ) {
    return withRunEvidence(
      `expected one named assertion failure; inspect the mutation (exit ${status}; passed ${report.numPassedTests}; failed: ${failedLines(report)})`,
      run,
      sandbox,
    );
  }
  const unclean = uncleanEndProblem(run);
  if (unclean !== null) {
    return withRunEvidence(
      `the named assertion failed, but a run that did not end cleanly is not a detection: ${unclean}`,
      run,
      sandbox,
    );
  }
  return null;
}
