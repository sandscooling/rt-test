import type { Socket } from "node:net";
import { errorText } from "../vitest/error-text.js";
import type { DaemonLog } from "./daemon-log.js";
import {
  encodeLine,
  ERROR_TYPE,
  HELLO_TYPE,
  isStopRequest,
  LineDecoder,
  MAX_LINE_BYTES,
  parseLine,
  PROTOCOL_VERSION,
  STATUS_TYPE,
  STOPPING_TYPE,
  VERSION_MISMATCH_CODE,
  type DaemonIdentity,
  type DecodedLine,
  type ErrorCode,
  type ErrorResponse,
  type ProtocolMessage,
  type HelloResponse,
  type StatusResponse,
  type StopAcknowledgement,
  type VersionMismatchError,
} from "./protocol.js";

/** What the daemon's lifecycle answers a connection with. */
export interface DaemonHandlers {
  readonly identity: DaemonIdentity;
  status(): Pick<StatusResponse, "activity" | "stopping" | "unstoredJobs">;
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
const CLOSE_GRACE_MS = 1_000;

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

function versionedAnswer(
  message: ProtocolMessage,
  handlers: DaemonHandlers,
): StatusResponse | ErrorResponse {
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
    return error("stopping", "the daemon is stopping");
  }
  return error(
    "unknown-request",
    `unknown request type ${JSON.stringify(message["type"] ?? null)}`,
  );
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
