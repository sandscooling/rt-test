import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { daemonStatus, stopDaemon } from "../src/client.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  IDLE_ENTRY,
  WORKSPACE_A,
  eventually,
  fixtureFile,
  logged,
  settled,
  started,
  until,
  withDaemonConsumer,
  withTestEndpoint,
} from "./daemon-harness.js";
import { confirmEvery } from "./harness.js";

/** The fixture file naming the endpoint each heartbeat child connects to before its first beat. */
const CHILD_ENDPOINT = "child-endpoint";
/** A line written to a heartbeat child's connection asks it for its process id. */
const QUESTION = "?\n";
/** How a heartbeat child that could not connect to the test names the file holding its reason. */
const FAILED_PREFIX = "failed-heartbeat-";

/** The daemon fixture's `packages/a` files whose names start with `prefix`. */
function fixtureFilesNamed(root: string, prefix: string): string[] {
  return readdirSync(join(root, WORKSPACE_A)).filter((name) =>
    name.startsWith(prefix),
  );
}

/** How many heartbeat children have started: each writes its file in the daemon fixture's `packages/a`. */
function heartbeatCount(root: string): number {
  return fixtureFilesNamed(root, "heartbeat-").length;
}

/** The reason of each heartbeat child that could not connect to the test. */
function failedHeartbeats(root: string): string[] {
  return fixtureFilesNamed(root, FAILED_PREFIX).map((name) =>
    readFileSync(join(root, WORKSPACE_A, name), "utf8"),
  );
}

/** Throws naming each heartbeat child that could not connect, so the test reports it rather than waiting on it. */
function requireConnectedHeartbeats(root: string): void {
  const failed = failedHeartbeats(root);
  if (failed.length > 0) {
    throw new Error(
      `a heartbeat child could not connect to the test: ${failed.join("; ")}`,
    );
  }
}

/** A heartbeat child's connection to the test, which the OS closes once the child has ended. */
class ChildConnection {
  readonly #socket: Socket;
  #waiting: ((pid: number | undefined) => void) | undefined;
  #closed = false;

  constructor(socket: Socket) {
    this.#socket = socket;
    socket.on("error", () => undefined);
    createInterface({ input: socket }).on("line", (line) =>
      this.#settle(Number(line)),
    );
    socket.once("close", () => {
      this.#closed = true;
      this.#settle(undefined);
    });
  }

  /** The child's process id once it answers, or undefined once its connection has closed. */
  ask(): Promise<number | undefined> {
    if (this.#closed) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      this.#waiting = resolve;
      this.#socket.write(QUESTION);
    });
  }

  #settle(pid: number | undefined): void {
    const wake = this.#waiting;
    this.#waiting = undefined;
    wake?.(pid);
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
 * The process ids of the heartbeat children still running. Every child connects before it writes its first beat, so
 * once the test has accepted as many connections as there are heartbeat files, asking each one reaches every child: a
 * live one answers however slowly it runs, and an ended one cannot. Throws naming each child that could not connect.
 */
async function stillRunning(
  root: string,
  children: readonly ChildConnection[],
): Promise<number[]> {
  await until(
    () =>
      children.length >= heartbeatCount(root) ||
      failedHeartbeats(root).length > 0,
  );
  requireConnectedHeartbeats(root);
  const answers = await Promise.all(children.map((child) => child.ask()));
  return answers.filter((pid) => pid !== undefined);
}

describe("what a job starts ends with the job", () => {
  /** Runs every workspace with each global setup and test starting a heartbeat child as `spawnChildren` says. */
  function childrenAfterIdle(spawnChildren: string) {
    return withChildEndpoint((endpoint, children) =>
      withDaemonConsumer(async (root, pids) => {
        writeFileSync(fixtureFile(root, CHILD_ENDPOINT), endpoint);
        writeFileSync(fixtureFile(root, "spawn-children"), spawnChildren);
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
          writeFileSync(fixtureFile(root, "spawn-children"), "shell");
          writeFileSync(fixtureFile(root, "stick-at"), "2");
          const identity = await started(root, pids, confirmEvery(root));
          if ("thrown" in identity) return identity;
          await until(
            () =>
              existsSync(fixtureFile(root, "stuck")) ||
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
