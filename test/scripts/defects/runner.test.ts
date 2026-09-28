import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Defect } from "../../../scripts/lib/defects/catalog.mjs";
import ProgressReporter, {
  PROGRESS_MARKER,
} from "../../../scripts/lib/defects/progress-reporter.mjs";
import {
  baselineProblem,
  createVitestRunner,
  detectionProblem,
  EXIT_RECORD_SUFFIX,
  vitestArgs,
  type AssertionResult,
  type RunResult,
} from "../../../scripts/lib/defects/vitest.mjs";
import { endsWithin } from "../processes.js";
import { endOwnedProcesses } from "../run-cleanup.mjs";
import { PROCESS_SCENARIO } from "../timeouts.js";
import {
  CALC_TEST,
  catalogOf,
  cleanEnd,
  OTHER_TEST,
  runStandIn,
  withScratch,
  type StandInScript,
} from "./harness.js";

const SANDBOX = join("scratch", "sandbox-0");

const test = (
  id: string,
  status: string,
  failure = "AssertionError: expected 0 to be 1",
): AssertionResult => ({
  title: `${id}: behaves`,
  status,
  failureMessages: status === "failed" ? [failure] : [],
});

function result(
  status: number | null,
  files: Readonly<Record<string, readonly AssertionResult[]>>,
  output: Pick<RunResult, "stderr" | "stdoutTail"> = {
    stderr: "",
    stdoutTail: "",
  },
): RunResult {
  const tests = Object.values(files).flat();
  const count = (state: string) =>
    tests.filter((each) => each.status === state).length;
  return {
    status,
    report: {
      numPassedTests: count("passed"),
      numFailedTests: count("failed"),
      testResults: Object.entries(files).map(([file, assertionResults]) => ({
        name: join(SANDBOX, file),
        assertionResults,
      })),
    },
    ...output,
    ...cleanEnd(status),
  };
}

const RUN_OUTPUT = {
  stderr: "vitest broke here\n",
  stdoutTail: "last words",
};

const defect = (id: string) =>
  catalogOf().defects.find((each) => each.id === id)!;

const ARGS = {
  entry: "vitest.mjs",
  config: "vitest.config.ts",
  sandbox: SANDBOX,
  report: "report.json",
};

/** Short enough that a stalled stand-in is stopped at once, long enough for it to start. */
const STALL_WINDOW_MS = 2000;
/** Several times the stand-in's 100 ms beat, so a run that keeps beating is never stopped on a loaded machine. */
const LIVE_WINDOW_MS = 2000;
/** How long an ended process may take to go on a loaded machine. */
const STOP_WAIT_MS = 15_000;
/** How long a process that must be spared is watched for an end that should never come. */
const SPARE_WAIT_MS = 2000;
/** How long a stopped run may take to fail on a loaded machine, kept under the test's budget. */
const SETTLE_WAIT_MS = 10_000;

const progress = (event: object) =>
  `${PROGRESS_MARKER}${JSON.stringify(event)}`;
const collected = progress({ event: "collected", module: "calc.test.ts" });
const startedCalc = progress({
  event: "started",
  test: "calc > D1",
  timeout: 5000,
});
const startedAndFinished = (timeout: number) => [
  progress({ event: "started", test: "slow > D9", timeout }),
  progress({ event: "finished", test: "slow > D9" }),
];

/**
 * Runs a stand-in that starts `script`'s children, reports one line and hangs, so the runner stops it; then hands
 * `observe` the children's ids and ends whichever still run.
 */
function afterStall<T>(
  script: StandInScript,
  observe: (children: number[]) => Promise<T>,
): Promise<T> {
  return withScratch(async (dir) => {
    const run = runStandIn(
      dir,
      { ...script, lines: [startedCalc] },
      STALL_WINDOW_MS,
    );
    await run.outcome;
    const children = run.children();
    try {
      if (children.length !== script.children?.length) {
        throw new Error("the stand-in did not start its children");
      }
      return await observe(children);
    } finally {
      endOwnedProcesses([dir], children);
    }
  });
}

/**
 * Runs the entry script `source` writes, in `dir`, for a report path under the runner, stopping it after
 * `idleWindowMs` without progress when given.
 */
function runEntryIn(
  dir: string,
  source: (report: string) => string,
  idleWindowMs?: number,
): Promise<RunResult> {
  const entry = join(dir, "entry.mjs");
  const report = join(dir, "report.json");
  writeFileSync(entry, source(report));
  const run = createVitestRunner({
    root: dir,
    entry,
    ...(idleWindowMs === undefined ? {} : { idleWindowMs }),
  });
  return run({ sandbox: dir, report });
}

/** Runs the entry script `source` writes under the runner; `read`, or the runner's error. */
function runEntry(
  source: (report: string) => string,
  idleWindowMs?: number,
): Promise<string> {
  return withScratch((dir) =>
    runEntryIn(dir, source, idleWindowMs).then(
      () => "read",
      (error: Error) => error.message,
    ),
  );
}

const writesReport = (report: string, text: string) =>
  `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(report)}, ${JSON.stringify(text)});\n`;

const writesStdout = (text: string) =>
  `process.stdout.write(${JSON.stringify(text)});\n`;

/** The output the runner hands back from a run that writes a valid report, stderr, and stdout around a progress line. */
function validRunOutput(): Promise<Pick<RunResult, "stderr" | "stdoutTail">> {
  return withScratch(async (dir) => {
    const { stderr, stdoutTail } = await runEntryIn(
      dir,
      (report) =>
        writesReport(report, JSON.stringify(result(0, {}).report)) +
        `process.stderr.write(${JSON.stringify("warned here\n")});\n` +
        writesStdout(`said first\n${collected}\nsaid last\n`),
    );
    return { stderr, stdoutTail };
  });
}

const TAIL_LABEL = "; stdout tail: ";

/** The stdout tail a no-report failure ends with. */
const tailOf = (message: string) =>
  message.slice(message.lastIndexOf(TAIL_LABEL) + TAIL_LABEL.length);

const REAL_FIXTURES = fileURLToPath(
  new URL("../../fixtures/defects-runner/vitest/", import.meta.url),
);
/** Under the test's budget, so a real run that hangs fails through the runner's verdict, not the test's timeout. */
const REAL_WINDOW_MS = 20_000;

interface RealRun {
  /** Fixture files to copy into the sandbox; the run covers the first. */
  readonly files: readonly string[];
  /** The fixture config the sandbox runs under. */
  readonly config?: string;
  readonly pattern?: string;
}

type Judge = (run: RunResult, sandbox: string) => string | null;

/**
 * Runs real Vitest under the runner over fixtures copied into a scratch sandbox, and returns `judge`'s verdict on
 * the run, or the runner's error when it rejected the run.
 */
function realRun(spec: RealRun, judge: Judge): Promise<string | null> {
  return withScratch(async (dir) => {
    for (const file of spec.files) {
      copyFileSync(join(REAL_FIXTURES, file), join(dir, file));
    }
    copyFileSync(
      join(REAL_FIXTURES, spec.config ?? "vitest.config.ts"),
      join(dir, "vitest.config.ts"),
    );
    const run = createVitestRunner({ root: dir, idleWindowMs: REAL_WINDOW_MS });
    return run({
      sandbox: dir,
      report: join(dir, "report.json"),
      files: spec.files.slice(0, 1),
      ...(spec.pattern === undefined ? {} : { pattern: spec.pattern }),
    }).then(
      (done) => judge(done, dir),
      (error: Error) => error.message,
    );
  });
}

const fixtureDefect = (test: string): Defect => ({
  id: "D1",
  defect: "D1 defect",
  file: test,
  old: "",
  new: "",
  source: "",
  test,
});

const asBaseline =
  (test: string): Judge =>
  (run, sandbox) =>
    baselineProblem(run, sandbox, [fixtureDefect(test)], [test]);

const asDetection =
  (test: string): Judge =>
  (run, sandbox) =>
    detectionProblem(run, sandbox, fixtureDefect(test));

const bareRejection = 'Promise.reject(new Error("bare boom"));\n';

/** Node's own crash on an unhandled rejection: exit status 1, and the error on stderr. */
const NODE_REJECTION_CRASH = /; exit status 1, .*; stderr: .*Error: bare boom/s;

const PID_WAIT_MS = 15_000;
const PID_POLL_MS = 50;

async function pidWithin(path: string, boundMs: number): Promise<number> {
  const until = Date.now() + boundMs;
  while (Date.now() < until) {
    let pid = 0;
    try {
      pid = Number(readFileSync(path, "utf8"));
    } catch {
      pid = 0;
    }
    if (Number.isInteger(pid) && pid > 0) return pid;
    await delay(PID_POLL_MS);
  }
  throw new Error(`no process id appeared in ${path}`);
}

/** Runs an entry that hangs until another process kills it, as something outside the run can; the runner's error. */
function killedFromOutside(): Promise<string> {
  return withScratch(async (dir) => {
    const pidFile = join(dir, "pid");
    const outcome = runEntryIn(
      dir,
      () =>
        `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
      REAL_WINDOW_MS,
    ).then(
      () => "read",
      (error: Error) => error.message,
    );
    const entryPid = await pidWithin(pidFile, PID_WAIT_MS);
    if (endOwnedProcesses([dir], [entryPid]).length === 0) {
      throw new Error(`the entry process ${entryPid} was not killed`);
    }
    return outcome;
  });
}

/** A report whose one run file holds the named assertion failure a detection needs. */
const namedFailureReport = () =>
  result(1, {
    [CALC_TEST]: [test("D1", "failed"), test("D2", "skipped")],
  }).report;

const cleanRunEnded = progress({
  event: "run-ended",
  reason: "failed",
  errorCount: 0,
  errors: [],
});

function parseErrorOf(text: string): string {
  try {
    JSON.parse(text);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${text} parsed`);
}

describe("the Vitest runner", PROCESS_SCENARIO, () => {
  it("D905: scopes a run to the sandbox copy of the test file by absolute path", () => {
    const args = vitestArgs({ ...ARGS, files: [CALC_TEST] });
    expect(args).toContain(join(SANDBOX, CALC_TEST));
  });

  it("D906: filters by the id and its colon, so D1 never selects D12", () => {
    const args = vitestArgs({ ...ARGS, files: [CALC_TEST], pattern: "D1" });
    expect(args.slice(-2)).toEqual(["-t", "D1:"]);
  });

  it("D907: rejects a detection whose run also collected another file", () => {
    const run = result(1, {
      [CALC_TEST]: [test("D1", "failed"), test("D2", "skipped")],
      [OTHER_TEST]: [test("D3", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).not.toBeNull();
  });

  it("D908: rejects a named failure that is not an assertion failure", () => {
    const timedOut = test("D1", "failed", "Error: Test timed out in 5000ms.");
    const run = result(1, {
      [CALC_TEST]: [timedOut, test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).not.toBeNull();
  });

  it("D952: rejects a named failure raised by node:assert rather than an expectation", () => {
    const nodeAssert = test(
      "D1",
      "failed",
      "AssertionError [ERR_ASSERTION]: Expected values to be strictly equal",
    );
    const run = result(1, {
      [CALC_TEST]: [nodeAssert, test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).not.toBeNull();
  });

  it("D909: rejects a baseline where an extra pass hides a skipped named test", () => {
    const { defects } = catalogOf();
    const run = result(0, {
      [CALC_TEST]: [test("D1", "passed"), test("D2", "skipped")],
      [OTHER_TEST]: [test("D3", "passed"), test("D4", "passed")],
    });
    expect(baselineProblem(run, SANDBOX, defects)).not.toBeNull();
  });

  it("D910: rejects a baseline that collected a file outside its scope", () => {
    const { defects } = catalogOf();
    const run = result(0, {
      [CALC_TEST]: [test("D1", "passed"), test("D2", "passed")],
      [OTHER_TEST]: [test("D3", "passed")],
      "test/extra/extra.test.ts": [],
    });
    const scope = [CALC_TEST, OTHER_TEST].sort();
    expect(baselineProblem(run, SANDBOX, defects, scope)).not.toBeNull();
  });

  it("D911: never reads a report a previous run left behind", async () => {
    const outcome = await withScratch(async (dir) => {
      const entry = join(dir, "silent.mjs");
      const report = join(dir, "report.json");
      writeFileSync(entry, "process.exitCode = 1;\n");
      writeFileSync(report, JSON.stringify(result(0, {}).report));
      const run = createVitestRunner({ root: dir, entry });
      return run({ sandbox: dir, report }).then(
        () => "read",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toMatch(/no valid report/);
  });

  it("D1967: names a run's exit status, time to exit and exit-to-close lag when it left no report", async () => {
    const outcome = await runEntry(() => "process.exitCode = 3;\n");
    expect(outcome).toMatch(
      /; exit status 3, exited \d+ ms after start, closed \d+ ms after exit; /,
    );
  });

  it("D1968: says a report the run never wrote was never written", async () => {
    const outcome = await runEntry(() => "process.exitCode = 1;\n");
    expect(outcome).toContain(
      "Bootstrap runner produced no valid report: the report was never written; ",
    );
  });

  it("D1969: names a report that is not JSON by its byte size, head and parse error", async () => {
    const truncated = '{"numPassedTests": 1, "testR';
    const outcome = await runEntry((report) => writesReport(report, truncated));
    expect(outcome).toContain(
      String.raw`the report (28 bytes, starting "{\"numPassedTests\": 1, \"testR") is not JSON: ` +
        parseErrorOf(truncated),
    );
  });

  it("D1972: fails a report that parses but holds no testResults list through the no-report message", async () => {
    const outcome = await runEntry((report) => writesReport(report, "null"));
    expect(outcome).toContain(
      'the report (4 bytes, starting "null") holds no testResults list',
    );
  });

  it("D1970: quotes stdout that is not progress, keeping output written ahead of a progress event on its line", async () => {
    const stdout = `plain before\n${collected}\nahead${collected}\n`;
    const outcome = await runEntry(() => writesStdout(stdout));
    expect(tailOf(outcome)).toBe("plain before\nahead");
  });

  it("D1971: cuts the stdout tail to its last 2000 characters behind a leading ...", async () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      `${String(i + 1).padStart(2, "0")}:`.padEnd(150, "x"),
    );
    const outcome = await runEntry(() => writesStdout(`${lines.join("\n")}\n`));
    const kept = lines.slice(-20).join("\n");
    expect(tailOf(outcome)).toBe(`...${kept.slice(-1997)}`);
  });

  it("D1973: quotes only the first 200 characters of a report that is not JSON", async () => {
    const outcome = await runEntry((report) =>
      writesReport(report, "x".repeat(300)),
    );
    expect(outcome).toContain(
      `the report (300 bytes, starting "${"x".repeat(200)}") is not JSON`,
    );
  });

  it("D1974: quotes a final stdout line that has no newline", async () => {
    const outcome = await runEntry(() => writesStdout("first\nlast words"));
    expect(tailOf(outcome)).toBe("first\nlast words");
  });

  it("D1975: keeps the last 20 non-blank stdout lines", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const outcome = await runEntry(() =>
      writesStdout(`${lines.join("\n\n")}\n`),
    );
    expect(tailOf(outcome)).toBe(lines.slice(30).join("\n"));
  });

  it("D1976: quotes the run's stderr whole when it left no report", async () => {
    const outcome = await runEntry(
      () => `process.stderr.write("vitest broke here\\n");\n`,
    );
    expect(outcome).toContain("; stderr: vitest broke here\n; stdout tail: ");
  });

  it("D1977: measures the close lag from the run's exit, not from its start", async () => {
    const outcome = await runEntry(() => "setTimeout(() => {}, 1000);\n");
    const [, exitMs, closeLagMs] =
      /exited (\d+) ms after start, closed (\d+) ms after exit/.exec(outcome) ??
      [];
    expect(Number(closeLagMs)).toBeLessThan(Number(exitMs));
  });

  it("D1978: says a report that exists but cannot be read could not be read", async () => {
    const outcome = await runEntry(
      (report) =>
        `import { mkdirSync } from "node:fs";\nmkdirSync(${JSON.stringify(report)});\n`,
    );
    expect(outcome).toContain(
      "Bootstrap runner produced no valid report: the report could not be read: ",
    );
  });

  it("D1979: gives blank stdout lines no place among the tail's 20", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const outcome = await runEntry(() =>
      writesStdout(`${lines.join("\n\n")}\n`),
    );
    expect(tailOf(outcome)).toBe(lines.join("\n"));
  });

  it("D1980: quotes a stalled run's stderr and stdout tail in its stop failure", async () => {
    const outcome = await runEntry(
      () =>
        `process.stderr.write("hung here\\n");\nprocess.stdout.write("said before hanging\\n");\nsetInterval(() => {}, 1000);\n`,
      STALL_WINDOW_MS,
    );
    expect(outcome).toMatch(
      /made no progress.*; stderr: hung here\n; stdout tail: said before hanging$/s,
    );
  });

  it("D2056: hands back a run's whole stderr with a valid report", async () => {
    const { stderr } = await validRunOutput();
    expect(stderr).toBe("warned here\n");
  });

  it("D2064: ends an over-long timeout failure with the run's stderr and stdout tail", async () => {
    const outcome = await runEntry(
      () =>
        `process.stderr.write(${JSON.stringify("warned here\n")});\n` +
        writesStdout(`said first\n${startedAndFinished(120_001).join("\n")}\n`),
    );
    expect(outcome).toBe(
      "slow > D9 (120001 ms) declares a timeout above LONGEST_TEST_TIMEOUT_MS (120000 ms) in test/scripts/longest-test-timeout.mjs, which the verifier's idle window is sized from; raise that constant; Vitest reported no run end; the Vitest process exited with code 0; stderr: warned here\n; stdout tail: said first",
    );
  });

  it("D2059: hands back a run's stdout tail that is not progress with a valid report", async () => {
    const { stdoutTail } = await validRunOutput();
    expect(stdoutTail).toBe("said first\nsaid last");
  });

  it("D946: rejects a run whose only failure is a different test", () => {
    const run = result(1, {
      [CALC_TEST]: [test("D1", "skipped"), test("D2", "failed")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).not.toBeNull();
  });

  it("D947: rejects a detection while another test in the run passes", () => {
    const run = result(1, {
      [CALC_TEST]: [test("D1", "failed"), test("D2", "passed")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).not.toBeNull();
  });

  it("D948: rejects a baseline whose named tests pass while Vitest exits 1", () => {
    const { defects } = catalogOf();
    const run = result(1, {
      [CALC_TEST]: [test("D1", "passed"), test("D2", "passed")],
      [OTHER_TEST]: [test("D3", "passed")],
    });
    expect(baselineProblem(run, SANDBOX, defects)).not.toBeNull();
  });

  it("D949: rejects a named assertion failure from a run that did not exit 1", () => {
    const run = result(null, {
      [CALC_TEST]: [test("D1", "failed"), test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).not.toBeNull();
  });

  it("D1250: names an undetected run's exit status, passed count and the failed test's first message line", () => {
    const timedOut = test(
      "D1",
      "failed",
      "Error: Test timed out in 5000ms.\n    at calc.test.ts:1:1",
    );
    const run = result(1, {
      [CALC_TEST]: [timedOut, test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toContain(
      "(exit 1; passed 0; failed: D1: behaves: Error: Test timed out in 5000ms.)",
    );
  });

  it("D1251: reads a failed test with no failure message as no failure message", () => {
    const silent = { ...test("D1", "failed"), failureMessages: [] };
    const run = result(1, {
      [CALC_TEST]: [silent, test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toContain(
      "failed: D1: behaves: no failure message)",
    );
  });

  it("D1270: reads a failed test whose first failure message is empty as no failure message", () => {
    const empty = test("D1", "failed", "");
    const run = result(1, {
      [CALC_TEST]: [empty, test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toContain(
      "failed: D1: behaves: no failure message)",
    );
  });

  it("D1271: reports failed none when the named test passed under its mutation", () => {
    const run = result(0, {
      [CALC_TEST]: [test("D1", "passed"), test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toContain(
      "(exit 0; passed 1; failed: none)",
    );
  });

  it("D1701: never stops a run that keeps reporting progress, however long it runs past the idle window", async () => {
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          {
            repeat: { line: collected, forMs: 5 * LIVE_WINDOW_MS },
            finish: true,
          },
          LIVE_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toBe("read");
  });

  it("D1702: stops a run whose only output is not a reporter line, naming the running test and the last progress", async () => {
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          {
            lines: [startedCalc],
            repeat: { line: "plain output", forMs: 4 * STALL_WINDOW_MS },
            finish: true,
          },
          STALL_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toMatch(
      /no progress .*still running: calc > D1; last progress: started calc > D1/,
    );
  });

  it("D1703: stops a run whose only output is a malformed reporter line", async () => {
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          {
            lines: [startedCalc],
            repeat: {
              line: `${PROGRESS_MARKER}{"event":`,
              forMs: 4 * STALL_WINDOW_MS,
            },
            finish: true,
          },
          STALL_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toMatch(/made no progress/);
  });

  it("D1782: stops a run whose only output is a reporter line naming no known event", async () => {
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          {
            lines: [startedCalc],
            repeat: {
              line: progress({ event: "unknown", test: "calc > D1" }),
              forMs: 4 * STALL_WINDOW_MS,
            },
            finish: true,
          },
          STALL_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toMatch(/made no progress/);
  });

  it("D1783: ends a stopped run's worker that holds the main process's output open", async () => {
    const ended = await afterStall(
      { children: [[]], childStdio: "inherit" },
      ([worker]) => endsWithin(worker!, STOP_WAIT_MS),
    );
    expect(ended).toBe(true);
  });

  it("D2472: fails a stalled run whose main process exited before the stop, saying its workers could not be told apart", async () => {
    const outcome = await withScratch(async (dir) => {
      const run = runStandIn(
        dir,
        {
          lines: [startedCalc],
          children: [[]],
          childStdio: "inherit",
          finish: true,
        },
        STALL_WINDOW_MS,
      );
      try {
        return await run.outcome;
      } finally {
        endOwnedProcesses([dir], run.children());
      }
    });
    expect(outcome).toMatch(
      /its main process had exited before the stop, so its workers could not be told from other processes/,
    );
  });

  it("D2494: fails, rather than waiting on its output, a stalled run whose main process exited before the stop", async () => {
    const settled = await withScratch(async (dir) => {
      const run = runStandIn(
        dir,
        {
          lines: [startedCalc],
          children: [[]],
          childStdio: "inherit",
          finish: true,
        },
        STALL_WINDOW_MS,
      );
      try {
        return await Promise.race([
          run.outcome.then(() => true),
          delay(STALL_WINDOW_MS + SETTLE_WAIT_MS).then(() => false),
        ]);
      } finally {
        endOwnedProcesses([dir], run.children());
      }
    });
    expect(settled).toBe(true);
  });

  it("D1704: ends a stopped run's pool workers, which outlive its main process", async () => {
    const ended = await afterStall({ children: [[]] }, ([worker]) =>
      endsWithin(worker!, STOP_WAIT_MS),
    );
    expect(ended).toBe(true);
  });

  it("D1705: spares a stopped run's watchdog, named by its command line, so it can clean up after the run", async () => {
    const ended = await afterStall(
      { children: [["run-watchdog.mjs"]] },
      ([watchdog]) => endsWithin(watchdog!, SPARE_WAIT_MS),
    );
    expect(ended).toBe(false);
  });

  it("D1708: fails a run holding a test whose timeout exceeds the longest allowed, naming it and the constant to raise", async () => {
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          { lines: startedAndFinished(120_001), finish: true },
          LIVE_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toMatch(
      /slow > D9 \(120001 ms\).*LONGEST_TEST_TIMEOUT_MS.*test\/scripts\/longest-test-timeout\.mjs/,
    );
  });

  it("D1746: accepts a test whose timeout is exactly the longest allowed", async () => {
    const outcome = await withScratch(
      (dir) =>
        runStandIn(
          dir,
          { lines: startedAndFinished(120_000), finish: true },
          LIVE_WINDOW_MS,
        ).outcome,
    );
    expect(outcome).toBe("read");
  });

  it("D1709: fails a run whose project hook timeout exceeds the longest allowed test timeout, naming the project", async () => {
    const limits = progress({
      event: "limits",
      teardownTimeout: 10_000,
      hookTimeouts: [{ project: "slow-hooks", timeout: 120_001 }],
    });
    const outcome = await withScratch(
      (dir) =>
        runStandIn(dir, { lines: [limits], finish: true }, LIVE_WINDOW_MS)
          .outcome,
    );
    expect(outcome).toMatch(/the hooks of project slow-hooks \(120001 ms\)/);
  });

  it("D1710: bounds a started test's silence by its timeout over every retry and repeat", () => {
    const writes: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      new ProgressReporter().onTestCaseReady({
        module: { moduleId: "calc.test.ts" },
        fullName: "D1",
        options: { timeout: 1000, retry: { count: 2 }, repeats: 1 },
      });
    } finally {
      write.mockRestore();
    }
    const started = JSON.parse(
      writes.join("").slice(PROGRESS_MARKER.length),
    ) as { timeout: number };
    expect(started.timeout).toBe(6000);
  });

  it("D1252: cuts a CRLF failure message at its first line with no carriage return", () => {
    const { defects } = catalogOf();
    const crlf = test(
      "D1",
      "failed",
      "AssertionError: expected 0 to be 1\r\n    at calc.test.ts:1:1",
    );
    const run = result(1, {
      [CALC_TEST]: [crlf, test("D2", "passed")],
      [OTHER_TEST]: [test("D3", "passed")],
    });
    expect(baselineProblem(run, SANDBOX, defects)).toContain(
      "failed: D1: behaves: AssertionError: expected 0 to be 1)",
    );
  });

  it("D2057: ends an undetected run's verdict with its stderr and stdout tail", () => {
    const run = result(
      1,
      { [CALC_TEST]: [test("D1", "skipped"), test("D2", "skipped")] },
      RUN_OUTPUT,
    );
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toBe(
      'expected one named assertion failure; inspect the mutation (exit 1; passed 0; failed: none); Vitest ended the run with reason "failed" and no unhandled error; the Vitest process exited with code 1; stderr: vitest broke here\n; stdout tail: last words',
    );
  });

  it("D2058: ends a failed baseline's verdict with its stderr and stdout tail", () => {
    const { defects } = catalogOf();
    const run = result(1, { [CALC_TEST]: [], [OTHER_TEST]: [] }, RUN_OUTPUT);
    expect(baselineProblem(run, SANDBOX, defects)).toBe(
      `the unmodified baseline must pass every named test and no other (passed 0 for ${defects.length} named; failed: none); Vitest ended the run with reason "failed" and no unhandled error; the Vitest process exited with code 1; stderr: vitest broke here\n; stdout tail: last words`,
    );
  });

  it("D2060: quotes a run with no stderr or stdout tail as (empty) in its verdict", () => {
    const run = result(1, {
      [CALC_TEST]: [test("D1", "skipped"), test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toBe(
      'expected one named assertion failure; inspect the mutation (exit 1; passed 0; failed: none); Vitest ended the run with reason "failed" and no unhandled error; the Vitest process exited with code 1; stderr: (empty); stdout tail: (empty)',
    );
  });

  it("D2061: ends the verdict on a run that collected another file with its stderr and stdout tail", () => {
    const run = result(
      1,
      {
        [CALC_TEST]: [test("D1", "failed"), test("D2", "skipped")],
        [OTHER_TEST]: [test("D3", "skipped")],
      },
      RUN_OUTPUT,
    );
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toBe(
      'expected a run of test/calc/calc.test.ts alone; Vitest ended the run with reason "failed" and no unhandled error; the Vitest process exited with code 1; stderr: vitest broke here\n; stdout tail: last words',
    );
  });

  it("D2062: ends the verdict on a baseline that ran a different set of test files with its stderr and stdout tail", () => {
    const { defects } = catalogOf();
    const run = result(
      0,
      {
        [CALC_TEST]: [test("D1", "passed"), test("D2", "passed")],
        [OTHER_TEST]: [test("D3", "passed")],
        "test/extra/extra.test.ts": [],
      },
      RUN_OUTPUT,
    );
    const scope = [CALC_TEST, OTHER_TEST].sort();
    expect(baselineProblem(run, SANDBOX, defects, scope)).toBe(
      'the baseline ran a different set of test files; Vitest ended the run with reason "passed" and no unhandled error; the Vitest process exited with code 0; stderr: vitest broke here\n; stdout tail: last words',
    );
  });

  it("D2172: names a test worker's death by its exit code or signal, runner state and test file", async () => {
    const verdict = await realRun(
      { files: ["dies.fixture.ts"] },
      asBaseline("dies.fixture.ts"),
    );
    expect(verdict).toMatch(
      /caused by: Error: Worker exited unexpectedly with (exit code \d+ |signal \w+ )+during \w+ state while running test file \S*dies\.fixture\.ts/,
    );
  });

  it("D2173: names an unhandled error beside a passing test by its type, message and first stack frame", async () => {
    const verdict = await realRun(
      { files: ["beside-pass.fixture.ts"] },
      asBaseline("beside-pass.fixture.ts"),
    );
    expect(verdict).toMatch(
      /\(1\) Uncaught Exception: Error: boom beside a passing test\n\s+at .*beside-pass\.fixture\.ts:\d+:\d+/,
    );
  });

  it("D2174: names a test file whose import threw by the file and its error", async () => {
    const verdict = await realRun(
      { files: ["import.fixture.ts", "throws-on-import.ts"] },
      asBaseline("import.fixture.ts"),
    );
    expect(verdict).toContain(
      "; file errors: import.fixture.ts: the import threw; ",
    );
  });

  it("D2175: names the first 10 tests a dead worker left pending and counts the rest", async () => {
    const verdict = await realRun(
      { files: ["dies.fixture.ts"] },
      asBaseline("dies.fixture.ts"),
    );
    expect(verdict).toContain(
      "; tests left pending: (1) D1: dies mid-test (2) D2: never runs (3) D3: never runs (4) D4: never runs (5) D5: never runs (6) D6: never runs (7) D7: never runs (8) D8: never runs (9) D9: never runs (10) D10: never runs and 2 more; ",
    );
  });

  it("D2185: names exactly 10 pending tests with no count of the rest", async () => {
    const verdict = await realRun(
      { files: ["dies-ten.fixture.ts"] },
      asBaseline("dies-ten.fixture.ts"),
    );
    expect(verdict).toContain(
      "(9) D9: never runs (10) D10: never runs; Vitest ended the run",
    );
  });

  it("D2176: names a host-side unhandled rejection, the process.exit call it led to with its callers, and the exit code", async () => {
    const outcome = await realRun(
      {
        files: ["passes.fixture.ts", "host-rejection.setup.ts"],
        config: "host-rejection.config.ts",
      },
      () => "read",
    );
    expect(outcome).toMatch(
      /; the Vitest process recorded \(1\) an unhandled rejection: Error: host boom\n.*\(2\) a process\.exit\(1\) call from .+ < .+, then exited with code 1; /s,
    );
  });

  it("D2177: never counts a named assertion failure beside an unhandled error as a detection", async () => {
    const verdict = await realRun(
      { files: ["fails-beside-error.fixture.ts"], pattern: "D1" },
      asDetection("fails-beside-error.fixture.ts"),
    );
    expect(verdict).toEqual(
      expect.stringContaining(
        "the named assertion failed, but a run that did not end cleanly is not a detection: Vitest reported 1 unhandled error(s); ",
      ),
    );
  });

  it("D2178: never counts a named assertion failure as a detection when the process wrote its report and recorded no exit", async () => {
    const run = await withScratch((dir) =>
      runEntryIn(
        dir,
        (report) =>
          writesReport(report, JSON.stringify(namedFailureReport())) +
          `process.stdout.write(${JSON.stringify(`${cleanRunEnded}\n`)}, () => process.reallyExit(1));\n`,
      ),
    );
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toEqual(
      expect.stringContaining(
        "the named assertion failed, but a run that did not end cleanly is not a detection: the Vitest process recorded no exit; ",
      ),
    );
  });

  it("D2179: says a run killed from outside before its report recorded no exit", async () => {
    const outcome = await killedFromOutside();
    expect(outcome).toContain(
      "; the Vitest process recorded no exit, so it was killed, crashed below JavaScript, or could not write its record; ",
    );
  });

  it("D2180: leaves a bare unhandled rejection to crash with Node's own stderr and exit 1", async () => {
    const outcome = await runEntry(() => bareRejection);
    expect(outcome).toMatch(NODE_REJECTION_CRASH);
  });

  it("D2181: passes a clean real detection and a clean real baseline", async () => {
    const verdicts = await Promise.all([
      realRun(
        { files: ["fails.fixture.ts"], pattern: "D1" },
        asDetection("fails.fixture.ts"),
      ),
      realRun(
        { files: ["passes.fixture.ts"] },
        asBaseline("passes.fixture.ts"),
      ),
    ]);
    expect(verdicts).toEqual([null, null]);
  });

  it("D2182: records a process.exit call with its caller, then exits with its code", async () => {
    const outcome = await runEntry(
      () => "process.exit(3);\nsetInterval(() => {}, 1000);\n",
      STALL_WINDOW_MS,
    );
    expect(outcome).toMatch(
      /; exit status 3, .*; the Vitest process recorded \(1\) a process\.exit\(3\) call from .+, then exited with code 3; /s,
    );
  });

  it("D2183: leaves a rejection after the last other listener left to crash as Node does", async () => {
    const outcome = await runEntry(
      () =>
        `const listener = () => {};\nprocess.on("unhandledRejection", listener);\nprocess.off("unhandledRejection", listener);\n${bareRejection}`,
    );
    expect(outcome).toMatch(NODE_REJECTION_CRASH);
  });

  it("D2184: keeps a process.exit code when the exit record cannot be written", async () => {
    const outcome = await runEntry(
      (report) =>
        `import { mkdirSync, rmSync } from "node:fs";\nconst record = ${JSON.stringify(`${report}${EXIT_RECORD_SUFFIX}`)};\nrmSync(record);\nmkdirSync(record);\nprocess.exit(3);\n`,
    );
    expect(outcome).toMatch(/; exit status 3, /);
  });

  it("D2186: counts an exit record line cut short as unreadable", async () => {
    const outcome = await runEntry(
      (report) =>
        `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(`${report}${EXIT_RECORD_SUFFIX}`)}, ${JSON.stringify('{"kind":"exi\n')});\n`,
    );
    expect(outcome).toContain(
      "; the Vitest process exited with code 0, then left 1 unreadable record line(s); ",
    );
  });

  it("D2187: never counts a named assertion failure as a detection when the process then crashed on an uncaught exception", async () => {
    const run = await withScratch((dir) =>
      runEntryIn(
        dir,
        (report) =>
          writesReport(report, JSON.stringify(namedFailureReport())) +
          `process.stdout.write(${JSON.stringify(`${cleanRunEnded}\n`)}, () => setTimeout(() => { throw new Error("host boom after close"); }, 0));\n`,
      ),
    );
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toEqual(
      expect.stringContaining(
        "the named assertion failed, but a run that did not end cleanly is not a detection: the Vitest process recorded 1 unhandled error(s); ",
      ),
    );
  });

  it("D2188: never counts a named assertion failure as a detection when a process.exit call ended the process", async () => {
    const run = await withScratch((dir) =>
      runEntryIn(
        dir,
        (report) =>
          writesReport(report, JSON.stringify(namedFailureReport())) +
          `process.stdout.write(${JSON.stringify(`${cleanRunEnded}\n`)}, () => process.exit(1));\n`,
      ),
    );
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toEqual(
      expect.stringContaining(
        "the named assertion failed, but a run that did not end cleanly is not a detection: the Vitest process was ended by a process.exit call, ",
      ),
    );
  });

  it("D2189: fails an all-pass baseline that exited 0 when its process recorded no exit", async () => {
    const { defects } = catalogOf();
    const allPass = result(0, {
      [CALC_TEST]: [test("D1", "passed"), test("D2", "passed")],
      [OTHER_TEST]: [test("D3", "passed")],
    }).report;
    const passedRunEnded = progress({
      event: "run-ended",
      reason: "passed",
      errorCount: 0,
      errors: [],
    });
    const run = await withScratch((dir) =>
      runEntryIn(
        dir,
        (report) =>
          writesReport(report, JSON.stringify(allPass)) +
          `process.stdout.write(${JSON.stringify(`${passedRunEnded}\n`)}, () => process.reallyExit(0));\n`,
      ),
    );
    expect(baselineProblem(run, SANDBOX, defects)).toEqual(
      expect.stringContaining(
        "the unmodified baseline did not end cleanly: the Vitest process recorded no exit; ",
      ),
    );
  });

  it("D2190: never counts a named assertion failure as a detection when Vitest reported no run end, though its process exited", () => {
    const run = {
      ...result(1, {
        [CALC_TEST]: [test("D1", "failed"), test("D2", "skipped")],
      }),
      runEnd: null,
    };
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toEqual(
      expect.stringContaining(
        "the named assertion failed, but a run that did not end cleanly is not a detection: Vitest reported no run end; ",
      ),
    );
  });
});
