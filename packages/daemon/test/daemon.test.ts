import {
  fork,
  spawn,
  spawnSync,
  type ChildProcess,
  type StdioOptions,
} from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  crashError,
  listedModules,
  syncChildEnd,
  WatchedChild,
  type ChildEnd,
} from "../../../test/scripts/child-end.js";
import {
  DAEMON_FORKS_SUFFIX,
  GAINED_VARIABLE,
  HELD_AT_FORK,
  REPORT_VARIABLE,
} from "../../../test/fixtures/daemon/report-environment.mjs";
import { endOwnedProcesses } from "../../../test/scripts/run-cleanup.mjs";
import {
  daemonStatus,
  queryPathStatus,
  querySummary,
  startDaemon,
  stopDaemon,
  type DaemonIdentity,
} from "../src/client.js";
import { daemonLogFile } from "../src/daemon/daemon-log.js";
import type { DaemonKey } from "../src/daemon/endpoint-proof.js";
import { clientEndpoint, identityHash } from "../src/daemon/endpoint.js";
import { daemonEntryPoint } from "../src/daemon/entry-point.js";
import {
  EXECUTOR_BOUND_MS,
  type ExecutorRequest,
} from "../src/daemon/executor-jobs.js";
import { PROTOCOL_VERSION, RESPONSE_BOUND_MS } from "../src/daemon/protocol.js";
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
  endExecutors,
  eventually,
  fixtureFile,
  declareFixtureMarkers,
  holdAt,
  leakAtFirstRun,
  logEntries,
  logged,
  REPORT_ENVIRONMENT,
  reportedEnvironments,
  settled,
  started,
  storedRuns,
  trustedStart,
  until,
  withConnection,
  withDaemonConsumer,
  withDaemons,
  withEnvironment,
  withPreload,
  withStandIn,
  type StandIn,
} from "./daemon-harness.js";
import {
  frozenProof,
  KEY_TEST_OPTIONS,
  KEY_TEST_TIMEOUT_MS,
  withDaemonKey,
} from "./daemon-key.js";
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
/** How far past the executor's bound a loaded machine may end it. */
const LOADED_MARGIN_MS = 25_000;
/** A hold that outlives the executor's bound, so an executor nobody ends still finishes its run. */
const HOLD_LIFETIME_MS = EXECUTOR_BOUND_MS + LOADED_MARGIN_MS;
/** The marker the fixture writes once a hold's lifetime has run out. */
const HELD_OUT = "held-out";
/** A version the daemon does not speak, derived so that raising the daemon's own never makes it match. */
const NEXT_PROTOCOL_VERSION = PROTOCOL_VERSION + 1;
const STARTER = "the starter";
const FORKED_DAEMON = "the forked daemon";
const EXECUTOR = "the executor";
/** A forked child's stderr is kept, so a child that crashes names its cause. */
const FORKED_STDIO: StdioOptions = ["ignore", "ignore", "pipe", "ipc"];
/** The line Node ends its report of an uncaught exception or a failed startup with. */
const FATAL_ERROR_TRAILER = /^Node\.js v\d+\.\d+\.\d+/m;
/** How the executor exits once it has ended its own tree: `process.exit()` on Linux, `taskkill /F` on Windows. */
const OWN_TREE_EXIT_CODES: ReadonlySet<number> = new Set([0, 1]);
/** How a daemon exits once it has abandoned a start its starter never accepted. */
const ABANDONED_EXIT_CODES: ReadonlySet<number> = new Set([1]);
/** A module of the Vitest package, as opposed to this package's own `src/vitest/`. */
const VITEST_PACKAGE_URL =
  /\/node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?vitest\//;

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

/** How a stand-in proves its answers: with the key it holds, with another key, or not at all. */
type Proving = "key" | "another key" | "no proof";

/** How an impostor proves its answers. */
type ImpostorProving = Exclude<Proving, "key">;

/** Why a client refuses each impostor's answer, so a refusal for any other reason, such as an unchecked key directory, fails. */
const IMPOSTOR_REFUSAL: Readonly<Record<ImpostorProving, string>> = {
  "another key": "its proof does not match this worktree's daemon key",
  "no proof": "it answered without a proof",
};

/** How a client reports a process on the endpoint that does not prove itself this user's daemon for the root. */
function notTheDaemon(
  path: string,
  root: string,
  proving: ImpostorProving,
): RegExp {
  return new RegExp(
    `The process answering on ${escaped(path)} is not this user's daemon for ${escaped(root)}: ${escaped(IMPOSTOR_REFUSAL[proving])}`,
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
  connectionClosed: Promise<void>,
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

/**
 * Answers the hello, the status and the stop as a daemon of this version with process `pid` would, proving the hello
 * and the stop acknowledgement as `proving` says, and stops listening once the client that asked for the stop has
 * closed that connection, so its acknowledgement has been read.
 */
function answerAs(pid: number, proving: Proving) {
  return (context: KeyContext): StandInAnswer =>
    (request, standIn, connectionClosed) => {
      switch (request["type"]) {
        case "hello":
          return {
            type: "hello",
            protocolVersion: PROTOCOL_VERSION,
            pid,
            ...proofField(proving, context, request, pid),
          };
        case "status":
          return { type: "status", protocolVersion: PROTOCOL_VERSION, pid };
        case "stop":
          void connectionClosed.then(() => standIn.close());
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

/** The identity a starter that exited cleanly printed; any other end of the starter is a crash. */
function starterIdentity(end: ChildEnd): DaemonIdentity {
  if (end.code === 0 && end.signal === null) {
    try {
      const identity = JSON.parse(end.stdout) as DaemonIdentity | null;
      if (typeof identity?.pid === "number") return identity;
    } catch {
      // Stdout that is not JSON is reported with the crash below.
    }
  }
  throw crashError(STARTER, end);
}

/**
 * Whether `end` is an exit with one of `codes`, by no signal and with no report of an uncaught error on stderr. An
 * uncaught error exits with code 1 too, so only that report tells it from a deliberate exit 1.
 */
function exitedCleanWith(end: ChildEnd, codes: ReadonlySet<number>): boolean {
  return (
    end.signal === null &&
    end.code !== null &&
    codes.has(end.code) &&
    !FATAL_ERROR_TRAILER.test(end.stderr)
  );
}

/** Throws unless the executor ended by ending its own tree. */
function endedItsOwnTree(end: ChildEnd): void {
  if (!exitedCleanWith(end, OWN_TREE_EXIT_CODES)) {
    throw crashError(EXECUTOR, end);
  }
}

/** Whether the daemon has exited as an abandoned start does; any other exit is a crash. */
async function exitedAbandoned(watched: WatchedChild): Promise<boolean> {
  if (!(await eventually(() => watched.settled))) return false;
  const end = await watched.end;
  if (exitedCleanWith(end, ABANDONED_EXIT_CODES)) return true;
  throw crashError(FORKED_DAEMON, end);
}

/** A forked daemon's first startup report; a daemon that ends before sending one has crashed. */
function firstReport(
  daemon: ChildProcess,
  watched: WatchedChild,
): Promise<unknown> {
  return Promise.race([
    new Promise<unknown>((resolve) => daemon.once("message", resolve)),
    watched.end.then((end) => {
      throw crashError(FORKED_DAEMON, end);
    }),
  ]);
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
    const label = "the process that loads the client";
    const end = syncChildEnd(label, listed);
    if (end.code !== 0 || end.signal !== null) throw crashError(label, end);
    const modules = listedModules(label, end);
    expect({
      clientLoaded: modules.includes(pathToFileURL(CLIENT).href),
      forbidden: modules.filter(
        (url) => url === "node:sqlite" || VITEST_PACKAGE_URL.test(url),
      ),
    }).toStrictEqual({ clientLoaded: true, forbidden: [] });
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
            await until(() => stopSettled || standIn.connections >= 2);
            const probed = standIn.connections >= 2;
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
            protocolVersion: PROTOCOL_VERSION,
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
          { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
        );
        const watched = new WatchedChild(starter, STARTER);
        try {
          const exited = await eventually(() => watched.settled);
          const identity = exited
            ? starterIdentity(await watched.end)
            : (JSON.parse(watched.stdout || "null") as DaemonIdentity | null);
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
          stdio: FORKED_STDIO,
          windowsHide: true,
        });
        try {
          const answered = firstReport(
            daemon,
            new WatchedChild(daemon, FORKED_DAEMON),
          );
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
            `start: consumer root ${root}, state directory ${join(root, ".rt-test")}, process ${identity.pid}, protocol version ${PROTOCOL_VERSION}`,
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
  body: (
    daemon: ChildProcess,
    files: DaemonFiles,
    watched: WatchedChild,
  ) => Promise<T>,
): Promise<T | { report: unknown }> {
  const stateDirectory = join(root, ".rt-test");
  mkdirSync(stateDirectory, { recursive: true });
  const entry = daemonEntryPoint("daemon-main");
  const daemon = fork(entry.file, [root, stateDirectory], {
    cwd: root,
    execArgv: [...entry.execArgv],
    stdio: FORKED_STDIO,
    windowsHide: true,
  });
  if (daemon.pid !== undefined) pids.add(daemon.pid);
  const watched = new WatchedChild(daemon, FORKED_DAEMON);
  try {
    const reported = firstReport(daemon, watched);
    daemon.send({ type: "start", start: confirmEvery(root) });
    const report = await reported;
    if ((report as { type?: unknown } | null)?.type !== "serving") {
      return { report };
    }
    const worktree = consumerIdentity(root).worktreeIdentity;
    return await body(
      daemon,
      {
        logFile: daemonLogFile(stateDirectory, worktree),
        lockFile: storeLockOf(stateDirectory, worktree),
      },
      watched,
    );
  } finally {
    if (daemon.connected) daemon.disconnect();
  }
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
        withServingFork(root, pids, async (daemon, files, watched) => {
          daemon.disconnect();
          return abandonment(await exitedAbandoned(watched), files);
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
        withServingFork(root, pids, async (daemon, files, watched) => {
          daemon.send({ type: "not-begin" });
          return abandonment(await exitedAbandoned(watched), files);
        }),
      );
      expect(outcome).toStrictEqual(ABANDONED);
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
          protocolVersion: PROTOCOL_VERSION,
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

  it(
    "D1503: a start that finds a daemon of another protocol version is refused, naming its process and version and saying it can be stopped",
    async () => {
      const start = await inTempDir((root) =>
        withKeyedStandIn(
          root,
          (context) => (request) => ({
            type: "error",
            code: "protocol-version-mismatch",
            message: "another version",
            protocolVersion: NEXT_PROTOCOL_VERSION,
            clientProtocolVersion: PROTOCOL_VERSION,
            pid: 4242,
            ...proofField("key", context, request, 4242),
          }),
          () =>
            settled(
              startDaemon({ trusted: true, start: confirmNothing(root) }),
            ),
        ),
      );
      expect(start).toStrictEqual({
        thrown: expect.stringMatching(
          new RegExp(
            String.raw`process 4242\b.*protocol version ${NEXT_PROTOCOL_VERSION}\b.*can be stopped`,
          ),
        ),
      });
    },
    KEY_TEST_TIMEOUT_MS,
  );
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
    "D1495: an executor killed mid-run with no stop asked stores that run crashed, logged and not listed unstored, and the next workspace still runs",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await atHoldPoint(root, "holding");
        endExecutors([root]);
        await eventually(() => logged(identity.logFile, IDLE_ENTRY));
        const status = await settled(daemonStatus(root));
        return {
          unstored:
            "thrown" in status
              ? status
              : status.unstoredJobs.map((job) => job.workspacePath),
          runs: storedRuns(identity.stateDirectory, root),
          logged: logged(identity.logFile, `run ended: ${WORKSPACE_A} crashed`),
        };
      });
      expect(outcome).toStrictEqual({
        unstored: [],
        runs: [
          [WORKSPACE_A, "crashed"],
          [WORKSPACE_B, "completed"],
        ],
        logged: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1496: an executor whose channel to the daemon closes mid-run, as when the daemon is killed, ends within the executor bound",
    async () => {
      // Windows ends a killed daemon's children itself, so the channel is closed from this side instead.
      const ended = await withDaemonConsumer(async (root) => {
        writeFileSync(fixtureFile(root, "hold"), String(HOLD_LIFETIME_MS));
        const entry = daemonEntryPoint("executor-main");
        const executor = fork(entry.file, [], {
          cwd: root,
          execArgv: [...entry.execArgv],
          stdio: FORKED_STDIO,
          windowsHide: true,
        });
        const watched = new WatchedChild(executor, EXECUTOR);
        try {
          executor.send({
            type: "run",
            workspace: {
              path: WORKSPACE_A,
              directory: join(root, WORKSPACE_A),
            },
            configFile: `${WORKSPACE_A}/vitest.config.mjs`,
          } satisfies ExecutorRequest);
          const holding = () => existsSync(fixtureFile(root, "holding"));
          await until(() => watched.settled || holding());
          const endedBeforeDisconnect = watched.settled || !executor.connected;
          if (endedBeforeDisconnect) {
            throw crashError(EXECUTOR, await watched.end);
          }
          executor.disconnect();
          const heldOut = () => existsSync(fixtureFile(root, HELD_OUT));
          await until(() => watched.settled || heldOut());
          const held = heldOut();
          if (!held) endedItsOwnTree(await watched.end);
          return { exited: watched.settled, heldOut: held };
        } finally {
          executor.kill("SIGKILL");
        }
      });
      expect(ended).toStrictEqual({ exited: true, heldOut: false });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1497: SIGTERM mid-run stops the daemon as a stop request does, storing the run in progress as interrupted",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        const identity = await withPreload(
          join(FIXTURES, "emit-sigterm.mjs"),
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
          declareFixtureMarkers(root);
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

describe(
  "a process on the endpoint that is not this user's daemon",
  KEY_TEST_OPTIONS,
  () => {
    /** Holds `root`'s endpoint as an impostor proving as `proving` says, and hands `body` how a client refuses it. */
    function asImpostor<T>(
      root: string,
      proving: ImpostorProving,
      body: (expected: RegExp) => Promise<T>,
    ): Promise<T> {
      return withKeyedStandIn(root, answerAs(exitedPid(), proving), (standIn) =>
        body(notTheDaemon(standIn.endpoint.path, root, proving)),
      );
    }

    it("D1556: status refuses an impostor whose hello carries a proof made with another key, naming the endpoint and saying the proof does not match the key", async () => {
      const outcome = await inTempDir((root) =>
        asImpostor(root, "another key", async (expected) => ({
          status: await settled(daemonStatus(root)),
          expected,
        })),
      );
      expect(outcome.status).toStrictEqual({
        thrown: expect.stringMatching(outcome.expected),
      });
    });

    it("D1557: stop refuses an impostor whose acknowledgement names an exited process and carries a proof made with another key, saying the proof does not match the key", async () => {
      const outcome = await inTempDir((root) =>
        asImpostor(root, "another key", async (expected) => ({
          stop: await settled(stopDaemon(root)),
          expected,
        })),
      );
      expect(outcome.stop).toStrictEqual({
        thrown: expect.stringMatching(outcome.expected),
      });
    });

    it("D1558: a start refuses an impostor whose hello carries a proof made with another key, saying the proof does not match the key, and spawns no daemon", async () => {
      const outcome = await inTempDir((root) =>
        asImpostor(root, "another key", async (expected) => ({
          start: await settled(trustedStart(confirmNothing(root))),
          stateDirectoryMade: existsSync(join(root, ".rt-test")),
          expected,
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

    it("D1559: status refuses an impostor whose hello carries no proof, naming the endpoint and saying it answered without a proof", async () => {
      const outcome = await inTempDir((root) =>
        asImpostor(root, "no proof", async (expected) => ({
          status: await settled(daemonStatus(root)),
          expected,
        })),
      );
      expect(outcome.status).toStrictEqual({
        thrown: expect.stringMatching(outcome.expected),
      });
    });

    it("D1560: stop refuses an impostor whose acknowledgement names an exited process and carries no proof, saying it answered without a proof", async () => {
      const outcome = await inTempDir((root) =>
        asImpostor(root, "no proof", async (expected) => ({
          stop: await settled(stopDaemon(root)),
          expected,
        })),
      );
      expect(outcome.stop).toStrictEqual({
        thrown: expect.stringMatching(outcome.expected),
      });
    });

    it("D1561: a start refuses an impostor whose hello carries no proof, saying it answered without a proof, and spawns no daemon", async () => {
      const outcome = await inTempDir((root) =>
        asImpostor(root, "no proof", async (expected) => ({
          start: await settled(trustedStart(confirmNothing(root))),
          stateDirectoryMade: existsSync(join(root, ".rt-test")),
          expected,
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
          (context) => (request, standIn, connectionClosed) => {
            if (request["type"] !== "stop") return undefined;
            context.key.remove();
            void connectionClosed.then(() => standIn.close());
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
  },
);

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
        endOwnedProcesses([root], [first.pid]);
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

describe("a query to the worktree's daemon", () => {
  it(
    "D1844: a summary and a status sent while a workspace runs leave that run to complete and the next workspace still run",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await atHoldPoint(root, "holding");
        const summary = await settled(querySummary(root));
        const status = await settled(
          queryPathStatus(root, join(root, WORKSPACE_A)),
        );
        holdAt(root, "release");
        return {
          answered: !("thrown" in summary) && !("thrown" in status),
          idle: await eventually(() => logged(identity.logFile, IDLE_ENTRY)),
          runs: storedRuns(identity.stateDirectory, root),
        };
      });
      expect(outcome).toStrictEqual({
        answered: true,
        idle: true,
        runs: [
          [WORKSPACE_A, "completed"],
          [WORKSPACE_B, "completed"],
        ],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2767: a run whose global setup leaks a host rejection is stored completed, its tests passed and current and its summary counting the rejection",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        leakAtFirstRun(root);
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        const idle = await eventually(() =>
          logged(identity.logFile, IDLE_ENTRY),
        );
        const summary = await settled(querySummary(root));
        if ("thrown" in summary) return summary;
        const latestRun = summary.workspaces.find(
          (workspace) => workspace.workspacePath === WORKSPACE_A,
        )?.latestRun;
        return {
          idle,
          latestRun:
            latestRun?.status === "ran"
              ? {
                  execution: latestRun.execution,
                  unhandledErrors: latestRun.unhandledErrors,
                }
              : latestRun,
          passed: summary.counts.states.passed,
          current: summary.counts.freshness.current,
          unstoredJobs: summary.unstoredJobs,
        };
      });
      expect(outcome).toStrictEqual({
        idle: true,
        latestRun: { execution: "completed", unhandledErrors: 1 },
        passed: 2,
        current: 2,
        unstoredJobs: [],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2771: the line the executor writes for a host rejection during a run reaches the daemon's log, labelled",
    async () => {
      const lines = await withDaemonConsumer(async (root, pids) => {
        leakAtFirstRun(root);
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await eventually(() => logged(identity.logFile, IDLE_ENTRY));
        return logEntries(identity.logFile).filter((entry) =>
          entry.includes("host rejection from packages/a's setup"),
        );
      });
      expect(lines).toStrictEqual([
        expect.stringMatching(
          /^executor \d+: unhandled rejection on the host thread while the session was open: host rejection from packages\/a's setup$/,
        ),
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1845: a summary answered while a workspace runs carries the activity running that workspace",
    async () => {
      const activity = await withDaemonConsumer(async (root, pids) => {
        holdAt(root, "hold");
        try {
          const identity = await started(root, pids, confirmEvery(root));
          if ("thrown" in identity) return identity;
          await atHoldPoint(root, "holding");
          const summary = await settled(querySummary(root));
          return "thrown" in summary ? summary : summary.activity;
        } finally {
          holdAt(root, "release");
        }
      });
      expect(activity).toStrictEqual({
        state: "running",
        workspacePath: WORKSPACE_A,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  /** Holds `root`'s endpoint as a proving daemon that answers a summary with `error`, and asks it for a summary. */
  function summaryFromDaemonAnswering(
    root: string,
    error: object,
  ): Promise<unknown> {
    const daemon = answerAs(exitedPid(), "key");
    return withKeyedStandIn(
      root,
      (context) => (request, standIn, connectionClosed) =>
        request["type"] === "summary"
          ? { type: "error", ...error }
          : daemon(context)(request, standIn, connectionClosed),
      () => settled(querySummary(root)),
    );
  }

  it(
    "D1846: a daemon that predates the queries answers with its unknown-request error, and the reason says to stop it and start it again",
    async () => {
      const outcome = await inTempDir(async (root) => ({
        summary: await summaryFromDaemonAnswering(root, {
          code: "unknown-request",
          message: 'unknown request type "summary"',
        }),
        root,
      }));
      expect(outcome.summary).toStrictEqual({
        thrown: `The daemon serving ${outcome.root} predates this query; stop it and start it again.`,
      });
    },
    KEY_TEST_TIMEOUT_MS,
  );

  it(
    "D1847: a daemon that is stopping answers with its stopping error, and the reason says it is stopping",
    async () => {
      const outcome = await inTempDir(async (root) => ({
        summary: await summaryFromDaemonAnswering(root, {
          code: "stopping",
          message: "the daemon is stopping",
        }),
        root,
      }));
      expect(outcome.summary).toStrictEqual({
        thrown: `The daemon serving ${outcome.root} is stopping.`,
      });
    },
    KEY_TEST_TIMEOUT_MS,
  );

  it(
    "D1875: a daemon that proves its hello and then drops the connection before answering gives a reason naming the root",
    async () => {
      const outcome = await inTempDir(async (root) => {
        const daemon = answerAs(exitedPid(), "key");
        const summary = await withKeyedStandIn(
          root,
          (context) => (request, standIn, connectionClosed) => {
            if (request["type"] !== "summary") {
              return daemon(context)(request, standIn, connectionClosed);
            }
            void standIn.close();
            return undefined;
          },
          () => settled(querySummary(root)),
        );
        return { summary, root };
      });
      expect(outcome.summary).toStrictEqual({
        thrown: expect.stringContaining(outcome.root),
      });
    },
    KEY_TEST_TIMEOUT_MS,
  );
});

describe("a stand-in on the endpoint", () => {
  /**
   * How a test holding a stand-in that echoes each request settles once it has sent `line` and handed the answer to
   * `afterAnswer`.
   */
  function afterSending(
    line: string,
    afterAnswer: (answer: unknown) => unknown = (answer) => answer,
  ) {
    return inTempDir((root) =>
      settled(
        withStandIn(
          consumerIdentity(root).worktreeIdentity,
          (request) => ({ echoed: request }),
          (standIn) =>
            withConnection(standIn.endpoint.path, async (connection) => {
              connection.send(`${line}\n`);
              return afterAnswer(await connection.next());
            }),
        ),
      ),
    );
  }

  it("D2411: a request line that is not JSON fails the test that holds the stand-in, naming the line", async () => {
    expect(await afterSending("not json")).toStrictEqual({
      thrown: "the stand-in read a line that is not a JSON object: not json",
    });
  });

  it("D2415: a request line that is JSON but not an object fails the test that holds the stand-in, naming the line", async () => {
    expect(await afterSending("null")).toStrictEqual({
      thrown: "the stand-in read a line that is not a JSON object: null",
    });
  });

  it("D2414: a test body that fails after the stand-in read an unreadable line fails naming that line", async () => {
    const outcome = await afterSending("not json", () => {
      throw new Error("the test body's own failure");
    });
    expect(outcome).toStrictEqual({
      thrown: "the stand-in read a line that is not a JSON object: not json",
    });
  });
});

/** How many times the log says a round left no workspace due. */
function idleCount(logFile: string): number {
  return logEntries(logFile).filter((entry) => entry === IDLE_ENTRY).length;
}

/** How many runs the store holds for each workspace of the worktree at `root`. */
function runCounts(
  stateDirectory: string,
  root: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [path] of storedRuns(stateDirectory, root)) {
    if (path !== undefined) counts[path] = (counts[path] ?? 0) + 1;
  }
  return counts;
}

describe("what a daemon runs after a start and after an edit", () => {
  it(
    "D2691: a daemon restarted over results that read current runs no workspace",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const first = await started(root, pids, confirmEvery(root));
        if ("thrown" in first) return first;
        await eventually(() => idleCount(first.logFile) >= 1);
        await settled(stopDaemon(root));
        const before = runCounts(first.stateDirectory, root);
        const idles = idleCount(first.logFile);
        const second = await started(root, pids, confirmEvery(root));
        if ("thrown" in second) return second;
        await eventually(() => idleCount(second.logFile) > idles);
        return { before, after: runCounts(second.stateDirectory, root) };
      });
      expect(outcome).toStrictEqual({
        before: { [WORKSPACE_A]: 1, [WORKSPACE_B]: 1 },
        after: { [WORKSPACE_A]: 1, [WORKSPACE_B]: 1 },
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2692: an edit to one workspace's own test runs that workspace again, and leaves the other's result current and unrun",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        for (const name of ["a", "b"]) {
          writeFileSync(
            join(root, "packages", name, "package.json"),
            JSON.stringify({ name, private: true }),
          );
        }
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await eventually(() => idleCount(identity.logFile) >= 1);
        const before = runCounts(identity.stateDirectory, root);
        appendFileSync(
          join(root, WORKSPACE_B, "passes.test.mjs"),
          "// an edit\n",
        );
        await eventually(() => idleCount(identity.logFile) >= 2);
        return { before, after: runCounts(identity.stateDirectory, root) };
      });
      expect(outcome).toStrictEqual({
        before: { [WORKSPACE_A]: 1, [WORKSPACE_B]: 1 },
        after: { [WORKSPACE_A]: 1, [WORKSPACE_B]: 2 },
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the environment a daemon's executor processes start with", () => {
  it(
    "D3335: a variable the daemon's own environment gains after it began serving reaches none of the executor processes that run its tests",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        const report = join(dirname(root), "environments.jsonl");
        const identity = await withEnvironment(REPORT_VARIABLE, report, () =>
          withPreload(REPORT_ENVIRONMENT, () =>
            started(root, pids, confirmEvery(root)),
          ),
        );
        if ("thrown" in identity) return identity;
        const idle = await eventually(() =>
          logged(identity.logFile, IDLE_ENTRY),
        );
        const environments = reportedEnvironments(report);
        const forks = `${report}${DAEMON_FORKS_SUFFIX}`;
        return {
          idle,
          reported: environments.length > 0,
          forkedHoldingIt:
            existsSync(forks) &&
            readFileSync(forks, "utf8").split("\n").includes(HELD_AT_FORK),
          gained: environments.filter(
            (environment) => environment[GAINED_VARIABLE] !== undefined,
          ).length,
        };
      });
      expect(outcome).toStrictEqual({
        idle: true,
        reported: true,
        forkedHoldingIt: true,
        gained: 0,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
