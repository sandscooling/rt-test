import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  linkSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { errorText } from "../vitest/error-text.js";
import { WINDOWS, type Endpoint } from "./endpoint.js";
import { runtimeDirectoryRefusal } from "./runtime-directory.js";
import { protectDirectory, protectedDirectoryRefusal } from "./windows-acl.js";

const KEY_BYTES = 32;
const CHALLENGE_BYTES = 32;
const CHALLENGE_ENCODING = "base64url";
/*
 * Frozen for every protocol version, so a client of any version checks the proof of a daemon of any other: the key
 * file's text, and the HMAC over the challenge, the worktree identity and the decimal process id, joined by NUL.
 */
const KEY_ENCODING = "hex";
const PROOF_ALGORITHM = "sha256";
const PROOF_ENCODING = "hex";
const PROOF_SEPARATOR = "\0";
/** Frozen: no version may lower it. */
const MAX_CHALLENGE_LENGTH = 256;
const KEY_FILE_MODE = 0o600;
const TEMPORARY_SUFFIX = ".tmp";
const REMOVING_SUFFIX = ".removing";
/** Well inside the age after which systemd-tmpfiles removes an untouched file from `/tmp`: 10 days upstream. */
const KEY_REFRESH_MS = 24 * 60 * 60 * 1000;

/** The key a daemon proves itself with, which only it and its user can read. */
export interface DaemonKey {
  /** The proof answering a client's challenge; undefined when the challenge is not one. */
  prove(challenge: unknown): string | undefined;
  /** Deletes the key, once the endpoint accepts no connection. */
  remove(): void;
}

/** A fresh challenge, so a recorded proof never answers a later client. */
export function newChallenge(): string {
  return randomBytes(CHALLENGE_BYTES).toString(CHALLENGE_ENCODING);
}

/**
 * Writes a new key for the daemon now holding `endpoint`, replacing one a killed daemon left, in a directory only
 * this user may enter. Refuses when that directory is open to anyone else.
 */
export function createDaemonKey(
  endpoint: Endpoint,
  worktreeIdentity: string,
):
  | { readonly ok: true; readonly key: DaemonKey }
  | { readonly ok: false; readonly reason: string } {
  const refusal = keyDirectoryRefusal(endpoint, true);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  const secret = randomBytes(KEY_BYTES).toString(KEY_ENCODING);
  const temporary = `${endpoint.keyFile}.${process.pid}${TEMPORARY_SUFFIX}`;
  try {
    writeFileSync(temporary, secret, { mode: KEY_FILE_MODE, flag: "wx" });
    renameSync(temporary, endpoint.keyFile);
  } catch (error) {
    rmSync(temporary, { force: true });
    return {
      ok: false,
      reason: `cannot write the daemon key ${endpoint.keyFile}: ${errorText(error)}`,
    };
  }
  const refresh = setInterval(
    () => touch(endpoint.keyFile),
    KEY_REFRESH_MS,
  ).unref();
  return {
    ok: true,
    key: {
      prove: (challenge) =>
        isChallenge(challenge)
          ? proofOf(secret, challenge, worktreeIdentity, process.pid)
          : undefined,
      remove: () => {
        clearInterval(refresh);
        removeIfStillOurs(endpoint.keyFile, secret);
      },
    },
  };
}

/**
 * Checks answers against the key of the daemon now serving `endpoint`. It is read before any request is sent,
 * since a daemon removes its key as it stops, before a client may have read the acknowledgement.
 */
export function daemonVerifier(
  endpoint: Endpoint,
  worktreeIdentity: string,
):
  | { readonly ok: true; readonly verifier: DaemonVerifier }
  | { readonly ok: false; readonly reason: string } {
  const secret = readKey(endpoint);
  if (!secret.ok) return secret;
  return {
    ok: true,
    verifier: {
      refusal: (challenge, answer) =>
        proofRefusal(secret.value, worktreeIdentity, challenge, answer),
    },
  };
}

export interface DaemonVerifier {
  /**
   * Why `answer` does not prove it came from this user's daemon for the worktree: it must carry the process id it
   * names and the proof over the challenge sent, made with the daemon's key.
   */
  refusal(
    challenge: string,
    answer: Readonly<Record<string, unknown>>,
  ): string | undefined;
}

function proofRefusal(
  secret: string,
  worktreeIdentity: string,
  challenge: string,
  answer: Readonly<Record<string, unknown>>,
): string | undefined {
  const { pid, proof } = answer;
  if (typeof pid !== "number" || typeof proof !== "string") {
    return `it answered without a proof: ${JSON.stringify(answer)}`;
  }
  const expected = Buffer.from(
    proofOf(secret, challenge, worktreeIdentity, pid),
  );
  const received = Buffer.from(proof);
  return received.length === expected.length &&
    timingSafeEqual(received, expected)
    ? undefined
    : "its proof does not match this worktree's daemon key";
}

function readKey(
  endpoint: Endpoint,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: string } {
  const refusal = keyDirectoryRefusal(endpoint, false);
  if (refusal !== undefined) return { ok: false, reason: refusal };
  try {
    return { ok: true, value: readFileSync(endpoint.keyFile, "utf8") };
  } catch (error) {
    return {
      ok: false,
      reason: `no daemon key can be read from ${endpoint.keyFile}: ${errorText(error)}`,
    };
  }
}

function keyDirectoryRefusal(
  endpoint: Endpoint,
  create: boolean,
): string | undefined {
  if (process.platform !== WINDOWS) {
    return runtimeDirectoryRefusal(endpoint.keyDirectory, create);
  }
  return create
    ? protectDirectory(endpoint.keyDirectory)
    : protectedDirectoryRefusal(endpoint.keyDirectory);
}

function isChallenge(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CHALLENGE_LENGTH
  );
}

function proofOf(
  secret: string,
  challenge: string,
  worktreeIdentity: string,
  pid: number,
): string {
  return createHmac(PROOF_ALGORITHM, secret)
    .update([challenge, worktreeIdentity, String(pid)].join(PROOF_SEPARATOR))
    .digest(PROOF_ENCODING);
}

/** Keeps a long-idle daemon's key from being aged out of `/tmp`. */
function touch(file: string): void {
  const now = new Date();
  try {
    utimesSync(file, now, now);
  } catch (error) {
    process.emitWarning(
      `cannot refresh the daemon key ${file}: ${errorText(error)}`,
    );
  }
}

/**
 * Moves the key aside before reading it, so a key a starting daemon has just written in its place is never deleted:
 * one found to be another daemon's is put back. A key that could be neither read nor put back is left aside.
 */
function removeIfStillOurs(file: string, secret: string): void {
  const aside = `${file}.${process.pid}${REMOVING_SUFFIX}`;
  try {
    renameSync(file, aside);
    if (readFileSync(aside, "utf8") !== secret) putBack(aside, file);
    rmSync(aside, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      process.emitWarning(
        `cannot remove the daemon key ${file}: ${errorText(error)}`,
      );
    }
  }
}

/** A key written after it was moved aside is newer, so it stays. */
function putBack(aside: string, file: string): void {
  try {
    linkSync(aside, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
