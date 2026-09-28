import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { crashError, WatchedChild } from "../child-end.js";
import { clientEndpoint } from "../../../packages/daemon/src/daemon/endpoint.js";
import { createDaemonKey } from "../../../packages/daemon/src/daemon/endpoint-proof.js";
import { consumerIdentity } from "../../../packages/daemon/src/store/consumer-identity.js";
import {
  confirmNothing,
  trustedStart,
  withDaemons,
  withStandIn,
} from "../../../packages/daemon/test/daemon-harness.js";
import {
  cleanUpRun,
  endOwnedProcesses,
  endRecorded,
  guardRun,
  processRecords,
  recordStarted,
  STARTED_FILE,
  sweepEndedRuns,
  type StartedEntry,
} from "../run-cleanup.mjs";
import {
  endAll,
  endedProcessId,
  endsWithin,
  holdsWithin,
  idleProcess,
} from "../processes.js";
import { PROCESS_SCENARIO } from "../timeouts.js";
import { watchdogsOf, withDaemonRunSetup } from "./daemon-run.js";

const GUARDED_RUN = fileURLToPath(
  new URL("./guarded-run.mjs", import.meta.url),
);
/** How long an ended process may take to go on a loaded machine. */
const STOP_WAIT_MS = 15_000;
/** How long a process that must be spared is watched for an end that should never come. */
const SPARE_WAIT_MS = 2000;
/** How long a watchdog may take to notice its run's death and clean up after it. */
const WATCHDOG_WAIT_MS = 10_000;
/** How the daemon project's global setup names each run's temp parent, before the owning process id. */
const DAEMON_RUN_PREFIX = "rt-test-daemon-run-";
/** The variables `os.tmpdir()` reads, on Linux and on Windows. */
const TEMP_VARIABLES = ["TMPDIR", "TEMP", "TMP"];
/** The key the daemon project's global setup provides the run's temp parent under. */
const RUN_ROOT_KEY = "rtTestDaemonTempRoot";

/** Hands `body` a run directory and a sibling directory outside it, and removes both however `body` ends. */
async function inRunRoot<T>(
  body: (runRoot: string, outside: string) => Promise<T>,
): Promise<T> {
  const base = mkdtempSync(join(tmpdir(), "rt-test-cleanup-"));
  const runRoot = join(base, "run");
  const outside = join(base, "outside");
  mkdirSync(runRoot);
  mkdirSync(outside);
  try {
    return await body(runRoot, outside);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** Starts `pids` processes, hands them to `body`, and ends whichever still run however `body` ends. */
async function withProcesses<T>(
  pids: readonly number[],
  body: () => Promise<T>,
): Promise<T> {
  try {
    return await body();
  } finally {
    endAll(pids);
  }
}

/** The run's record of what it started; a run that recorded nothing has no record file. */
function recorded(runRoot: string): StartedEntry[] {
  const file = join(runRoot, STARTED_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as StartedEntry);
}

interface WorkerState {
  readonly __vitest_worker__: {
    readonly providedContext: Record<string, unknown>;
  };
}

/** Provides the run's temp parent to the daemon harness while `body` runs, as the daemon project's global setup does. */
async function providingRunRoot<T>(
  runRoot: string,
  body: () => Promise<T>,
): Promise<T> {
  const provided = (globalThis as unknown as WorkerState).__vitest_worker__
    .providedContext;
  provided[RUN_ROOT_KEY] = runRoot;
  try {
    return await body();
  } finally {
    delete provided[RUN_ROOT_KEY];
  }
}

/** The child's first stdout line; a child that ends before writing one has crashed. */
function firstLine(child: ChildProcess, label: string): Promise<string> {
  const watched = new WatchedChild(child, label);
  return Promise.race([
    new Promise<string>((resolveLine) => {
      createInterface({ input: child.stdout! }).once("line", resolveLine);
    }),
    watched.end.then((end) => {
      throw crashError(label, end);
    }),
  ]);
}

const IDLE_SCRIPT = "setInterval(() => {}, 1000);";

/**
 * Starts an idle child whose command line names nothing, as a daemon starts an executor, writes its id, and ends it
 * through its own handle once its stdin closes, so a child the code under test spares never outlives the test.
 */
const STARTS_IDLE_CHILD = [
  'const { spawn } = require("node:child_process");',
  `const child = spawn(process.execPath, ["-e", ${JSON.stringify(IDLE_SCRIPT)}], { stdio: "ignore", windowsHide: true });`,
  "console.log(child.pid);",
  'process.stdin.on("end", () => { child.kill("SIGKILL"); process.exit(0); });',
  "process.stdin.resume();",
].join("\n");

/** Starts a process naming `root` on its command line, working outside it, that starts an idle child. */
function childStarter(root: string): ChildProcess {
  return spawn(process.execPath, ["-e", STARTS_IDLE_CHILD, root], {
    cwd: tmpdir(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

/** Has the starter end its idle child and exit, and waits for it to go. */
async function endStarter(starter: ChildProcess): Promise<void> {
  if (starter.exitCode !== null || starter.signalCode !== null) return;
  const exited = new Promise((resolveExit) =>
    starter.once("exit", resolveExit),
  );
  starter.stdin?.end();
  await exited;
}

describe("cleaning up a test run", PROCESS_SCENARIO, () => {
  it("D1747: ends a recorded process still running inside the run's directory", async () => {
    const ended = await inRunRoot(async (runRoot) => {
      const owned = idleProcess([runRoot]);
      return withProcesses([owned], async () => {
        recordStarted(runRoot, { pids: [owned] });
        await cleanUpRun(runRoot);
        return endsWithin(owned, STOP_WAIT_MS);
      });
    });
    expect(ended).toBe(true);
  });

  it("D1748: spares a recorded process whose command line lies outside the run, as a reused process id", async () => {
    const ended = await inRunRoot(async (runRoot) => {
      const stranger = idleProcess();
      return withProcesses([stranger], async () => {
        recordStarted(runRoot, { pids: [stranger] });
        await cleanUpRun(runRoot);
        return endsWithin(stranger, SPARE_WAIT_MS);
      });
    });
    expect(ended).toBe(false);
  });

  it("D1749: removes a recorded file outside the run's directory, such as a Linux socket", async () => {
    const left = await inRunRoot(async (runRoot, outside) => {
      const socket = join(outside, "daemon.sock");
      writeFileSync(socket, "");
      recordStarted(runRoot, { files: [socket] });
      await cleanUpRun(runRoot);
      return existsSync(socket);
    });
    expect(left).toBe(false);
  });

  it("D1763: removes a recorded key with the .tmp and .removing copies beside it, and no other key's", async () => {
    const left = await inRunRoot(async (runRoot, outside) => {
      for (const name of [
        "abc.key",
        "abc.key.41.tmp",
        "abc.key.42.removing",
        "abcd.key.43.tmp",
        "other.txt",
      ]) {
        writeFileSync(join(outside, name), "");
      }
      recordStarted(runRoot, { keyFiles: [join(outside, "abc.key")] });
      await cleanUpRun(runRoot);
      return readdirSync(outside).sort();
    });
    expect(left).toEqual(["abcd.key.43.tmp", "other.txt"]);
  });

  it("D1751: ends nothing and removes no recorded file when it cannot tell which processes are the run's", async () => {
    const kept = await inRunRoot(async (runRoot, outside) => {
      const key = join(outside, "abc.key");
      writeFileSync(key, "");
      recordStarted(runRoot, { pids: [process.pid], keyFiles: [key] });
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      Object.defineProperty(process, "platform", {
        ...platform,
        value: "win32",
      });
      vi.stubEnv("SystemRoot", undefined);
      try {
        await cleanUpRun(runRoot).catch(() => undefined);
      } finally {
        Object.defineProperty(process, "platform", platform);
        vi.unstubAllEnvs();
      }
      return existsSync(key);
    });
    expect(kept).toBe(true);
  });

  it("D1758: records a relative path resolved, so a cleanup from another working directory finds it", async () => {
    const files = await inRunRoot(async (runRoot) => {
      recordStarted(runRoot, { files: ["daemon.sock"] });
      return recorded(runRoot).flatMap((entry) => entry.files ?? []);
    });
    expect(files).toEqual([join(process.cwd(), "daemon.sock")]);
  });

  it("D1752: sweeps a run whose process has ended and leaves a run whose process still runs", async () => {
    const prefix = `rt-test-sweep-${randomUUID()}-`;
    const endedRun = join(tmpdir(), `${prefix}${await endedProcessId()}-a`);
    const liveRun = join(tmpdir(), `${prefix}${process.pid}-b`);
    mkdirSync(endedRun);
    mkdirSync(liveRun);
    let left: boolean[];
    try {
      await sweepEndedRuns(prefix);
      left = [existsSync(endedRun), existsSync(liveRun)];
    } finally {
      rmSync(endedRun, { recursive: true, force: true });
      rmSync(liveRun, { recursive: true, force: true });
    }
    expect(left).toEqual([false, true]);
  });

  it("D1753: fails to guard a run when the watchdog exits before it is ready", async () => {
    vi.stubEnv("NODE_OPTIONS", "--no-such-option");
    let outcome: string;
    try {
      outcome = await inRunRoot((runRoot) =>
        guardRun(runRoot).then(
          () => "ready",
          (error: Error) => error.message,
        ),
      );
    } finally {
      vi.unstubAllEnvs();
    }
    expect(outcome).toMatch(/watchdog exited with \d+ before it was ready/);
  });

  it("D1750: ends a killed run's recorded processes and removes its directory once the run's process dies", async () => {
    const cleaned = await inRunRoot(async (runRoot) => {
      const run = spawn(process.execPath, [GUARDED_RUN, runRoot], {
        cwd: tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let daemon: number | undefined;
      try {
        daemon = Number(await firstLine(run, "the guarded run"));
        run.kill("SIGKILL");
        const ended = await endsWithin(daemon, WATCHDOG_WAIT_MS);
        const removed =
          ended &&
          (await holdsWithin(() => !existsSync(runRoot), WATCHDOG_WAIT_MS));
        return [ended, removed];
      } finally {
        run.kill("SIGKILL");
        if (daemon !== undefined) endOwnedProcesses([runRoot], [daemon]);
      }
    });
    expect(cleaned).toEqual([true, true]);
  });

  it("D1754: fails the run's teardown naming a recorded process it had to end", async () => {
    const result = await withDaemonRunSetup(async (runRoot, teardown) => {
      const owned = idleProcess([runRoot]);
      return withProcesses([owned], async () => {
        recordStarted(runRoot, { pids: [owned] });
        const outcome = await teardown().then(
          () => "passed",
          (error: Error) => error.message,
        );
        return { owned, outcome };
      });
    });
    expect(result.outcome).toContain(`and was ended: ${result.owned}`);
  });

  it("D1775: starts a run watchdog before the daemon suite runs", async () => {
    const watchdogs = await withDaemonRunSetup(async (runRoot) =>
      watchdogsOf(runRoot),
    );
    expect(watchdogs).toHaveLength(1);
  });

  it("D1776: cleans up, before the daemon suite runs, what an ended run left", async () => {
    // A private temp directory, since every daemon-suite setup running beside this test sweeps the shared one.
    const temp = mkdtempSync(join(tmpdir(), "rt-test-sweep-home-"));
    const leftover = join(
      temp,
      `${DAEMON_RUN_PREFIX}${await endedProcessId()}-${randomUUID()}`,
    );
    mkdirSync(leftover);
    for (const name of TEMP_VARIABLES) vi.stubEnv(name, temp);
    let left: boolean;
    try {
      left = await withDaemonRunSetup(async () => existsSync(leftover));
    } finally {
      vi.unstubAllEnvs();
      rmSync(temp, { recursive: true, force: true });
    }
    expect(left).toBe(false);
  });

  it("D1780: ends a process named in a recorded pid file, such as a fixture's executor", async () => {
    const ended = await inRunRoot(async (runRoot, outside) => {
      const executor = idleProcess([runRoot]);
      return withProcesses([executor], async () => {
        const pidFile = join(outside, "executor-pids");
        writeFileSync(pidFile, `${executor}\n`);
        recordStarted(runRoot, { pidFiles: [pidFile] });
        await cleanUpRun(runRoot);
        return endsWithin(executor, STOP_WAIT_MS);
      });
    });
    expect(ended).toBe(true);
  });

  it("D1781: ends the process holding a lock in a recorded lock directory, such as a daemon's store lock", async () => {
    const ended = await inRunRoot(async (runRoot, outside) => {
      const daemon = idleProcess([runRoot]);
      return withProcesses([daemon], async () => {
        writeFileSync(join(outside, "store.lock"), String(daemon));
        recordStarted(runRoot, { lockDirectories: [outside] });
        await cleanUpRun(runRoot);
        return endsWithin(daemon, STOP_WAIT_MS);
      });
    });
    expect(ended).toBe(true);
  });
});

describe("ending a recorded process", PROCESS_SCENARIO, () => {
  it("D2440: spares a live process whose start time no longer matches its record, as one that took a recorded id", async () => {
    const ended = await inRunRoot(async (runRoot) => {
      const holder = idleProcess([runRoot]);
      return withProcesses([holder], async () => {
        const record = processRecords([holder]).get(holder)!;
        endRecorded([{ ...record, startedAt: record.startedAt + 1n }]);
        return endsWithin(holder, SPARE_WAIT_MS);
      });
    });
    expect(ended).toBe(false);
  });

  it("D2441: ends a live process whose start time matches its record", async () => {
    const ended = await inRunRoot(async (runRoot) => {
      const recorded = idleProcess([runRoot]);
      return withProcesses([recorded], async () => {
        endRecorded([processRecords([recorded]).get(recorded)!]);
        return endsWithin(recorded, STOP_WAIT_MS);
      });
    });
    expect(ended).toBe(true);
  });

  it("D2443: ends a process naming nothing of the run while the live process that started it lies inside the run", async () => {
    const ended = await inRunRoot(async (runRoot) => {
      const starter = childStarter(runRoot);
      try {
        const executor = Number(await firstLine(starter, "the child starter"));
        endOwnedProcesses([runRoot], [executor]);
        return await endsWithin(executor, STOP_WAIT_MS);
      } finally {
        await endStarter(starter);
      }
    });
    expect(ended).toBe(true);
  });

  it("D2445: leaves alone a running process that no idle process handle of its own started", async () => {
    const other = spawn(process.execPath, ["-e", IDLE_SCRIPT], {
      stdio: "ignore",
      windowsHide: true,
    });
    let ended: boolean;
    try {
      endAll([other.pid!]);
      ended = await endsWithin(other.pid!, SPARE_WAIT_MS);
    } finally {
      other.kill("SIGKILL");
    }
    expect(ended).toBe(false);
  });
});

describe(
  "the daemon harness's record of what a run starts",
  PROCESS_SCENARIO,
  () => {
    it("D1755: records each daemon process id a test adds before the test can lose it", async () => {
      const result = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, () =>
          withDaemons([consumer], async (pids) => {
            const daemon = idleProcess([consumer]);
            pids.add(daemon);
            const ids = recorded(runRoot).flatMap((entry) => entry.pids ?? []);
            return { daemon, ids };
          }),
        ),
      );
      expect(result.ids).toEqual([result.daemon]);
    });

    it("D1756: records where each root's daemon would hold its store lock before the test body runs", async () => {
      const result = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, () =>
          withDaemons([consumer], async () => ({
            stateDirectory: join(consumer, ".rt-test"),
            locks: recorded(runRoot).flatMap(
              (entry) => entry.lockDirectories ?? [],
            ),
          })),
        ),
      );
      expect(result.locks).toContain(result.stateDirectory);
    });

    it("D1778: records where each root's executors write their process ids before the test body runs", async () => {
      const result = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, () =>
          withDaemons([consumer], async () => ({
            executorPids: join(consumer, "packages", "a", "executor-pids"),
            pidFiles: recorded(runRoot).flatMap(
              (entry) => entry.pidFiles ?? [],
            ),
          })),
        ),
      );
      expect(result.pidFiles).toContain(result.executorPids);
    });

    it("D1779: records each root's daemon key before the test body runs", async () => {
      const result = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, () =>
          withDaemons([consumer], async () => {
            const location = clientEndpoint(
              consumerIdentity(consumer).worktreeIdentity,
            );
            if (!location.ok) throw new Error(location.reason);
            return {
              key: resolve(location.keyFile),
              keys: recorded(runRoot).flatMap((entry) => entry.keyFiles ?? []),
            };
          }),
        ),
      );
      expect(result.keys).toEqual([result.key]);
    });

    it("D1774: records a trusted start's state directory before the daemon can start", async () => {
      const result = await inRunRoot((runRoot, outside) =>
        providingRunRoot(runRoot, async () => {
          const stateDirectory = join(outside, "state");
          const missingRoot = join(outside, "no-such-consumer");
          await trustedStart(confirmNothing(missingRoot), stateDirectory).catch(
            () => undefined,
          );
          const locks = recorded(runRoot).flatMap(
            (entry) => entry.lockDirectories ?? [],
          );
          return { stateDirectory, locks };
        }),
      );
      expect(result.locks).toContain(result.stateDirectory);
    });

    it("D1761: records a stand-in daemon's key before it listens on the worktree's endpoint", async () => {
      const result = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, () => {
          const identity = consumerIdentity(consumer).worktreeIdentity;
          const location = clientEndpoint(identity);
          if (!location.ok) throw new Error(location.reason);
          return withStandIn(
            identity,
            () => undefined,
            async () => ({
              key: resolve(location.keyFile),
              keys: recorded(runRoot).flatMap((entry) => entry.keyFiles ?? []),
            }),
          );
        }),
      );
      expect(result.keys).toEqual([result.key]);
    });

    it("D2442: spares a recorded daemon id that a process outside the consumer now holds", async () => {
      const ended = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, async () => {
          const stranger = idleProcess();
          return withProcesses([stranger], async () => {
            await withDaemons([consumer], async (pids) => {
              pids.add(stranger);
            });
            return endsWithin(stranger, SPARE_WAIT_MS);
          });
        }),
      );
      expect(ended).toBe(false);
    });

    it("D2496: keeps a failed test's own error when ending its daemons fails too", async () => {
      const surfaced = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, async () => {
          const daemon = idleProcess([consumer]);
          const platform = Object.getOwnPropertyDescriptor(
            process,
            "platform",
          )!;
          try {
            return await withDaemons([consumer], async (pids) => {
              pids.add(daemon);
              Object.defineProperty(process, "platform", {
                ...platform,
                value: "win32",
              });
              vi.stubEnv("SystemRoot", undefined);
              throw new Error("the test body failed");
            }).then(
              () => ["passed"],
              (error: Error) =>
                error instanceof AggregateError
                  ? error.errors.map((each: Error) => each.message)
                  : [error.message],
            );
          } finally {
            Object.defineProperty(process, "platform", platform);
            vi.unstubAllEnvs();
            endAll([daemon]);
          }
        }),
      );
      expect(surfaced[0]).toBe("the test body failed");
    });

    it("D2474: keeps the consumer's daemon key while a recorded id still runs that it could not prove the test's", async () => {
      const kept = await inRunRoot((runRoot, consumer) =>
        providingRunRoot(runRoot, async () => {
          const identity = consumerIdentity(consumer).worktreeIdentity;
          const location = clientEndpoint(identity);
          if (!location.ok) throw new Error(location.reason);
          const created = createDaemonKey(location, identity);
          if (!created.ok) throw new Error(created.reason);
          const stranger = idleProcess();
          try {
            await withDaemons([consumer], async (pids) => {
              pids.add(stranger);
            });
            return existsSync(location.keyFile);
          } finally {
            endAll([stranger]);
            created.key.remove();
          }
        }),
      );
      expect(kept).toBe(true);
    });
  },
);
