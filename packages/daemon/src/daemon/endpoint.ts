import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from "node:net";
import { tmpdir, userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { errorText } from "../vitest/error-text.js";
import { runtimeDirectoryRefusal, takeLock } from "./runtime-directory.js";

const WINDOWS = "win32";
const PIPE_PREFIX = "\\\\.\\pipe\\rt-test-";
const RUNTIME_DIRECTORY_VARIABLE = "XDG_RUNTIME_DIR";
const RUNTIME_DIRECTORY_PREFIX = "rt-test-";
const SOCKET_EXTENSION = ".sock";
const LOCK_EXTENSION = ".lock";
/** Linux's `sun_path` size, which Linux fills without a terminating NUL: a longer path is refused by one Node and silently truncated by another. */
export const MAX_SOCKET_PATH_BYTES = 108;
const HASH_ALGORITHM = "sha256";
const HASH_LENGTH = 32;
const HASH_SEPARATOR = "\0";

/** Where a worktree's daemon listens. */
export type EndpointLocation =
  | {
      readonly ok: true;
      readonly path: string;
      /** Linux only: the directory holding the socket and its lock file. */
      readonly runtimeDirectory?: string;
    }
  | { readonly ok: false; readonly reason: string };

export type Listening =
  | {
      readonly ok: true;
      readonly path: string;
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
 * The endpoint a client may connect to: refused when the Linux socket path is too long, or when its runtime
 * directory is not this user's alone, since another user's socket there could answer in the daemon's place.
 */
export function clientEndpoint(worktreeIdentity: string): EndpointLocation {
  const location = endpointLocation(worktreeIdentity);
  if (!location.ok || location.runtimeDirectory === undefined) return location;
  const refusal = runtimeDirectoryRefusal(location.runtimeDirectory, false);
  return refusal === undefined ? location : { ok: false, reason: refusal };
}

/** The pipe namespace is shared by every user of a Windows machine, so its name hashes the user too. */
function endpointLocation(worktreeIdentity: string): EndpointLocation {
  if (process.platform === WINDOWS) {
    return {
      ok: true,
      path: `${PIPE_PREFIX}${identityHash(userInfo().username, worktreeIdentity)}`,
    };
  }
  const runtimeDirectory = linuxRuntimeDirectory();
  const path = join(
    runtimeDirectory,
    `${identityHash(worktreeIdentity)}${SOCKET_EXTENSION}`,
  );
  const bytes = Buffer.byteLength(path, "utf8");
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    return {
      ok: false,
      reason: `the socket path ${path} is ${bytes} bytes, longer than the platform's limit of ${MAX_SOCKET_PATH_BYTES} bytes`,
    };
  }
  return { ok: true, path, runtimeDirectory };
}

function linuxRuntimeDirectory(): string {
  const configured = process.env[RUNTIME_DIRECTORY_VARIABLE];
  if (configured !== undefined && isAbsolute(configured)) return configured;
  return join(tmpdir(), `${RUNTIME_DIRECTORY_PREFIX}${process.getuid?.()}`);
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
 * another daemon answers there, when the Linux path is too long, or when the runtime directory is not this user's.
 */
export async function listenOnEndpoint(
  worktreeIdentity: string,
  onConnection: (socket: Socket) => void,
  held: HeldEndpoint = SOCKET_FILE,
): Promise<Listening> {
  const location = endpointLocation(worktreeIdentity);
  if (!location.ok) return location;
  try {
    return await listenAt(
      location.path,
      location.runtimeDirectory,
      onConnection,
      held,
    );
  } catch (error) {
    return {
      ok: false,
      reason: `cannot take the endpoint ${location.path}: ${errorText(error)}`,
    };
  }
}

async function listenAt(
  path: string,
  runtimeDirectory: string | undefined,
  onConnection: (socket: Socket) => void,
  held: HeldEndpoint,
): Promise<Listening> {
  if (runtimeDirectory === undefined) {
    return listenOrReport(path, onConnection, held);
  }
  const refusal = runtimeDirectoryRefusal(runtimeDirectory, true);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  const lock = takeLock(
    `${path.slice(0, -SOCKET_EXTENSION.length)}${LOCK_EXTENSION}`,
  );
  if (!lock.ok) return lock;
  try {
    return await listenOrReport(path, onConnection, held);
  } finally {
    lock.release();
  }
}

async function listenOrReport(
  path: string,
  onConnection: (socket: Socket) => void,
  held: HeldEndpoint,
): Promise<Listening> {
  const first = await tryListen(path, onConnection);
  if (first.ok || first.code !== "EADDRINUSE") return listening(first, path);
  const holder = await held.holder(path);
  if (holder === "answers") {
    return {
      ok: false,
      reason: `another daemon already serves this worktree's endpoint ${path}`,
    };
  }
  if (holder === "stale-file") await held.removeStale(path);
  return listening(await tryListen(path, onConnection), path);
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

function listening(attempt: ListenAttempt, path: string): Listening {
  if (!attempt.ok) {
    return {
      ok: false,
      reason: `cannot listen on ${path}: ${attempt.reason}`,
    };
  }
  const { server } = attempt;
  return {
    ok: true,
    path,
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
