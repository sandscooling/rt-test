import { resolve } from "node:path";
import type { Socket } from "node:net";
import { consumerIdentity } from "../store/consumer-identity.js";
import { openStore, type RtTestStore } from "../store/open-store.js";
import type { StoreScope } from "../store/stored-records.js";
import { errorText } from "../vitest/error-text.js";
import { DaemonLog, daemonLogFile } from "./daemon-log.js";
import { listenOnEndpoint } from "./endpoint.js";
import { Executor } from "./executor.js";
import { DaemonLifecycle } from "./lifecycle.js";
import {
  PROTOCOL_VERSION,
  REFUSED_TYPE,
  SERVING_TYPE,
  START_TYPE,
  type StartupReport,
  type StartupRequest,
} from "./protocol.js";
import { connectionServer } from "./server.js";

const STOP_SIGNALS = ["SIGTERM", "SIGINT"] as const;
const REFUSED_EXIT_CODE = 1;

const [consumerRoot, stateDirectory] = process.argv.slice(2);

main().catch(async (error: unknown) => {
  await report({ type: REFUSED_TYPE, reason: errorText(error) });
  process.exit(REFUSED_EXIT_CODE);
});

async function main(): Promise<void> {
  if (consumerRoot === undefined || stateDirectory === undefined) {
    void report({
      type: REFUSED_TYPE,
      reason:
        "the daemon was started without a consumer root and a state directory",
    });
    return;
  }
  const request = await startupRequest();
  if (request === undefined) return;
  if (!isStartupRequest(request)) {
    void report({
      type: REFUSED_TYPE,
      reason: `the first message on the startup channel is not a confirmed start: ${JSON.stringify(request)}`,
    });
    return;
  }
  if (resolve(request.start.consumerRoot) !== resolve(consumerRoot)) {
    void report({
      type: REFUSED_TYPE,
      reason: `the confirmed start names the consumer root ${request.start.consumerRoot}, not ${consumerRoot}`,
    });
    return;
  }
  const scope = consumerIdentity(consumerRoot);
  const log = new DaemonLog(
    daemonLogFile(stateDirectory, scope.worktreeIdentity),
  );
  log.entry(
    `start: consumer root ${consumerRoot}, state directory ${stateDirectory}, process ${process.pid}, protocol version ${PROTOCOL_VERSION}`,
  );
  const lifecycle = await serve(request, scope, log, stateDirectory);
  if (lifecycle === undefined) return;
  for (const signal of STOP_SIGNALS) process.on(signal, () => lifecycle.stop());
  lifecycle.begin();
  void report({ type: SERVING_TYPE, pid: process.pid });
  await lifecycle.stopped();
  process.exit();
}

/** Takes the endpoint, then opens the store, before anything executes, refusing the start on either. */
async function serve(
  request: StartupRequest,
  scope: StoreScope,
  log: DaemonLog,
  directory: string,
): Promise<DaemonLifecycle | undefined> {
  let accept = (socket: Socket): void => {
    socket.destroy();
  };
  const listening = await listenOnEndpoint(scope.worktreeIdentity, (socket) =>
    accept(socket),
  );
  if (!listening.ok) return refuse(log, listening.reason);
  let store: RtTestStore;
  try {
    store = openStore(directory);
  } catch (error) {
    await listening.close();
    return refuse(log, `cannot open the store: ${errorText(error)}`);
  }
  const lifecycle = new DaemonLifecycle({
    identity: {
      pid: process.pid,
      consumerRoot: request.start.consumerRoot,
      ...scope,
      stateDirectory: directory,
      logFile: log.file,
      protocolVersion: PROTOCOL_VERSION,
    },
    scope,
    start: request.start,
    store,
    log,
    executor: new Executor(log),
    closeEndpoint: () => {
      server.closeConnections();
      return listening.close();
    },
  });
  const server = connectionServer(lifecycle, log);
  accept = server.onConnection;
  log.entry(`serving on ${listening.path}`);
  return lifecycle;
}

function isStartupRequest(message: unknown): message is StartupRequest {
  if (typeof message !== "object" || message === null) return false;
  const { type, start } = message as Partial<StartupRequest>;
  return (
    type === START_TYPE &&
    typeof start?.consumerRoot === "string" &&
    Array.isArray(start.workspaces)
  );
}

/** The first message on the spawn-time channel; undefined when the channel closed first. */
function startupRequest(): Promise<unknown> {
  return new Promise((resolveRequest) => {
    if (!process.connected) {
      process.stderr.write(
        "the daemon was started without its startup channel\n",
      );
      process.exitCode = REFUSED_EXIT_CODE;
      resolveRequest(undefined);
      return;
    }
    process.once("message", (message: unknown) => resolveRequest(message));
    process.once("disconnect", () => resolveRequest(undefined));
  });
}

function refuse(log: DaemonLog, reason: string): undefined {
  log.entry(`start refused: ${reason}`);
  void report({ type: REFUSED_TYPE, reason });
  return undefined;
}

/** Sends the one startup report and closes the channel, so the daemon outlives the process that started it. */
function report(message: StartupReport): Promise<void> {
  const refused = message.type === REFUSED_TYPE;
  if (refused) process.exitCode = REFUSED_EXIT_CODE;
  if (!process.connected) {
    if (refused) process.stderr.write(`start refused: ${message.reason}\n`);
    return Promise.resolve();
  }
  return new Promise((sent) => {
    process.send?.(message, () => {
      if (process.connected) process.disconnect();
      sent();
    });
  });
}
