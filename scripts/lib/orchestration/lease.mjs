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
import { ownerRunning } from "../../../test/scripts/run-cleanup.mjs";
import { isRunning } from "../processes.mjs";

export const LEASE_DIR = "_agent-docs/.scratch/run-lease";
export const HEARTBEAT_MS = 10_000;
const STALE_AFTER_MS = 60_000;
const ORPHANED_RUN_LIMIT_MS = 60 * 60_000;
/**
 * How long a proof that a live process is the recorded one holds before it is sought again: its own heartbeat, or
 * its start time read from the OS, which costs a process query of about a second on Windows.
 */
const IDENTITY_TRUSTED_MS = 2 * HEARTBEAT_MS;
const DECIMAL_DIGITS = /^\d+$/;

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
  "startedAt",
  "at",
  "childPid",
  "childStartedAt",
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

/** The lease as its last writer left it: every write of its content holds the lock, so a read under it is never torn. */
export const readLeaseLocked = (dir) => withLock(dir, () => readLease(dir));

/**
 * Whether the process a record names still runs: a process holds its id, and has its start time when the record
 * holds one. A start time checked as running, or whose check failed, counts as running without another query while
 * its id stays held, for a bounded time. A failed check counts as running, as the id alone would, and is reported.
 */
export function processProbe(
  report,
  { now = Date.now, confirm = ownerRunning } = {},
) {
  const checked = new Map();
  return (pid, startedAt) => {
    if (!isRunning(pid)) {
      checked.delete(pid);
      return false;
    }
    if (typeof startedAt !== "string" || !DECIMAL_DIGITS.test(startedAt)) {
      return true;
    }
    const at = now();
    const last = checked.get(pid);
    if (last?.startedAt === startedAt && at - last.at < IDENTITY_TRUSTED_MS) {
      return true;
    }
    let alive = true;
    try {
      alive = confirm({ pid, startedAt: BigInt(startedAt) });
    } catch (error) {
      report(
        `process ${pid} counts as running, since its start time could not be checked: ${error.message}`,
      );
    }
    if (alive) checked.set(pid, { startedAt, at });
    else checked.delete(pid);
    return alive;
  };
}

// A recent heartbeat, stamped by the owner or by a run joining its hold, stands in for the owner's start time.
function ownerRuns(record, now, running) {
  const beatAge = now - record.heartbeatAt;
  if (beatAge > STALE_AFTER_MS) return false;
  if (beatAge < IDENTITY_TRUSTED_MS) return running(record.pid);
  return running(record.pid, record.startedAt);
}

function recordedRunRuns(record, now, running) {
  if (record.childPid === undefined) return false;
  if (now - record.heartbeatAt > ORPHANED_RUN_LIMIT_MS) return false;
  return running(record.childPid, record.childStartedAt);
}

/**
 * A holder is stale once its process is gone or its heartbeat has lapsed, unless the run it started still runs:
 * a wrapper killed on its own leaves that run loading the machine. That run keeps the lease for a bounded time only.
 */
export const isStale = (record, now = Date.now(), running = isRunning) =>
  !ownerRuns(record, now, running) && !recordedRunRuns(record, now, running);

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

const sameRecord = (a, b) =>
  a !== null &&
  b !== null &&
  a.heartbeatAt === b.heartbeatAt &&
  a.pid === b.pid &&
  a.childPid === b.childPid;

const byIdAlone = (running) => (pid) => running(pid);

/**
 * Takes the lease when this waiter heads the queue and the lease is free or stale. The holder is re-read and the
 * lease created under the lock, so two waiters never both replace it. The holder is judged before the lock, since
 * judging it may query the OS for longer than the lock may be held. A holder that changed meanwhile is re-judged
 * under it by its ids alone, so it counts as running for this poll where only a start time would show it gone.
 * `rejoin` means a lapsed heartbeat cost this waiter its entry.
 */
export function takeTurn(
  dir,
  entry,
  { now = Date.now(), running = isRunning } = {},
) {
  const waiting = liveQueue(dir, { now, running, prune: true });
  const position = waiting.findIndex((w) => w.file === entry.file);
  const judged = readLease(dir);
  const judgedStale = judged !== null && isStale(judged, now, running);
  return withLock(dir, () => {
    const current = readLease(dir);
    const stale = sameRecord(current, judged)
      ? judgedStale
      : current !== null && isStale(current, now, byIdAlone(running));
    const holder = current && !stale ? current : null;
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

/**
 * Records the run the holder started, by its pid and, when known, its start time, while `pid` still holds the
 * lease. A run recorded by its pid alone keeps the lease while any process holds that pid.
 */
export function recordChild(
  dir,
  pid,
  childPid,
  now = Date.now(),
  childStartedAt,
) {
  return withLock(dir, () => {
    const current = readLease(dir);
    if (current?.pid !== pid) return false;
    writeFileSync(
      current.file,
      JSON.stringify({ ...storedFields(current), childPid, childStartedAt }),
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
  const owned = current !== null && ownerRuns(current, now, running);
  const stale =
    current !== null && !owned && !recordedRunRuns(current, now, running);
  return {
    holder: stale ? null : current,
    orphaned: current !== null && !owned && !stale,
    stale: stale ? current : null,
    queue: liveQueue(dir, { now, running }),
  };
}
