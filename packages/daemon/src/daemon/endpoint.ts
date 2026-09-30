import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { userInfo } from "node:os";
import { join } from "node:path";
import { errorText } from "../vitest/error-text.js";
import { runtimeDirectoryRefusal, takeLock } from "./runtime-directory.js";
import { protectDirectory } from "./windows-acl.js";

export const WINDOWS = "win32";
/*
 * Frozen for every protocol version, since a client of any version must find a daemon of any other and its key: each
 * name and directory below, and the identity hash that names the endpoint and the key.
 */
const PIPE_PREFIX = "\\\\.\\pipe\\rt-test-";
/** Every session of a user, whatever its environment, finds the same directory: never `TMPDIR` or `XDG_RUNTIME_DIR`. */
const SHARED_TEMPORARY_DIRECTORY = "/tmp";
const RUNTIME_DIRECTORY_PREFIX = "rt-test-";
/** Under the profile the user's token names, which no environment variable moves. */
const WINDOWS_KEY_DIRECTORY = ["AppData", "Local", "rt-test"] as const;
const SOCKET_EXTENSION = ".sock";
const LOCK_EXTENSION = ".lock";
const KEY_EXTENSION = ".key";
const HASH_ALGORITHM = "sha256";
const HASH_LENGTH = 32;
const HASH_SEPARATOR = "\0";

/** Where a worktree's daemon listens, and where it keeps its key. */
export interface Endpoint {
  readonly path: string;
  /** Linux only: the directory holding the socket and its lock file. */
  readonly runtimeDirectory?: string;
  /** Only this user may enter it; on Linux it is the runtime directory. */
  readonly keyDirectory: string;
  /** Where the daemon serving this endpoint keeps the key it proves itself with. */
  readonly keyFile: string;
}

export type EndpointLocation =
  | ({ readonly ok: true } & Endpoint)
  | { readonly ok: false; readonly reason: string };

export type Listening =
  | {
      readonly ok: true;
      readonly endpoint: Endpoint;
      /**
       * Resolves once the endpoint accepts no connection and every connection it accepted has ended; on Linux the
       * socket file is gone.
       */
      close(): Promise<void>;
    }
  | { readonly ok: false; readonly reason: string };

/** Who holds an endpoint path that a listen found in use. */
export type EndpointHolder = "answers" | "stale-file" | "gone";

/**
 * How a start treats an endpoint path already in use: by default, a socket file a killed daemon left. Only Linux
 * leaves one, so a test on another platform injects its own.
 */
export interface HeldEndpoint {
  holder(path: string): Promise<EndpointHolder>;
  /** Resolves once the path is free to listen on. */
  removeStale(path: string): Promise<void>;
}

const SOCKET_FILE: HeldEndpoint = {
  holder: probe,
  removeStale: removeStaleSocket,
};

/** A stable name for a worktree identity, short enough for any endpoint or file name. */
export function identityHash(...parts: readonly string[]): string {
  return createHash(HASH_ALGORITHM)
    .update(parts.join(HASH_SEPARATOR))
    .digest("hex")
    .slice(0, HASH_LENGTH);
}

/**
 * The endpoint a client may connect to: refused when its Linux runtime directory is not this user's alone, since
 * another user's socket there could answer in the daemon's place.
 */
export function clientEndpoint(worktreeIdentity: string): EndpointLocation {
  const endpoint = endpointOf(worktreeIdentity);
  const refusal =
    endpoint.runtimeDirectory === undefined
      ? undefined
      : runtimeDirectoryRefusal(endpoint.runtimeDirectory, false);
  return refusal === undefined
    ? { ok: true, ...endpoint }
    : { ok: false, reason: refusal };
}

/**
 * The pipe namespace is shared by every user of a Windows machine, so its name hashes the user too. The Linux socket
 * path has a fixed shape well under the 108-byte `sun_path` limit.
 */
function endpointOf(worktreeIdentity: string): Endpoint {
  if (process.platform === WINDOWS) {
    const name = identityHash(userInfo().username, worktreeIdentity);
    const keyDirectory = userDirectoryPath();
    return {
      path: `${PIPE_PREFIX}${name}`,
      keyDirectory,
      keyFile: join(keyDirectory, `${name}${KEY_EXTENSION}`),
    };
  }
  const runtimeDirectory = userDirectoryPath();
  const name = identityHash(worktreeIdentity);
  return {
    path: join(runtimeDirectory, `${name}${SOCKET_EXTENSION}`),
    runtimeDirectory,
    keyDirectory: runtimeDirectory,
    keyFile: join(runtimeDirectory, `${name}${KEY_EXTENSION}`),
  };
}

/** The key directory on Windows, and the runtime directory on Linux. */
function userDirectoryPath(): string {
  if (process.platform === WINDOWS) {
    return join(userInfo().homedir, ...WINDOWS_KEY_DIRECTORY);
  }
  return join(
    SHARED_TEMPORARY_DIRECTORY,
    `${RUNTIME_DIRECTORY_PREFIX}${process.getuid?.()}`,
  );
}

export type UserDirectory =
  | { readonly ok: true; readonly directory: string }
  | { readonly ok: false; readonly reason: string };

/**
 * The user's own RT Test directory, where the daemon keeps its key, made owner-only when missing. On Linux one that
 * is not this user's alone is refused. On Windows an existing one is used as found, since only this user or an
 * administrator can create it in the profile, and every daemon start protects it.
 */
export function userDirectory(): UserDirectory {
  const directory = userDirectoryPath();
  const refusal =
    process.platform === WINDOWS
      ? protectedIfMissing(directory)
      : runtimeDirectoryRefusal(directory, true);
  return refusal === undefined
    ? { ok: true, directory }
    : { ok: false, reason: refusal };
}

function protectedIfMissing(directory: string): string | undefined {
  return existsSync(directory) ? undefined : protectDirectory(directory);
}

/** Resolves with the connected socket, or rejects with the connection error, whose `code` says why. */
export function connectEndpoint(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/**
 * Takes the worktree's endpoint and serves each connection with `onConnection`. Refuses, listening nowhere, when
 * a process already answers there, or when the Linux runtime directory is not this user's.
 */
export async function listenOnEndpoint(
  worktreeIdentity: string,
  onConnection: (socket: Socket) => void,
  held: HeldEndpoint = SOCKET_FILE,
): Promise<Listening> {
  const endpoint = endpointOf(worktreeIdentity);
  try {
    return await listenAt(endpoint, onConnection, held);
  } catch (error) {
    return {
      ok: false,
      reason: `cannot take the endpoint ${endpoint.path}: ${errorText(error)}`,
    };
  }
}

async function listenAt(
  endpoint: Endpoint,
  onConnection: (socket: Socket) => void,
  held: HeldEndpoint,
): Promise<Listening> {
  const { path, runtimeDirectory } = endpoint;
  if (runtimeDirectory === undefined) {
    return listenOrReport(endpoint, onConnection, held);
  }
  const refusal = runtimeDirectoryRefusal(runtimeDirectory, true);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  const lock = takeLock(
    `${path.slice(0, -SOCKET_EXTENSION.length)}${LOCK_EXTENSION}`,
  );
  if (!lock.ok) return lock;
  try {
    return await listenOrReport(endpoint, onConnection, held);
  } finally {
    lock.release();
  }
}

async function listenOrReport(
  endpoint: Endpoint,
  onConnection: (socket: Socket) => void,
  held: HeldEndpoint,
): Promise<Listening> {
  const { path } = endpoint;
  const first = await tryListen(path, onConnection);
  if (first.ok || first.code !== "EADDRINUSE") {
    return listening(first, endpoint);
  }
  const holder = await held.holder(path);
  if (holder === "answers") {
    return {
      ok: false,
      reason: `a process already answers on this worktree's endpoint ${path}`,
    };
  }
  if (holder === "stale-file") await held.removeStale(path);
  return listening(await tryListen(path, onConnection), endpoint);
}

type ListenAttempt =
  | { readonly ok: true; readonly server: Server }
  | { readonly ok: false; readonly code: unknown; readonly reason: string };

function tryListen(
  path: string,
  onConnection: (socket: Socket) => void,
): Promise<ListenAttempt> {
  return new Promise((resolve) => {
    const server = createServer(onConnection);
    const failed = (error: NodeJS.ErrnoException): void => {
      resolve({ ok: false, code: error.code, reason: errorText(error) });
    };
    server.once("error", failed);
    server.listen(path, () => {
      server.off("error", failed);
      server.on("error", (error) => reportServerError(path, error));
      resolve({ ok: true, server });
    });
  });
}

function listening(attempt: ListenAttempt, endpoint: Endpoint): Listening {
  if (!attempt.ok) {
    return {
      ok: false,
      reason: `cannot listen on ${endpoint.path}: ${attempt.reason}`,
    };
  }
  const { server } = attempt;
  return {
    ok: true,
    endpoint,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** A Linux socket file outlives a killed listener and refuses connections; a live one answers. */
async function probe(path: string): Promise<EndpointHolder> {
  try {
    (await connectEndpoint(path)).destroy();
    return "answers";
  } catch (error) {
    return holderAfterConnectError((error as NodeJS.ErrnoException).code);
  }
}

/** A refused connection is a socket file no listener holds; any other failure means nothing is there. */
export function holderAfterConnectError(code: unknown): EndpointHolder {
  return code === "ECONNREFUSED" ? "stale-file" : "gone";
}

/** A listening server's error, such as a failed accept, leaves it serving; the daemon's stderr is its log. */
function reportServerError(path: string, error: Error): void {
  process.emitWarning(`the endpoint ${path} failed: ${errorText(error)}`);
}

async function removeStaleSocket(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
