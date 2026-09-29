import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { join } from "node:path";
import { recordStarted } from "../../../test/scripts/run-cleanup.mjs";
import { runTempRoot } from "./harness.js";

const WINDOWS = "win32";
const TEST_PIPE_PREFIX = "\\\\.\\pipe\\rt-test-test-";
/**
 * A directory with a short fixed path, so a test socket's path fits the 108-byte `sun_path` whatever the temp
 * directory is.
 */
const TEST_SOCKET_DIRECTORY = "/tmp";
const TEST_SOCKET_PREFIX = "rt-test-test-";
const TEST_SOCKET_EXTENSION = ".sock";

/** A socket path of its own, recorded for the run's cleanup, since a killed test leaves the socket file behind. */
export function testSocketPath(): string {
  const path = join(
    TEST_SOCKET_DIRECTORY,
    `${TEST_SOCKET_PREFIX}${randomUUID()}${TEST_SOCKET_EXTENSION}`,
  );
  recordStarted(runTempRoot(), { files: [path] });
  return path;
}

/** Serves `onConnection` on an endpoint of its own, a named pipe on Windows and a socket elsewhere. */
export async function withTestEndpoint<T>(
  onConnection: (socket: Socket) => void,
  body: (path: string) => Promise<T>,
): Promise<T> {
  const onWindows = process.platform === WINDOWS;
  const path = onWindows
    ? `${TEST_PIPE_PREFIX}${randomUUID()}`
    : testSocketPath();
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    onConnection(socket);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, resolve);
    });
    return await body(path);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    if (!onWindows) rmSync(path, { force: true });
  }
}
