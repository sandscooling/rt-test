import { FINGERPRINT_DIGEST, NOT_FINGERPRINTED } from "../src/store/schema.js";
import type { InputFingerprint } from "../src/store/stored-records.js";
import { logEntries } from "./daemon-harness.js";

const RUN_STORED_PREFIX = "run stored: ";
const UNDER_FINGERPRINT = " under fingerprint ";
const STORED_NOT_FINGERPRINTED = " not fingerprinted";

/** A run the daemon's log says it stored: its workspace and what it was stored under. */
export interface LoggedRun {
  readonly workspacePath: string;
  readonly inputFingerprint: InputFingerprint;
}

/**
 * Each run `entries` say was stored, in stored order: one for each `run stored:` entry, which the daemon writes once a
 * run's write has committed. No other entry names a stored run: the entry for a run stored not fingerprinted is
 * written ahead of the write, whatever its result. Throws on a `run stored:` entry that names no fingerprint.
 */
export function runsLogged(entries: readonly string[]): LoggedRun[] {
  return entries
    .filter((entry) => entry.startsWith(RUN_STORED_PREFIX))
    .map((entry) => loggedRun(entry.slice(RUN_STORED_PREFIX.length)));
}

function loggedRun(stored: string): LoggedRun {
  if (stored.endsWith(STORED_NOT_FINGERPRINTED)) {
    return {
      workspacePath: stored.slice(0, -STORED_NOT_FINGERPRINTED.length),
      inputFingerprint: { kind: NOT_FINGERPRINTED },
    };
  }
  const digestAt = stored.lastIndexOf(UNDER_FINGERPRINT);
  if (digestAt < 0) {
    throw new Error(
      `The daemon's log holds a stored run entry that names no fingerprint: ${RUN_STORED_PREFIX}${stored}`,
    );
  }
  return {
    workspacePath: stored.slice(0, digestAt),
    inputFingerprint: {
      kind: FINGERPRINT_DIGEST,
      digest: stored.slice(digestAt + UNDER_FINGERPRINT.length),
    },
  };
}

/** Each run the daemon's log at `logFile` says it stored, in stored order, one a later run of its workspace replaced in the store included. */
export function loggedRuns(logFile: string): LoggedRun[] {
  return runsLogged(logEntries(logFile));
}
