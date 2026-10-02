import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { createInterface, type Interface } from "node:readline";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LONGEST_TEST_TIMEOUT_MS } from "../../../test/scripts/longest-test-timeout.mjs";
import {
  endOwnedProcesses,
  recordStarted,
  removeKeyFile,
  stillRunning,
  type ProcessRecord,
} from "../../../test/scripts/run-cleanup.mjs";
import {
  startDaemon,
  stopDaemon,
  type ConfirmedStart,
  type DaemonIdentity,
} from "../src/client.js";
import type { DaemonLog } from "../src/daemon/daemon-log.js";
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
import {
  fixtureRepository,
  inConsumerCopy,
  REPO,
  runTempRoot,
} from "./harness.js";

/** What `RawConnection.next` resolves with once the daemon has closed the connection. */
export const CLOSED = "closed";

type Line = Readonly<Record<string, unknown>>;

/**
 * The lines of a connection this side also writes to, with each of its errors handed to `onError` once. readline
 * re-emits the socket's errors on its interface until the socket ends, where one nobody listens for is thrown uncaught.
 * The interface does not close when an error closes the socket, so read the end of the connection from the socket.
 */
export function readLines(
  socket: Socket,
  onError: (error: NodeJS.ErrnoException) => void,
): Interface {
  socket.on("error", onError);
  const lines = createInterface({ input: socket });
  lines.on("error", () => undefined);
  return lines;
}

/** A request line parsed, or undefined for one that is not a JSON object. */
function parsedRequest(line: string): Line | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  const isObject =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  return isObject ? (parsed as Line) : undefined;
}

/** A client that writes raw text, as a client of another protocol version or a broken one would, and reads each line back. */
export class RawConnection {
  readonly #socket: Socket;
  readonly #lines: string[] = [];
  readonly #waiting: ((line: string) => void)[] = [];
  #closed = false;

  private constructor(socket: Socket) {
    this.#socket = socket;
    readLines(socket, () => undefined).on("line", (line) =>
      this.#deliver(line),
    );
    socket.once("close", () => {
      this.#closed = true;
      for (const wake of this.#waiting.splice(0)) wake(CLOSED);
    });
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
  let unreadable: Error | undefined;
  recordEndpointOf(worktreeIdentity, defaultStateDirectory(worktreeIdentity));
  const listening = await listenOnEndpoint(worktreeIdentity, (socket) => {
    connections += 1;
    sockets.add(socket);
    const connectionClosed = new Promise<void>((resolve) =>
      socket.once("close", () => resolve()),
    );
    readLines(socket, () => undefined).on("line", (line) => {
      if (standIn === undefined || socket.destroyed) return;
      const request = parsedRequest(line);
      if (request === undefined) {
        unreadable ??= new Error(
          `the stand-in read a line that is not a JSON object: ${line}`,
        );
        socket.destroy();
        return;
      }
      const reply = answer(request, standIn, connectionClosed);
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
    const result = await body(standIn);
    if (unreadable !== undefined) throw unreadable;
    return result;
  } catch (error) {
    if (unreadable === undefined || error === unreadable) throw error;
    throw new Error(unreadable.message, { cause: error });
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

/**
 * The files the daemon fixture writes into its own tree while a job runs, and the control files a test writes to hold,
 * release or shape one. A file that changes during a job is an input edit, which stores the job not fingerprinted and
 * leaves its workspace due, so a daemon over the fixture never idles unless git ignores them.
 */
const FIXTURE_MARKERS = [
  ...new Set([
    ...EXECUTOR_PID_FILES.map((file) => file.slice(file.lastIndexOf("/") + 1)),
    "setups",
    "held-out",
    "hold",
    "release",
    "hold-collect",
    "release-collect",
    "spawn-children",
    "stick-at",
    "host-rejection",
    "crash-at",
    "child-endpoint",
    "heartbeat-*",
    "failed-heartbeat-*",
  ]),
];

/** Ignores the fixture's own markers in the git repository at `root`, so only the daemon's own writes could move its inputs. */
export function ignoreFixtureMarkers(root: string): void {
  writeFileSync(join(root, ".gitignore"), `${FIXTURE_MARKERS.join("\n")}\n`);
}

/** Declares the fixture's markers non-inputs in `rt-test.json`, for a consumer that is not a real git repository. */
export function declareFixtureMarkers(root: string): void {
  writeFileSync(
    join(root, "rt-test.json"),
    JSON.stringify({ nonInputs: FIXTURE_MARKERS.map((name) => `**/${name}`) }),
  );
}

export type Settled<T> = T | { thrown: string };

export function settled<T>(work: Promise<T>): Promise<Settled<T>> {
  return work.catch((error: unknown) => ({
    thrown: error instanceof Error ? error.message : String(error),
  }));
}

/** Runs `body` with the environment variable `name` set to `value`, then restores what it held before. */
export function withEnvironment<T>(
  name: string,
  value: string,
  body: () => Promise<T>,
): Promise<T> {
  return withVariables({ [name]: value }, body);
}

/** Runs `body` with each variable in `values` set, or unset where its value is undefined, then restores them all. */
export async function withVariables<T>(
  values: Readonly<Record<string, string | undefined>>,
  body: () => Promise<T>,
): Promise<T> {
  const saved = Object.keys(values).map(
    (name) => [name, process.env[name]] as const,
  );
  setVariables(Object.entries(values));
  try {
    return await body();
  } finally {
    setVariables(saved);
  }
}

function setVariables(
  values: Iterable<readonly [string, string | undefined]>,
): void {
  for (const [name, value] of values) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/** Preloaded through NODE_OPTIONS, it has each executor process report the environment it started with. */
export const REPORT_ENVIRONMENT = join(
  REPO,
  "test/fixtures/daemon/report-environment.mjs",
);

/** The environments the report-environment preload recorded in `file`, one per executor process, in start order. */
export function reportedEnvironments(file: string): NodeJS.ProcessEnv[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as NodeJS.ProcessEnv);
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

/** `packages/a`'s global setup count at a confirmed start's discovery, the first job to load it. */
const DISCOVERY_SETUP = "1";
/** `packages/a`'s global setup count at a confirmed start's first run, which follows its discovery's. */
export const FIRST_RUN_SETUP = "2";

/** Makes `packages/a`'s global setup leak one unhandled rejection on the executor's thread at the discovery alone. */
export function leakAtDiscovery(root: string): void {
  writeFileSync(fixtureFile(root, "host-rejection"), DISCOVERY_SETUP);
}

/** Makes `packages/a`'s global setup leak one unhandled rejection on the executor's thread at the first run alone. */
export function leakAtFirstRun(root: string): void {
  writeFileSync(fixtureFile(root, "host-rejection"), FIRST_RUN_SETUP);
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
function executorPids(root: string): number[] {
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

/** The log entry the daemon writes each time a round leaves no confirmed workspace due. */
export const IDLE_ENTRY = "idle: no confirmed workspace is due";

/** Each run the store holds for the worktree at `consumerRoot`, which is each workspace's latest, as its workspace and how it ended. */
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

/**
 * Ends each executor the fixture recorded for `roots` that is still running as one of theirs, and returns the records
 * it ended. On Windows only a live daemon proves an executor theirs; on Linux its working directory does too. An id
 * another process has since taken is spared.
 */
export function endExecutors(roots: readonly string[]): ProcessRecord[] {
  return endOwnedProcesses(roots, roots.flatMap(executorPids));
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
    await endDaemons(roots, pids).catch((cleanup: unknown) => {
      throw new AggregateError(
        [error, cleanup],
        "the test failed, and ending its daemons failed too",
      );
    });
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

/**
 * Ends every daemon and executor of `roots` still running as theirs, and returns the ids of any it ended that still
 * run after the wait. Each daemon is asked to stop even when its executors could not be ended. A recorded id still
 * running that could not be proven theirs keeps the leftovers, since it may be a daemon still using its key; the
 * run's teardown removes them, as it removes whatever a run recorded.
 */
async function endDaemons(
  roots: readonly string[],
  pids: ReadonlySet<number>,
): Promise<number[]> {
  let endedFirst: ProcessRecord[];
  try {
    endedFirst = endExecutors(roots);
  } finally {
    for (const root of roots) await stopDaemon(root).catch(() => undefined);
  }
  const recorded = [...pids, ...roots.flatMap(executorPids)];
  const ended = endOwnedProcesses(roots, recorded);
  const everyEnded = [...endedFirst, ...ended];
  const endedIds = new Set(everyEnded.map(({ pid }) => pid));
  const unproven = recorded.filter(
    (pid) => !endedIds.has(pid) && isRunning(pid),
  );
  await eventually(() => stillRunning(everyEnded).length === 0);
  const alive = [...new Set(stillRunning(everyEnded).map(({ pid }) => pid))];
  if (alive.length === 0 && unproven.length === 0) {
    for (const root of roots) removeLeftovers(root);
  }
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

/**
 * Copies the daemon fixture into a temp git repository that ignores its markers, with Vitest linked, and ends its
 * daemon however `body` ends.
 */
export function withDaemonConsumer<T>(
  body: (root: string, pids: Set<number>) => Promise<T>,
): Promise<T> {
  return inConsumerCopy(DAEMON_FIXTURE, "vitest", (root) => {
    ignoreFixtureMarkers(root);
    fixtureRepository(root);
    return withDaemons([root], (pids) => body(root, pids));
  });
}
