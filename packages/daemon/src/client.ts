import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { resolve } from "node:path";
import { BUSY_TIMEOUT_MS } from "./store/schema.js";
import { resolvedStateDirectory } from "./start-plan.js";
import type { ConfirmedStart } from "./vitest/confirmed-start.js";
import { errorText, exitText } from "./vitest/error-text.js";
import { DaemonConnection } from "./daemon/daemon-connection.js";
import { daemonLogFile } from "./daemon/daemon-log.js";
import { WINDOWS } from "./daemon/endpoint.js";
import { KEY_DIRECTORY_START_BOUND_MS } from "./daemon/windows-acl.js";
import { daemonEntryPoint } from "./daemon/entry-point.js";
import { EXECUTOR_BOUND_MS } from "./daemon/executor-jobs.js";
import {
  onProvenConnection,
  provenRequest,
  requireAnswer,
  targetOf,
  type DaemonTarget,
} from "./daemon/proven-connection.js";
import { isRunning } from "./daemon/runtime-directory.js";
import {
  BEGIN_TYPE,
  PROTOCOL_VERSION,
  REFUSED_TYPE,
  SERVING_TYPE,
  START_TYPE,
  STATUS_TYPE,
  STOP_REQUEST,
  STOPPING_TYPE,
  type DaemonIdentity,
  type StartupAcceptance,
  type StartupReport,
  type ProtocolMessage,
  type StartupRequest,
  type StatusResponse,
} from "./daemon/protocol.js";

export { queryPathStatus, querySummary } from "./query-client.js";
export { startPlan, type StartPlan } from "./start-plan.js";
export {
  NON_INPUTS_ABSENT,
  NON_INPUTS_UNUSABLE,
  type NonInputsDeclaration,
} from "./inputs/non-inputs.js";
export type {
  ConfirmedStart,
  ConfirmedWorkspace,
} from "./vitest/confirmed-start.js";
export type { UnreadWorkspaceSource } from "./vitest/find-workspaces.js";
export { errorText } from "./vitest/error-text.js";
export {
  PROTOCOL_VERSION,
  type DaemonActivity,
  type DaemonIdentity,
  type PathStatusResponse,
  type StatusResponse,
  type SummaryResponse,
  type UnstoredJob,
} from "./daemon/protocol.js";
export {
  activityText,
  DEPENDENCY_BUILD_FAILED,
  DEPENDENCY_BUILD_TIMED_OUT,
  DEPENDENCY_BUILDS_ENDED,
  FRESHNESS_VALUES,
  NO_SELECTION_INPUT,
  RECONCILIATION_INCOMPLETE,
  SELECTION_REFUSED,
  TEST_STATES,
  WATCHER_UNHEALTHY,
  type CutReason,
  type FileCounts,
  type InputFacts,
  type InputsNotNarrowed,
  type LatestRunFacts,
  type NotDiscoveredEntry,
  type TestCounts,
  type WorkspaceFacts,
} from "./query/answer.js";

export interface StartDaemonOptions {
  /** The caller states that the user trusts this project to execute: only an explicit, confirmed start sets it. */
  readonly trusted: true;
  /** The consumer root and each workspace, with its config file, that the user was shown and confirmed. */
  readonly start: ConfirmedStart;
  /** Defaults to `.rt-test` under the consumer root; a relative path resolves against the working directory. */
  readonly stateDirectory?: string;
}

export interface StoppedDaemon {
  /** The process that acknowledged the stop and has since exited. */
  readonly pid: number;
}

const DAEMON_ENTRY = "daemon-main";
const APPEND_FLAG = "a";
/** `openStore` may wait out the busy timeout on each of its header read, journal switch, schema creation and migration. */
const STARTUP_STORE_WAITS = 4;
/** Covers starting Node and taking the endpoint. */
const STARTUP_MARGIN_MS = 5_000;
/** On Windows the daemon protects its key directory, and the client checks it, with system tools before answering. */
const STARTUP_KEY_DIRECTORY_MS =
  process.platform === WINDOWS ? KEY_DIRECTORY_START_BOUND_MS : 0;
export const STARTUP_DEADLINE_MS =
  STARTUP_STORE_WAITS * BUSY_TIMEOUT_MS +
  STARTUP_KEY_DIRECTORY_MS +
  STARTUP_MARGIN_MS;
/** Covers closing the store and the endpoint after the executor has ended. */
const STOP_MARGIN_MS = 5_000;
/** A stopping daemon waits out the executor bound, then one store write, then closes. */
export const STOP_DEADLINE_MS =
  EXECUTOR_BOUND_MS + BUSY_TIMEOUT_MS + STOP_MARGIN_MS;
const STOP_POLL_MS = 100;

/**
 * Starts the worktree's daemon, which executes the project's tests: call only after the user confirmed the start.
 * Resolves once the daemon answers on its endpoint, before its discovery has finished.
 */
export async function startDaemon(
  options: StartDaemonOptions,
): Promise<DaemonIdentity> {
  const start: ConfirmedStart = {
    ...options.start,
    consumerRoot: resolve(options.start.consumerRoot),
  };
  if ((options as { trusted?: unknown }).trusted !== true) {
    throw new Error(
      `Refusing to start a daemon for ${start.consumerRoot}: the caller did not state that the project is trusted.`,
    );
  }
  const target = targetOf(start.consumerRoot, "start");
  await refuseRunningDaemon(target);
  const stateDirectory = resolvedStateDirectory(
    start.consumerRoot,
    options.stateDirectory,
  );
  mkdirSync(stateDirectory, { recursive: true });
  const logFile = daemonLogFile(stateDirectory, target.worktreeIdentity);
  const child = spawnDaemon(start.consumerRoot, stateDirectory, logFile);
  try {
    return await startedDaemon(child, start, target, logFile);
  } catch (error) {
    abandon(child);
    throw error;
  }
}

async function startedDaemon(
  child: ChildProcess,
  start: ConfirmedStart,
  target: DaemonTarget,
  logFile: string,
): Promise<DaemonIdentity> {
  const deadline = Date.now() + STARTUP_DEADLINE_MS;
  const request: StartupRequest = { type: START_TYPE, start };
  child.send(request);
  const report = await startupReport(child, logFile, deadline);
  if (report.type === REFUSED_TYPE) {
    throw new Error(
      `The daemon for ${start.consumerRoot} refused to start: ${report.reason}. See ${logFile}.`,
    );
  }
  const status = await beforeDeadline(
    askStatus(target),
    deadline,
    `the daemon, process ${report.pid}, did not answer its status within ${STARTUP_DEADLINE_MS} ms of its start; see ${logFile}`,
  );
  if (status.pid !== report.pid) {
    throw new Error(
      `The daemon for ${start.consumerRoot} reported its start as process ${report.pid}, but process ${status.pid} answered on its endpoint. See ${logFile}.`,
    );
  }
  await acceptStart(child, report.pid, logFile);
  return identityOf(status);
}

/** The daemon executes nothing until it reads this, so a start its starter never accepted runs nothing. */
function acceptStart(
  child: ChildProcess,
  pid: number,
  logFile: string,
): Promise<void> {
  const acceptance: StartupAcceptance = { type: BEGIN_TYPE };
  return new Promise((accepted, reject) => {
    child.send(acceptance, (error: Error | null) => {
      if (error === null) {
        child.disconnect();
        accepted();
        return;
      }
      reject(
        new Error(
          `The daemon, process ${pid}, could not be told to begin: ${errorText(error)}. See ${logFile}.`,
        ),
      );
    });
  });
}

/** A start that failed after the spawn leaves nothing running, since its caller is told nothing started. */
function abandon(child: ChildProcess): void {
  if (child.connected) child.disconnect();
  if (child.exitCode === null && child.signalCode === null) child.kill();
}

/** The worktree's daemon's status; rejects, naming the consumer root, when no daemon serves it. */
export async function daemonStatus(
  consumerRoot: string,
): Promise<StatusResponse> {
  return askStatus(targetOf(consumerRoot, "query"));
}

/**
 * The worktree's daemon's status, or undefined when nothing listens on its endpoint. Rejects, with the reason, when
 * whatever answers cannot be confirmed as this user's daemon of this protocol version.
 */
export async function servingDaemon(
  consumerRoot: string,
): Promise<StatusResponse | undefined> {
  return statusIfServing(targetOf(consumerRoot, "query"));
}

/** Why a start is refused while a daemon serves the worktree. */
export function alreadyServingReason(
  pid: number,
  consumerRoot: string,
): string {
  return `a daemon, process ${pid}, already serves the worktree at ${consumerRoot}`;
}

/**
 * Stops the worktree's daemon, of any protocol version, and resolves once its process has exited and its endpoint
 * accepts no connection. A stop already under way is joined.
 */
export async function stopDaemon(consumerRoot: string): Promise<StoppedDaemon> {
  const target = targetOf(consumerRoot, "stop");
  const connection = await connect(target);
  let answer: ProtocolMessage;
  try {
    answer = await provenRequest(target, connection, (challenge) => ({
      ...STOP_REQUEST,
      challenge,
    }));
  } finally {
    connection.close();
  }
  if (answer["type"] !== STOPPING_TYPE || typeof answer["pid"] !== "number") {
    throw new Error(
      `The daemon for ${consumerRoot} did not acknowledge the stop: ${JSON.stringify(answer)}`,
    );
  }
  const pid = answer["pid"];
  await waitForExit(
    target,
    pid,
    typeof answer["logFile"] === "string" ? answer["logFile"] : undefined,
  );
  return { pid };
}

async function connect(target: DaemonTarget): Promise<DaemonConnection> {
  const connected = await DaemonConnection.open(target.endpoint.path);
  if (connected.ok) return connected.connection;
  throw new Error(
    connected.nothingListens
      ? `No daemon serves the worktree at ${target.consumerRoot}.`
      : `Cannot reach the daemon for ${target.consumerRoot}: ${connected.reason}.`,
  );
}

async function askStatus(target: DaemonTarget): Promise<StatusResponse> {
  const status = await statusIfServing(target);
  if (status === undefined) {
    throw new Error(`No daemon serves the worktree at ${target.consumerRoot}.`);
  }
  return status;
}

/** Undefined when nothing listens on the endpoint. */
async function statusIfServing(
  target: DaemonTarget,
): Promise<StatusResponse | undefined> {
  return onProvenConnection(target, async (connection) => {
    const status = await connection.request({
      type: STATUS_TYPE,
      protocolVersion: PROTOCOL_VERSION,
    });
    requireAnswer(target.consumerRoot, status, STATUS_TYPE);
    return status as unknown as StatusResponse;
  });
}

/** Refuses when anything holds the endpoint: this user's daemon, one of another version, or an impostor. */
async function refuseRunningDaemon(target: DaemonTarget): Promise<void> {
  const { consumerRoot } = target;
  let status: StatusResponse | undefined;
  try {
    status = await statusIfServing(target);
  } catch (error) {
    throw new Error(
      `Refusing to start a daemon for ${consumerRoot}: ${errorText(error)}`,
      { cause: error },
    );
  }
  if (status === undefined) return;
  throw new Error(
    `Refusing to start: ${alreadyServingReason(status.pid, consumerRoot)}.`,
  );
}

function spawnDaemon(
  consumerRoot: string,
  stateDirectory: string,
  logFile: string,
): ChildProcess {
  const entry = daemonEntryPoint(DAEMON_ENTRY);
  const log = openSync(logFile, APPEND_FLAG);
  try {
    return spawn(
      process.execPath,
      [...entry.execArgv, entry.file, consumerRoot, stateDirectory],
      {
        cwd: consumerRoot,
        detached: true,
        stdio: ["ignore", log, log, "ipc"],
        windowsHide: true,
      },
    );
  } finally {
    closeSync(log);
  }
}

/** The daemon's one startup report. */
function startupReport(
  child: ChildProcess,
  logFile: string,
  deadline: number,
): Promise<StartupReport> {
  const report = new Promise<StartupReport>((resolveReport, reject) => {
    child.once("message", (message: unknown) => {
      if (isStartupReport(message)) {
        resolveReport(message);
        return;
      }
      reject(
        new Error(
          `The daemon sent a startup report the client cannot read: ${JSON.stringify(message)}. See ${logFile}.`,
        ),
      );
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `The daemon exited before reporting its start (${exitText(code, signal)}). See ${logFile}.`,
        ),
      );
    });
  });
  return beforeDeadline(
    report,
    deadline,
    `the daemon, process ${child.pid}, did not report its start within ${STARTUP_DEADLINE_MS} ms; see ${logFile}`,
  ).finally(() => {
    child.removeAllListeners();
    child.unref();
  });
}

function isStartupReport(message: unknown): message is StartupReport {
  if (typeof message !== "object" || message === null) return false;
  const report = message as ProtocolMessage;
  return report["type"] === SERVING_TYPE
    ? typeof report["pid"] === "number"
    : report["type"] === REFUSED_TYPE && typeof report["reason"] === "string";
}

async function beforeDeadline<T>(
  work: Promise<T>,
  deadline: number,
  reason: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out: ${reason}.`)),
      Math.max(0, deadline - Date.now()),
    );
  });
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitForExit(
  { consumerRoot, endpoint: { path } }: DaemonTarget,
  pid: number,
  logFile: string | undefined,
): Promise<void> {
  const deadline = Date.now() + STOP_DEADLINE_MS;
  let running = true;
  while (Date.now() < deadline) {
    running = isRunning(pid);
    if (!running && !(await endpointAnswers(path))) return;
    await new Promise((wake) => setTimeout(wake, STOP_POLL_MS));
  }
  const pending = running
    ? `process ${pid} had not exited`
    : `process ${pid} exited, but its endpoint ${path} still accepts connections, so another daemon may have started there`;
  throw new Error(
    `The daemon for ${consumerRoot} did not finish stopping within ${STOP_DEADLINE_MS} ms of acknowledging the stop: ${pending}.${logFile === undefined ? "" : ` See ${logFile}.`}`,
  );
}

async function endpointAnswers(path: string): Promise<boolean> {
  const connected = await DaemonConnection.open(path);
  if (connected.ok) connected.connection.close();
  return connected.ok;
}

function identityOf(status: StatusResponse): DaemonIdentity {
  return {
    pid: status.pid,
    consumerRoot: status.consumerRoot,
    projectIdentity: status.projectIdentity,
    worktreeIdentity: status.worktreeIdentity,
    stateDirectory: status.stateDirectory,
    logFile: status.logFile,
    protocolVersion: status.protocolVersion,
  };
}
