import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import ProgressReporter, {
  PROGRESS_MARKER,
} from "../../../scripts/lib/defects/progress-reporter.mjs";
import {
  baselineProblem,
  createVitestRunner,
  detectionProblem,
  vitestArgs,
  type AssertionResult,
  type RunResult,
} from "../../../scripts/lib/defects/vitest.mjs";
import { endAll, endsWithin } from "../processes.js";
import { PROCESS_SCENARIO } from "../timeouts.js";
import {
  CALC_TEST,
  catalogOf,
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
  output: Pick<RunResult, "stderr" | "stdout"> = { stderr: "", stdout: "" },
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
  };
}

const RUN_OUTPUT = { stderr: "vitest broke here\n", stdout: "last words" };

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
      endAll(children);
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
function validRunOutput(): Promise<Pick<RunResult, "stderr" | "stdout">> {
  return withScratch(async (dir) => {
    const { stderr, stdout } = await runEntryIn(
      dir,
      (report) =>
        writesReport(report, JSON.stringify(result(0, {}).report)) +
        `process.stderr.write(${JSON.stringify("warned here\n")});\n` +
        writesStdout(`said first\n${collected}\nsaid last\n`),
    );
    return { stderr, stdout };
  });
}

const TAIL_LABEL = "; stdout tail: ";

/** The stdout tail a no-report failure ends with. */
const tailOf = (message: string) =>
  message.slice(message.lastIndexOf(TAIL_LABEL) + TAIL_LABEL.length);

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
      "slow > D9 (120001 ms) declares a timeout above LONGEST_TEST_TIMEOUT_MS (120000 ms) in test/scripts/longest-test-timeout.mjs, which the verifier's idle window is sized from; raise that constant; stderr: warned here\n; stdout tail: said first",
    );
  });

  it("D2059: hands back a run's stdout tail that is not progress with a valid report", async () => {
    const { stdout } = await validRunOutput();
    expect(stdout).toBe("said first\nsaid last");
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
      "expected one named assertion failure; inspect the mutation (exit 1; passed 0; failed: none); stderr: vitest broke here\n; stdout tail: last words",
    );
  });

  it("D2058: ends a failed baseline's verdict with its stderr and stdout tail", () => {
    const { defects } = catalogOf();
    const run = result(1, { [CALC_TEST]: [], [OTHER_TEST]: [] }, RUN_OUTPUT);
    expect(baselineProblem(run, SANDBOX, defects)).toBe(
      `the unmodified baseline must pass every named test and no other (passed 0 for ${defects.length} named; failed: none); stderr: vitest broke here\n; stdout tail: last words`,
    );
  });

  it("D2060: quotes a run with no stderr or stdout tail as (empty) in its verdict", () => {
    const run = result(1, {
      [CALC_TEST]: [test("D1", "skipped"), test("D2", "skipped")],
    });
    expect(detectionProblem(run, SANDBOX, defect("D1"))).toBe(
      "expected one named assertion failure; inspect the mutation (exit 1; passed 0; failed: none); stderr: (empty); stdout tail: (empty)",
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
      "expected a run of test/calc/calc.test.ts alone; stderr: vitest broke here\n; stdout tail: last words",
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
      "the baseline ran a different set of test files; stderr: vitest broke here\n; stdout tail: last words",
    );
  });
});
