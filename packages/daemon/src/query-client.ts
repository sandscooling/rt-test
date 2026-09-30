import {
  onProvenConnection,
  requireAnswer,
  targetOf,
  type DaemonTarget,
} from "./daemon/proven-connection.js";
import {
  CHANGES_TYPE,
  ERROR_TYPE,
  isWaitLimit,
  NOTHING_TO_ANSWER_CODE,
  PATH_STATUS_TYPE,
  PROTOCOL_VERSION,
  RESPONSE_BOUND_MS,
  STOPPING_CODE,
  SUMMARY_TYPE,
  UNKNOWN_REQUEST_CODE,
  WAIT_LIMIT_MS,
  WAIT_TYPE,
  type ChangesRequest,
  type ChangesResponse,
  type PathStatusRequest,
  type PathStatusResponse,
  type ProtocolMessage,
  type SummaryRequest,
  type SummaryResponse,
  type WaitRequest,
  type WaitResponse,
} from "./daemon/protocol.js";
import { errorText } from "./vitest/error-text.js";

/**
 * How long a path status or a changes query may take to answer, a target until measured: the daemon first reads the
 * named paths, which for a folder is every input it holds under it and for the root every input, more than any
 * changes query's files.
 */
const READ_FIRST_BOUND_MS = 60_000;

/** What the worktree's daemon's stored runs say about the whole worktree; it starts nothing. */
export async function querySummary(
  consumerRoot: string,
): Promise<SummaryResponse> {
  const request: SummaryRequest = {
    type: SUMMARY_TYPE,
    protocolVersion: PROTOCOL_VERSION,
  };
  const answer = await query(targetOf(consumerRoot, "query"), request);
  return answer as unknown as SummaryResponse;
}

/** What the worktree's daemon's stored runs say about the file or folder at the absolute `path`; it starts nothing. */
export async function queryPathStatus(
  consumerRoot: string,
  path: string,
): Promise<PathStatusResponse> {
  const request: PathStatusRequest = {
    type: PATH_STATUS_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    path,
  };
  const answer = await query(
    targetOf(consumerRoot, "query"),
    request,
    READ_FIRST_BOUND_MS,
  );
  return answer as unknown as PathStatusResponse;
}

export interface ChangesOptions {
  /** The cursor an earlier changes answer returned; absent for a baseline. */
  readonly since?: string;
}

/**
 * Which tests covering the files at the absolute `paths` changed state or freshness since `since`, answered at once
 * with a cursor for the next call; it starts nothing and never waits.
 */
export async function queryChanges(
  consumerRoot: string,
  paths: readonly string[],
  options: ChangesOptions = {},
): Promise<ChangesResponse> {
  const { since } = options;
  const request: ChangesRequest = {
    type: CHANGES_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    paths,
    ...(since === undefined ? {} : { since }),
  };
  const answer = await query(
    targetOf(consumerRoot, "query"),
    request,
    READ_FIRST_BOUND_MS,
  );
  return answer as unknown as ChangesResponse;
}

export interface WaitOptions {
  /** A whole number of ms from 1 to `MAX_WAIT_LIMIT_MS`; the daemon's default when absent. */
  readonly limitMs?: number;
}

/**
 * Waits for the tests covering the files at the absolute `paths` to have current results or none coming, and answers
 * settled, superseded when an input they read moves, or unsettled at the limit; it starts nothing.
 */
export async function queryWait(
  consumerRoot: string,
  paths: readonly string[],
  options: WaitOptions = {},
): Promise<WaitResponse> {
  const { limitMs } = options;
  const request: WaitRequest = {
    type: WAIT_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    paths,
    ...(limitMs === undefined ? {} : { limitMs }),
  };
  // A limit the daemon refuses is answered at once, so the bound need not cover it.
  const waitsMs = isWaitLimit(limitMs) ? limitMs : WAIT_LIMIT_MS;
  const answer = await query(
    targetOf(consumerRoot, "query"),
    request,
    waitsMs + RESPONSE_BOUND_MS,
  );
  return answer as unknown as WaitResponse;
}

/**
 * The daemon's answer to a query, or a rejection saying why it has none; `boundMs` is how long it may take, the
 * connection's default when absent.
 */
async function query(
  target: DaemonTarget,
  request: SummaryRequest | PathStatusRequest | WaitRequest | ChangesRequest,
  boundMs?: number,
): Promise<ProtocolMessage> {
  const { consumerRoot } = target;
  const answer = await onProvenConnection(target, (connection) =>
    connection.request(request, boundMs).catch((failure: unknown) => {
      throw new Error(
        `Cannot get an answer from the daemon for ${consumerRoot}: ${errorText(failure)}.`,
        { cause: failure },
      );
    }),
  );
  if (answer === undefined) {
    throw new Error(
      `No daemon serves the worktree at ${consumerRoot}; start one with rt-test start.`,
    );
  }
  if (answer["type"] === ERROR_TYPE) {
    throw new Error(queryErrorReason(consumerRoot, answer));
  }
  requireAnswer(consumerRoot, answer, request.type);
  return answer;
}

function queryErrorReason(
  consumerRoot: string,
  error: ProtocolMessage,
): string {
  const message = String(error["message"]);
  switch (error["code"]) {
    case UNKNOWN_REQUEST_CODE:
      return `The daemon serving ${consumerRoot} predates this query; stop it and start it again.`;
    case STOPPING_CODE:
      return `The daemon serving ${consumerRoot} is stopping.`;
    case NOTHING_TO_ANSWER_CODE:
      return `Nothing to answer: ${message}.`;
    default:
      return `The daemon serving ${consumerRoot} could not answer: ${message}.`;
  }
}
