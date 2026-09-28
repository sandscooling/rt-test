import type { Socket } from "node:net";
import { isAbsolute } from "node:path";
import type {
  NoAnswer,
  PathStatusAnswer,
  SummaryAnswer,
} from "../query/answer.js";
import { errorText } from "../vitest/error-text.js";
import type { DaemonLog } from "./daemon-log.js";
import {
  encodeLine,
  ERROR_TYPE,
  HELLO_TYPE,
  isStopRequest,
  LineDecoder,
  MAX_LINE_BYTES,
  NOTHING_TO_ANSWER_CODE,
  parseLine,
  PATH_STATUS_TYPE,
  PROTOCOL_VERSION,
  QUERY_FAILED_CODE,
  STATUS_TYPE,
  STOPPING_CODE,
  STOPPING_TYPE,
  SUMMARY_TYPE,
  UNKNOWN_REQUEST_CODE,
  VERSION_MISMATCH_CODE,
  type DaemonIdentity,
  type DecodedLine,
  type ErrorCode,
  type ErrorResponse,
  type ProtocolMessage,
  type HelloResponse,
  type PathStatusResponse,
  type StatusResponse,
  type StopAcknowledgement,
  type SummaryResponse,
  type VersionMismatchError,
} from "./protocol.js";

/** What the daemon's lifecycle answers a connection with. */
export interface DaemonHandlers {
  readonly identity: DaemonIdentity;
  status(): Pick<StatusResponse, "activity" | "stopping" | "unstoredJobs">;
  /** Reads only: starts no job and changes no activity. */
  summary(): SummaryAnswer | NoAnswer;
  /** Reads only; `path` is absolute. */
  pathStatus(path: string): PathStatusAnswer | NoAnswer;
  /** Begins the stop, or joins the one under way. */
  stop(): void;
  isStopping(): boolean;
}

/** The proof answering a request's challenge, made with the daemon's key; undefined when there is no challenge. */
export type Prover = (challenge: unknown) => string | undefined;

export interface ConnectionServer {
  readonly onConnection: (socket: Socket) => void;
  /** Ends every open connection once what was written to it has flushed, or once the close grace passes. */
  closeConnections(): void;
}

type ConnectionState = "awaiting-hello" | "ready" | "mismatched";

/** How long a closing connection may take to flush before it is dropped, so a client that stops reading cannot hold the stop. */
export const CLOSE_GRACE_MS = 1_000;

/** Writes to a connection only in answer to a line it sent, so a client that cannot write receives nothing. */
export function connectionServer(
  handlers: DaemonHandlers,
  log: DaemonLog,
  prove: Prover,
): ConnectionServer {
  const sockets = new Set<Socket>();
  return {
    onConnection: (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      serve(socket, { handlers, prove }, log);
    },
    closeConnections: () => {
      for (const socket of sockets) {
        socket.end(() => socket.destroy());
        setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref();
      }
    },
  };
}

interface Answerer {
  readonly handlers: DaemonHandlers;
  readonly prove: Prover;
}

function serve(socket: Socket, answerer: Answerer, log: DaemonLog): void {
  const decoder = new LineDecoder();
  const connection = { state: "awaiting-hello" as ConnectionState };
  socket.on("data", (chunk: Buffer) => {
    for (const line of decoder.push(chunk)) {
      if (!socket.writable) return;
      answer(socket, connection, line, answerer);
    }
  });
  socket.on("error", (error) => {
    log.entry(`a client connection failed: ${errorText(error)}`);
  });
}

function answer(
  socket: Socket,
  connection: { state: ConnectionState },
  line: DecodedLine,
  answerer: Answerer,
): void {
  const { handlers, prove } = answerer;
  const parsed = line.tooLong ? undefined : parseLine(line.text);
  if (parsed?.ok === true && isStopRequest(parsed.message)) {
    send(
      socket,
      stopAcknowledgement(handlers, prove(parsed.message["challenge"])),
    );
    handlers.stop();
    return;
  }
  if (connection.state === "mismatched") {
    socket.end();
    return;
  }
  if (parsed === undefined) {
    send(
      socket,
      error("line-too-long", `a line is longer than ${MAX_LINE_BYTES} bytes`),
    );
    return;
  }
  if (!parsed.ok) {
    send(socket, error("invalid-json", `the line is ${parsed.reason}`));
    return;
  }
  const message = parsed.message;
  if (message["type"] === HELLO_TYPE) {
    connection.state = hello(socket, message, answerer);
    return;
  }
  if (connection.state === "awaiting-hello") {
    send(
      socket,
      error(
        "hello-required",
        "send a hello before any request other than stop",
      ),
    );
    return;
  }
  send(socket, versionedAnswer(message, handlers));
}

function hello(
  socket: Socket,
  message: ProtocolMessage,
  { handlers, prove }: Answerer,
): ConnectionState {
  const clientVersion = message["protocolVersion"];
  const proof = prove(message["challenge"]);
  if (clientVersion === PROTOCOL_VERSION) {
    const response: HelloResponse = {
      type: HELLO_TYPE,
      protocolVersion: PROTOCOL_VERSION,
      pid: handlers.identity.pid,
      ...withProof(proof),
    };
    send(socket, response);
    return "ready";
  }
  const mismatch: VersionMismatchError = {
    type: ERROR_TYPE,
    code: VERSION_MISMATCH_CODE,
    message: `the daemon, process ${handlers.identity.pid}, speaks protocol version ${PROTOCOL_VERSION}, not ${JSON.stringify(clientVersion ?? null)}; only a stop request is accepted on this connection`,
    protocolVersion: PROTOCOL_VERSION,
    clientProtocolVersion: clientVersion ?? null,
    pid: handlers.identity.pid,
    ...withProof(proof),
  };
  send(socket, mismatch);
  return "mismatched";
}

type VersionedAnswer =
  StatusResponse | SummaryResponse | PathStatusResponse | ErrorResponse;

function versionedAnswer(
  message: ProtocolMessage,
  handlers: DaemonHandlers,
): VersionedAnswer {
  if (message["protocolVersion"] !== PROTOCOL_VERSION) {
    return error(
      "invalid-request",
      `a request must carry protocolVersion ${PROTOCOL_VERSION}`,
    );
  }
  if (message["type"] === STATUS_TYPE) {
    return { type: STATUS_TYPE, ...handlers.identity, ...handlers.status() };
  }
  if (handlers.isStopping()) {
    return error(STOPPING_CODE, "the daemon is stopping");
  }
  if (message["type"] === SUMMARY_TYPE) {
    return queryResponse(() => withType(SUMMARY_TYPE, handlers.summary()));
  }
  if (message["type"] === PATH_STATUS_TYPE) {
    return pathStatusResponse(message["path"], handlers);
  }
  return error(
    UNKNOWN_REQUEST_CODE,
    `unknown request type ${JSON.stringify(message["type"] ?? null)}`,
  );
}

function pathStatusResponse(
  path: unknown,
  handlers: DaemonHandlers,
): PathStatusResponse | ErrorResponse {
  if (typeof path !== "string" || !isAbsolute(path)) {
    return error(
      "invalid-request",
      `a ${PATH_STATUS_TYPE} request must carry an absolute path; got ${JSON.stringify(path ?? null)}`,
    );
  }
  return queryResponse(() =>
    withType(PATH_STATUS_TYPE, handlers.pathStatus(path)),
  );
}

function withType<T extends string, A extends object>(
  type: T,
  answer: A | NoAnswer,
): (A & { type: T; protocolVersion: number }) | NoAnswer {
  if ("noAnswer" in answer) return answer;
  return { ...answer, type, protocolVersion: PROTOCOL_VERSION };
}

/** A query that throws, has nothing to answer, or would pass the line limit is answered with an error saying why. */
function queryResponse<R extends object>(
  answer: () => R | NoAnswer,
): R | ErrorResponse {
  let response: R | NoAnswer;
  try {
    response = answer();
  } catch (failure) {
    return error(QUERY_FAILED_CODE, `the query failed: ${errorText(failure)}`);
  }
  if ("noAnswer" in response) {
    return error(NOTHING_TO_ANSWER_CODE, response.noAnswer);
  }
  const size = Buffer.byteLength(JSON.stringify(response));
  if (size > MAX_LINE_BYTES) {
    return error(
      NOTHING_TO_ANSWER_CODE,
      `the answer is ${size} bytes, longer than the protocol's line limit of ${MAX_LINE_BYTES} bytes; ask status for a narrower path`,
    );
  }
  return response;
}

function stopAcknowledgement(
  handlers: DaemonHandlers,
  proof: string | undefined,
): StopAcknowledgement {
  return {
    type: STOPPING_TYPE,
    pid: handlers.identity.pid,
    logFile: handlers.identity.logFile,
    ...withProof(proof),
  };
}

/** A request without a challenge gets no proof field, rather than one holding nothing. */
function withProof(proof: string | undefined): { proof?: string } {
  return proof === undefined ? {} : { proof };
}

function error(code: ErrorCode, message: string): ErrorResponse {
  return { type: ERROR_TYPE, protocolVersion: PROTOCOL_VERSION, code, message };
}

function send(socket: Socket, message: object): void {
  if (socket.writable) socket.write(encodeLine(message));
}
