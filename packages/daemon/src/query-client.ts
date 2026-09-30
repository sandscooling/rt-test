import {
  boundUntil,
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
 * How long a path status or a changes query may take to answer, a target until measured. The daemon first reads the
 * named paths: for a path status of the root that is every input it holds, which is more than any changes query names.
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
  const answer = await query(targetOf(consumerRoot, "query"), request, {
    requestMs: READ_FIRST_BOUND_MS,
  });
  return answer as unknown as PathStatusResponse;
}

export interface ChangesOptions {
  /** The cursor an earlier changes answer returned; absent for a baseline. */
  readonly since?: string;
  /** A whole number of ms the whole query may take, the daemon's proof of its hello included; `READ_FIRST_BOUND_MS` when absent. */
  readonly boundMs?: number;
  /** The files among `paths` the caller edited, whose changes the daemon counts as edits, never as its own jobs'. */
  readonly edited?: readonly string[];
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
  const { since, edited, boundMs = READ_FIRST_BOUND_MS } = options;
  if (!Number.isInteger(boundMs) || boundMs <= 0) {
    throw new RangeError(
      `a changes query's boundMs must be a whole number of ms above 0, not ${boundMs}`,
    );
  }
  const deadline = Date.now() + boundMs;
  const request: ChangesRequest = {
    type: CHANGES_TYPE,
    protocolVersion: PROTOCOL_VERSION,
    paths,
    ...(since === undefined ? {} : { since }),
    ...(edited === undefined ? {} : { edited }),
  };
  const answer = await query(targetOf(consumerRoot, "query"), request, {
    deadline,
  });
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
  const answer = await query(targetOf(consumerRoot, "query"), request, {
    requestMs: waitsMs + RESPONSE_BOUND_MS,
  });
  return answer as unknown as WaitResponse;
}

/**
 * How long the request's answer may take once the hello is proven, or when the whole query, its hello included, ends:
 * a `Date.now()` time.
 */
type QueryBound =
  { readonly requestMs: number } | { readonly deadline: number };

/**
 * The daemon's answer to a query, or a rejection saying why it has none; with no `bound`, each answer may take the
 * connection's default.
 */
async function query(
  target: DaemonTarget,
  request: SummaryRequest | PathStatusRequest | WaitRequest | ChangesRequest,
  bound?: QueryBound,
): Promise<ProtocolMessage> {
  const { consumerRoot } = target;
  const deadline =
    bound !== undefined && "deadline" in bound ? bound.deadline : undefined;
  const answer = await onProvenConnection(
    target,
    async (connection) => {
      try {
        return await connection.request(request, requestBoundMs(bound));
      } catch (failure) {
        throw new Error(
          `Cannot get an answer from the daemon for ${consumerRoot}: ${errorText(failure)}.`,
          { cause: failure },
        );
      }
    },
    deadline,
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

function requestBoundMs(bound: QueryBound | undefined): number | undefined {
  if (bound === undefined) return undefined;
  return "requestMs" in bound ? bound.requestMs : boundUntil(bound.deadline);
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
