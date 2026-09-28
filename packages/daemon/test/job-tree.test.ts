import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { daemonStatus, stopDaemon } from "../src/client.js";
import { isRunning } from "../src/daemon/runtime-directory.js";
import {
  DAEMON_FIXTURE,
  DAEMON_TEST_TIMEOUT_MS,
  IDLE_ENTRY,
  WORKSPACE_A,
  eventually,
  fixtureFile,
  logged,
  readLines,
  settled,
  started,
  until,
  withDaemonConsumer,
  withTestEndpoint,
} from "./daemon-harness.js";
import { confirmEvery, copyFixture, inTempDir } from "./harness.js";

const runningChecks = vi.hoisted(() => ({
  /** Called with each process id the test asks about, before the answer, so a test can act at that point. */
  observe: undefined as ((pid: number) => void) | undefined,
}));

vi.mock("../src/daemon/runtime-directory.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/daemon/runtime-directory.js")>();
  return {
    ...actual,
    isRunning: (pid: number) => {
      runningChecks.observe?.(pid);
      return actual.isRunning(pid);
    },
  };
});

/** The fixture file naming the endpoint each heartbeat child connects to before its first beat. */
const CHILD_ENDPOINT = "child-endpoint";
/** A line written to a heartbeat child's connection asks it for its process id. */
const QUESTION = "?\n";
/** How a heartbeat child names the file it rewrites with its process id and the time on every beat. */
const HEARTBEAT_PREFIX = "heartbeat-";
/** How a heartbeat child that could not connect to the test, or lost its connection, names the file holding its reason. */
const FAILED_PREFIX = "failed-heartbeat-";
/** The fixture file saying how each global setup and test starts its heartbeat child. */
const SPAWN_CHILDREN = "spawn-children";
/** The fixture file naming the global setup that sticks in synchronous code, and the marker it writes once stuck. */
const STICK_AT = "stick-at";
const STUCK = "stuck";

/** The daemon fixture's `packages/a` files whose names start with `prefix`. */
function fixtureFilesNamed(root: string, prefix: string): string[] {
  return readdirSync(join(root, WORKSPACE_A)).filter((name) =>
    name.startsWith(prefix),
  );
}

/** How many heartbeat children have started: each writes its file in the daemon fixture's `packages/a`. */
function heartbeatCount(root: string): number {
  return fixtureFilesNamed(root, HEARTBEAT_PREFIX).length;
}

/** The reason of each heartbeat child that could not connect to the test or lost its connection. */
function failedHeartbeats(root: string): string[] {
  return fixtureFilesNamed(root, FAILED_PREFIX).map((name) =>
    readFileSync(join(root, WORKSPACE_A, name), "utf8"),
  );
}

/**
 * Throws naming each heartbeat child that could not connect or lost its connection, so the test reports it rather
 * than waiting on it or reading its closed connection as the child having ended.
 */
function requireConnectedHeartbeats(root: string): void {
  const failed = failedHeartbeats(root);
  if (failed.length > 0) {
    throw new Error(
      `a heartbeat child could not connect to the test or lost its connection: ${failed.join("; ")}`,
    );
  }
}

/** The error codes a connection reports once its other end has gone, which for a heartbeat child means it has ended. */
const PEER_GONE = new Set(["EPIPE", "ECONNRESET", "EOF"]);
/** A process id as a heartbeat child answers it: a positive decimal, since killing 0 or a negative id reaches a group. */
const PROCESS_ID = /^[1-9]\d*$/;

interface Waiting {
  resolve(pid: number | undefined): void;
  reject(error: Error): void;
}

/** A heartbeat child's connection to the test, which the OS closes once the child has ended. */
class ChildConnection {
  readonly #socket: Socket;
  #waiting: Waiting | undefined;
  #closed = false;
  #failure: Error | undefined;
  #pid: number | undefined;

  constructor(socket: Socket) {
    this.#socket = socket;
    readLines(socket, (error) => {
      if (PEER_GONE.has(error.code ?? "")) return;
      this.#failure ??= new Error(
        `the test's connection to a heartbeat child failed: ${error.message}`,
        { cause: error },
      );
    }).on("line", (line) => this.#answer(line));
    socket.once("close", () => {
      this.#closed = true;
      this.#settle(undefined);
    });
  }

  /**
   * The child's process id once it answers, or undefined once its connection has closed because the child ended.
   * Rejects when the connection failed for any other reason, since the child may still run.
   */
  ask(): Promise<number | undefined> {
    return new Promise((resolve, reject) => {
      this.#waiting = { resolve, reject };
      if (this.#closed) this.#settle(undefined);
      else this.#socket.write(QUESTION);
    });
  }

  /** The process id the child announced on connecting, or undefined when that line never arrived. */
  get pid(): number | undefined {
    return this.#pid;
  }

  #answer(line: string): void {
    if (PROCESS_ID.test(line)) {
      this.#heard(Number(line));
      return;
    }
    this.#failure ??= new Error(
      `a heartbeat child answered "${line}" rather than its process id`,
    );
    this.#socket.destroy();
  }

  /** The child's first line announces its process id; each later one answers a question. */
  #heard(pid: number): void {
    if (this.#pid === undefined) this.#pid = pid;
    else this.#settle(pid);
  }

  #settle(pid: number | undefined): void {
    const waiting = this.#waiting;
    this.#waiting = undefined;
    if (this.#failure === undefined) waiting?.resolve(pid);
    else waiting?.reject(this.#failure);
  }
}

/** Serves the heartbeat children's connections on an endpoint of the test's own for the length of `body`. */
function withChildEndpoint<T>(
  body: (path: string, children: readonly ChildConnection[]) => Promise<T>,
): Promise<T> {
  const children: ChildConnection[] = [];
  return withTestEndpoint(
    (socket) => children.push(new ChildConnection(socket)),
    (path) => body(path, children),
  );
}

/**
 * The process ids of the heartbeat children still running. Every child connects and announces its process id before
 * it writes its first beat, so once the test has accepted as many connections as there are heartbeat files, asking
 * each one reaches every child: a live one answers however slowly it runs, and an ended one cannot. Throws naming each
 * child that could not connect or lost its connection.
 */
async function stillRunning(
  root: string,
  children: readonly ChildConnection[],
): Promise<number[]> {
  const connected = await eventually(
    () =>
      children.length >= heartbeatCount(root) ||
      failedHeartbeats(root).length > 0,
  );
  requireConnectedHeartbeats(root);
  if (!connected) {
    throw new Error(
      `the test accepted ${children.length} heartbeat connections for ${heartbeatCount(root)} heartbeat files`,
    );
  }
  const answers = await Promise.all(children.map((child) => child.ask()));
  const alive = answers.filter((pid) => pid !== undefined);
  const silent = children.filter((_, index) => answers[index] === undefined);
  let running: number[] = [];
  const exited = await eventually(() => {
    running = silentStillRunning(silent);
    return failedHeartbeats(root).length > 0 || running.length === 0;
  });
  requireConnectedHeartbeats(root);
  if (!exited) {
    throw new Error(
      `a heartbeat child that did not answer still runs by its process id: ${running.join(", ")}; the heartbeat files hold ${heartbeatContents(root)}`,
    );
  }
  return alive;
}

/**
 * The announced process id of each heartbeat child that did not answer and still runs, empty once every one has
 * exited. A child that lost its connection writes its reason before it exits, so once it has exited the reason is on
 * disk, however late the test saw the connection close. A child whose announcement never arrived is not waited on.
 */
function silentStillRunning(silent: readonly ChildConnection[]): number[] {
  return silent.flatMap(({ pid }) =>
    pid !== undefined && isRunning(pid) ? [pid] : [],
  );
}

/** Each heartbeat file's name and content, so a failure shows every child's last beat beside the process ids. */
function heartbeatContents(root: string): string {
  return fixtureFilesNamed(root, HEARTBEAT_PREFIX)
    .map(
      (name) =>
        `${name} ${JSON.stringify(readFileSync(join(root, WORKSPACE_A, name), "utf8"))}`,
    )
    .join(", ");
}

/** The heartbeat child the connection tests start themselves, outside any job. */
const HEARTBEAT_SCRIPT = "heartbeat.mjs";
const LOST_CHILD = "lost";
/** The reason a heartbeat child gives when the test ends its connection with no error on it. */
const ENDED_BY_THE_TEST =
  "lost its connection to the test: the test's endpoint closed it";
/** A preload that ends a heartbeat child's lifetime the first time the test writes to its connection. */
const END_LIFETIME_ON_FIRST_LINE = new URL(
  "../../../test/fixtures/daemon/end-lifetime-on-first-line.mjs",
  import.meta.url,
).href;
/** A preload that resets a heartbeat child's connection the first time the test writes to it. */
const RESET_ON_FIRST_LINE = new URL(
  "../../../test/fixtures/daemon/reset-on-first-line.mjs",
  import.meta.url,
).href;

/** An error as a socket reports a failed read or write, carrying its code. */
function connectionError(syscall: string, code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${syscall} ${code}`), { code, syscall });
}

/** The message `act` throws, or undefined when it returns. */
function thrownBy(act: () => void): string | undefined {
  try {
    act();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The first connection an endpoint accepts, and the handler that takes it. */
function firstConnection(): {
  accept: (socket: Socket) => void;
  accepted: Promise<Socket>;
} {
  let accept: (socket: Socket) => void = () => undefined;
  const accepted = new Promise<Socket>((resolve) => {
    accept = resolve;
  });
  return { accept, accepted };
}

/**
 * Hands `body` the test's connection to a stand-in heartbeat child whose end the test holds: `served` is the test's
 * socket under the connection, and `child` the stand-in's.
 */
function withHeldConnection<T>(
  body: (
    connection: ChildConnection,
    served: Socket,
    child: Socket,
  ) => Promise<T>,
): Promise<T> {
  const first = firstConnection();
  return withTestEndpoint(first.accept, async (endpoint) => {
    const child = createConnection(endpoint);
    child.on("error", () => undefined);
    try {
      const served = await first.accepted;
      return await body(new ChildConnection(served), served, child);
    } finally {
      child.destroy();
    }
  });
}

/**
 * What asking a heartbeat child reads once `error` has reached the test's socket and the socket has closed, and what
 * the error threw. The test emits the error on the socket as the socket itself would, so a listener missing on the way
 * throws where the test sees it rather than uncaught.
 */
function afterConnectionError(error: NodeJS.ErrnoException) {
  return withHeldConnection(async (connection, served) => {
    const answer = settled(connection.ask());
    const thrown = thrownBy(() => served.emit("error", error));
    served.destroy();
    return { thrown, answer: await answer };
  });
}

/**
 * A view of a heartbeat child's connection that heard the child announce `pid` and then closed, while the child's own
 * connection stays open: the test has seen the close before the child knows of it.
 */
function closedAfterAnnouncing(pid: number): Promise<ChildConnection> {
  return withTestEndpoint(
    (socket) => socket.end(`${pid}\n`),
    async (endpoint) => {
      const seen = createConnection(endpoint);
      const connection = new ChildConnection(seen);
      await new Promise((resolve) => seen.once("close", resolve));
      return connection;
    },
  );
}

/** The process id a stand-in heartbeat child announces. */
const ANNOUNCED_PID = 4242;

/** What asking a stand-in heartbeat child reads when it answers `answer`. */
function askedAnswering(answer: string) {
  return withHeldConnection((connection, _served, child) => {
    child.on("data", () => child.write(`${answer}\n`));
    return settled(connection.ask());
  });
}

interface StartedHeartbeat {
  readonly root: string;
  readonly endpoint: string;
  readonly pid: number;
  /** The test's socket under the child's connection. */
  readonly served: Socket;
  /** The child's exit code once it has exited. */
  readonly exited: Promise<number | null>;
}

/**
 * Starts a heartbeat child in a copy of the daemon fixture, connected to an endpoint of the test's own, and hands it to
 * `body` once it has made its first beat. Ends the child however `body` ends.
 */
function withHeartbeatChild<T>(
  body: (heartbeat: StartedHeartbeat) => Promise<T>,
  nodeArgs: readonly string[] = [],
): Promise<T> {
  return inTempDir((root) => {
    copyFixture(DAEMON_FIXTURE, root);
    const first = firstConnection();
    return withTestEndpoint(first.accept, async (endpoint) => {
      writeFileSync(fixtureFile(root, CHILD_ENDPOINT), endpoint);
      const beat = fixtureFile(root, `${HEARTBEAT_PREFIX}${LOST_CHILD}`);
      const child = spawn(
        process.execPath,
        [...nodeArgs, fixtureFile(root, HEARTBEAT_SCRIPT), beat],
        { stdio: "ignore", windowsHide: true },
      );
      const exited = once(child, "exit").then(
        ([code]) => code as number | null,
      );
      try {
        await until(
          () =>
            existsSync(beat) ||
            failedHeartbeats(root).length > 0 ||
            child.exitCode !== null ||
            child.signalCode !== null,
        );
        requireConnectedHeartbeats(root);
        if (!existsSync(beat)) {
          throw new Error(
            `the heartbeat child ended (${child.exitCode ?? child.signalCode}) before its first beat`,
          );
        }
        const served = await first.accepted;
        const pid = child.pid ?? Number.NaN;
        return await body({ root, endpoint, pid, served, exited });
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        await exited;
      }
    });
  });
}

describe("what a job starts ends with the job", () => {
  /** Runs every workspace with each global setup and test starting a heartbeat child as `spawnChildren` says. */
  function childrenAfterIdle(spawnChildren: string) {
    return withChildEndpoint((endpoint, children) =>
      withDaemonConsumer(async (root, pids) => {
        writeFileSync(fixtureFile(root, CHILD_ENDPOINT), endpoint);
        writeFileSync(fixtureFile(root, SPAWN_CHILDREN), spawnChildren);
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        const idle = await eventually(() =>
          logged(identity.logFile, IDLE_ENTRY),
        );
        const alive = await stillRunning(root, children);
        for (const pid of alive) process.kill(pid, "SIGKILL");
        const status = await settled(daemonStatus(root));
        return {
          idle,
          spawned: heartbeatCount(root),
          alive,
          serving: !("thrown" in status),
        };
      }),
    );
  }

  it(
    "D1665: a global setup stuck in synchronous code, which started a child through a shell, is ended at the executor bound with that child",
    async () => {
      const outcome = await withChildEndpoint((endpoint, children) =>
        withDaemonConsumer(async (root, pids) => {
          writeFileSync(fixtureFile(root, CHILD_ENDPOINT), endpoint);
          writeFileSync(fixtureFile(root, SPAWN_CHILDREN), "shell");
          writeFileSync(fixtureFile(root, STICK_AT), "2");
          const identity = await started(root, pids, confirmEvery(root));
          if ("thrown" in identity) return identity;
          await until(
            () =>
              existsSync(fixtureFile(root, STUCK)) ||
              failedHeartbeats(root).length > 0,
          );
          requireConnectedHeartbeats(root);
          const stuckWith = await stillRunning(root, children);
          const stop = await settled(stopDaemon(root));
          const alive = await stillRunning(root, children);
          for (const pid of alive) process.kill(pid, "SIGKILL");
          return {
            pid: identity.pid,
            stuckWith: stuckWith.length,
            stop,
            alive,
          };
        }),
      );
      const pid = "pid" in outcome ? outcome.pid : Number.NaN;
      expect(outcome).toStrictEqual({
        pid,
        stuckWith: 1,
        stop: { pid },
        alive: [],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1661: once every job has ended, with the daemon still serving, no child a global setup or a test started through a shell still runs",
    async () => {
      expect(await childrenAfterIdle("shell")).toStrictEqual({
        idle: true,
        spawned: 6,
        alive: [],
        serving: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1660: once every job has ended, with the daemon still serving, no child a global setup or a test started, in a thread or a forked worker, still runs",
    async () => {
      expect(await childrenAfterIdle("")).toStrictEqual({
        idle: true,
        spawned: 6,
        alive: [],
        serving: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the test's connection to a heartbeat child", () => {
  it("D2402: a write that fails because the child has just exited throws nowhere, and the child reads as ended", async () => {
    expect(
      await afterConnectionError(connectionError("write", "EPIPE")),
    ).toStrictEqual({ thrown: undefined, answer: undefined });
  });

  it("D2412: a connection the child's end reset reads as the child having ended", async () => {
    expect(
      await afterConnectionError(connectionError("read", "ECONNRESET")),
    ).toStrictEqual({ thrown: undefined, answer: undefined });
  });

  it("D2413: a write that meets the end of the child's connection reads as the child having ended", async () => {
    expect(
      await afterConnectionError(connectionError("write", "EOF")),
    ).toStrictEqual({ thrown: undefined, answer: undefined });
  });

  it("D2403: a connection that fails for any reason but the child having gone fails the question, naming the error", async () => {
    expect(
      await afterConnectionError(connectionError("read", "ETIMEDOUT")),
    ).toStrictEqual({
      thrown: undefined,
      answer: {
        thrown:
          "the test's connection to a heartbeat child failed: read ETIMEDOUT",
      },
    });
  });

  it("D2421: a connection that failed for any reason but the child having gone, and closed before the test asked, fails the question", async () => {
    const answer = await withHeldConnection(async (connection, served) => {
      const closed = new Promise((resolve) => served.once("close", resolve));
      served.emit("error", connectionError("read", "ETIMEDOUT"));
      served.destroy();
      await closed;
      return settled(connection.ask());
    });
    expect(answer).toStrictEqual({
      thrown:
        "the test's connection to a heartbeat child failed: read ETIMEDOUT",
    });
  });

  it("D2424: a child that announces itself after the test asked, then ends before answering, reads as ended", async () => {
    const outcome = await withHeldConnection(
      async (connection, _served, child) => {
        child.once("data", () => child.end(`${ANNOUNCED_PID}\n`));
        const answer = await settled(connection.ask());
        return { answer, announced: connection.pid };
      },
    );
    expect(outcome).toStrictEqual({
      answer: undefined,
      announced: ANNOUNCED_PID,
    });
  });

  it("D2407: an answer that is not a positive process id fails the question, naming the answer", async () => {
    expect(await askedAnswering("-1")).toStrictEqual({
      thrown: 'a heartbeat child answered "-1" rather than its process id',
    });
  });

  it("D2416: an answer of 0, which would reach the test's process group, fails the question, naming the answer", async () => {
    expect(await askedAnswering("0")).toStrictEqual({
      thrown: 'a heartbeat child answered "0" rather than its process id',
    });
  });

  it(
    "D2408: a heartbeat child whose connection the test ends writes why to its failure file, then exits",
    async () => {
      const outcome = await withHeartbeatChild(
        async ({ root, served, exited }) => {
          served.end();
          const code = await exited;
          return { code, failed: failedHeartbeats(root) };
        },
      );
      expect(outcome).toStrictEqual({ code: 1, failed: [ENDED_BY_THE_TEST] });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2425: a heartbeat child announces its process id on connecting, before the test asks it anything",
    async () => {
      const outcome = await withHeartbeatChild(async ({ pid, served }) => {
        const lines: string[] = [];
        readLines(served, () => undefined).on("line", (line) =>
          lines.push(line),
        );
        const closed = new Promise((resolve) => served.once("close", resolve));
        served.end();
        await closed;
        return { lines, pid: String(pid) };
      });
      expect(outcome.lines).toStrictEqual([outcome.pid]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2423: a heartbeat child that outlives its lifetime writes that to its failure file, then exits",
    async () => {
      const outcome = await withHeartbeatChild(
        async ({ root, served, exited }) => {
          served.write(QUESTION);
          const code = await exited;
          return { code, failed: failedHeartbeats(root) };
        },
        ["--import", END_LIFETIME_ON_FIRST_LINE],
      );
      expect(outcome).toStrictEqual({
        code: 1,
        failed: ["outlived its 60000 ms lifetime"],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2420: a heartbeat child whose connection is reset writes the error to its failure file, then exits",
    async () => {
      const outcome = await withHeartbeatChild(
        async ({ root, served, exited }) => {
          served.write(QUESTION);
          const code = await exited;
          return { code, failed: failedHeartbeats(root) };
        },
        ["--import", RESET_ON_FIRST_LINE],
      );
      expect(outcome).toStrictEqual({
        code: 1,
        failed: ["lost its connection to the test: read ECONNRESET"],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2409: a child whose connection the test saw close before the child wrote why is reported, not read as ended",
    async () => {
      const outcome = await withHeartbeatChild(
        async ({ root, pid, served }) => {
          const connection = await closedAfterAnnouncing(pid);
          runningChecks.observe = (checked) => {
            if (checked === pid && !served.writableEnded) served.end();
          };
          try {
            return await settled(stillRunning(root, [connection]));
          } finally {
            runningChecks.observe = undefined;
          }
        },
      );
      expect(outcome).toStrictEqual({
        thrown: `a heartbeat child could not connect to the test or lost its connection: ${ENDED_BY_THE_TEST}`,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
