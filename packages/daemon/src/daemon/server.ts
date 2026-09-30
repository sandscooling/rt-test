import type { Socket } from "node:net";
import { isAbsolute } from "node:path";
import type {
  NoAnswer,
  PathStatusAnswer,
  RefusedQuery,
  SummaryAnswer,
  WaitAnswer,
} from "../query/answer.js";
import type { ChangesAnswer } from "../query/changes-answer.js";
import { errorText } from "../vitest/error-text.js";
import type { DaemonLog } from "./daemon-log.js";
import {
  CHANGES_TYPE,
  encodeLine,
  ERROR_TYPE,
  HELLO_TYPE,
  isCursor,
  isStopRequest,
  isWaitLimit,
  LineDecoder,
  MAX_CHANGES_PATHS,
  MAX_CURSOR_CHARACTERS,
  MAX_LINE_BYTES,
  MAX_WAIT_LIMIT_MS,
  MAX_WAIT_PATHS,
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
  WAIT_LIMIT_MS,
  WAIT_TYPE,
  type ChangesResponse,
  type DaemonIdentity,
  type DecodedLine,
  type ErrorResponse,
  type ProtocolMessage,
  type HelloResponse,
  type PathStatusResponse,
  type StatusResponse,
  type StopAcknowledgement,
  type SummaryResponse,
  type VersionMismatchError,
  type WaitResponse,
} from "./protocol.js";
import {
  editedPaths,
  error,
  namedPaths,
  valueShape,
} from "./request-fields.js";

type Answered<A> = A | NoAnswer | RefusedQuery;
/** A query's answer, or a promise of it when its work is still to come. */
type QueryAnswer<A> = Answered<A> | Promise<Answered<A>>;

/** A wait request the server has checked. */
export interface WaitQuery {
  /** Absolute. */
  readonly paths: readonly string[];
  readonly limitMs: number;
}

/** A changes request the server has checked. */
export interface ChangesQuery {
  /** Absolute. */
  readonly paths: readonly string[];
  /** Absent for a baseline. */
  readonly since: string | undefined;
  /** The files among `paths` the caller edited, each as given; empty when it named none. */
  readonly edited: readonly string[];
}

/** What a too-large answer's error asks for instead: fewer files for a wait or a changes query, a narrower path for the others. */
const NARROWER_REQUEST = {
  path: "ask status for a narrower path",
  files: "wait on fewer files",
  changedFiles: "ask for the changes of fewer files",
} as const;

/**
 * What the daemon's lifecycle answers a connection with. A query that answers with a promise has its `signal` aborted
 * once nobody waits for that answer: the stop began, or its connection closed, by the client or past the daemon's bound
 * on unanswered requests.
 */
export interface DaemonHandlers {
  readonly identity: DaemonIdentity;
  /** Aborts as the stop begins, before the stop sequence closes anything. */
  readonly stopSignal: AbortSignal;
  status(): Pick<StatusResponse, "activity" | "stopping" | "unstoredJobs">;
  /** Reads only: starts no job and changes no activity. */
  summary(signal: AbortSignal): QueryAnswer<SummaryAnswer>;
  /** Reads only; `path` is absolute. */
  pathStatus(path: string, signal: AbortSignal): QueryAnswer<PathStatusAnswer>;
  /** Reads only: starts no job; answers once the files' covering tests settle, their inputs move, or the limit passes. */
  wait(query: WaitQuery, signal: AbortSignal): QueryAnswer<WaitAnswer>;
  /** Reads only: starts no job and never waits; answers what changed for the files' covering tests since a cursor. */
  changes(query: ChangesQuery, signal: AbortSignal): QueryAnswer<ChangesAnswer>;
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
/**
 * How many requests a connection may leave unanswered before it is closed: each may hold an answer of up to
 * `MAX_LINE_BYTES` while it waits its turn behind a pending one.
 */
export const MAX_UNANSWERED_REQUESTS = 8;

/** Writes to a connection only in answer to a line it sent, so a client that cannot write receives nothing. */
export function connectionServer(
  handlers: DaemonHandlers,
  log: DaemonLog,
  prove: Prover,
): ConnectionServer {
  const connections = new Set<ServedConnection>();
  handlers.stopSignal.addEventListener(
    "abort",
    () => {
      for (const connection of connections) connection.answerPendingStopping();
    },
    { once: true },
  );
  return {
    onConnection: (socket) => {
      const connection = new ServedConnection(socket, log);
      connections.add(connection);
      socket.once("close", () => {
        connections.delete(connection);
        connection.drop();
      });
      serve(connection, { handlers, prove }, log);
    },
    closeConnections: () => {
      for (const { socket } of connections) {
        socket.end(() => socket.destroy());
        setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref();
      }
    },
  };
}

/** A request's answer, written in its turn; undefined while its work runs. */
interface Turn {
  message: object | undefined;
  readonly work: AbortController | undefined;
}

/**
 * Writes one answer per request line, in the order the lines arrived, however late each answer is ready, since a
 * client matches each answer to its request by position.
 */
class ServedConnection {
  state: ConnectionState = "awaiting-hello";
  readonly socket: Socket;
  readonly #log: DaemonLog;
  readonly #turns: Turn[] = [];
  #ending = false;
  #dropped = false;

  constructor(socket: Socket, log: DaemonLog) {
    this.socket = socket;
    this.#log = log;
  }

  /** Whether a line arriving now is answered. */
  get answering(): boolean {
    return this.socket.writable && !this.#ending;
  }

  /** Queues the answer to the latest line. */
  reply(answer: object): void {
    this.#queue({ message: answer, work: undefined });
  }

  /**
   * Queues the answer to the latest line, still to come; `work` holds the signal its work was given. `answer` never
   * rejects: a failed query resolves with its error answer.
   */
  replyLate(answer: Promise<object>, work: AbortController): void {
    const turn: Turn = { message: undefined, work };
    void answer.then((message) => this.#settle(turn, message));
    this.#queue(turn);
  }

  /** Answers each request whose work still runs with the stopping error, and aborts that work. */
  answerPendingStopping(): void {
    for (const turn of this.#turns) {
      if (turn.message !== undefined) continue;
      turn.message = stoppingError();
      turn.work?.abort();
    }
    this.#flush();
  }

  /** Ends the connection once every earlier request's answer is written. */
  endOnceAnswered(): void {
    this.#ending = true;
    this.#flush();
  }

  /** Aborts the work of each request still pending and writes nothing more. */
  drop(): void {
    this.#dropped = true;
    for (const turn of this.#turns.splice(0)) {
      if (turn.message === undefined) turn.work?.abort();
    }
  }

  #queue(turn: Turn): void {
    this.#turns.push(turn);
    this.#flush();
    if (this.#turns.length > MAX_UNANSWERED_REQUESTS) this.#closeOverBound();
  }

  /** A late answer is dropped once the request was answered otherwise or the connection was dropped. */
  #settle(turn: Turn, message: object): void {
    if (this.#dropped || turn.message !== undefined) return;
    turn.message = message;
    this.#flush();
  }

  #flush(): void {
    for (
      let turn = this.#turns[0];
      turn?.message !== undefined;
      turn = this.#turns[0]
    ) {
      this.#turns.shift();
      send(this.socket, turn.message);
    }
    if (this.#ending && this.#turns.length === 0 && this.socket.writable) {
      this.socket.end();
    }
  }

  #closeOverBound(): void {
    this.#log.entry(
      `a client connection was closed: it left more than ${MAX_UNANSWERED_REQUESTS} requests unanswered`,
    );
    this.socket.destroy();
    this.drop();
  }
}

interface Answerer {
  readonly handlers: DaemonHandlers;
  readonly prove: Prover;
}

function serve(
  connection: ServedConnection,
  answerer: Answerer,
  log: DaemonLog,
): void {
  const decoder = new LineDecoder();
  connection.socket.on("data", (chunk: Buffer) => {
    for (const line of decoder.push(chunk)) {
      if (!connection.answering) return;
      answer(connection, line, answerer);
    }
  });
  connection.socket.on("error", (error) => {
    log.entry(`a client connection failed: ${errorText(error)}`);
  });
}

function answer(
  connection: ServedConnection,
  line: DecodedLine,
  answerer: Answerer,
): void {
  const { handlers, prove } = answerer;
  const parsed = line.tooLong ? undefined : parseLine(line.text);
  if (parsed?.ok === true && isStopRequest(parsed.message)) {
    // Begun first: the stop answers every pending request, so the queued acknowledgement never passes the bound.
    handlers.stop();
    connection.reply(
      stopAcknowledgement(handlers, prove(parsed.message["challenge"])),
    );
    return;
  }
  if (connection.state === "mismatched") {
    connection.endOnceAnswered();
    return;
  }
  if (parsed === undefined) {
    connection.reply(
      error("line-too-long", `a line is longer than ${MAX_LINE_BYTES} bytes`),
    );
    return;
  }
  if (!parsed.ok) {
    connection.reply(error("invalid-json", `the line is ${parsed.reason}`));
    return;
  }
  const message = parsed.message;
  if (message["type"] === HELLO_TYPE) {
    connection.state = hello(connection, message, answerer);
    return;
  }
  if (connection.state === "awaiting-hello") {
    connection.reply(
      error(
        "hello-required",
        "send a hello before any request other than stop",
      ),
    );
    return;
  }
  const work = new AbortController();
  const response = versionedAnswer(message, handlers, work.signal);
  if (response instanceof Promise) connection.replyLate(response, work);
  else connection.reply(response);
}

function hello(
  connection: ServedConnection,
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
    connection.reply(response);
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
  connection.reply(mismatch);
  return "mismatched";
}

type VersionedAnswer =
  | StatusResponse
  | SummaryResponse
  | PathStatusResponse
  | WaitResponse
  | ChangesResponse
  | ErrorResponse;

function versionedAnswer(
  message: ProtocolMessage,
  handlers: DaemonHandlers,
  signal: AbortSignal,
): VersionedAnswer | Promise<VersionedAnswer> {
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
    return stoppingError();
  }
  if (message["type"] === SUMMARY_TYPE) {
    return queryResponse(SUMMARY_TYPE, () => handlers.summary(signal));
  }
  if (message["type"] === PATH_STATUS_TYPE) {
    return pathStatusResponse(message["path"], handlers, signal);
  }
  if (message["type"] === WAIT_TYPE) {
    return waitResponse(message, handlers, signal);
  }
  if (message["type"] === CHANGES_TYPE) {
    return changesResponse(message, handlers, signal);
  }
  return error(
    UNKNOWN_REQUEST_CODE,
    `unknown request type ${JSON.stringify(message["type"] ?? null)}`,
  );
}

function pathStatusResponse(
  path: unknown,
  handlers: DaemonHandlers,
  signal: AbortSignal,
): Queried<PathStatusResponse> | Promise<Queried<PathStatusResponse>> {
  if (typeof path !== "string" || !isAbsolute(path)) {
    return error(
      "invalid-request",
      `a ${PATH_STATUS_TYPE} request must carry an absolute path; got ${JSON.stringify(path ?? null)}`,
    );
  }
  return queryResponse(PATH_STATUS_TYPE, () =>
    handlers.pathStatus(path, signal),
  );
}

/** Refuses a wait whose paths or limit it cannot take before any of its work begins. */
function waitResponse(
  message: ProtocolMessage,
  handlers: DaemonHandlers,
  signal: AbortSignal,
): Queried<WaitResponse> | Promise<Queried<WaitResponse>> {
  const paths = namedPaths(message, WAIT_TYPE, MAX_WAIT_PATHS, "a wait");
  const limitMs = "limitMs" in message ? message["limitMs"] : WAIT_LIMIT_MS;
  if (!Array.isArray(paths)) return paths;
  if (!isWaitLimit(limitMs)) {
    return error(
      "invalid-request",
      `a ${WAIT_TYPE} request's limitMs must be a whole number of ms from 1 to ${MAX_WAIT_LIMIT_MS}; got ${JSON.stringify(limitMs)}`,
    );
  }
  const query: WaitQuery = { paths, limitMs };
  return queryResponse(WAIT_TYPE, () => handlers.wait(query, signal));
}

/** Refuses a changes request whose paths, cursor or edited files it cannot take before any of its work begins. */
function changesResponse(
  message: ProtocolMessage,
  handlers: DaemonHandlers,
  signal: AbortSignal,
): Queried<ChangesResponse> | Promise<Queried<ChangesResponse>> {
  const paths = namedPaths(
    message,
    CHANGES_TYPE,
    MAX_CHANGES_PATHS,
    "a changes request",
  );
  if (!Array.isArray(paths)) return paths;
  const since = message["since"];
  if (since !== undefined && !isCursor(since)) {
    return error(
      "invalid-request",
      `a ${CHANGES_TYPE} request's since must be a non-empty string of at most ${MAX_CURSOR_CHARACTERS} characters; got ${valueShape(since)}`,
    );
  }
  const edited = editedPaths(message["edited"], paths);
  if (!Array.isArray(edited)) return edited;
  const query: ChangesQuery = { paths, since, edited };
  return queryResponse(CHANGES_TYPE, () => handlers.changes(query, signal));
}

type Typed<T extends string, A> = A & { type: T; protocolVersion: number };
type Queried<R> = R | ErrorResponse;

/**
 * A query that throws or rejects, is refused, has nothing to answer, or would pass the line limit is answered with an
 * error saying why, whether its answer came at once or late.
 */
function queryResponse<T extends string, A extends object>(
  type: T,
  answer: () => QueryAnswer<A>,
): Queried<Typed<T, A>> | Promise<Queried<Typed<T, A>>> {
  try {
    const response = answer();
    return response instanceof Promise
      ? response.then((late) => checkedAnswer(type, late)).catch(queryFailed)
      : checkedAnswer(type, response);
  } catch (failure) {
    return queryFailed(failure);
  }
}

function checkedAnswer<T extends string, A extends object>(
  type: T,
  response: Answered<A>,
): Queried<Typed<T, A>> {
  const narrower = narrowerRequest(type);
  if ("refused" in response) {
    return error("invalid-request", response.refused);
  }
  if ("noAnswer" in response) {
    return error(NOTHING_TO_ANSWER_CODE, response.noAnswer);
  }
  const typed = { ...response, type, protocolVersion: PROTOCOL_VERSION };
  const size = Buffer.byteLength(JSON.stringify(typed));
  if (size > MAX_LINE_BYTES) {
    return error(
      NOTHING_TO_ANSWER_CODE,
      `the answer is ${size} bytes, longer than the protocol's line limit of ${MAX_LINE_BYTES} bytes; ${narrower}`,
    );
  }
  return typed;
}

function narrowerRequest(type: string): string {
  if (type === WAIT_TYPE) return NARROWER_REQUEST.files;
  if (type === CHANGES_TYPE) return NARROWER_REQUEST.changedFiles;
  return NARROWER_REQUEST.path;
}

function queryFailed(failure: unknown): ErrorResponse {
  return error(QUERY_FAILED_CODE, `the query failed: ${errorText(failure)}`);
}

function stoppingError(): ErrorResponse {
  return error(STOPPING_CODE, "the daemon is stopping");
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

function send(socket: Socket, message: object): void {
  if (socket.writable) socket.write(encodeLine(message));
}
