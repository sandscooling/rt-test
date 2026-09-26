import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baselineProblem,
  createVitestRunner,
  detectionProblem,
  vitestArgs,
  type AssertionResult,
  type RunResult,
} from "../../../scripts/lib/defects/vitest.mjs";
import { CALC_TEST, catalogOf, OTHER_TEST, withScratch } from "./harness.js";

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

describe("the Vitest runner", () => {
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
});
