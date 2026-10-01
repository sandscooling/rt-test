import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TestIdentity } from "@rt-test/core";
import { describe, expect, it } from "vitest";
import { Executor, type JobOutcome } from "../../src/daemon/executor.js";
import type {
  DefectExperiment,
  FalsificationJob,
} from "../../src/falsify/experiment-record.js";
import { takeStartEnvironment } from "../../src/inputs/environment-digest.js";
import { DAEMON_TEST_TIMEOUT_MS, memoryLog } from "../daemon-harness.js";
import { inConsumerCopy, waitUntil } from "../harness.js";
import { errorMarkersOf, judgementOf } from "./job-readings.js";

const FIXTURE = "executor-crash";
const FIXTURE_CONFIG = "vitest.config.mjs";
const TEST_MODULE = "a.test.mjs";
/** Read by the executor-crash fixture's global setup at each job: how it ends the executor process. */
const CRASH_FILE = "crash";
/** The hold directory a mutation of the fixture's test module points its first test at, so only the experiment holds. */
const EXPERIMENT_HOLD = "hold-point-2";
/** The hold directory the fixture's first test holds on as written, so the baseline holds. */
const BASELINE_HOLD = "hold-point";
/** How a reply that holds no baseline reads in `runsKept`. */
const NO_RUN = "none";
/** An error name the fixture's mutated test throws under, which the job counts as an assertion only when told to. */
const DECLARED_NAME = "FixtureCheckError";

const SECOND: TestIdentity = {
  workspacePath: ".",
  projectName: "",
  modulePath: TEST_MODULE,
  namePath: ["second"],
  occurrence: 0,
};

function mutating(
  root: string,
  defectId: string,
  old: string,
  replacement: string,
): DefectExperiment {
  return {
    defectId,
    test: SECOND,
    mutation: { file: join(root, TEST_MODULE), old, new: replacement },
  };
}

/**
 * Falsifies `experiments` over a copy of the executor-crash fixture in a fresh executor, counting an error named in
 * `assertionErrors` as an assertion, then closes it.
 */
function falsifiedThroughExecutor(
  experiments: (root: string) => DefectExperiment[],
  during: (
    root: string,
    executor: Executor,
    job: Promise<unknown>,
  ) => void | Promise<void> = () => undefined,
  crash = "",
  assertionErrors: readonly string[] = [],
): Promise<JobOutcome<FalsificationJob>> {
  return inConsumerCopy(FIXTURE, "vitest", async (root) => {
    writeFileSync(join(root, CRASH_FILE), crash);
    const executor = new Executor(memoryLog(), takeStartEnvironment());
    try {
      const job = executor.falsify(
        { path: ".", directory: root },
        FIXTURE_CONFIG,
        experiments(root),
        assertionErrors,
      );
      await during(root, executor, job);
      return await job;
    } finally {
      await executor.close();
    }
  });
}

const pidless = (text: string): string =>
  text.replace(/process \d+/g, "process <pid>");

describe("a falsification job in the executor", () => {
  it(
    "D3651: a record holding an error field JSON cannot carry, a bigint, still crosses the executor's channel",
    async () => {
      const outcome = await falsifiedThroughExecutor((root) => [
        mutating(
          root,
          "bigint",
          'it("second", () => {});',
          'it("second", () => {throw Object.assign(new Error("big"), { size: 10n });});',
        ),
      ]);
      const record =
        outcome.ended && outcome.value.status === "ran"
          ? outcome.value.experiments[0]
          : undefined;
      const error =
        record?.status === "ran"
          ? record.run.modules
              .flatMap((module) => (module.collected ? module.tests : []))
              .find((test) => test.identity.namePath.at(-1) === "second")
              ?.errors[0]
          : undefined;
      expect(error?.["size"] ?? outcome).toBe("10n");
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3652: a job whose executor process ends before replying returns nothing to store, with the reason",
    async () => {
      const outcome = await falsifiedThroughExecutor(
        (root) => [
          mutating(root, "crashed", "const POLL_MS = 5;", "const POLL_MS = 6;"),
        ],
        undefined,
        "throw",
      );
      expect(
        outcome.ended
          ? outcome
          : { ...outcome, reason: pidless(outcome.reason) },
      ).toEqual({
        ended: false,
        reason:
          "the executor process <pid> exited during the job (exit code 1)",
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3653: an abort during an experiment ends the job there, and its reply holds the finished baseline and no restored baseline",
    async () => {
      const outcome = await falsifiedThroughExecutor(
        (root) => [
          mutating(root, "held", '"./hold-point"', `"./${EXPERIMENT_HOLD}"`),
        ],
        abortedWhileHeldAt(EXPERIMENT_HOLD),
      );
      expect(runsKept(outcome)).toEqual({
        interrupted: true,
        baseline: true,
        experiments: [["held", "not-run", "interrupted"]],
        restored: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3741: an abort during the baseline ends the job there, and its reply holds no baseline and each planned experiment as interrupted",
    async () => {
      const outcome = await falsifiedThroughExecutor(
        (root) => [
          mutating(root, "planned", "const POLL_MS = 5;", "const POLL_MS = 6;"),
        ],
        abortedWhileHeldAt(BASELINE_HOLD),
      );
      expect(runsKept(outcome)).toEqual({
        interrupted: true,
        baseline: NO_RUN,
        experiments: [["planned", "not-run", "interrupted"]],
        restored: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3773: an error name given to Executor.falsify reaches the judge in the executor process, so that error reads as an assertion and its experiment as detected",
    async () => {
      const outcome = await falsifiedThroughExecutor(
        (root) => [
          mutating(
            root,
            "declared",
            'it("second", () => {});',
            `it("second", () => {throw Object.assign(new Error("checked"), { name: "${DECLARED_NAME}" });});`,
          ),
        ],
        undefined,
        undefined,
        [DECLARED_NAME],
      );
      expect(
        outcome.ended
          ? {
              judgement: judgementOf(outcome.value, "declared"),
              errors: errorMarkersOf(outcome.value, "declared"),
            }
          : outcome,
      ).toEqual({
        judgement: { verdict: "detected" },
        errors: ["declared-name"],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

/**
 * Creates the hold directory, waits until the fixture's first test holds on it, aborts the job, and releases the
 * test, as `stoppedWhileHeld` does for a run.
 */
function abortedWhileHeldAt(
  holdDirectory: string,
): (root: string, executor: Executor, job: Promise<unknown>) => Promise<void> {
  return async (root, executor, job) => {
    const hold = join(root, holdDirectory);
    mkdirSync(hold);
    await waitUntil(() => existsSync(join(hold, "holding")), job);
    executor.abort();
    writeFileSync(join(hold, "release"), "");
  };
}

/** Which runs an ended job's reply holds; a job that did not end with runs as its whole outcome. */
function runsKept(outcome: JobOutcome<FalsificationJob>): unknown {
  if (!outcome.ended || outcome.value.status !== "ran") return outcome;
  const job = outcome.value;
  return {
    interrupted: job.interrupted,
    baseline: job.baseline?.ran ?? NO_RUN,
    experiments: job.experiments.map((record) =>
      record.status === "ran"
        ? [record.defectId, record.status]
        : [record.defectId, record.status, record.reason.kind],
    ),
    restored: job.restoredBaseline !== undefined,
  };
}
