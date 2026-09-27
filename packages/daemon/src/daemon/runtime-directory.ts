import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { errorText } from "../vitest/error-text.js";

const OWNER_ONLY_MODE = 0o700;
const GROUP_AND_OTHER_BITS = 0o077;
const PERMISSION_BITS = 0o777;
const NO_SIGNAL = 0;
const TEMPORARY_SUFFIX = ".tmp";
const STALE_SUFFIX = ".stale";
/** The start lock is held across the stale-socket check, its unlink and the listen, so two racing starts never unlink each other's live socket. */
const START_LOCK_HOLDER = "another start of this worktree's daemon";

export type Lock =
  | { readonly ok: true; release(): void }
  | { readonly ok: false; readonly reason: string };

/**
 * Why the Linux runtime directory cannot hold this user's socket: a link, not a directory, another user's, or open
 * to others. With `create`, a missing directory is made owner-only; without it, a missing directory passes, since
 * nothing listens there.
 */
export function runtimeDirectoryRefusal(
  directory: string,
  create: boolean,
): string | undefined {
  try {
    if (create)
      mkdirSync(directory, { recursive: true, mode: OWNER_ONLY_MODE });
    const stats = lstatSync(directory, { throwIfNoEntry: false });
    if (stats === undefined) return undefined;
    if (stats.isSymbolicLink()) {
      return `the runtime directory ${directory} is a symbolic link`;
    }
    if (!stats.isDirectory()) return `${directory} is not a directory`;
    if (stats.uid !== process.getuid?.()) {
      return `the runtime directory ${directory} belongs to another user`;
    }
    if ((stats.mode & GROUP_AND_OTHER_BITS) !== 0) {
      return `other users can enter the runtime directory ${directory} (mode ${(stats.mode & PERMISSION_BITS).toString(8)}, ${OWNER_ONLY_MODE.toString(8)} required)`;
    }
    return undefined;
  } catch (error) {
    return `cannot use the runtime directory ${directory}: ${errorText(error)}`;
  }
}

/**
 * An exclusive lock file naming this process. A lock whose process has ended is taken over. A refusal names the
 * holding process as `holderRole`, what a process holding this lock is.
 */
export function takeLock(
  file: string,
  holderRole: string = START_LOCK_HOLDER,
): Lock {
  if (createLock(file)) return held(file);
  const holder = readHolder(file);
  if (holder !== undefined && isRunning(holder)) {
    return {
      ok: false,
      reason: `${holderRole}, process ${holder}, holds ${file}; delete it if process ${holder} is not one`,
    };
  }
  if (holder !== undefined) removeStaleLock(file, holder);
  return createLock(file)
    ? held(file)
    : {
        ok: false,
        reason: `${holderRole} holds ${file}; delete it if no such process is running`,
      };
}

export function isRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, NO_SIGNAL);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Links a fully written file into place, so the lock never exists without its process id. */
function createLock(file: string): boolean {
  const temporary = `${file}.${process.pid}${TEMPORARY_SUFFIX}`;
  writeFileSync(temporary, String(process.pid), { mode: OWNER_ONLY_MODE });
  try {
    linkSync(temporary, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return false;
  } finally {
    removeIfPresent(temporary);
  }
}

/** Moves the lock aside under this process's own name, so of two starts only one takes it; puts back a live one it took by mistake. */
function removeStaleLock(file: string, staleHolder: number): void {
  const aside = `${file}.${process.pid}${STALE_SUFFIX}`;
  try {
    renameSync(file, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const moved = readHolder(aside);
  if (moved !== staleHolder) restore(aside, file);
  removeIfPresent(aside);
}

function restore(aside: string, file: string): void {
  try {
    linkSync(aside, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function held(file: string): Lock {
  return {
    ok: true,
    release: () => {
      if (readHolder(file) === process.pid) removeIfPresent(file);
    },
  };
}

/** Undefined when the file is gone or names no process. */
function readHolder(file: string): number | undefined {
  try {
    const pid = Number.parseInt(readFileSync(file, "utf8"), 10);
    return Number.isInteger(pid) ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function removeIfPresent(file: string): void {
  try {
    unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
