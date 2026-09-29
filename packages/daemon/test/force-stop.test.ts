import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { recordOf } from "../../../test/scripts/processes.js";
import {
  stillRunning,
  type ProcessRecord,
} from "../../../test/scripts/run-cleanup.mjs";
import {
  discoverTests,
  type TestDiscovery,
} from "../src/vitest/discover-tests.js";
import {
  confirmEvery,
  inConsumerCopy,
  INTERRUPTED,
  ranRun,
  RUN_HOOK,
  runHooks,
  runSummary,
  settledRun,
  waitUntil,
  withPool,
  type Pool,
  type RunResult,
  type VitestInstall,
} from "./harness.js";

/** Waited for in real time: fake timers would also freeze the timers of the Vitest instance each test hosts. */
const { TEST_GRACE_MS } = vi.hoisted(() => ({ TEST_GRACE_MS: 1000 }));

vi.mock("../src/vitest/force-stop.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/vitest/force-stop.js")>()),
  FORCE_STOP_GRACE_MS: TEST_GRACE_MS,
}));

/** Past the fixtures' 20 s loops, so a job that is never force-stopped still ends, as a failed assertion. */
const STUCK_TIMEOUT_MS = 90_000;
const ABORT_REASON = new Error("stop requested");

interface StuckRun {
  readonly run: RunResult;
  /**
   * On the forks pool, the stuck test's worker process, taken while it loops; undefined on threads, where the host
   * itself runs the test, and when the run ended before it looped.
   */
  readonly worker: ProcessRecord | undefined;
}

/** The process id the stuck test writes once it loops, or undefined before it has written one. */
function loopingPid(looping: string): number | undefined {
  const text = existsSync(looping) ? readFileSync(looping, "utf8") : "";
  return text === "" ? undefined : Number(text);
}

/** Runs the force-stop fixture, aborting once its test is stuck in a synchronous loop. */
function stuckRun(install: VitestInstall, pool: Pool): Promise<StuckRun> {
  return inConsumerCopy("force-stop", install, (root) =>
    withPool(pool, async () => {
      const directory = join(root, "run");
      const looping = join(directory, "looping");
      const controller = new AbortController();
      const run = settledRun(directory, controller.signal);
      await waitUntil(() => loopingPid(looping) !== undefined, run);
      const pid = loopingPid(looping);
      let worker: ProcessRecord | undefined;
      try {
        worker =
          pool === "forks" && pid !== undefined ? recordOf(pid) : undefined;
      } finally {
        controller.abort();
      }
      return { run: await run, worker };
    }),
  );
}

async function stuckRunRecord(
  install: VitestInstall,
  pool: Pool,
): Promise<unknown> {
  const { run } = await stuckRun(install, pool);
  return { summary: runSummary(run), forceStopped: ranRun(run)?.forceStopped };
}

/** A forks-pool run's record, and whether its stuck worker process still exists once the run has returned. */
async function stuckForksRunRecord(install: VitestInstall): Promise<unknown> {
  const { run, worker } = await stuckRun(install, "forks");
  return {
    summary: runSummary(run),
    forceStopped: ranRun(run)?.forceStopped,
    workerAlive: worker !== undefined && stillRunning([worker]).length > 0,
  };
}

/** Discovers the force-stop fixture's module that loops at load, aborting once it is looping. */
function stuckDiscovery(install: VitestInstall, pool: Pool): Promise<unknown> {
  return inConsumerCopy("force-stop", install, (root) =>
    withPool(pool, async () => {
      const directory = join(root, "collect");
      const controller = new AbortController();
      const discovery: Promise<TestDiscovery | { thrown: string }> =
        discoverTests(confirmEvery(directory), controller.signal).catch(
          (error: unknown) => ({ thrown: String(error) }),
        );
      await waitUntil(
        () => existsSync(join(directory, "collecting")),
        discovery,
      );
      controller.abort(ABORT_REASON);
      return {
        discovery: await discovery,
        loopFinished: existsSync(join(directory, "loop-finished")),
      };
    }),
  );
}

const FORCE_STOPPED_RUN = {
  summary: {
    execution: "interrupted",
    modules: {
      "stuck.test.mjs": {
        loops: INTERRUPTED,
        "never started": INTERRUPTED,
      },
    },
  },
  forceStopped: true,
};

const FORCE_STOPPED_DISCOVERY = {
  discovery: { thrown: "Error: stop requested" },
  loopFinished: false,
};

describe("the force-stop grace", () => {
  it("D1318: the grace before a force-stop is 10 seconds", async () => {
    const actual = await vi.importActual<
      typeof import("../src/vitest/force-stop.js")
    >("../src/vitest/force-stop.js");
    expect(actual.FORCE_STOP_GRACE_MS).toBe(10_000);
  });
});

describe("force-stopping a run stuck in a synchronous loop", () => {
  it(
    "D1319: on Vitest 5's forks pool, the run ends interrupted and force-stopped, every unfinished test interrupted and no worker process left",
    async () => {
      expect(await stuckForksRunRecord("vitest")).toEqual({
        ...FORCE_STOPPED_RUN,
        workerAlive: false,
      });
    },
    STUCK_TIMEOUT_MS,
  );

  it(
    "D1320: on Vitest 5's threads pool, the run ends interrupted and force-stopped, every unfinished test interrupted",
    async () => {
      expect(await stuckRunRecord("vitest", "threads")).toEqual(
        FORCE_STOPPED_RUN,
      );
    },
    STUCK_TIMEOUT_MS,
  );

  it(
    "D1321: on Vitest 4.1's forks pool, the run ends interrupted and force-stopped, every unfinished test interrupted and no worker process left",
    async () => {
      expect(await stuckForksRunRecord("vitest-4")).toEqual({
        ...FORCE_STOPPED_RUN,
        workerAlive: false,
      });
    },
    STUCK_TIMEOUT_MS,
  );

  it(
    "D1322: on Vitest 4.1's threads pool, the run ends interrupted and force-stopped, every unfinished test interrupted",
    async () => {
      expect(await stuckRunRecord("vitest-4", "threads")).toEqual(
        FORCE_STOPPED_RUN,
      );
    },
    STUCK_TIMEOUT_MS,
  );
});

describe("force-stopping a discovery stuck loading a module", () => {
  it(
    "D1323: on Vitest 5's forks pool, the discovery rejects with the signal's reason before the module's loop ends",
    async () => {
      expect(await stuckDiscovery("vitest", "forks")).toEqual(
        FORCE_STOPPED_DISCOVERY,
      );
    },
    STUCK_TIMEOUT_MS,
  );

  it(
    "D1324: on Vitest 4.1's threads pool, the discovery rejects with the signal's reason before the module's loop ends",
    async () => {
      expect(await stuckDiscovery("vitest-4", "threads")).toEqual(
        FORCE_STOPPED_DISCOVERY,
      );
    },
    STUCK_TIMEOUT_MS,
  );
});

describe("force-stopping a run whose first module is queued after the grace", () => {
  it(
    "D1325: a run aborted in an async globalSetup held past the grace is force-stopped as soon as Vitest queues its first module",
    async () => {
      const outcome = await inConsumerCopy(
        "force-stop",
        "vitest",
        async (root) => {
          const controller = new AbortController();
          runHooks()[RUN_HOOK] = (event) => {
            if (event !== "global-setup") return undefined;
            controller.abort();
            // Registered after the grace timer the abort just started, and longer, so it always fires after that one.
            return new Promise((resolve) => {
              setTimeout(resolve, TEST_GRACE_MS * 2);
            });
          };
          try {
            const run = await settledRun(
              join(root, "late-queue"),
              controller.signal,
            );
            const recorded = ranRun(run);
            return recorded === undefined
              ? run
              : {
                  execution: recorded.execution,
                  forceStopped: recorded.forceStopped,
                };
          } finally {
            delete runHooks()[RUN_HOOK];
          }
        },
      );
      expect(outcome).toEqual({ execution: "interrupted", forceStopped: true });
    },
    STUCK_TIMEOUT_MS,
  );
});
