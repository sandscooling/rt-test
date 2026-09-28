import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { isRunning } from "../processes.mjs";

export const LEASE_DIR = "_agent-docs/.scratch/run-lease";
export const HEARTBEAT_MS = 10_000;
const STALE_AFTER_MS = 60_000;
const ORPHANED_RUN_LIMIT_MS = 60 * 60_000;

const LEASE_FILE = "lease.json";
const QUEUE_DIR = "queue";
const ENTRY_EXTENSION = ".json";
const PARTIAL_ENTRY_SUFFIX = ".part";
const TIME_DIGITS = 15;
const PID_DIGITS = 10;
const MS_PER_SECOND = 1000;
const LOCK_DIR = "lease.lock";
const LOCK_BROKEN_AFTER_MS = 5000;
const LOCK_RETRY_MS = 10;
const STORED_FIELDS = [
  "lane",
  "thread",
  "worktree",
  "command",
  "pid",
  "at",
  "childPid",
];

const leaseFile = (dir) => join(dir, LEASE_FILE);
const queueDir = (dir) => join(dir, QUEUE_DIR);

const sleepSync = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A lock left by a process that died inside its few-millisecond hold is broken once it is clearly abandoned.
function breakAbandonedLock(lock) {
  const heldSince = statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
  if (heldSince === undefined) return;
  if (Date.now() - heldSince <= LOCK_BROKEN_AFTER_MS) return;
  removeDirIfPresent(lock);
}

function removeDirIfPresent(dir) {
  try {
    rmdirSync(dir);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** Runs `fn` while no other process reads, checks and replaces or removes the lease. */
function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, LOCK_DIR);
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      breakAbandonedLock(lock);
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    removeDirIfPresent(lock);
  }
}

function removeIfPresent(file) {
  try {
    unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function createExclusive(file, record) {
  const fd = openSync(file, "wx");
  try {
    writeSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
}

/** Stamps the heartbeat, which is the file's mtime. False once the file is gone. */
export function beat(file, now = Date.now()) {
  const seconds = now / MS_PER_SECOND;
  try {
    utimesSync(file, seconds, seconds);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// A record caught mid-write reads as one with no pid, which counts as stale.
function readRecord(file) {
  let text;
  let heartbeatAt;
  try {
    heartbeatAt = statSync(file).mtimeMs;
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    record = { lane: "(unreadable lease)", thread: "", command: "" };
  }
  return { ...record, heartbeatAt, file };
}

export const readLease = (dir) => readRecord(leaseFile(dir));

/**
 * A holder is stale once its process is gone or its heartbeat has lapsed, unless the run it started still runs:
 * a wrapper killed on its own leaves that run loading the machine. That run keeps the lease for a bounded time only.
 */
export function isStale(record, now = Date.now(), running = isRunning) {
  if (
    record.childPid !== undefined &&
    now - record.heartbeatAt > ORPHANED_RUN_LIMIT_MS
  ) {
    return true;
  }
  if (record.childPid !== undefined && running(record.childPid)) return false;
  return !running(record.pid) || now - record.heartbeatAt > STALE_AFTER_MS;
}

const storedFields = (record) =>
  Object.fromEntries(
    STORED_FIELDS.filter((key) => record[key] !== undefined).map((key) => [
      key,
      record[key],
    ]),
  );

function entryName(owner, now) {
  const time = String(now).padStart(TIME_DIGITS, "0");
  const pid = String(owner.pid).padStart(PID_DIGITS, "0");
  return `${time}-${pid}${ENTRY_EXTENSION}`;
}

function queueEntries(dir) {
  const folder = queueDir(dir);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => name.endsWith(ENTRY_EXTENSION))
    .toSorted()
    .map((name) => readRecord(join(folder, name)))
    .filter((record) => record !== null);
}

/** The live waiters in arrival order. With `prune`, a stale waiter's entry is removed as well as skipped. */
function liveQueue(
  dir,
  { now = Date.now(), running = isRunning, prune = false } = {},
) {
  const live = [];
  for (const entry of queueEntries(dir)) {
    if (!isStale(entry, now, running)) live.push(entry);
    else if (prune) removeIfPresent(entry.file);
  }
  return live;
}

/** Adds a waiter at the back of the queue; `owner` is the record the lease will carry. */
export function joinQueue(dir, owner, now = Date.now()) {
  mkdirSync(queueDir(dir), { recursive: true });
  const file = join(queueDir(dir), entryName(owner, now));
  const partial = `${file}${PARTIAL_ENTRY_SUFFIX}`;
  writeFileSync(partial, JSON.stringify({ ...owner, at: now }));
  renameSync(partial, file);
  beat(file, now);
  return { file, owner };
}

const leaveQueue = (entry) => removeIfPresent(entry.file);

/**
 * Takes the lease when this waiter heads the queue and the lease is free or stale. The holder is re-read and the
 * lease created under the lock, so two waiters never both replace it. `rejoin` means a lapsed heartbeat cost this
 * waiter its entry.
 */
export function takeTurn(
  dir,
  entry,
  { now = Date.now(), running = isRunning } = {},
) {
  const waiting = liveQueue(dir, { now, running, prune: true });
  const position = waiting.findIndex((w) => w.file === entry.file);
  return withLock(dir, () => {
    const current = readLease(dir);
    const holder = current && !isStale(current, now, running) ? current : null;
    if (position !== 0 || holder) {
      return { taken: false, rejoin: position === -1, position, holder };
    }
    if (current) removeIfPresent(current.file);
    createExclusive(leaseFile(dir), { ...entry.owner, at: now });
    beat(leaseFile(dir), now);
    leaveQueue(entry);
    return { taken: true, reclaimed: current, file: leaseFile(dir) };
  });
}

/** Records the pid of the run the holder started, while `pid` still holds the lease. */
export function recordChild(dir, pid, childPid, now = Date.now()) {
  return withLock(dir, () => {
    const current = readLease(dir);
    if (current?.pid !== pid) return false;
    writeFileSync(
      current.file,
      JSON.stringify({ ...storedFields(current), childPid }),
    );
    return beat(current.file, now);
  });
}

/** Removes the lease only while this process still holds it; a reclaimed lease belongs to its new holder. */
export function releaseOwn(dir, pid) {
  return withLock(dir, () => {
    const current = readLease(dir);
    if (current?.pid !== pid) return false;
    removeIfPresent(current.file);
    return true;
  });
}

export const RELEASE = Object.freeze({
  RELEASED: "released",
  REFUSED: "refused",
  NONE: "none",
});

export function releaseLane(dir, lane) {
  return withLock(dir, () => {
    const current = readLease(dir);
    if (current === null) return { status: RELEASE.NONE, holder: null };
    if (current.lane !== lane) {
      return { status: RELEASE.REFUSED, holder: current };
    }
    removeIfPresent(current.file);
    return { status: RELEASE.RELEASED, holder: current };
  });
}

/**
 * What holds the lease now, whether only its recorded run holds it, a stale record nobody has reclaimed yet, and the
 * live waiters. Reads only.
 */
export function leaseStatus(
  dir,
  { now = Date.now(), running = isRunning } = {},
) {
  const current = readLease(dir);
  const stale = current !== null && isStale(current, now, running);
  return {
    holder: stale ? null : current,
    orphaned: !stale && current !== null && !running(current.pid),
    stale: stale ? current : null,
    queue: liveQueue(dir, { now, running }),
  };
}
