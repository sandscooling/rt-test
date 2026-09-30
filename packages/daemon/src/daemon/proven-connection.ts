import { consumerIdentity } from "../store/consumer-identity.js";
import { DaemonConnection } from "./daemon-connection.js";
import { daemonVerifier, newChallenge } from "./endpoint-proof.js";
import { clientEndpoint, type Endpoint } from "./endpoint.js";
import {
  ERROR_TYPE,
  HELLO_TYPE,
  PROTOCOL_VERSION,
  RESPONSE_BOUND_MS,
  VERSION_MISMATCH_CODE,
  type ProtocolMessage,
} from "./protocol.js";

/** A worktree's daemon as a client addresses it. */
export interface DaemonTarget {
  readonly consumerRoot: string;
  readonly worktreeIdentity: string;
  readonly endpoint: Endpoint;
}

export function targetOf(
  consumerRoot: string,
  action: "start" | "query" | "stop",
): DaemonTarget {
  const { worktreeIdentity } = consumerIdentity(consumerRoot);
  const location = clientEndpoint(worktreeIdentity);
  if (location.ok)
    return { consumerRoot, worktreeIdentity, endpoint: location };
  const verb = action === "start" ? "start" : "reach";
  throw new Error(
    `Cannot ${verb} a daemon for ${consumerRoot}: ${location.reason}.`,
  );
}

/**
 * Sends a request carrying a fresh challenge, and resolves with the answer only once it proves it came from this
 * user's daemon for the worktree, so no process that took the endpoint can answer in its place. The answer may take the
 * connection's default bound, and never past `deadline`, a `Date.now()` time, when one is given.
 */
export async function provenRequest(
  target: DaemonTarget,
  connection: DaemonConnection,
  request: (challenge: string) => object,
  deadline?: number,
): Promise<ProtocolMessage> {
  const verifier = daemonVerifier(target.endpoint, target.worktreeIdentity);
  if (!verifier.ok) throw notTheDaemon(target, verifier.reason);
  const challenge = newChallenge();
  const answer = await connection.request(
    request(challenge),
    deadline === undefined
      ? undefined
      : boundUntil(deadline, RESPONSE_BOUND_MS),
  );
  const refusal = verifier.verifier.refusal(challenge, answer);
  if (refusal === undefined) return answer;
  throw notTheDaemon(target, refusal);
}

/** The bound that ends a wait at `deadline`, a `Date.now()` time, never longer than `capMs`; throws once it has passed. */
export function boundUntil(deadline: number, capMs?: number): number {
  const left = deadline - Date.now();
  if (left <= 0) {
    throw new Error("the query's deadline passed before the daemon was asked");
  }
  return capMs === undefined ? left : Math.min(left, capMs);
}

function notTheDaemon(target: DaemonTarget, reason: string): Error {
  return new Error(
    `The process answering on ${target.endpoint.path} is not this user's daemon for ${target.consumerRoot}: ${reason}.`,
  );
}

/**
 * Runs `work` on a connection whose hello the daemon proved, so no answer comes from a process that cannot prove it
 * is this user's daemon; undefined when nothing listens on the endpoint. The hello's answer never comes past
 * `helloDeadline`, a `Date.now()` time, when one is given.
 */
export async function onProvenConnection<T>(
  target: DaemonTarget,
  work: (connection: DaemonConnection) => Promise<T>,
  helloDeadline?: number,
): Promise<T | undefined> {
  const { consumerRoot } = target;
  const connected = await DaemonConnection.open(target.endpoint.path);
  if (!connected.ok) {
    if (connected.nothingListens) return undefined;
    throw new Error(
      `Cannot reach the daemon for ${consumerRoot}: ${connected.reason}.`,
    );
  }
  const { connection } = connected;
  try {
    requireAnswer(
      consumerRoot,
      await provenRequest(
        target,
        connection,
        (challenge) => ({
          type: HELLO_TYPE,
          protocolVersion: PROTOCOL_VERSION,
          challenge,
        }),
        helloDeadline,
      ),
      HELLO_TYPE,
    );
    return await work(connection);
  } finally {
    connection.close();
  }
}

/** A version mismatch names the daemon's process and version, and says it can be stopped. */
export function requireAnswer(
  consumerRoot: string,
  answer: ProtocolMessage,
  type: string,
): void {
  if (answer["type"] === type) return;
  if (
    answer["type"] === ERROR_TYPE &&
    answer["code"] === VERSION_MISMATCH_CODE
  ) {
    throw new Error(
      `The daemon for ${consumerRoot}, process ${String(answer["pid"])}, speaks protocol version ${String(answer["protocolVersion"])}, not ${PROTOCOL_VERSION}. It can be stopped, and then started again.`,
    );
  }
  throw new Error(
    `The daemon for ${consumerRoot} answered a ${type} request with ${JSON.stringify(answer)}`,
  );
}
