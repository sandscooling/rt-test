import { fork, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  daemonStatus,
  startDaemon,
  stopDaemon,
  type DaemonIdentity,
} from "../src/client.js";
import { daemonLogFile } from "../src/daemon/daemon-log.js";
import type { DaemonKey } from "../src/daemon/endpoint-proof.js";
import { clientEndpoint, identityHash } from "../src/daemon/endpoint.js";
import { daemonEntryPoint } from "../src/daemon/entry-point.js";
import { EXECUTOR_BOUND_MS } from "../src/daemon/executor-jobs.js";
import { RESPONSE_BOUND_MS } from "../src/daemon/protocol.js";
import { isRunning } from "../src/daemon/runtime-directory.js";
import { consumerIdentity } from "../src/store/consumer-identity.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  atHoldPoint,
  DAEMON_FIXTURE,
  IDLE_ENTRY,
  RawConnection,
  WORKSPACE_A,
  WORKSPACE_B,
  confirmNothing,
  eventually,
  executorPids,
  fixtureFile,
  frozenProof,
  holdAt,
  logEntries,
  logged,
  settled,
  started,
  storedRuns,
  trustedStart,
  withDaemonConsumer,
  withDaemonKey,
  withDaemons,
  withStandIn,
  type StandIn,
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

function clientLocation(worktreeIdentity: string) {
  const location = clientEndpoint(worktreeIdentity);
  if (!location.ok) throw new Error(location.reason);
  return location;
}

function endpointOf(identity: DaemonIdentity): string {
  return clientLocation(identity.worktreeIdentity).path;
}

function keyFileOf(identity: DaemonIdentity): string {
  return clientLocation(identity.worktreeIdentity).keyFile;
}

/** The lock the daemon holds on its worktree's store, `daemon-<worktree hash>.lock` in the state directory. */
function storeLockOf(stateDirectory: string, worktreeIdentity: string): string {
  return join(stateDirectory, `daemon-${identityHash(worktreeIdentity)}.lock`);
}

/** The id of a process that has already exited, which no running process holds. */
function exitedPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How a client reports a process on the endpoint that does not prove itself this user's daemon for the root. */
function notTheDaemon(path: string, root: string): RegExp {
  return new RegExp(
    `The process answering on ${escaped(path)} is not this user's daemon for ${escaped(root)}: `,
  );
}

/** What a stand-in hands its answers to prove them: the key it holds, and the worktree it answers for. */
interface KeyContext {
  readonly worktree: string;
  readonly key: DaemonKey;
  readonly keyText: string;
}

type StandInAnswer = (
  request: Readonly<Record<string, unknown>>,
  standIn: StandIn,
) => object | undefined;

/**
 * Holds `root`'s real endpoint in its daemon's place, with a key for it written where the daemon keeps one, as a
 * daemon killed earlier leaves it, and removes both however `body` ends.
 */
function withKeyedStandIn<T>(
  root: string,
  answer: (context: KeyContext) => StandInAnswer,
  body: (standIn: StandIn) => Promise<T>,
): Promise<T> {
  const worktree = consumerIdentity(root).worktreeIdentity;
  return withDaemonKey(clientLocation(worktree), worktree, (key, keyText) =>
    withStandIn(worktree, answer({ worktree, key, keyText }), body),
  );
}

/** How a stand-in proves its answers: with the key it holds, with another key, or not at all. */
type Proving = "key" | "another key" | "no proof";

function proofField(
  proving: Proving,
  context: KeyContext,
  request: Readonly<Record<string, unknown>>,
  pid: number,
): { proof?: string } {
  if (proving === "no proof") return {};
  const keyText = proving === "key" ? context.keyText : "another key";
  return {
    proof: frozenProof(
      keyText,
      String(request["challenge"]),
      context.worktree,
      pid,
    ),
  };
}

/** Lets a stand-in's stop acknowledgement reach its client before it stops listening. */
const STAND_IN_CLOSE_MS = 100;

/**
 * Answers the hello, the status and the stop as a daemon of this version with process `pid` would, proving the hello
 * and the stop acknowledgement as `proving` says, and stops listening just after acknowledging a stop.
 */
function answerAs(pid: number, proving: Proving) {
  return (context: KeyContext): StandInAnswer =>
    (request, standIn) => {
      switch (request["type"]) {
        case "hello":
          return {
            type: "hello",
            protocolVersion: 1,
            pid,
            ...proofField(proving, context, request, pid),
          };
        case "status":
          return { type: "status", protocolVersion: 1, pid };
        case "stop":
          setTimeout(() => void standIn.close(), STAND_IN_CLOSE_MS);
          return {
            type: "stopping",
            pid,
            logFile: "stand-in.log",
            ...proofField(proving, context, request, pid),
          };
        default:
          return undefined;
      }
    };
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
      const pid = exitedPid();
      const outcome = await inTempDir((root) =>
        withKeyedStandIn(
          root,
          (context) => (request) =>
            request["type"] === "stop"
              ? {
                  type: "stopping",
                  pid,
                  logFile: "stand-in.log",
                  ...proofField("key", context, request, pid),
                }
              : undefined,
          async (standIn) => {
            let stopSettled = false;
            const stop = settled(stopDaemon(root)).finally(() => {
              stopSettled = true;
            });
            const probed = await eventually(
              () => standIn.connections >= 2,
              PROBE_BOUND_MS,
            );
            const waiting = !stopSettled;
            await standIn.close();
            return { probed, waiting, stop: await stop };
          },
        ),
      );
      expect(outcome).toStrictEqual({
        probed: true,
        waiting: true,
        stop: { pid },
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

/** Where a forked daemon writes what the handshake tests read. */
interface DaemonFiles {
  readonly logFile: string;
  readonly lockFile: string;
}

/**
 * Forks the daemon over `root` as a starter would, confirming every workspace, and hands `body` the daemon once it
 * has reported serving, before any acceptance is sent. Resolves with the report instead when it is not serving.
 */
async function withServingFork<T>(
  root: string,
  pids: Set<number>,
  body: (daemon: ChildProcess, files: DaemonFiles) => Promise<T>,
): Promise<T | { report: unknown }> {
  const stateDirectory = join(root, ".rt-test");
  mkdirSync(stateDirectory, { recursive: true });
  const entry = daemonEntryPoint("daemon-main");
  const daemon = fork(entry.file, [root, stateDirectory], {
    cwd: root,
    execArgv: [...entry.execArgv],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  if (daemon.pid !== undefined) pids.add(daemon.pid);
  try {
    const reported = new Promise<unknown>((resolve) => {
      daemon.once("message", resolve);
      daemon.once("exit", () => resolve("exited without a report"));
    });
    daemon.send({ type: "start", start: confirmEvery(root) });
    const report = await reported;
    if ((report as { type?: unknown } | null)?.type !== "serving") {
      return { report };
    }
    const worktree = consumerIdentity(root).worktreeIdentity;
    return await body(daemon, {
      logFile: daemonLogFile(stateDirectory, worktree),
      lockFile: storeLockOf(stateDirectory, worktree),
    });
  } finally {
    if (daemon.connected) daemon.disconnect();
  }
}

function exitedOf(daemon: ChildProcess): Promise<boolean> {
  return eventually(
    () => daemon.exitCode !== null || daemon.signalCode !== null,
  );
}

/** What a daemon whose start was never accepted leaves: it has exited, ran nothing and holds no lock. */
function abandonment(exited: boolean, files: DaemonFiles) {
  const entries = logEntries(files.logFile);
  return {
    exited,
    abandoned: entries.some((entry) => entry.startsWith("start abandoned")),
    discovered: entries.includes("discovery started"),
    locked: existsSync(files.lockFile),
  };
}

const ABANDONED = {
  exited: true,
  abandoned: true,
  discovered: false,
  locked: false,
};

describe("a start its starter never accepted", () => {
  it(
    "D1764: a daemon whose startup channel closes after its serving report, with no acceptance, exits having run nothing and holding no lock",
    async () => {
      const outcome = await withDaemonConsumer((root, pids) =>
        withServingFork(root, pids, async (daemon, files) => {
          daemon.disconnect();
          return abandonment(await exitedOf(daemon), files);
        }),
      );
      expect(outcome).toStrictEqual(ABANDONED);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1765: a daemon sent anything but the acceptance after its serving report exits having run nothing and holding no lock",
    async () => {
      const outcome = await withDaemonConsumer((root, pids) =>
        withServingFork(root, pids, async (daemon, files) => {
          daemon.send({ type: "not-begin" });
          return abandonment(await exitedOf(daemon), files);
        }),
      );
      expect(outcome).toStrictEqual(ABANDONED);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1766: a stop that arrives before the acceptance is not followed by discovery once the acceptance comes",
    async () => {
      const outcome = await withDaemonConsumer((root, pids) =>
        withServingFork(root, pids, async (daemon, files) => {
          const stop = settled(stopDaemon(root));
          const requested = await eventually(() =>
            logged(files.logFile, "stop requested"),
          );
          daemon.send({ type: "begin" });
          const stopped = await stop;
          return {
            requested,
            stopped: !("thrown" in stopped),
            exited: await exitedOf(daemon),
            discovered: logEntries(files.logFile).includes("discovery started"),
          };
        }),
      );
      expect(outcome).toStrictEqual({
        requested: true,
        stopped: true,
        exited: true,
        discovered: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1767: a daemon startDaemon has resolved with keeps running and runs its start sequence to idle, never abandoning the start",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const idle = await eventually(() =>
          logged(identity.logFile, IDLE_ENTRY),
        );
        return {
          idle,
          running: isRunning(identity.pid),
          abandoned: logged(identity.logFile, "start abandoned"),
        };
      });
      expect(outcome).toStrictEqual({
        idle: true,
        running: true,
        abandoned: false,
      });
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
          pid: identity.pid,
          stop,
          running: isRunning(identity.pid),
          endpointAnswers: !(await gone(identity)) && !isRunning(identity.pid),
        };
      });
      const pid = "pid" in outcome ? outcome.pid : Number.NaN;
      expect(outcome).toStrictEqual({
        pid,
        stop: { pid },
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
        await atHoldPoint(root, "holding");
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
        await atHoldPoint(root, "stuck");
        const stop = await settled(stopDaemon(root));
        return {
          pid: identity.pid,
          stop,
          runs: storedRuns(identity.stateDirectory, root),
          ended: logEntries(identity.logFile).some((entry) =>
            entry.includes(
              `had not ended ${EXECUTOR_BOUND_MS} ms after its abort`,
            ),
          ),
        };
      });
      const pid = "pid" in outcome ? outcome.pid : Number.NaN;
      expect(outcome).toStrictEqual({
        pid,
        stop: { pid },
        runs: [],
        ended: true,
      });
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
    const start = await inTempDir((root) =>
      withKeyedStandIn(
        root,
        (context) => (request) => ({
          type: "error",
          code: "protocol-version-mismatch",
          message: "another version",
          protocolVersion: NEXT_PROTOCOL_VERSION,
          clientProtocolVersion: 1,
          pid: 4242,
          ...proofField("key", context, request, 4242),
        }),
        () =>
          settled(startDaemon({ trusted: true, start: confirmNothing(root) })),
      ),
    );
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
        await atHoldPoint(root, "stuck");
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
        await atHoldPoint(root, "holding");
        for (const pid of new Set(executorPids(root))) {
          if (isRunning(pid)) process.kill(pid, "SIGKILL");
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
          await atHoldPoint(root, "holding");
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
        await atHoldPoint(root, "holding");
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

describe("a process on the endpoint that is not this user's daemon", () => {
  /** Holds `root`'s endpoint as an impostor proving as `proving` says, and hands `body` the endpoint's path. */
  function asImpostor<T>(
    root: string,
    proving: Proving,
    body: (path: string) => Promise<T>,
  ): Promise<T> {
    return withKeyedStandIn(root, answerAs(exitedPid(), proving), (standIn) =>
      body(standIn.endpoint.path),
    );
  }

  it("D1556: status refuses an impostor whose hello carries a proof made with another key, naming the endpoint", async () => {
    const outcome = await inTempDir((root) =>
      asImpostor(root, "another key", async (path) => ({
        status: await settled(daemonStatus(root)),
        expected: notTheDaemon(path, root),
      })),
    );
    expect(outcome.status).toStrictEqual({
      thrown: expect.stringMatching(outcome.expected),
    });
  });

  it("D1557: stop refuses an impostor whose acknowledgement names an exited process and carries a proof made with another key", async () => {
    const outcome = await inTempDir((root) =>
      asImpostor(root, "another key", async (path) => ({
        stop: await settled(stopDaemon(root)),
        expected: notTheDaemon(path, root),
      })),
    );
    expect(outcome.stop).toStrictEqual({
      thrown: expect.stringMatching(outcome.expected),
    });
  });

  it("D1558: a start refuses an impostor whose hello carries a proof made with another key, and spawns no daemon", async () => {
    const outcome = await inTempDir((root) =>
      asImpostor(root, "another key", async (path) => ({
        start: await settled(trustedStart(confirmNothing(root))),
        stateDirectoryMade: existsSync(join(root, ".rt-test")),
        expected: notTheDaemon(path, root),
      })),
    );
    expect({
      start: outcome.start,
      stateDirectoryMade: outcome.stateDirectoryMade,
    }).toStrictEqual({
      start: { thrown: expect.stringMatching(outcome.expected) },
      stateDirectoryMade: false,
    });
  });

  it("D1559: status refuses an impostor whose hello carries no proof, naming the endpoint", async () => {
    const outcome = await inTempDir((root) =>
      asImpostor(root, "no proof", async (path) => ({
        status: await settled(daemonStatus(root)),
        expected: notTheDaemon(path, root),
      })),
    );
    expect(outcome.status).toStrictEqual({
      thrown: expect.stringMatching(outcome.expected),
    });
  });

  it("D1560: stop refuses an impostor whose acknowledgement names an exited process and carries no proof", async () => {
    const outcome = await inTempDir((root) =>
      asImpostor(root, "no proof", async (path) => ({
        stop: await settled(stopDaemon(root)),
        expected: notTheDaemon(path, root),
      })),
    );
    expect(outcome.stop).toStrictEqual({
      thrown: expect.stringMatching(outcome.expected),
    });
  });

  it("D1561: a start refuses an impostor whose hello carries no proof, and spawns no daemon", async () => {
    const outcome = await inTempDir((root) =>
      asImpostor(root, "no proof", async (path) => ({
        start: await settled(trustedStart(confirmNothing(root))),
        stateDirectoryMade: existsSync(join(root, ".rt-test")),
        expected: notTheDaemon(path, root),
      })),
    );
    expect({
      start: outcome.start,
      stateDirectoryMade: outcome.stateDirectoryMade,
    }).toStrictEqual({
      start: { thrown: expect.stringMatching(outcome.expected) },
      stateDirectoryMade: false,
    });
  });

  it("D1571: a stop verifies a daemon that removes its key as it acknowledges, since the client read the key before sending", async () => {
    const pid = exitedPid();
    const stop = await inTempDir((root) =>
      withKeyedStandIn(
        root,
        (context) => (request, standIn) => {
          if (request["type"] !== "stop") return undefined;
          context.key.remove();
          setTimeout(() => void standIn.close(), STAND_IN_CLOSE_MS);
          return {
            type: "stopping",
            pid,
            logFile: "stand-in.log",
            ...proofField("key", context, request, pid),
          };
        },
        () => settled(stopDaemon(root)),
      ),
    );
    expect(stop).toStrictEqual({ pid });
  });
});

describe("the key and the store lock a daemon holds", () => {
  it(
    "D1572: a daemon's key file exists while it serves and is gone once its stop completes",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const serving = existsSync(keyFileOf(identity));
        await settled(stopDaemon(root));
        return { serving, stopped: existsSync(keyFileOf(identity)) };
      });
      expect(outcome).toStrictEqual({ serving: true, stopped: false });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1573: the store lock exists while the daemon serves and is gone once its stop completes",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const lock = storeLockOf(
          identity.stateDirectory,
          identity.worktreeIdentity,
        );
        const serving = existsSync(lock);
        await settled(stopDaemon(root));
        return { serving, stopped: existsSync(lock) };
      });
      expect(outcome).toStrictEqual({ serving: true, stopped: false });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1576: the store lock names the daemon's process for as long as it serves, not only while it starts",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const identity = await started(root, pids);
        if ("thrown" in identity) return identity;
        const lock = storeLockOf(
          identity.stateDirectory,
          identity.worktreeIdentity,
        );
        return {
          holder: existsSync(lock) ? readFileSync(lock, "utf8") : "no lock",
          pid: String(identity.pid),
        };
      });
      expect(outcome).toStrictEqual({
        holder: "pid" in outcome ? outcome.pid : "",
        pid: "pid" in outcome ? outcome.pid : "",
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1574: a killed daemon leaves its key, and the next start replaces it and proves itself",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const first = await started(root, pids);
        if ("thrown" in first) return first;
        process.kill(first.pid, "SIGKILL");
        await eventually(() => gone(first));
        const keyLeft = existsSync(keyFileOf(first));
        const second = await started(root, pids);
        if ("thrown" in second) return { keyLeft, second };
        const status = await settled(daemonStatus(root));
        return {
          keyLeft,
          serving: "thrown" in status ? status : status.pid === second.pid,
        };
      });
      expect(outcome).toStrictEqual({ keyLeft: true, serving: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1575: a start whose store lock names a running process is refused, naming that process and the lock file",
    async () => {
      const outcome = await startWithStoreLockHeld();
      expect(outcome.start).toStrictEqual({
        thrown: expect.stringMatching(
          new RegExp(`process ${process.pid}, holds ${escaped(outcome.lock)}`),
        ),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1689: the refusal of a start whose store lock is held calls the holder a daemon serving the worktree's store",
    async () => {
      const outcome = await startWithStoreLockHeld();
      expect(outcome.start).toStrictEqual({
        thrown: expect.stringContaining(
          `a daemon serving this worktree's store, process ${process.pid}, holds`,
        ),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

/** Starts a daemon for a fresh consumer whose store lock already names this running process. */
function startWithStoreLockHeld() {
  return withDaemonConsumer(async (root, pids) => {
    const stateDirectory = join(root, ".rt-test");
    const lock = storeLockOf(
      stateDirectory,
      consumerIdentity(root).worktreeIdentity,
    );
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(lock, String(process.pid));
    return { start: await started(root, pids), lock };
  });
}
