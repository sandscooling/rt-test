/**
 * The daemon's local protocol: one UTF-8 JSON object per `\n`-terminated line, in both directions.
 *
 * Frozen for every protocol version, so a client of any version can check and stop a daemon of any other: the line
 * framing, the line limit's floor, the hello's type, version and challenge, the stop request, its acknowledgement,
 * the version-mismatch error, and the proof a daemon gives in answer to a challenge. A later version may add fields
 * to these but never remove or rename one, and a reader ignores fields it does not know. Everything else is
 * versioned and may change with `PROTOCOL_VERSION`.
 */

import type {
  PathStatusAnswer,
  SummaryAnswer,
  WaitAnswer,
} from "../query/answer.js";
import { BUSY_TIMEOUT_MS } from "../store/schema.js";
import type { ConfirmedStart } from "../vitest/confirmed-start.js";
import { errorText } from "../vitest/error-text.js";

/** Frozen: no version may lower it. */
export const MAX_LINE_BYTES = 1024 * 1024;
const NEWLINE_BYTE = 0x0a;
const LINE_END = "\n";

export const PROTOCOL_VERSION = 4;

/** The daemon's event loop runs no Vitest code; its longest wait is one store write held by another worktree's daemon, and the second wait is margin. */
const STORE_WAITS_PER_RESPONSE = 2;
/** The longest a daemon takes to answer a status or stop request, even while a job holds Vitest open. */
export const RESPONSE_BOUND_MS = STORE_WAITS_PER_RESPONSE * BUSY_TIMEOUT_MS;

/**
 * A target until measured: a wait's limit when its caller gives none, which with `RESPONSE_BOUND_MS` stays under the
 * two minutes a coding agent's shell tool commonly allows a command.
 */
export const WAIT_LIMIT_MS = 100_000;
export const MAX_WAIT_LIMIT_MS = 3_600_000;
const MIN_WAIT_LIMIT_MS = 1;
export const MAX_WAIT_PATHS = 1_000;

/** Frozen. */
export const STOP_TYPE = "stop";
/** Frozen. */
export const STOPPING_TYPE = "stopping";
/** Frozen. */
export const ERROR_TYPE = "error";
/** Frozen. */
export const VERSION_MISMATCH_CODE = "protocol-version-mismatch";

/** Frozen: a daemon of any version answers a hello, or its version-mismatch error, with a proof. */
export const HELLO_TYPE = "hello";
export const STATUS_TYPE = "status";

export const SUMMARY_TYPE = "summary";
export const PATH_STATUS_TYPE = "path-status";
export const WAIT_TYPE = "wait";

export const START_TYPE = "start";
export const SERVING_TYPE = "serving";
export const REFUSED_TYPE = "refused";
export const BEGIN_TYPE = "begin";

/** Frozen: a fresh random string a client sends, which the daemon's answer must prove with its key. */
export interface Challenged {
  readonly challenge: string;
}

/** Frozen: present whenever the request carried a challenge of at most 256 characters, the frozen limit. */
export interface Proven {
  readonly proof?: string;
}

/** Frozen: a connection may send it as its first line, with no hello, or at any point after. */
export interface StopRequest extends Partial<Challenged> {
  readonly type: typeof STOP_TYPE;
}

/** Frozen: says the stop has begun, never that it has completed. */
export interface StopAcknowledgement extends Proven {
  readonly type: typeof STOPPING_TYPE;
  readonly pid: number;
  /** Where the daemon logs its stop, for a client that cannot ask its status. */
  readonly logFile: string;
}

/** Frozen: the answer to a hello of another protocol version. */
export interface VersionMismatchError extends Proven {
  readonly type: typeof ERROR_TYPE;
  readonly code: typeof VERSION_MISMATCH_CODE;
  readonly message: string;
  /** The daemon's. */
  readonly protocolVersion: number;
  readonly clientProtocolVersion: unknown;
  readonly pid: number;
}

export const STOP_REQUEST: StopRequest = { type: STOP_TYPE };

/** Frozen: its type, protocol version and challenge. */
export interface HelloRequest extends Challenged {
  readonly type: typeof HELLO_TYPE;
  readonly protocolVersion: number;
}

export interface StatusRequest {
  readonly type: typeof STATUS_TYPE;
  readonly protocolVersion: number;
}

export const UNKNOWN_REQUEST_CODE = "unknown-request";
export const STOPPING_CODE = "stopping";
/** A query the daemon understood but cannot answer, including one whose answer would pass the line limit; its message says why. */
export const NOTHING_TO_ANSWER_CODE = "nothing-to-answer";
/** A query that threw while the daemon answered it. */
export const QUERY_FAILED_CODE = "query-failed";

export type ErrorCode =
  | "invalid-json"
  | "invalid-request"
  | typeof UNKNOWN_REQUEST_CODE
  | "hello-required"
  | "line-too-long"
  | typeof STOPPING_CODE
  | typeof NOTHING_TO_ANSWER_CODE
  | typeof QUERY_FAILED_CODE;

export interface ErrorResponse {
  readonly type: typeof ERROR_TYPE;
  readonly protocolVersion: number;
  readonly code: ErrorCode;
  readonly message: string;
}

export interface HelloResponse extends Proven {
  readonly type: typeof HELLO_TYPE;
  readonly protocolVersion: number;
  readonly pid: number;
}

export type DaemonActivity =
  | { readonly state: "discovering" }
  | { readonly state: "running"; readonly workspacePath: string }
  | { readonly state: "idle" };

/** A job since the start that ended with nothing stored. */
export interface UnstoredJob {
  /** Undefined for the discovery. */
  readonly workspacePath?: string;
  readonly reason: string;
}

export interface DaemonIdentity {
  readonly pid: number;
  readonly consumerRoot: string;
  readonly projectIdentity: string;
  readonly worktreeIdentity: string;
  readonly stateDirectory: string;
  readonly logFile: string;
  readonly protocolVersion: number;
}

export interface StatusResponse extends DaemonIdentity {
  readonly type: typeof STATUS_TYPE;
  readonly activity: DaemonActivity;
  readonly stopping: boolean;
  readonly unstoredJobs: readonly UnstoredJob[];
}

export interface SummaryRequest {
  readonly type: typeof SUMMARY_TYPE;
  readonly protocolVersion: number;
}

export interface PathStatusRequest {
  readonly type: typeof PATH_STATUS_TYPE;
  readonly protocolVersion: number;
  /** Absolute. */
  readonly path: string;
}

export interface WaitRequest {
  readonly type: typeof WAIT_TYPE;
  readonly protocolVersion: number;
  /** Absolute, from one to `MAX_WAIT_PATHS`. */
  readonly paths: readonly string[];
  /** `WAIT_LIMIT_MS` when absent. */
  readonly limitMs?: number;
}

/** Whether `value` is a limit a wait takes: a whole number of ms from 1 to `MAX_WAIT_LIMIT_MS`. */
export function isWaitLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_WAIT_LIMIT_MS &&
    value <= MAX_WAIT_LIMIT_MS
  );
}

export type SummaryResponse = SummaryAnswer & {
  readonly type: typeof SUMMARY_TYPE;
  readonly protocolVersion: number;
};

export type PathStatusResponse = PathStatusAnswer & {
  readonly type: typeof PATH_STATUS_TYPE;
  readonly protocolVersion: number;
};

export type WaitResponse = WaitAnswer & {
  readonly type: typeof WAIT_TYPE;
  readonly protocolVersion: number;
};

export type DecodedLine =
  | { readonly tooLong: false; readonly text: string }
  | { readonly tooLong: true };

/** Splits a byte stream into lines across chunk boundaries, keeping no more than `MAX_LINE_BYTES` of any line. */
export class LineDecoder {
  #parts: Buffer[] = [];
  #size = 0;
  #discarding = false;

  push(chunk: Buffer): DecodedLine[] {
    const lines: DecodedLine[] = [];
    let start = 0;
    let end = chunk.indexOf(NEWLINE_BYTE);
    while (end !== -1) {
      this.#append(chunk.subarray(start, end), lines);
      this.#endLine(lines);
      start = end + 1;
      end = chunk.indexOf(NEWLINE_BYTE, start);
    }
    this.#append(chunk.subarray(start), lines);
    return lines;
  }

  #append(part: Buffer, lines: DecodedLine[]): void {
    if (this.#discarding || part.length === 0) return;
    if (this.#size + part.length > MAX_LINE_BYTES) {
      this.#reset();
      this.#discarding = true;
      lines.push({ tooLong: true });
      return;
    }
    this.#parts.push(part);
    this.#size += part.length;
  }

  #endLine(lines: DecodedLine[]): void {
    if (this.#discarding) {
      this.#discarding = false;
      return;
    }
    lines.push({
      tooLong: false,
      text: Buffer.concat(this.#parts).toString("utf8"),
    });
    this.#reset();
  }

  #reset(): void {
    this.#parts = [];
    this.#size = 0;
  }
}

export function encodeLine(message: object): string {
  return `${JSON.stringify(message)}${LINE_END}`;
}

/** A decoded protocol line: one JSON object, whose fields a reader checks before trusting them. */
export type ProtocolMessage = Readonly<Record<string, unknown>>;

export type ParsedLine =
  | { readonly ok: true; readonly message: ProtocolMessage }
  | { readonly ok: false; readonly reason: string };

/** A line holding one JSON object, or why it does not. */
export function parseLine(text: string): ParsedLine {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `not valid JSON: ${errorText(error)}`,
    };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "not a JSON object" };
  }
  return { ok: true, message: value as ProtocolMessage };
}

export function isStopRequest(message: ProtocolMessage): boolean {
  return message["type"] === STOP_TYPE;
}

/** The client's first message to the daemon over the spawn-time channel, which a command line could not hold. */
export interface StartupRequest {
  readonly type: typeof START_TYPE;
  readonly start: ConfirmedStart;
}

/** The daemon's one report over the spawn-time channel. */
export type StartupReport =
  | { readonly type: typeof SERVING_TYPE; readonly pid: number }
  | { readonly type: typeof REFUSED_TYPE; readonly reason: string };

/**
 * The client's last message over the spawn-time channel, sent once it has proven the serving daemon's status. The
 * daemon executes nothing before it arrives, and abandons the start when the channel closes first.
 */
export interface StartupAcceptance {
  readonly type: typeof BEGIN_TYPE;
}
