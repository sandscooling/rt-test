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
  };
}

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
});
