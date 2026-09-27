import { once } from "node:events";
import { createConnection, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { DaemonIdentity } from "../src/daemon/protocol.js";
import { connectionServer, type DaemonHandlers } from "../src/daemon/server.js";
import {
  CLOSED,
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
  withConnection,
  withTestEndpoint,
  type RawConnection,
} from "./daemon-harness.js";

const DAEMON_PID = 4242;
const LOG_FILE = "/state/daemon-log.log";
const IDENTITY: DaemonIdentity = {
  pid: DAEMON_PID,
  consumerRoot: "/consumer",
  projectIdentity: "/consumer/.git",
  worktreeIdentity: "/consumer",
  stateDirectory: "/consumer/.rt-test",
  logFile: LOG_FILE,
  protocolVersion: 1,
};
const HELLO = { type: "hello", protocolVersion: 1 };
const STATUS = { type: "status", protocolVersion: 1 };
const STOP = { type: "stop" };
/** One byte past the frozen 1 MiB line limit. */
const OVERLONG_LINE = `${"a".repeat(1024 * 1024 + 1)}\n`;

function handlers(stopping: boolean): DaemonHandlers {
  return {
    identity: IDENTITY,
    status: () => ({ activity: { state: "idle" }, stopping, unstoredJobs: [] }),
    stop: () => undefined,
    isStopping: () => stopping,
  };
}

/** Serves a daemon's connections on a test endpoint and hands `body` one connection to it. */
function onServer<T>(
  body: (connection: RawConnection) => Promise<T>,
  stopping = false,
): Promise<T> {
  const server = connectionServer(handlers(stopping), memoryLog());
  return withTestEndpoint(server.onConnection, (path) =>
    withConnection(path, body),
  );
}

/** Each answer by its type and error code, which is what a client branches on. */
async function answerKinds(
  connection: RawConnection,
  count: number,
): Promise<unknown[]> {
  const kinds: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    const line = await connection.next();
    kinds.push(
      line === CLOSED
        ? CLOSED
        : {
            type: line["type"],
            ...("code" in line ? { code: line["code"] } : {}),
          },
    );
  }
  return kinds;
}

describe("answering a bad line and serving on", () => {
  it("D1444: a line that is not JSON gets an invalid-json error, and the next hello on that connection is answered", async () => {
    const kinds = await onServer((connection) => {
      connection.send("not json\n");
      connection.sendLine(HELLO);
      return answerKinds(connection, 2);
    });
    expect(kinds).toStrictEqual([
      { type: "error", code: "invalid-json" },
      { type: "hello" },
    ]);
  });

  it("D1445: a request before the hello gets a hello-required error, and the hello after it is answered", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine(STATUS);
      connection.sendLine(HELLO);
      return answerKinds(connection, 2);
    });
    expect(kinds).toStrictEqual([
      { type: "error", code: "hello-required" },
      { type: "hello" },
    ]);
  });

  it("D1446: an unknown request gets an unknown-request error, and the status after it is answered", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine(HELLO);
      connection.sendLine({ type: "frobnicate", protocolVersion: 1 });
      connection.sendLine(STATUS);
      return answerKinds(connection, 3);
    });
    expect(kinds).toStrictEqual([
      { type: "hello" },
      { type: "error", code: "unknown-request" },
      { type: "status" },
    ]);
  });

  it("D1447: a line past 1 MiB gets a line-too-long error, and the hello after it is answered", async () => {
    const kinds = await onServer((connection) => {
      connection.send(OVERLONG_LINE);
      connection.sendLine(HELLO);
      return answerKinds(connection, 2);
    });
    expect(kinds).toStrictEqual([
      { type: "error", code: "line-too-long" },
      { type: "hello" },
    ]);
  });

  it("D1440: a request other than status or stop while the daemon stops gets a stopping error", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine(HELLO);
      connection.sendLine({ type: "frobnicate", protocolVersion: 1 });
      return answerKinds(connection, 2);
    }, true);
    expect(kinds).toStrictEqual([
      { type: "hello" },
      { type: "error", code: "stopping" },
    ]);
  });
});

describe("writing only in answer to a line", () => {
  it("D1448: the first line a connection receives answers the first line it sent", async () => {
    const first = await onServer((connection) => {
      connection.sendLine(HELLO);
      return connection.next();
    });
    expect(first).toStrictEqual({
      type: "hello",
      protocolVersion: 1,
      pid: DAEMON_PID,
    });
  });
});

describe("a client of another protocol version", () => {
  it("D1449: after a hello of another version, any line but the stop closes the connection unanswered", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine({ type: "hello", protocolVersion: 2 });
      connection.sendLine(STATUS);
      return answerKinds(connection, 2);
    });
    expect(kinds).toStrictEqual([
      { type: "error", code: "protocol-version-mismatch" },
      CLOSED,
    ]);
  });

  it("D1450: a stop sent while a stop is under way is acknowledged, naming the process and its log", async () => {
    const answer = await onServer((connection) => {
      connection.sendLine(STOP);
      return connection.next();
    }, true);
    expect(answer).toStrictEqual({
      type: "stopping",
      pid: DAEMON_PID,
      logFile: LOG_FILE,
    });
  });

  it("D1539: a request after the hello that carries no protocol version gets an invalid-request error", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine(HELLO);
      connection.sendLine({ type: "status" });
      return answerKinds(connection, 2);
    });
    expect(kinds).toStrictEqual([
      { type: "hello" },
      { type: "error", code: "invalid-request" },
    ]);
  });
});

describe("closing the connections at the stop", () => {
  /** Answers to this many hellos overflow what a paused client's pipe and buffer take in. */
  const UNREAD_HELLOS = 25_000;
  /** Past the 1 s close grace, with room for a loaded machine. */
  const CLOSE_BOUND_MS = 5_000;

  it(
    "D1540: a client that stops reading is dropped once the close grace passes, so it cannot hold the stop",
    async () => {
      const server = connectionServer(handlers(false), memoryLog());
      let served: Socket | undefined;
      const outcome = await withTestEndpoint(
        (socket) => {
          served = socket;
          server.onConnection(socket);
        },
        async (path) => {
          const client = createConnection(path);
          await once(client, "connect");
          client.pause();
          try {
            const requests = `${JSON.stringify(HELLO)}\n`.repeat(UNREAD_HELLOS);
            client.write(requests);
            const backlogged = await eventually(
              () =>
                served !== undefined &&
                served.bytesRead === Buffer.byteLength(requests) &&
                served.writableLength > 0,
            );
            server.closeConnections();
            const dropped = await eventually(
              () => served?.destroyed === true,
              CLOSE_BOUND_MS,
            );
            return { backlogged, dropped };
          } finally {
            client.destroy();
          }
        },
      );
      expect(outcome).toStrictEqual({ backlogged: true, dropped: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
