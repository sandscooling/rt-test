import {
  onProvenConnection,
  requireAnswer,
  targetOf,
  type DaemonTarget,
} from "./daemon/proven-connection.js";
import {
  ERROR_TYPE,
  NOTHING_TO_ANSWER_CODE,
  PATH_STATUS_TYPE,
  PROTOCOL_VERSION,
  STOPPING_CODE,
  SUMMARY_TYPE,
  UNKNOWN_REQUEST_CODE,
  type PathStatusRequest,
  type PathStatusResponse,
  type ProtocolMessage,
  type SummaryRequest,
  type SummaryResponse,
} from "./daemon/protocol.js";
import { errorText } from "./vitest/error-text.js";

/**
 * How long a path status may take to answer, a target until measured: the daemon first reads the path, which for a
 * folder is every input it holds under it and for the root every input.
 */
const PATH_STATUS_BOUND_MS = 60_000;

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
    PATH_STATUS_BOUND_MS,
  );
  return answer as unknown as PathStatusResponse;
}

/**
 * The daemon's answer to a query, or a rejection saying why it has none; `boundMs` is how long it may take, the
 * connection's default when absent.
 */
async function query(
  target: DaemonTarget,
  request: SummaryRequest | PathStatusRequest,
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
