import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TestOptions } from "vitest";
import {
  createDaemonKey,
  type DaemonKey,
} from "../src/daemon/endpoint-proof.js";
import { WINDOWS, type Endpoint } from "../src/daemon/endpoint.js";
import { KEY_DIRECTORY_START_BOUND_MS } from "../src/daemon/windows-acl.js";

/** Vitest's per-test timeout for a test that names none. */
const VITEST_DEFAULT_TIMEOUT_MS = 5000;
/**
 * On Windows, writing one daemon key and checking it at most twice, with the user's SID read at most once per test,
 * runs no more system tools than a start's key directory bound covers. Each tool run ends itself within its own
 * timeout, so a hung tool fails the test with the tool's error rather than the test's timeout. Elsewhere a test takes
 * the run's configured timeout.
 */
export const KEY_TEST_TIMEOUT_MS: number | undefined =
  process.platform === WINDOWS
    ? VITEST_DEFAULT_TIMEOUT_MS + KEY_DIRECTORY_START_BOUND_MS
    : undefined;

/** `KEY_TEST_TIMEOUT_MS` as a suite's options. */
export const KEY_TEST_OPTIONS: TestOptions =
  KEY_TEST_TIMEOUT_MS === undefined ? {} : { timeout: KEY_TEST_TIMEOUT_MS };

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
