import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LONGEST_TEST_TIMEOUT_MS } from "../../../test/scripts/longest-test-timeout.mjs";
import {
  endProcess,
  recordStarted,
  removeKeyFile,
} from "../../../test/scripts/run-cleanup.mjs";
import {
  startDaemon,
  stopDaemon,
  type ConfirmedStart,
  type DaemonIdentity,
} from "../src/client.js";
import type { DaemonLog } from "../src/daemon/daemon-log.js";
import {
  createDaemonKey,
  type DaemonKey,
} from "../src/daemon/endpoint-proof.js";
import {
  clientEndpoint,
  listenOnEndpoint,
  type Endpoint,
} from "../src/daemon/endpoint.js";
import { isRunning } from "../src/daemon/runtime-directory.js";
import { openStore } from "../src/store/open-store.js";
import {
  consumerIdentity,
  defaultStateDirectory,
} from "../src/store/consumer-identity.js";
import { inConsumerCopy, inTempDir, runTempRoot } from "./harness.js";

/** What `RawConnection.next` resolves with once the daemon has closed the connection. */
export const CLOSED = "closed";

type Line = Readonly<Record<string, unknown>>;

/** A client that writes raw text, as a client of another protocol version or a broken one would, and reads each line back. */
export class RawConnection {
  readonly #socket: Socket;
  readonly #lines: string[] = [];
  readonly #waiting: ((line: string) => void)[] = [];
  #closed = false;

  private constructor(socket: Socket) {
    this.#socket = socket;
    const reader = createInterface({ input: socket });
    reader.on("line", (line) => this.#deliver(line));
    reader.on("close", () => {
      this.#closed = true;
      for (const wake of this.#waiting.splice(0)) wake(CLOSED);
    });
    socket.on("error", () => undefined);
  }

  static open(path: string): Promise<RawConnection> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path);
      socket.once("connect", () => resolve(new RawConnection(socket)));
      socket.once("error", reject);
    });
  }

  send(text: string): void {
    this.#socket.write(text);
  }

  sendLine(message: object): void {
    this.send(`${JSON.stringify(message)}\n`);
  }

  /** The next line the daemon sent, parsed, or `CLOSED` once it has closed the connection. */
  async next(): Promise<Line | typeof CLOSED> {
    const text = await this.#nextText();
    return text === CLOSED ? CLOSED : (JSON.parse(text) as Line);
  }

  close(): void {
    this.#socket.destroy();
  }

  #nextText(): Promise<string> {
    const queued = this.#lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    if (this.#closed) return Promise.resolve(CLOSED);
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  #deliver(line: string): void {
    const wake = this.#waiting.shift();
    if (wake === undefined) this.#lines.push(line);
    else wake(line);
  }
}

/** Opens a connection, hands it to `body`, and closes it however `body` ends. */
export async function withConnection<T>(
  path: string,
  body: (connection: RawConnection) => Promise<T>,
): Promise<T> {
  const connection = await RawConnection.open(path);
  try {
    return await body(connection);
  } finally {
    connection.close();
  }
}

const WINDOWS = "win32";
const TEST_PIPE_PREFIX = "\\\\.\\pipe\\rt-test-test-";
const TEST_SOCKET_NAME = "test.sock";

/** Serves `onConnection` on an endpoint of its own, a named pipe on Windows and a socket in a temp dir elsewhere. */
export async function withTestEndpoint<T>(
  onConnection: (socket: Socket) => void,
  body: (path: string) => Promise<T>,
): Promise<T> {
  return inTempDir(async (dir) => {
    const path =
      process.platform === WINDOWS
        ? `${TEST_PIPE_PREFIX}${randomUUID()}`
        : join(dir, TEST_SOCKET_NAME);
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      onConnection(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    try {
      return await body(path);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

/** An endpoint whose key lives in a key directory of its own under `dir`, for a test that needs a key and no daemon. */
export function keyedEndpoint(dir: string): Endpoint {
  const keyDirectory = join(dir, "keys");
  return {
    path: join(dir, "endpoint"),
    keyDirectory,
    keyFile: join(keyDirectory, "daemon.key"),
  };
}

/**
 * The proof the daemon's design freezes, written out here rather than imported: the HMAC-SHA256, keyed by the key
 * file's text, of the challenge, the worktree identity and the decimal process id joined by NUL, in hex.
 */
export function frozenProof(
  keyText: string,
  challenge: string,
  worktreeIdentity: string,
  pid: number,
): string {
  return createHmac("sha256", keyText)
    .update(`${challenge}\0${worktreeIdentity}\0${pid}`)
    .digest("hex");
}

/** Writes a key for `endpoint` as a starting daemon does, hands `body` the key and its file's text, and removes it after. */
export async function withDaemonKey<T>(
  endpoint: Endpoint,
  worktreeIdentity: string,
  body: (key: DaemonKey, keyText: string) => T | Promise<T>,
): Promise<T> {
  const created = createDaemonKey(endpoint, worktreeIdentity);
  if (!created.ok) throw new Error(created.reason);
  try {
    return await body(created.key, readFileSync(endpoint.keyFile, "utf8"));
  } finally {
    created.key.remove();
  }
}

/** A process listening on a worktree's real endpoint in its daemon's place. */
export interface StandIn {
  readonly endpoint: Endpoint;
  /** How many connections it has accepted. */
  readonly connections: number;
  /** Stops listening and drops every connection; later calls do nothing. */
  close(): Promise<void>;
}

/**
 * Listens on the worktree's real endpoint, answering each request line with what `answer` returns (nothing when it
 * returns undefined), and closes however `body` ends. `answer` also gets a promise that resolves once the connection
 * the request came on has closed.
 */
export async function withStandIn<T>(
  worktreeIdentity: string,
  answer: (
    request: Line,
    standIn: StandIn,
    connectionClosed: Promise<void>,
  ) => object | undefined,
  body: (standIn: StandIn) => Promise<T>,
): Promise<T> {
  const sockets = new Set<Socket>();
  let connections = 0;
  let closing: Promise<void> | undefined;
  let standIn: StandIn | undefined;
  recordEndpointOf(worktreeIdentity, defaultStateDirectory(worktreeIdentity));
  const listening = await listenOnEndpoint(worktreeIdentity, (socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on("error", () => undefined);
    const connectionClosed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    createInterface({ input: socket }).on("line", (line) => {
      if (standIn === undefined) return;
      const reply = answer(JSON.parse(line) as Line, standIn, connectionClosed);
      if (reply !== undefined) socket.write(`${JSON.stringify(reply)}\n`);
    });
  });
  if (!listening.ok) throw new Error(listening.reason);
  standIn = {
    endpoint: listening.endpoint,
    get connections() {
      return connections;
    },
    close: () => {
      closing ??= (() => {
        for (const socket of sockets) socket.destroy();
        return listening.close();
      })();
      return closing;
    },
  };
  try {
    return await body(standIn);
  } finally {
    await standIn.close();
  }
}

/** A daemon log that keeps its entries in memory. */
export interface MemoryLog extends DaemonLog {
  readonly entries: string[];
}

export function memoryLog(): MemoryLog {
  const entries: string[] = [];
  return {
    file: "memory.log",
    entries,
    entry(message: string) {
      entries.push(message);
    },
    error(context: string, error: unknown) {
      entries.push(`error: ${context}: ${String(error)}`);
    },
  };
}

/** A test that starts a real daemon waits for its Node processes, its Vitest runs and its stop. */
export const DAEMON_TEST_TIMEOUT_MS = LONGEST_TEST_TIMEOUT_MS;
/** Covers a daemon's startup and its stop, each under 25 s, with room for a loaded machine. */
export const DAEMON_WAIT_MS = 60_000;
const POLL_MS = 25;

export const DAEMON_FIXTURE = "daemon-lifecycle";
export const WORKSPACE_A = "packages/a";
export const WORKSPACE_B = "packages/b";
/** The files each workspace of the daemon fixture writes holding the id of the executor process that ran it. */
const EXECUTOR_PID_FILES = [
  "packages/a/executor-pids",
  "packages/a/collecting",
  "packages/a/holding",
  "packages/a/stuck",
  "packages/b/executor-pids",
];

export type Settled<T> = T | { thrown: string };

export function settled<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.catch((error: unknown) => ({
    thrown: error instanceof Error ? error.message : String(error),
  }));
}

/** Runs `body` with the environment variable `name` set to `value`, then restores what it held before. */
export async function withEnvironment<T>(
  name: string,
  value: string,
  body: () => Promise<T>,
): Promise<T> {
  const saved = process.env[name];
  process.env[name] = value;
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

const NODE_OPTIONS = "NODE_OPTIONS";

/**
 * Runs `body` with every process a start or a job spawns preloading the module at `modulePath`. The preload is
 * passed as a file URL, since NODE_OPTIONS splits a raw path at each space.
 */
export function withPreload<T>(
  modulePath: string,
  body: () => Promise<T>,
): Promise<T> {
  const preload = `--import=${pathToFileURL(modulePath).href}`;
  const options = [process.env[NODE_OPTIONS], preload].filter(Boolean);
  return withEnvironment(NODE_OPTIONS, options.join(" "), body);
}

/** Polls until `ready` holds or `boundMs` passes, and says whether it held. */
export async function eventually(
  ready: () => boolean | Promise<boolean>,
  boundMs: number = DAEMON_WAIT_MS,
): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  for (;;) {
    if (await ready()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((wake) => setTimeout(wake, POLL_MS));
  }
}

/** The daemon fixture's `packages/a` file `name`, which the fixture reads as a hold point or writes as a marker. */
export function fixtureFile(root: string, name: string): string {
  return join(root, WORKSPACE_A, name);
}

/**
 * Resolves once `ready` holds, however long a loaded machine takes to get there, so the test acts on what it waits for
 * rather than whenever a wait of its own gives up. The test's timeout still ends a run that never gets there.
 */
export async function until(ready: () => boolean): Promise<void> {
  while (!ready()) {
    await new Promise((wake) => setTimeout(wake, POLL_MS));
  }
}

/** Resolves once the fixture has written the marker `name`, the point the fixture holds at. */
export function atHoldPoint(root: string, name: string): Promise<void> {
  return until(() => existsSync(fixtureFile(root, name)));
}

export function holdAt(root: string, hold: string): void {
  writeFileSync(fixtureFile(root, hold), "");
}

/** Every executor process id the fixture recorded. */
export function executorPids(root: string): number[] {
  return EXECUTOR_PID_FILES.flatMap((name) => {
    const file = join(root, name);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map(Number);
  });
}

/** The start a user confirms with no workspace: the daemon serves and discovers, and loads no Vitest. */
export function confirmNothing(consumerRoot: string): ConfirmedStart {
  return { consumerRoot, workspaces: [] };
}

function worktreeIdentityOf(root: string): string | undefined {
  try {
    return consumerIdentity(root).worktreeIdentity;
  } catch {
    // A root with no identity is refused before any daemon starts.
    return undefined;
  }
}

/** Records where a daemon for the worktree would hold its lock, key and Linux socket. */
function recordEndpointOf(
  worktreeIdentity: string,
  stateDirectory: string,
): void {
  const location = clientEndpoint(worktreeIdentity);
  const socket =
    location.ok && location.runtimeDirectory !== undefined
      ? [location.path]
      : [];
  recordStarted(runTempRoot(), {
    lockDirectories: [stateDirectory],
    keyFiles: location.ok ? [location.keyFile] : [],
    files: socket,
  });
}

/**
 * Records, before a daemon for `root` starts, where it would hold its lock, key and socket and where the fixture
 * writes its executors' ids.
 */
function recordDaemonAt(
  root: string,
  stateDirectory: string = defaultStateDirectory(root),
): void {
  recordStarted(runTempRoot(), {
    pidFiles: EXECUTOR_PID_FILES.map((name) => join(root, name)),
    lockDirectories: [stateDirectory],
  });
  const worktree = worktreeIdentityOf(root);
  if (worktree !== undefined) recordEndpointOf(worktree, stateDirectory);
}

/** A set of daemon process ids that records each id added, so a run killed before its test ends them still can. */
class RecordedPids extends Set<number> {
  override add(pid: number): this {
    recordStarted(runTempRoot(), { pids: [pid] });
    return super.add(pid);
  }
}

export function trustedStart(
  start: ConfirmedStart,
  stateDirectory?: string,
): Promise<DaemonIdentity> {
  recordDaemonAt(start.consumerRoot, stateDirectory);
  return startDaemon({
    trusted: true,
    start,
    ...(stateDirectory === undefined ? {} : { stateDirectory }),
  });
}

/** Starts a daemon for `root`, adding its process id to `pids` so the test ends it whatever happens. */
export async function started(
  root: string,
  pids: Set<number>,
  start = confirmNothing(root),
): Promise<Settled<DaemonIdentity>> {
  const identity = await settled(trustedStart(start));
  if (!("thrown" in identity)) pids.add(identity.pid);
  return identity;
}

/** The daemon's log entries, without their timestamps. */
export function logEntries(logFile: string): string[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(line.indexOf(" ") + 1));
}

export function logged(logFile: string, prefix: string): boolean {
  return logEntries(logFile).some((entry) => entry.startsWith(prefix));
}

/** The log entry the daemon writes once every confirmed workspace has run. */
export const IDLE_ENTRY = "idle: every confirmed workspace has run";

/** Each run stored for the worktree at `consumerRoot`, as its workspace and how it ended. */
export function storedRuns(
  stateDirectory: string,
  consumerRoot: string,
): string[][] {
  const store = openStore(stateDirectory);
  try {
    return store
      .readRuns(consumerIdentity(consumerRoot))
      .map(({ run }) => [
        run.workspace.path,
        run.status === "ran" ? run.execution : run.status,
      ]);
  } finally {
    store.close();
  }
}

function end(pid: number): void {
  if (isRunning(pid)) endProcess(pid);
}

/**
 * Hands `body` the consumer roots and a set to add each daemon's process id to, then ends every daemon and executor
 * however `body` ends: executors first, so no stop waits on a stuck job, then a stop, then a kill.
 */
export async function withDaemons<T>(
  roots: readonly string[],
  body: (pids: Set<number>) => Promise<T>,
): Promise<T> {
  for (const root of roots) recordDaemonAt(root);
  const pids = new RecordedPids();
  let result: T;
  try {
    result = await body(pids);
  } catch (error) {
    await endDaemons(roots, pids);
    throw error;
  }
  const alive = await endDaemons(roots, pids);
  if (alive.length > 0) {
    throw new Error(
      `A daemon or executor process was still running after the test ended it: ${alive.join(", ")}`,
    );
  }
  return result;
}

/** Ends every daemon and executor of `roots`, and returns the ids of any process still running after the wait. */
async function endDaemons(
  roots: readonly string[],
  pids: ReadonlySet<number>,
): Promise<number[]> {
  for (const pid of roots.flatMap(executorPids)) end(pid);
  for (const root of roots) await stopDaemon(root).catch(() => undefined);
  const recorded = [...pids, ...roots.flatMap(executorPids)];
  for (const pid of recorded) end(pid);
  await eventually(() => recorded.every((pid) => !isRunning(pid)));
  const alive = recorded.filter((pid) => isRunning(pid));
  if (alive.length === 0) for (const root of roots) removeLeftovers(root);
  return alive;
}

/**
 * Removes what a daemon the test had to kill leaves behind: its key, which on Windows is in the user's profile, with
 * any copy a killed start left half written, and on Linux its socket file in the shared `/tmp`.
 */
function removeLeftovers(root: string): void {
  const location = clientEndpoint(consumerIdentity(root).worktreeIdentity);
  if (!location.ok) return;
  if (location.runtimeDirectory !== undefined) {
    rmSync(location.path, { force: true });
  }
  removeKeyFile(location.keyFile);
}

/** Copies the daemon fixture into a temp consumer with Vitest linked, and ends its daemon however `body` ends. */
export function withDaemonConsumer<T>(
  body: (root: string, pids: Set<number>) => Promise<T>,
): Promise<T> {
  return inConsumerCopy(DAEMON_FIXTURE, "vitest", (root) =>
    withDaemons([root], (pids) => body(root, pids)),
  );
}
