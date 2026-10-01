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

const FIXTURE = "executor-crash";
const FIXTURE_CONFIG = "vitest.config.mjs";
const TEST_MODULE = "a.test.mjs";
/** Read by the executor-crash fixture's global setup at each job: how it ends the executor process. */
const CRASH_FILE = "crash";
/** The hold directory a mutation of the fixture's test module points its first test at, so only the experiment holds. */
const EXPERIMENT_HOLD = "hold-point-2";

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

/** Falsifies `experiments` over a copy of the executor-crash fixture in a fresh executor, then closes it. */
function falsifiedThroughExecutor(
  experiments: (root: string) => DefectExperiment[],
  during: (
    root: string,
    executor: Executor,
    job: Promise<unknown>,
  ) => void | Promise<void> = () => undefined,
  crash = "",
): Promise<JobOutcome<FalsificationJob>> {
  return inConsumerCopy(FIXTURE, "vitest", async (root) => {
    writeFileSync(join(root, CRASH_FILE), crash);
    const executor = new Executor(memoryLog(), takeStartEnvironment());
    try {
      const job = executor.falsify(
        { path: ".", directory: root },
        FIXTURE_CONFIG,
        experiments(root),
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
        async (root, executor, job) => {
          const hold = join(root, EXPERIMENT_HOLD);
          mkdirSync(hold);
          await waitUntil(() => existsSync(join(hold, "holding")), job);
          executor.abort();
          writeFileSync(join(hold, "release"), "");
        },
      );
      const job =
        outcome.ended && outcome.value.status === "ran"
          ? outcome.value
          : undefined;
      expect(
        job === undefined
          ? outcome
          : {
              interrupted: job.interrupted,
              baseline: job.baseline?.ran,
              experiments: job.experiments.map((record) =>
                record.status === "ran"
                  ? [record.defectId, record.status]
                  : [record.defectId, record.status, record.reason.kind],
              ),
              restored: job.restoredBaseline !== undefined,
            },
      ).toEqual({
        interrupted: true,
        baseline: true,
        experiments: [["held", "not-run", "interrupted"]],
        restored: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
