import { once } from "node:events";
import { createConnection, Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { DaemonConnection } from "../src/daemon/daemon-connection.js";
import {
  daemonVerifier,
  type DaemonVerifier,
} from "../src/daemon/endpoint-proof.js";
import {
  PROTOCOL_VERSION,
  RESPONSE_BOUND_MS,
  type DaemonIdentity,
} from "../src/daemon/protocol.js";
import type {
  NoAnswer,
  PathStatusAnswer,
  SummaryAnswer,
} from "../src/query/answer.js";
import {
  CLOSE_GRACE_MS,
  connectionServer,
  type ChangesQuery,
  type DaemonHandlers,
  type Prover,
  type WaitQuery,
} from "../src/daemon/server.js";
import {
  CLOSED,
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
  RawConnection,
  settled,
  until,
  withConnection,
} from "./daemon-harness.js";
import {
  KEY_TEST_OPTIONS,
  keyedEndpoint,
  withDaemonKey,
} from "./daemon-key.js";
import { HAND_BUILT_ROOT, inTempDir, WAITING, within } from "./harness.js";
import { join } from "node:path";
import { Deferred } from "./scheduling-harness.js";
import { testSocketPath, withTestEndpoint } from "./test-endpoint.js";
import { unhandledRejectionsDuring } from "./unhandled-rejections.js";

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

/** The stand-in begins its stop as the lifecycle does, by aborting `stop`, whose signal `isStopping` reads. */
function handlers(
  stopping: boolean,
  queries: Queries = {},
  stop = new AbortController(),
): DaemonHandlers {
  if (stopping) stop.abort();
  return {
    identity: IDENTITY,
    stopSignal: stop.signal,
    status: () => ({
      activity: { state: "idle" },
      stopping: stop.signal.aborted,
      unstoredJobs: [],
    }),
    summary: () => NO_STAND_IN_ANSWER,
    pathStatus: () => NO_STAND_IN_ANSWER,
    wait: () => NO_STAND_IN_ANSWER,
    changes: () => NO_STAND_IN_ANSWER,
    ...queries,
    stop: () => stop.abort(),
    isStopping: () => stop.signal.aborted,
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

/** An answer by its type and error code, which is what a client branches on. */
function kindOf(
  line: Awaited<ReturnType<RawConnection["next"]>> | typeof WAITING,
): unknown {
  if (line === CLOSED || line === WAITING) return line;
  return {
    type: line["type"],
    ...("code" in line ? { code: line["code"] } : {}),
  };
}

/** Each of the next `count` answers by its kind. */
async function answerKinds(
  connection: RawConnection,
  count: number,
): Promise<unknown[]> {
  const kinds: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    kinds.push(kindOf(await connection.next()));
  }
  return kinds;
}

const SUMMARY = { type: "summary", protocolVersion: PROTOCOL_VERSION };

/** Several requests written at once, so the daemon reads them together, in order. */
function linesOf(...messages: object[]): string {
  return messages.map((message) => `${JSON.stringify(message)}\n`).join("");
}

/** A summary whose content no test reads: only its type reaches a client's branch. */
const LATE_SUMMARY = { answered: "late" } as unknown as SummaryAnswer;

/** Answers every summary with a promise the test settles, recording the signal each summary's work was given. */
class LateSummaries {
  readonly signals: AbortSignal[] = [];
  readonly #answers: Deferred<SummaryAnswer | NoAnswer>[] = [];

  readonly summary = (
    signal: AbortSignal,
  ): Promise<SummaryAnswer | NoAnswer> => {
    const answer = new Deferred<SummaryAnswer | NoAnswer>();
    this.signals.push(signal);
    this.#answers.push(answer);
    return answer.promise;
  };

  /** Settles the summary asked `index`th, from 0. */
  answer(index: number, value: SummaryAnswer | NoAnswer = LATE_SUMMARY): void {
    this.#answers[index]?.resolve(value);
  }

  /** Resolves once `count` summaries have been asked. */
  asked(count: number): Promise<void> {
    return until(() => this.signals.length === count);
  }
}

/**
 * Serves stand-in handlers whose summaries `late` answers, and hands `body` a way to open connections to them and the
 * controller whose abort begins the stop, as the lifecycle's `stop()` does for a stop signal. Closes every connection
 * however `body` ends.
 */
function onLateServer<T>(
  late: LateSummaries,
  body: (
    connect: () => Promise<RawConnection>,
    stop: AbortController,
  ) => Promise<T>,
  queries: Queries = {},
): Promise<T> {
  const stop = new AbortController();
  const server = connectionServer(
    handlers(false, { summary: late.summary, ...queries }, stop),
    memoryLog(),
    NO_PROOF,
  );
  const opened: RawConnection[] = [];
  return withTestEndpoint(server.onConnection, async (path) => {
    try {
      return await body(async () => {
        const connection = await RawConnection.open(path);
        opened.push(connection);
        return connection;
      }, stop);
    } finally {
      for (const connection of opened) connection.close();
    }
  });
}

/** A connection that has said hello, with `requests` written after it; resolves once the hello's answer is read. */
async function helloThen(
  connect: () => Promise<RawConnection>,
  ...requests: object[]
): Promise<RawConnection> {
  const connection = await connect();
  connection.send(linesOf(HELLO, ...requests));
  await connection.next();
  return connection;
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

  it("D3199: a status while the daemon stops is answered with the status, not the stopping error", async () => {
    const kinds = await onServer((connection) => {
      connection.send(linesOf(HELLO, STATUS));
      return answerKinds(connection, 2);
    }, true);
    expect(kinds).toStrictEqual([{ type: "hello" }, { type: "status" }]);
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

  it("D3204: a query whose work rejects later gets a query-failed error saying what went wrong", async () => {
    expect(
      await summaryError({
        summary: () => Promise.reject(new Error("the store is unreadable")),
      }),
    ).toStrictEqual({
      type: "error",
      code: "query-failed",
      message: expect.stringContaining("the store is unreadable"),
    });
  });

  it("D3205: a query whose work later has nothing to answer gets a nothing-to-answer error carrying the reason", async () => {
    const reason = "the latest discovery holds no test";
    expect(
      await summaryError({
        summary: () => Promise.resolve({ noAnswer: reason }),
      }),
    ).toStrictEqual({
      type: "error",
      code: "nothing-to-answer",
      message: reason,
    });
  });

  it("D3206: a late answer one byte past the line limit is refused with a reason giving its size and the limit", async () => {
    const answer = answerOfSize(LINE_LIMIT_BYTES + 1);
    expect(
      await summaryError({ summary: () => Promise.resolve(answer) }),
    ).toStrictEqual({
      type: "error",
      code: "nothing-to-answer",
      message: expect.stringMatching(/1048577 bytes.*1048576 bytes/),
    });
  });
});

/** Long enough for a line the daemon wrote at once to reach the client, so its absence means it was not written. */
const NOT_WRITTEN_MS = 100;
const PATH_STATUS = {
  type: "path-status",
  protocolVersion: PROTOCOL_VERSION,
  path: IDENTITY.consumerRoot,
};
/** A path status whose content no test reads. */
const AT_ONCE_PATH_STATUS = {
  answered: "at once",
} as unknown as PathStatusAnswer;

describe(
  "answering a request once its answer is ready",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3187: a late answer is written on its connection once its work resolves, and not before", async () => {
      const late = new LateSummaries();
      const outcome = await onLateServer(late, async (connect) => {
        const connection = await helloThen(connect, SUMMARY);
        await late.asked(1);
        const answer = connection.next();
        const before = await within(answer, NOT_WRITTEN_MS);
        late.answer(0);
        return {
          before: kindOf(before),
          after: kindOf(await within(answer, RESPONSE_BOUND_MS)),
        };
      });
      expect(outcome).toStrictEqual({
        before: WAITING,
        after: { type: "summary" },
      });
    });

    it("D3188: while a request is pending, another connection's hello, status, summary, path status and stop are each answered", async () => {
      const late = new LateSummaries();
      let summaries = 0;
      const kinds = await onLateServer(
        late,
        async (connect) => {
          await helloThen(connect, SUMMARY);
          await late.asked(1);
          const other = await connect();
          other.send(linesOf(HELLO, STATUS, SUMMARY, PATH_STATUS, STOP));
          return within(answerKinds(other, 5), RESPONSE_BOUND_MS);
        },
        {
          summary: (signal) => {
            summaries += 1;
            return summaries === 1 ? late.summary(signal) : LATE_SUMMARY;
          },
          pathStatus: () => AT_ONCE_PATH_STATUS,
        },
      );
      expect(kinds).toStrictEqual([
        { type: "hello" },
        { type: "status" },
        { type: "summary" },
        { type: "path-status" },
        { type: "stopping" },
      ]);
    });

    it("D3189: an answer ready at once waits behind an earlier one still pending on its connection", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect) => {
        const connection = await helloThen(connect, SUMMARY, STATUS);
        await late.asked(1);
        late.answer(0);
        return within(answerKinds(connection, 2), RESPONSE_BOUND_MS);
      });
      expect(kinds).toStrictEqual([{ type: "summary" }, { type: "status" }]);
    });

    it("D3190: a connection with 8 requests unanswered stays open, and each is answered in turn", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect) => {
        const connection = await helloThen(
          connect,
          ...Array.from({ length: 8 }, () => SUMMARY),
        );
        await late.asked(8);
        for (let index = 0; index < 8; index += 1) late.answer(index);
        return within(answerKinds(connection, 8), RESPONSE_BOUND_MS);
      });
      expect(kinds).toStrictEqual(
        Array.from({ length: 8 }, () => ({ type: "summary" })),
      );
    });

    it("D3191: a connection that leaves 9 requests unanswered is closed", async () => {
      const late = new LateSummaries();
      const next = await onLateServer(late, async (connect) => {
        const connection = await helloThen(
          connect,
          ...Array.from({ length: 9 }, () => SUMMARY),
        );
        return within(connection.next(), RESPONSE_BOUND_MS);
      });
      expect(next).toBe(CLOSED);
    });

    it("D3193: after a hello of another version behind a pending request, the next line ends the connection only once that answer and the mismatch error are written", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect) => {
        const connection = await helloThen(
          connect,
          SUMMARY,
          { type: "hello", protocolVersion: OTHER_PROTOCOL_VERSION },
          STATUS,
        );
        await late.asked(1);
        late.answer(0);
        return within(answerKinds(connection, 3), RESPONSE_BOUND_MS);
      });
      expect(kinds).toStrictEqual([
        { type: "summary" },
        { type: "error", code: "protocol-version-mismatch" },
        CLOSED,
      ]);
    });

    it("D3249: a connection that leaves 9 requests unanswered, 8 of them answered at once behind a pending one, is closed and the pending work aborted", async () => {
      const late = new LateSummaries();
      const outcome = await onLateServer(late, async (connect) => {
        const connection = await helloThen(
          connect,
          SUMMARY,
          ...Array.from({ length: 8 }, () => STATUS),
        );
        const next = await within(connection.next(), RESPONSE_BOUND_MS);
        return { next, aborted: late.signals[0]?.aborted };
      });
      expect(outcome).toStrictEqual({ next: CLOSED, aborted: true });
    });
  },
);

describe(
  "a stop while requests are pending",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3194: a stop begun by a signal answers a pending request with the stopping error at once", async () => {
      const late = new LateSummaries();
      const answer = await onLateServer(late, async (connect, stop) => {
        const connection = await helloThen(connect, SUMMARY);
        await late.asked(1);
        stop.abort();
        return kindOf(await within(connection.next(), RESPONSE_BOUND_MS));
      });
      expect(answer).toStrictEqual({ type: "error", code: "stopping" });
    });

    it("D3195: a stop aborts the signal of a pending request's work", async () => {
      const late = new LateSummaries();
      const aborted = await onLateServer(late, async (connect, stop) => {
        const connection = await helloThen(connect, SUMMARY);
        await late.asked(1);
        stop.abort();
        await within(connection.next(), RESPONSE_BOUND_MS);
        return late.signals[0]?.aborted;
      });
      expect(aborted).toBe(true);
    });

    it("D3196: a request the stop answered never has its work's later answer written, so the next answer is the next request's", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect, stop) => {
        const connection = await helloThen(connect, SUMMARY);
        await late.asked(1);
        stop.abort();
        const stopping = await within(connection.next(), RESPONSE_BOUND_MS);
        late.answer(0);
        await afterATurn();
        connection.sendLine(STATUS);
        return [
          kindOf(stopping),
          kindOf(await within(connection.next(), RESPONSE_BOUND_MS)),
        ];
      });
      expect(kinds).toStrictEqual([
        { type: "error", code: "stopping" },
        { type: "status" },
      ]);
    });

    it("D3197: an answer already computed and waiting behind a pending request is written as computed after the stopping error", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect, stop) => {
        const connection = await helloThen(connect, SUMMARY, STATUS);
        await late.asked(1);
        stop.abort();
        return within(answerKinds(connection, 2), RESPONSE_BOUND_MS);
      });
      expect(kinds).toStrictEqual([
        { type: "error", code: "stopping" },
        { type: "status" },
      ]);
    });

    it("D3198: a stop request behind a pending request is acknowledged after that request's stopping error", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect) => {
        const connection = await helloThen(connect, SUMMARY, STOP);
        return within(answerKinds(connection, 2), RESPONSE_BOUND_MS);
      });
      expect(kinds).toStrictEqual([
        { type: "error", code: "stopping" },
        { type: "stopping" },
      ]);
    });

    it("D3254: a stop request behind 8 pending requests is acknowledged after their 8 stopping errors, rather than closing the connection past the bound", async () => {
      const late = new LateSummaries();
      const kinds = await onLateServer(late, async (connect) => {
        const connection = await helloThen(
          connect,
          ...Array.from({ length: 8 }, () => SUMMARY),
          STOP,
        );
        return within(answerKinds(connection, 9), RESPONSE_BOUND_MS);
      });
      expect(kinds).toStrictEqual([
        ...Array.from({ length: 8 }, () => ({
          type: "error",
          code: "stopping",
        })),
        { type: "stopping" },
      ]);
    });
  },
);

describe(
  "a client that closes while its request is pending",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3202: the pending request's work signal aborts", async () => {
      const late = new LateSummaries();
      const aborted = await onLateServer(late, async (connect) => {
        const connection = await helloThen(connect, SUMMARY);
        await late.asked(1);
        connection.close();
        return eventually(
          () => late.signals[0]?.aborted === true,
          RESPONSE_BOUND_MS,
        );
      });
      expect(aborted).toBe(true);
    });

    it("D3203: a rejection the work gives after the close is never an unhandled rejection", async () => {
      const late = new LateSummaries();
      const workEnds = new Deferred<void>();
      const unhandled = await unhandledRejectionsDuring(() =>
        onLateServer(
          late,
          async (connect) => {
            const connection = await helloThen(connect, SUMMARY);
            await late.asked(1);
            connection.close();
            await eventually(
              () => late.signals[0]?.aborted === true,
              RESPONSE_BOUND_MS,
            );
            workEnds.resolve();
            await afterATurn();
          },
          {
            summary: (signal) => {
              void late.summary(signal);
              return workEnds.promise.then(() => {
                throw new Error("the work was aborted");
              });
            },
          },
        ),
      );
      expect(unhandled.map(String)).toStrictEqual([]);
    });
  },
);

/** Longer than the default bound, as a caller whose request waits on work gives. */
const CALLER_BOUND_MS = 30_000;
/** Node's timer ceiling: a longer delay fires after 1 ms. */
const TIMER_CEILING_MS = 2_147_483_647;
const PENDING = "pending";

/** Serves stand-in handlers with `queries`, and hands `body` a client connection that has said hello. */
function withClient<T>(
  queries: Queries,
  body: (client: DaemonConnection) => Promise<T>,
): Promise<T> {
  const server = connectionServer(
    handlers(false, queries),
    memoryLog(),
    NO_PROOF,
  );
  return withTestEndpoint(server.onConnection, async (path) => {
    const opened = await DaemonConnection.open(path);
    if (!opened.ok) throw new Error(opened.reason);
    try {
      await opened.connection.request(HELLO);
      return await body(opened.connection);
    } finally {
      opened.connection.close();
    }
  });
}

/** Resolves once the event loop has turned, so every settled promise's callbacks have run. */
function afterATurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Asks a summary the stand-in never answers, with `boundMs` or the default, and says how the request stands just
 * before the bound passes and once it has, on a fake clock.
 */
async function aroundTheBound(
  boundMs: number,
  ask: (client: DaemonConnection) => Promise<unknown>,
): Promise<unknown> {
  const late = new LateSummaries();
  return withClient({ summary: late.summary }, async (client) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let state: unknown = PENDING;
      void settled(ask(client)).then((outcome) => {
        state = outcome;
      });
      await vi.advanceTimersByTimeAsync(boundMs - 1);
      await afterATurn();
      const before = state;
      await vi.advanceTimersByTimeAsync(1);
      await afterATurn();
      return { before, after: state };
    } finally {
      vi.useRealTimers();
    }
  });
}

/** Whether a request refused as a `RangeError` named `bound` and the range, or else how the request ended. */
async function boundRefusal(bound: number): Promise<unknown> {
  return withClient({}, async (client) => {
    const outcome = await client.request(STATUS, bound).then(
      (answer) => kindOf(answer),
      (error: unknown) => error,
    );
    if (!(outcome instanceof RangeError)) {
      return outcome instanceof Error ? outcome.message : outcome;
    }
    const words = outcome.message.split(/[^\w.]+/);
    return {
      namesBound: words.includes(String(bound)),
      namesRange:
        words.includes("1") && words.includes(String(TIMER_CEILING_MS)),
    };
  });
}

const NAMES_BOUND_AND_RANGE = { namesBound: true, namesRange: true };

describe(
  "a client's bound on an answer",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3207: a request given a bound waits that long, past the default, then rejects naming it", async () => {
      expect(
        await aroundTheBound(CALLER_BOUND_MS, (client) =>
          client.request(SUMMARY, CALLER_BOUND_MS),
        ),
      ).toStrictEqual({
        before: PENDING,
        after: { thrown: expect.stringContaining("30000 ms") },
      });
    });

    it("D3208: a request given no bound waits 10000 ms, then rejects naming it", async () => {
      expect(
        await aroundTheBound(10_000, (client) => client.request(SUMMARY)),
      ).toStrictEqual({
        before: PENDING,
        after: { thrown: expect.stringContaining("10000 ms") },
      });
    });

    it("D3209: a request whose bound passes closes its connection, so the daemon aborts the request's work", async () => {
      const late = new LateSummaries();
      const aborted = await withClient(
        { summary: late.summary },
        async (client) => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          try {
            void settled(client.request(SUMMARY, CALLER_BOUND_MS));
            while (late.signals.length === 0) await afterATurn();
            await vi.advanceTimersByTimeAsync(CALLER_BOUND_MS);
          } finally {
            vi.useRealTimers();
          }
          return eventually(
            () => late.signals[0]?.aborted === true,
            RESPONSE_BOUND_MS,
          );
        },
      );
      expect(aborted).toBe(true);
    });

    it("D3210: a bound of 0 ms is refused, naming the bound and the range", async () => {
      expect(await boundRefusal(0)).toStrictEqual(NAMES_BOUND_AND_RANGE);
    });

    it("D3211: a bound of 1.5 ms is refused, naming the bound and the range", async () => {
      expect(await boundRefusal(1.5)).toStrictEqual(NAMES_BOUND_AND_RANGE);
    });

    it("D3248: a bound of NaN is refused, naming the bound and the range", async () => {
      expect(await boundRefusal(Number.NaN)).toStrictEqual(
        NAMES_BOUND_AND_RANGE,
      );
    });

    it("D3212: a bound of 2147483648 ms, one past the timer's ceiling, is refused, naming the bound and the range", async () => {
      expect(await boundRefusal(TIMER_CEILING_MS + 1)).toStrictEqual(
        NAMES_BOUND_AND_RANGE,
      );
    });

    it("D3213: a bound of 1 ms is kept: a request the daemon has not answered rejects naming it", async () => {
      const late = new LateSummaries();
      const outcome = await withClient({ summary: late.summary }, (client) =>
        settled(client.request(SUMMARY, 1)),
      );
      expect(outcome).toStrictEqual({
        thrown: expect.stringMatching(/\b1 ms\b/),
      });
    });

    it("D3214: a bound of 2147483647 ms, the timer's ceiling, is kept: the request is answered", async () => {
      expect(await boundRefusal(TIMER_CEILING_MS)).toStrictEqual({
        type: "status",
      });
    });

    it("D3215: a refused bound writes nothing, so the next request gets its own answer", async () => {
      const answer = await withClient({}, async (client) => {
        await settled(client.request(SUMMARY, 0));
        return kindOf(await client.request(STATUS));
      });
      expect(answer).toStrictEqual({ type: "status" });
    });

    it("D3216: a second request while the first waits for its answer is refused, and the first gets its own answer", async () => {
      const late = new LateSummaries();
      const outcome = await withClient(
        { summary: late.summary },
        async (client) => {
          const first = settled(client.request(SUMMARY));
          const second = settled(client.request(STATUS));
          await late.asked(1);
          late.answer(0);
          const answered = await within(first, RESPONSE_BOUND_MS);
          return {
            first:
              answered === WAITING || "thrown" in answered
                ? answered
                : kindOf(answered),
            second: await within(second, RESPONSE_BOUND_MS),
          };
        },
      );
      expect(outcome).toStrictEqual({
        first: { type: "summary" },
        second: {
          thrown: expect.stringContaining("still waits for its answer"),
        },
      });
    });
  },
);

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

describe("proving each answer to a challenge", KEY_TEST_OPTIONS, () => {
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
            await afterATurn();
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

/** An absolute path a wait may name, on either host. */
const WAITED_FILE = join(HAND_BUILT_ROOT, "a.ts");

/** A wait request naming `paths`, with `more` beside them. */
function waitRequest(paths: readonly string[], more: object = {}): object {
  return { type: "wait", protocolVersion: PROTOCOL_VERSION, paths, ...more };
}

/**
 * Sends each request after a hello to a server whose wait records what reached it, and resolves with each answer by
 * its kind and each wait the handler was given, by its path count and limit.
 */
async function waitsAnswered(
  ...requests: object[]
): Promise<{ kinds: unknown[]; asked: [number, number][] }> {
  const asked: WaitQuery[] = [];
  const server = connectionServer(
    {
      ...handlers(false),
      wait: (query) => {
        asked.push(query);
        return NO_STAND_IN_ANSWER;
      },
    },
    memoryLog(),
    NO_PROOF,
  );
  const kinds = await withTestEndpoint(server.onConnection, (path) =>
    withConnection(path, (connection) => {
      connection.send(linesOf(HELLO, ...requests));
      return answerKinds(connection, requests.length + 1);
    }),
  );
  return {
    kinds: kinds.slice(1),
    asked: asked.map((query) => [query.paths.length, query.limitMs]),
  };
}

describe("a wait request", () => {
  it("D3424: one carrying no limit reaches the wait with a limit of 100000 ms", async () => {
    expect(await waitsAnswered(waitRequest([WAITED_FILE]))).toStrictEqual({
      kinds: [{ type: "error", code: "nothing-to-answer" }],
      asked: [[1, 100_000]],
    });
  });

  it("D3425: one whose limit is null, as a limit that is not a number serializes, is refused as invalid rather than given the default", async () => {
    expect(
      await waitsAnswered(waitRequest([WAITED_FILE], { limitMs: null })),
    ).toStrictEqual({
      kinds: [{ type: "error", code: "invalid-request" }],
      asked: [],
    });
  });

  it("D3426: one naming 1001 paths or a limit of 3600001 ms is refused, while 1000 paths and a limit of 3600000 ms reach the wait", async () => {
    const paths = (count: number): string[] =>
      Array.from({ length: count }, (_, index) =>
        join(HAND_BUILT_ROOT, `${index}.ts`),
      );
    expect(
      await waitsAnswered(
        waitRequest(paths(1001)),
        waitRequest(paths(1000)),
        waitRequest([WAITED_FILE], { limitMs: 3_600_001 }),
        waitRequest([WAITED_FILE], { limitMs: 3_600_000 }),
      ),
    ).toStrictEqual({
      kinds: [
        { type: "error", code: "invalid-request" },
        { type: "error", code: "nothing-to-answer" },
        { type: "error", code: "invalid-request" },
        { type: "error", code: "nothing-to-answer" },
      ],
      asked: [
        [1000, 100_000],
        [1, 3_600_000],
      ],
    });
  });
});

describe("a wait request naming no path", () => {
  it("D3460: one whose paths are an empty list is refused as invalid, and never reaches the wait", async () => {
    expect(await waitsAnswered(waitRequest([]))).toStrictEqual({
      kinds: [{ type: "error", code: "invalid-request" }],
      asked: [],
    });
  });
});

/** A changes request naming `paths`, with `more` beside them. */
function changesRequest(paths: readonly string[], more: object = {}): object {
  return { type: "changes", protocolVersion: PROTOCOL_VERSION, paths, ...more };
}

/**
 * Sends each request after a hello to a server whose changes query records what reached it, and resolves with each
 * answer by its kind and each query the handler was given, by its path count and cursor.
 */
async function changesAnswered(
  ...requests: object[]
): Promise<{ kinds: unknown[]; asked: [number, string | undefined][] }> {
  const asked: ChangesQuery[] = [];
  const server = connectionServer(
    {
      ...handlers(false),
      changes: (query) => {
        asked.push(query);
        return NO_STAND_IN_ANSWER;
      },
    },
    memoryLog(),
    NO_PROOF,
  );
  const kinds = await withTestEndpoint(server.onConnection, (path) =>
    withConnection(path, (connection) => {
      connection.send(linesOf(HELLO, ...requests));
      return answerKinds(connection, requests.length + 1);
    }),
  );
  return {
    kinds: kinds.slice(1),
    asked: asked.map((query) => [query.paths.length, query.since]),
  };
}

describe("a changes request", () => {
  it("D3498: one naming 1001 paths is refused, while one naming 1000 reaches the query", async () => {
    const paths = (count: number): string[] =>
      Array.from({ length: count }, (_, index) =>
        join(HAND_BUILT_ROOT, `${index}.ts`),
      );
    expect(
      await changesAnswered(
        changesRequest(paths(1001)),
        changesRequest(paths(1000)),
      ),
    ).toStrictEqual({
      kinds: [
        { type: "error", code: "invalid-request" },
        { type: "error", code: "nothing-to-answer" },
      ],
      asked: [[1000, undefined]],
    });
  });

  it("D3499: one whose cursor is an empty string or not a string is refused, while a cursor given reaches the query and none reaches it as none", async () => {
    expect(
      await changesAnswered(
        changesRequest([WAITED_FILE], { since: "" }),
        changesRequest([WAITED_FILE], { since: 7 }),
        changesRequest([WAITED_FILE], { since: "cursor-1" }),
        changesRequest([WAITED_FILE]),
      ),
    ).toStrictEqual({
      kinds: [
        { type: "error", code: "invalid-request" },
        { type: "error", code: "invalid-request" },
        { type: "error", code: "nothing-to-answer" },
        { type: "error", code: "nothing-to-answer" },
      ],
      asked: [
        [1, "cursor-1"],
        [1, undefined],
      ],
    });
  });
});
