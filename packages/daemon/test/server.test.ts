import { once } from "node:events";
import { createConnection, Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  daemonVerifier,
  type DaemonVerifier,
} from "../src/daemon/endpoint-proof.js";
import {
  PROTOCOL_VERSION,
  type DaemonIdentity,
} from "../src/daemon/protocol.js";
import type { SummaryAnswer } from "../src/query/answer.js";
import {
  CLOSE_GRACE_MS,
  connectionServer,
  type DaemonHandlers,
  type Prover,
} from "../src/daemon/server.js";
import {
  CLOSED,
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  keyedEndpoint,
  memoryLog,
  withConnection,
  withDaemonKey,
  type RawConnection,
} from "./daemon-harness.js";
import { inTempDir } from "./harness.js";
import { testSocketPath, withTestEndpoint } from "./test-endpoint.js";

/** The longest path `listen` accepts for a Unix socket: `sun_path` holds 108 bytes, the last for the terminating NUL. */
const SOCKET_PATH_LIMIT_BYTES = 107;
const DAEMON_PID = 4242;
const LOG_FILE = "/state/daemon-log.log";
const IDENTITY: DaemonIdentity = {
  pid: DAEMON_PID,
  consumerRoot: "/consumer",
  projectIdentity: "/consumer/.git",
  worktreeIdentity: "/consumer",
  stateDirectory: "/consumer/.rt-test",
  logFile: LOG_FILE,
  protocolVersion: PROTOCOL_VERSION,
};
/** A version the daemon does not speak, derived so that raising the daemon's own never makes it match. */
const OTHER_PROTOCOL_VERSION = PROTOCOL_VERSION + 1;
const HELLO = { type: "hello", protocolVersion: PROTOCOL_VERSION };
const STATUS = { type: "status", protocolVersion: PROTOCOL_VERSION };
const STOP = { type: "stop" };
/** One byte past the frozen 1 MiB line limit. */
const OVERLONG_LINE = `${"a".repeat(1024 * 1024 + 1)}\n`;

type Queries = Partial<Pick<DaemonHandlers, "summary" | "pathStatus">>;

const NO_STAND_IN_ANSWER = { noAnswer: "the stand-in answers no query" };

function handlers(stopping: boolean, queries: Queries = {}): DaemonHandlers {
  return {
    identity: IDENTITY,
    status: () => ({ activity: { state: "idle" }, stopping, unstoredJobs: [] }),
    summary: () => NO_STAND_IN_ANSWER,
    pathStatus: () => NO_STAND_IN_ANSWER,
    ...queries,
    stop: () => undefined,
    isStopping: () => stopping,
  };
}

/** Answers no challenge, for a test that does not look at proofs. */
const NO_PROOF: Prover = () => undefined;

/** Serves a daemon's connections on a test endpoint and hands `body` one connection to it. */
function onServer<T>(
  body: (connection: RawConnection) => Promise<T>,
  stopping = false,
  queries: Queries = {},
): Promise<T> {
  const server = connectionServer(
    handlers(stopping, queries),
    memoryLog(),
    NO_PROOF,
  );
  return withTestEndpoint(server.onConnection, (path) =>
    withConnection(path, body),
  );
}

/**
 * Serves with a real daemon key, as this process's daemon for `PROVEN_WORKTREE`, and hands `body` one connection and
 * a verifier reading that key as a client does.
 */
function onProvingServer<T>(
  body: (connection: RawConnection, verifier: DaemonVerifier) => Promise<T>,
): Promise<T> {
  return inTempDir((dir) => {
    const endpoint = keyedEndpoint(dir);
    return withDaemonKey(endpoint, PROVEN_WORKTREE, (key) => {
      const verifier = daemonVerifier(endpoint, PROVEN_WORKTREE);
      if (!verifier.ok) throw new Error(verifier.reason);
      const server = connectionServer(
        {
          ...handlers(false),
          identity: { ...IDENTITY, pid: process.pid },
        },
        memoryLog(),
        key.prove,
      );
      return withTestEndpoint(server.onConnection, (path) =>
        withConnection(path, (connection) =>
          body(connection, verifier.verifier),
        ),
      );
    });
  });
}

const PROVEN_WORKTREE = "/consumer";
/** The frozen challenge limit, and one past it. */
const LONGEST_CHALLENGE = "c".repeat(256);
const OVERLONG_CHALLENGE = "c".repeat(257);

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
      connection.sendLine({
        type: "frobnicate",
        protocolVersion: PROTOCOL_VERSION,
      });
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
      connection.sendLine({
        type: "frobnicate",
        protocolVersion: PROTOCOL_VERSION,
      });
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
      protocolVersion: PROTOCOL_VERSION,
      pid: DAEMON_PID,
    });
  });
});

describe("answering a query", () => {
  const SUMMARY = { type: "summary", protocolVersion: PROTOCOL_VERSION };
  /** The frozen 1 MiB line limit, in bytes. */
  const LINE_LIMIT_BYTES = 1_048_576;

  /** An answer whose summary response encodes to exactly `bytes` bytes. */
  function answerOfSize(bytes: number): SummaryAnswer {
    const empty = Buffer.byteLength(JSON.stringify({ pad: "", ...SUMMARY }));
    return { pad: "x".repeat(bytes - empty) } as unknown as SummaryAnswer;
  }

  /** The error answering the summary sent after the hello, as its code and message. */
  async function summaryError(queries: Queries): Promise<unknown> {
    const line = await onServer(
      async (connection) => {
        connection.sendLine(HELLO);
        connection.sendLine(SUMMARY);
        await connection.next();
        return connection.next();
      },
      false,
      queries,
    );
    return line === CLOSED
      ? line
      : { type: line["type"], code: line["code"], message: line["message"] };
  }

  it("D1835: a query to a stopping daemon gets a stopping error, and the store is never read", async () => {
    let reads = 0;
    const kinds = await onServer(
      (connection) => {
        connection.sendLine(HELLO);
        connection.sendLine(SUMMARY);
        return answerKinds(connection, 2);
      },
      true,
      {
        summary: () => {
          reads += 1;
          return NO_STAND_IN_ANSWER;
        },
      },
    );
    expect({ kinds, reads }).toStrictEqual({
      kinds: [{ type: "hello" }, { type: "error", code: "stopping" }],
      reads: 0,
    });
  });

  it("D1836: an answer one byte past the line limit is refused with a reason giving its size and the limit and naming status", async () => {
    const answer = answerOfSize(LINE_LIMIT_BYTES + 1);
    expect(await summaryError({ summary: () => answer })).toStrictEqual({
      type: "error",
      code: "nothing-to-answer",
      message: expect.stringMatching(
        /1048577 bytes.*1048576 bytes.*status for a narrower path/,
      ),
    });
  });

  it("D1837: an answer exactly at the line limit is sent", async () => {
    const answer = answerOfSize(LINE_LIMIT_BYTES);
    const kinds = await onServer(
      (connection) => {
        connection.sendLine(HELLO);
        connection.sendLine(SUMMARY);
        return answerKinds(connection, 2);
      },
      false,
      { summary: () => answer },
    );
    expect(kinds).toStrictEqual([{ type: "hello" }, { type: "summary" }]);
  });

  it("D1838: a query that throws gets a query-failed error saying what went wrong, and the status after it is answered", async () => {
    const answers = await onServer(
      async (connection) => {
        connection.sendLine(HELLO);
        connection.sendLine(SUMMARY);
        connection.sendLine(STATUS);
        const lines = [];
        for (let index = 0; index < 3; index += 1) {
          const line = await connection.next();
          lines.push(
            line === CLOSED
              ? CLOSED
              : {
                  type: line["type"],
                  ...("code" in line
                    ? { code: line["code"], message: line["message"] }
                    : {}),
                },
          );
        }
        return lines;
      },
      false,
      {
        summary: () => {
          throw new Error("the store is unreadable");
        },
      },
    );
    expect(answers).toStrictEqual([
      { type: "hello" },
      {
        type: "error",
        code: "query-failed",
        message: expect.stringContaining("the store is unreadable"),
      },
      { type: "status" },
    ]);
  });

  it("D1839: a query with nothing to answer gets a nothing-to-answer error carrying the reason", async () => {
    const reason = "the latest discovery holds no test";
    expect(
      await summaryError({ summary: () => ({ noAnswer: reason }) }),
    ).toStrictEqual({
      type: "error",
      code: "nothing-to-answer",
      message: reason,
    });
  });

  it("D1840: a path-status request carrying a relative path is refused as invalid, and never reaches the query", async () => {
    const asked: string[] = [];
    const kinds = await onServer(
      (connection) => {
        connection.sendLine(HELLO);
        connection.sendLine({
          type: "path-status",
          protocolVersion: PROTOCOL_VERSION,
          path: "packages/a",
        });
        return answerKinds(connection, 2);
      },
      false,
      {
        pathStatus: (path) => {
          asked.push(path);
          return NO_STAND_IN_ANSWER;
        },
      },
    );
    expect({ kinds, asked }).toStrictEqual({
      kinds: [{ type: "hello" }, { type: "error", code: "invalid-request" }],
      asked: [],
    });
  });
});

describe("a client of another protocol version", () => {
  it("D1449: after a hello of another version, any line but the stop closes the connection unanswered", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine({
        type: "hello",
        protocolVersion: OTHER_PROTOCOL_VERSION,
      });
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

  it("D3110: a request after the hello that carries another protocol version gets an invalid-request error", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine(HELLO);
      connection.sendLine({
        type: "status",
        protocolVersion: OTHER_PROTOCOL_VERSION,
      });
      return answerKinds(connection, 2);
    });
    expect(kinds).toStrictEqual([
      { type: "hello" },
      { type: "error", code: "invalid-request" },
    ]);
  });

  it("D3111: a hello of an older protocol version is refused with a version-mismatch error", async () => {
    const kinds = await onServer((connection) => {
      connection.sendLine({
        type: "hello",
        protocolVersion: PROTOCOL_VERSION - 1,
      });
      return answerKinds(connection, 1);
    });
    expect(kinds).toStrictEqual([
      { type: "error", code: "protocol-version-mismatch" },
    ]);
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

  it(
    "D1540: a client that stops reading is dropped once the close grace passes, so it cannot hold the stop",
    async () => {
      const server = connectionServer(handlers(false), memoryLog(), NO_PROOF);
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
            vi.useFakeTimers({ toFake: ["setTimeout"] });
            server.closeConnections();
            await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS);
            return { backlogged, dropped: served?.destroyed === true };
          } finally {
            vi.useRealTimers();
            client.destroy();
          }
        },
      );
      expect(outcome).toStrictEqual({ backlogged: true, dropped: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("proving each answer to a challenge", () => {
  it("D1566: a hello whose challenge is 257 characters, one past the frozen limit, is answered with no proof field", async () => {
    const answer = await onProvingServer((connection) => {
      connection.sendLine({ ...HELLO, challenge: OVERLONG_CHALLENGE });
      return connection.next();
    });
    expect(answer).toStrictEqual({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
    });
  });

  it("D1567: a hello whose challenge is exactly 256 characters is answered with a proof that verifies", async () => {
    const refusal = await onProvingServer(async (connection, verifier) => {
      connection.sendLine({ ...HELLO, challenge: LONGEST_CHALLENGE });
      const answer = await connection.next();
      return answer === CLOSED
        ? CLOSED
        : verifier.refusal(LONGEST_CHALLENGE, answer);
    });
    expect(refusal).toBeUndefined();
  });

  it("D1568: a hello without a challenge is answered with no proof field", async () => {
    const answer = await onProvingServer((connection) => {
      connection.sendLine(HELLO);
      return connection.next();
    });
    expect(answer).toStrictEqual({
      type: "hello",
      protocolVersion: PROTOCOL_VERSION,
      pid: process.pid,
    });
  });

  it("D1569: the version-mismatch error answering a challenged hello of the next version carries a proof that verifies", async () => {
    const refusal = await onProvingServer(async (connection, verifier) => {
      connection.sendLine({
        type: "hello",
        protocolVersion: OTHER_PROTOCOL_VERSION,
        challenge: "mismatch",
      });
      const answer = await connection.next();
      return answer === CLOSED ? CLOSED : verifier.refusal("mismatch", answer);
    });
    expect(refusal).toBeUndefined();
  });

  it("D1570: the frozen stop after a version mismatch, carrying a challenge, is acknowledged with a proof that verifies", async () => {
    const refusal = await onProvingServer(async (connection, verifier) => {
      connection.sendLine({
        type: "hello",
        protocolVersion: OTHER_PROTOCOL_VERSION,
        challenge: "mismatch",
      });
      await connection.next();
      connection.sendLine({ ...STOP, challenge: "stop" });
      const answer = await connection.next();
      return answer === CLOSED ? CLOSED : verifier.refusal("stop", answer);
    });
    expect(refusal).toBeUndefined();
  });
});

describe("the raw connection a test reads lines from", () => {
  /** Resolves on the next turn of the event loop, once every callback already queued has run. */
  function afterQueuedCallbacks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it("D2410: a connection an error closes reads as closed, rather than waiting on a line that cannot come", async () => {
    const connect = vi.spyOn(Socket.prototype, "connect");
    let read: unknown = "still waiting";
    try {
      await withTestEndpoint(
        () => undefined,
        (path) =>
          withConnection(path, async (connection) => {
            const socket = connect.mock.contexts[0];
            if (!(socket instanceof Socket)) {
              throw new Error("the raw connection opened no socket");
            }
            void connection.next().then((line) => {
              read = line;
            });
            const closed = new Promise((resolve) =>
              socket.once("close", resolve),
            );
            socket.destroy(
              Object.assign(new Error("read ECONNRESET"), {
                code: "ECONNRESET",
              }),
            );
            await closed;
            await afterQueuedCallbacks();
          }),
      );
    } finally {
      connect.mockRestore();
    }
    expect(read).toBe(CLOSED);
  });
});

describe("the socket a test endpoint listens on", () => {
  it("D2608: has a path that fits the bytes a Unix socket path allows, under the run's long temp directory", () => {
    expect(Buffer.byteLength(testSocketPath())).toBeLessThanOrEqual(
      SOCKET_PATH_LIMIT_BYTES,
    );
  });
});
