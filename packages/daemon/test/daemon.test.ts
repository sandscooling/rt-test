import { fork, spawn, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  daemonStatus,
  startDaemon,
  stopDaemon,
  type DaemonIdentity,
} from "../src/client.js";
import { clientEndpoint, listenOnEndpoint } from "../src/daemon/endpoint.js";
import { daemonEntryPoint } from "../src/daemon/entry-point.js";
import { EXECUTOR_BOUND_MS } from "../src/daemon/executor-jobs.js";
import { RESPONSE_BOUND_MS } from "../src/daemon/protocol.js";
import { isRunning } from "../src/daemon/runtime-directory.js";
import { consumerIdentity } from "../src/store/consumer-identity.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  DAEMON_FIXTURE,
  IDLE_ENTRY,
  RawConnection,
  WORKSPACE_A,
  WORKSPACE_B,
  confirmNothing,
  eventually,
  executorPids,
  fixtureFile,
  holdAt,
  logEntries,
  logged,
  settled,
  storedRuns,
  trustedStart,
  withDaemonConsumer,
  withDaemons,
  type Settled,
} from "./daemon-harness.js";
import {
  REPO,
  confirmEvery,
  copyFixture,
  inTempDir,
  linkVitest,
  linkedWorktree,
  mainCheckout,
} from "./harness.js";

const CLIENT = fileURLToPath(new URL("../src/client.ts", import.meta.url));
const FIXTURES = join(REPO, "test/fixtures/daemon");
/** The Node flags a process needs to load this package from source, as the daemon's own entry points do. */
const SOURCE_FLAGS = daemonEntryPoint("daemon-main").execArgv;
const STOP_LINE = '{"type":"stop"}\n';
const NEXT_PROTOCOL_VERSION = 2;
/** A module of the Vitest package, as opposed to this package's own `src/vitest/`. */
const VITEST_PACKAGE_URL =
  /\/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?vitest\//;
/** A stop that polls every 100 ms has probed the endpoint again well within this. */
const PROBE_BOUND_MS = 5_000;

/** Starts a daemon for `root`, adding its process id to `pids` so the test ends it whatever happens. */
async function started(
  root: string,
  pids: Set<number>,
  start = confirmNothing(root),
): Promise<Settled<DaemonIdentity>> {
  const identity = await settled(trustedStart(start));
  if (!("thrown" in identity)) pids.add(identity.pid);
  return identity;
}

function endpointOf(identity: DaemonIdentity): string {
  const location = clientEndpoint(identity.worktreeIdentity);
  if (!location.ok) throw new Error(location.reason);
  return location.path;
}

/** Whether the daemon's process has exited and its endpoint accepts no connection. */
async function gone(identity: DaemonIdentity): Promise<boolean> {
  if (isRunning(identity.pid)) return false;
  return RawConnection.open(endpointOf(identity)).then(
    (connection) => {
      connection.close();
      return false;
    },
    () => true,
  );
}

describe("a client with no daemon to talk to", () => {
  it("D1483: a status request with no daemon serving the worktree rejects, naming the consumer root", async () => {
    const outcome = await inTempDir(async (root) => ({
      root,
      status: await settled(daemonStatus(root)),
    }));
    expect(outcome.status).toStrictEqual({
      thrown: expect.stringContaining(outcome.root),
    });
  });

  it("D1484: a stop with no daemon serving the worktree rejects, naming the consumer root", async () => {
    const outcome = await inTempDir(async (root) => ({
      root,
      stop: await settled(stopDaemon(root)),
    }));
    expect(outcome.stop).toStrictEqual({
      thrown: expect.stringContaining(outcome.root),
    });
  });

  it("D1485: loading the client loads neither node:sqlite nor any Vitest module", () => {
    const listed = spawnSync(
      process.execPath,
      [
        ...SOURCE_FLAGS,
        "--import",
        pathToFileURL(join(FIXTURES, "list-modules.mjs")).href,
        "--input-type=module",
        "--eval",
        `await import(${JSON.stringify(pathToFileURL(CLIENT).href)});`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const modules = JSON.parse(listed.stdout || "[]") as string[];
    expect({
      status: listed.status,
      clientLoaded: modules.includes(pathToFileURL(CLIENT).href),
      forbidden: modules.filter(
        (url) => url === "node:sqlite" || VITEST_PACKAGE_URL.test(url),
      ),
    }).toStrictEqual({ status: 0, clientLoaded: true, forbidden: [] });
  });

  it(
    "D1537: a stop keeps waiting while the endpoint still accepts connections after the daemon's process has exited",
    async () => {
      const outcome = await inTempDir(async (root) => {
        const exitedPid = spawnSync(process.execPath, ["-e", ""]).pid;
        const sockets = new Set<Socket>();
        let connections = 0;
        const listening = await listenOnEndpoint(
          consumerIdentity(root).worktreeIdentity,
          (socket) => {
            connections += 1;
            sockets.add(socket);
            socket.on("error", () => undefined);
            socket.on("data", () => {
              socket.write(
                `${JSON.stringify({ type: "stopping", pid: exitedPid, logFile: "stand-in.log" })}\n`,
              );
            });
          },
        );
        if (!listening.ok) return { thrown: listening.reason };
        let stopSettled = false;
        const stop = settled(stopDaemon(root)).finally(() => {
          stopSettled = true;
        });
        const probed = await eventually(() => connections >= 2, PROBE_BOUND_MS);
        const waiting = !stopSettled;
        for (const socket of sockets) socket.destroy();
        await listening.close();
        return { probed, waiting, stop: await stop };
      });
      expect(outcome).toStrictEqual({
        probed: true,
        waiting: true,
        stop: undefined,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("starting a daemon", () => {
  it(
    "D1486: a start that does not state the project is trusted is refused, and no daemon serves the worktree",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const start = await settled(
          startDaemon({
            trusted: false as unknown as true,
            start: confirmNothing(root),
          }),
        );
        if (!("thrown" in start)) pids.add(start.pid);
        return {
          start,
          serving: !("thrown" in (await settled(daemonStatus(root)))),
        };
      });
      expect(outcome).toStrictEqual({
        start: {
          thrown: expect.stringContaining(
            "did not state that the project is trusted",
          ),
        },
        serving: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1487: a start resolves with the daemon's process, the worktree's identities, the default state directory under the root and the protocol version",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        return {
          actual: {
            running: isRunning(identity.pid),
            consumerRoot: identity.consumerRoot,
            projectIdentity: identity.projectIdentity,
            worktreeIdentity: identity.worktreeIdentity,
            stateDirectory: identity.stateDirectory,
            logDirectory: dirname(identity.logFile),
            protocolVersion: identity.protocolVersion,
          },
          expected: {
            running: true,
            consumerRoot: root,
            ...consumerIdentity(root),
            stateDirectory: join(root, ".rt-test"),
            logDirectory: join(root, ".rt-test"),
            protocolVersion: 1,
          },
        };
      });
      expect("actual" in outcome ? outcome.actual : outcome).toStrictEqual(
        "expected" in outcome ? outcome.expected : {},
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1488: a relative consumer root and state directory resolve against the caller's working directory",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const caller = process.cwd();
        process.chdir(dirname(root));
        try {
          const identity = await settled(
            trustedStart(confirmNothing(basename(root)), "state"),
          );
          if ("thrown" in identity) return identity;
          pids.add(identity.pid);
          return {
            consumerRoot: identity.consumerRoot === root,
            stateDirectory:
              identity.stateDirectory === join(dirname(root), "state"),
          };
        } finally {
          process.chdir(caller);
        }
      });
      expect(outcome).toStrictEqual({
        consumerRoot: true,
        stateDirectory: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1489: a start resolves while its discovery is still collecting",
    async () => {
      const activity = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold-collect");
        try {
          const identity = await started(root, pids, confirmEvery(root));
          if ("thrown" in identity) return identity;
          const status = await settled(daemonStatus(root));
          return "thrown" in status ? status : status.activity;
        } finally {
          holdAt(root, "release-collect");
        }
      });
      expect(activity).toStrictEqual({ state: "discovering" });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1490: the process that started a daemon exits on its own while the daemon keeps serving",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const starter = spawn(
          process.execPath,
          [
            ...SOURCE_FLAGS,
            join(FIXTURES, "start-and-exit.mjs"),
            CLIENT,
            JSON.stringify({ trusted: true, start: confirmNothing(root) }),
          ],
          { stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
        );
        let printed = "";
        starter.stdout.on("data", (chunk: Buffer) => {
          printed += chunk.toString("utf8");
        });
        try {
          const exited = await eventually(() => starter.exitCode !== null);
          const identity = JSON.parse(
            printed || "null",
          ) as DaemonIdentity | null;
          if (identity !== null) pids.add(identity.pid);
          const status = await settled(daemonStatus(root));
          return {
            exited,
            serving: !("thrown" in status) && status.pid === identity?.pid,
          };
        } finally {
          starter.kill("SIGKILL");
        }
      });
      expect(outcome).toStrictEqual({ exited: true, serving: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1534: a first startup message that is not a confirmed start is refused, saying so",
    async () => {
      const report = await inTempDir(async (root) => {
        const entry = daemonEntryPoint("daemon-main");
        const daemon = fork(entry.file, [root, join(root, "state")], {
          cwd: root,
          execArgv: [...entry.execArgv],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
        });
        try {
          const answered = new Promise<unknown>((resolve) => {
            daemon.once("message", resolve);
            daemon.once("exit", () => resolve("exited without a report"));
          });
          daemon.send({ type: "start" });
          return await answered;
        } finally {
          daemon.kill("SIGKILL");
          await eventually(
            () => daemon.exitCode !== null || daemon.signalCode !== null,
          );
        }
      });
      expect(report).toStrictEqual({
        type: "refused",
        reason: expect.stringContaining("is not a confirmed start"),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1498: a second start while a daemon serves the worktree is refused, naming the running daemon's process",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const first = await started(root, pids);
        if ("thrown" in first) return first;
        return { pid: first.pid, second: await started(root, pids) };
      });
      const pid = "pid" in outcome ? outcome.pid : Number.NaN;
      expect(outcome).toStrictEqual({
        pid,
        second: { thrown: expect.stringContaining(`process ${pid}`) },
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1504: the log records the start, naming the consumer root, state directory, process and protocol version, and the stop",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        await settled(stopDaemon(root));
        return {
          entries: logEntries(identity.logFile).filter(
            (entry) => entry.startsWith("start") || entry === "stopped",
          ),
          expected: [
            `start: consumer root ${root}, state directory ${join(root, ".rt-test")}, process ${identity.pid}, protocol version 1`,
            "stopped",
          ],
        };
      });
      expect("entries" in outcome ? outcome.entries : outcome).toStrictEqual(
        "expected" in outcome ? outcome.expected : [],
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("stopping a daemon", () => {
  it(
    "D1491: a stop resolves only once the daemon's process has exited and its endpoint accepts no connection",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const stop = await settled(stopDaemon(root));
        return {
          stop,
          running: isRunning(identity.pid),
          endpointAnswers: !(await gone(identity)) && !isRunning(identity.pid),
        };
      });
      expect(outcome).toStrictEqual({
        stop: undefined,
        running: false,
        endpointAnswers: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1492: a run in progress when the stop arrives is stored as interrupted, and the next workspace is never run",
    async () => {
      const runs = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await eventually(() => existsSync(fixtureFile(root, "holding")));
        await settled(stopDaemon(root));
        return storedRuns(identity.stateDirectory, root);
      });
      expect(runs).toStrictEqual([[WORKSPACE_A, "interrupted"]]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1493: a job stuck in a synchronous global setup at the stop is ended at the executor bound, stores nothing, and the daemon exits",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        writeFileSync(fixtureFile(root, "stick-at"), "2");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await eventually(() => existsSync(fixtureFile(root, "stuck")));
        const stop = await settled(stopDaemon(root));
        return {
          stop,
          runs: storedRuns(identity.stateDirectory, root),
          ended: logEntries(identity.logFile).some((entry) =>
            entry.includes(
              `had not ended ${EXECUTOR_BOUND_MS} ms after its abort`,
            ),
          ),
        };
      });
      expect(outcome).toStrictEqual({ stop: undefined, runs: [], ended: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1501: the stop sent as a connection's first line, with no hello, is acknowledged and stops the daemon",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const connection = await RawConnection.open(endpointOf(identity));
        try {
          connection.send(STOP_LINE);
          const ack = await connection.next();
          return {
            ack,
            gone: await eventually(() => gone(identity)),
            expected: {
              type: "stopping",
              pid: identity.pid,
              logFile: identity.logFile,
            },
          };
        } finally {
          connection.close();
        }
      });
      expect(outcome).toStrictEqual({
        ack: "expected" in outcome ? outcome.expected : {},
        gone: true,
        expected: "expected" in outcome ? outcome.expected : {},
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1502: after a hello of another protocol version is refused with both versions and the process, the stop on that connection stops the daemon",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const connection = await RawConnection.open(endpointOf(identity));
        try {
          connection.sendLine({
            type: "hello",
            protocolVersion: NEXT_PROTOCOL_VERSION,
          });
          const refusal = await connection.next();
          connection.send(STOP_LINE);
          const ack = await connection.next();
          return {
            refusal,
            ack: ack === "closed" ? ack : ack["type"],
            gone: await eventually(() => gone(identity)),
            pid: identity.pid,
          };
        } finally {
          connection.close();
        }
      });
      const pid = "pid" in outcome ? outcome.pid : Number.NaN;
      expect(outcome).toStrictEqual({
        refusal: {
          type: "error",
          code: "protocol-version-mismatch",
          message: expect.any(String),
          protocolVersion: 1,
          clientProtocolVersion: NEXT_PROTOCOL_VERSION,
          pid,
        },
        ack: "stopping",
        gone: true,
        pid,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D1503: a start that finds a daemon of another protocol version is refused, naming its process and version and saying it can be stopped", async () => {
    const start = await inTempDir(async (root) => {
      const sockets = new Set<Socket>();
      const listening = await listenOnEndpoint(
        consumerIdentity(root).worktreeIdentity,
        (socket) => {
          sockets.add(socket);
          socket.on("data", () => {
            socket.write(
              `${JSON.stringify({
                type: "error",
                code: "protocol-version-mismatch",
                message: "another version",
                protocolVersion: NEXT_PROTOCOL_VERSION,
                clientProtocolVersion: 1,
                pid: 4242,
              })}\n`,
            );
          });
        },
      );
      if (!listening.ok) return { thrown: listening.reason };
      try {
        return await settled(
          startDaemon({ trusted: true, start: confirmNothing(root) }),
        );
      } finally {
        for (const socket of sockets) socket.destroy();
        await listening.close();
      }
    });
    expect(start).toStrictEqual({
      thrown: expect.stringMatching(
        /process 4242\b.*protocol version 2\b.*can be stopped/,
      ),
    });
  });
});

describe("the executor process", () => {
  it(
    "D1494: status answers within the response bound while discovery is stuck in a synchronous global setup",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        writeFileSync(fixtureFile(root, "stick-at"), "1");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await eventually(() => existsSync(fixtureFile(root, "stuck")));
        const asked = Date.now();
        const status = await settled(daemonStatus(root));
        return {
          activity: "thrown" in status ? status : status.activity,
          inTime: Date.now() - asked < RESPONSE_BOUND_MS,
        };
      });
      expect(outcome).toStrictEqual({
        activity: { state: "discovering" },
        inTime: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1495: an executor killed mid-run stores nothing for that run, is listed, and the next workspace still runs",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await eventually(() => existsSync(fixtureFile(root, "holding")));
        for (const pid of new Set(executorPids(root))) {
          process.kill(pid, "SIGKILL");
        }
        await eventually(() => logged(identity.logFile, IDLE_ENTRY));
        const status = await settled(daemonStatus(root));
        return {
          unstored:
            "thrown" in status
              ? status
              : status.unstoredJobs.map((job) => job.workspacePath),
          runs: storedRuns(identity.stateDirectory, root),
        };
      });
      expect(outcome).toStrictEqual({
        unstored: [WORKSPACE_A],
        runs: [[WORKSPACE_B, "completed"]],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1496: an executor whose channel to the daemon closes mid-run, as when the daemon is killed, ends within the executor bound",
    async () => {
      // Windows ends a killed daemon's children itself, so the channel is closed from this side instead.
      const ended = await withDaemonConsumer(async (root) => {
        holdAt(root, "hold");
        const entry = daemonEntryPoint("executor-main");
        const executor = fork(entry.file, [], {
          cwd: root,
          execArgv: [...entry.execArgv],
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
        });
        try {
          executor.send({
            type: "run",
            workspace: {
              path: WORKSPACE_A,
              directory: join(root, WORKSPACE_A),
            },
            configFile: `${WORKSPACE_A}/vitest.config.mjs`,
          });
          await eventually(() => existsSync(fixtureFile(root, "holding")));
          executor.disconnect();
          return await eventually(
            () => executor.exitCode !== null || executor.signalCode !== null,
            EXECUTOR_BOUND_MS,
          );
        } finally {
          executor.kill("SIGKILL");
        }
      });
      expect(ended).toBe(true);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1497: SIGTERM mid-run stops the daemon as a stop request does, storing the run in progress as interrupted",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        const identity = await withNodeOptions(
          `--import=${pathToFileURL(join(FIXTURES, "emit-sigterm.mjs")).href}`,
          () => started(root, pids, confirmEvery(root)),
        );
        if ("thrown" in identity) return identity;
        await eventually(() => existsSync(fixtureFile(root, "holding")));
        writeFileSync(join(identity.stateDirectory, "emit-sigterm"), "");
        return {
          exited: await eventually(() => !isRunning(identity.pid)),
          runs: storedRuns(identity.stateDirectory, root),
        };
      });
      expect(outcome).toStrictEqual({
        exited: true,
        runs: [[WORKSPACE_A, "interrupted"]],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("two worktrees of one project", () => {
  it(
    "D1500: the daemons of two worktrees serve at once on one state directory, and each worktree reads back only its own runs",
    async () => {
      const outcome = await inTempDir(async (dir) => {
        const main = mainCheckout(dir);
        const feature = linkedWorktree(main, "feature", (gitdir) => gitdir);
        for (const root of [main, feature]) {
          copyFixture(DAEMON_FIXTURE, root);
          linkVitest(root, "vitest");
        }
        const state = join(dir, "state");
        return withDaemons([main, feature], async (pids) => {
          const identities: DaemonIdentity[] = [];
          for (const root of [main, feature]) {
            const identity = await settled(
              trustedStart(
                {
                  consumerRoot: root,
                  workspaces: [
                    {
                      path: WORKSPACE_B,
                      configFile: `${WORKSPACE_B}/vitest.config.mjs`,
                    },
                  ],
                },
                state,
              ),
            );
            if ("thrown" in identity) return identity;
            pids.add(identity.pid);
            identities.push(identity);
          }
          await eventually(() =>
            identities.every((identity) =>
              logged(identity.logFile, IDLE_ENTRY),
            ),
          );
          return {
            main: storedRuns(state, main),
            feature: storedRuns(state, feature),
          };
        });
      });
      expect(outcome).toStrictEqual({
        main: [[WORKSPACE_B, "completed"]],
        feature: [[WORKSPACE_B, "completed"]],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

/** Runs `body` with `options` added to NODE_OPTIONS, which every process a start spawns inherits. */
async function withNodeOptions<T>(
  options: string,
  body: () => Promise<T>,
): Promise<T> {
  const saved = process.env["NODE_OPTIONS"];
  process.env["NODE_OPTIONS"] = [saved, options].filter(Boolean).join(" ");
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env["NODE_OPTIONS"];
    else process.env["NODE_OPTIONS"] = saved;
  }
}
