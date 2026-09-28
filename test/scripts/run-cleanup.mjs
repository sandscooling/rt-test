import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isRunning } from "../../scripts/lib/processes.mjs";

export { isRunning };

/** Lists, one JSON entry per line, what a test run started, for whoever ends the run to clean up. */
export const STARTED_FILE = "started-processes";
const WATCHDOG = fileURLToPath(new URL("./run-watchdog.mjs", import.meta.url));
const LOCK_EXTENSION = ".lock";
const KEY_LEFTOVER_SUFFIXES = [".tmp", ".removing"];
const WINDOWS = "win32";
const KILL_SIGNAL = "SIGKILL";
/** How long one PowerShell query for process command lines may take on a loaded machine. */
const COMMAND_LINE_QUERY_MS = 30_000;
/**
 * How long a removal Windows refuses as held is retried: Windows reports an ended process exited before it releases
 * its handles. Node's own `rmSync` retries do not cover `EPERM`, so the wait is explicit.
 */
const RELEASE_WINDOW_MS = 11_000;
const RELEASE_POLL_MS = 200;
/** What Windows answers a removal of a directory that a live process holds open. */
const HELD_DIRECTORY_CODES = new Set(["EPERM", "EBUSY"]);
const NOT_FOUND = "ENOENT";
const NO_SUCH_PROCESS = "ESRCH";
const POWERSHELL_UNDER_SYSTEM_ROOT = [
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
];
const PROC = "/proc";
/** Where `/proc/<pid>/stat` holds the parent's id and the start time, counted from the field after the name. */
const STAT_PARENT_FIELD = 1;
const STAT_START_TIME_FIELD = 19;
const DECIMAL_DIGITS = /^\d+$/;

function isHeldOnWindows(error) {
  return process.platform === WINDOWS && HELD_DIRECTORY_CODES.has(error?.code);
}

/** Removes the directory, retrying while Windows reports it held; resolves false when it is still held after the window. */
export async function removeDirectory(directory) {
  const deadline = Date.now() + RELEASE_WINDOW_MS;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (!isHeldOnWindows(error)) throw error;
      if (Date.now() >= deadline) return false;
      await new Promise((wake) => setTimeout(wake, RELEASE_POLL_MS));
    }
  }
}

const PATH_FIELDS = ["pidFiles", "lockDirectories", "keyFiles", "files"];

/** The entry with every path absolute, since whoever reads it back runs in another working directory. */
function resolvedEntry(entry) {
  const resolved = { ...entry };
  for (const field of PATH_FIELDS) {
    if (entry[field] !== undefined) {
      resolved[field] = entry[field].map((path) => resolve(path));
    }
  }
  return resolved;
}

/** Adds an entry to the run's record of what it started; see `StartedEntry` for its fields. */
export function recordStarted(runRoot, entry) {
  appendFileSync(
    join(runRoot, STARTED_FILE),
    `${JSON.stringify(resolvedEntry(entry))}\n`,
  );
}

function readStarted(runRoot) {
  const file = join(runRoot, STARTED_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        // A run killed mid-write leaves its last line cut short.
        return [];
      }
    });
}

function pidsIn(file) {
  try {
    return readFileSync(file, "utf8")
      .split(/\s+/)
      .filter((text) => text !== "")
      .map(Number);
  } catch (error) {
    if (error.code === NOT_FOUND) return [];
    throw error;
  }
}

function lockFilesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(LOCK_EXTENSION))
    .map((name) => join(directory, name));
}

function recordedPids(entries) {
  const pids = entries.flatMap((entry) => [
    ...(entry.pids ?? []),
    ...(entry.pidFiles ?? []).flatMap(pidsIn),
    ...(entry.lockDirectories ?? []).flatMap(lockFilesIn).flatMap(pidsIn),
  ]);
  return [...new Set(pids)];
}

/**
 * Selects the processes `filter` names and their parents, and prints them as one JSON array in UTF-8, since a
 * command line may hold any character. The creation time is file-time ticks as text, past a JSON number's
 * precision. A process with no creation time is a system one, never a run's. A failed query exits non-zero rather
 * than printing an empty list.
 */
const windowsRecordQuery = (filter) =>
  [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
    `$found = @(Get-CimInstance Win32_Process -Filter '${filter}')`,
    "$ids = @($found | ForEach-Object { $_.ProcessId })",
    "$parents = @($found | ForEach-Object { $_.ParentProcessId } | Where-Object { $_ -gt 0 -and $ids -notcontains $_ } | Sort-Object -Unique)",
    `if ($parents.Count -gt 0) { $found += @(Get-CimInstance Win32_Process -Filter (($parents | ForEach-Object { "ProcessId=$_" }) -join ' OR ')) }`,
    "$records = @($found | Where-Object { $_.CreationDate } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; startedAt = [string]$_.CreationDate.ToFileTimeUtc(); commandLine = [string]$_.CommandLine } })",
    "ConvertTo-Json -InputObject $records -Compress",
  ].join("; ");

/** The record a query printed, or undefined for an entry missing a field. */
function windowsRecord(entry) {
  const { pid, parent, startedAt, commandLine } = entry ?? {};
  const whole = [pid, parent].every(Number.isInteger);
  if (!whole || !DECIMAL_DIGITS.test(startedAt ?? "")) return undefined;
  if (typeof commandLine !== "string") return undefined;
  return { pid, parent, startedAt: BigInt(startedAt), commandLine };
}

/**
 * The record of each Windows process `filter` selects and of each one's parent, keyed by process id. Throws when
 * the query cannot be made, since an empty answer would read as "no such process".
 */
function windowsRecords(filter) {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined) {
    throw new Error("cannot query processes: SystemRoot is not set");
  }
  const result = spawnSync(
    join(systemRoot, ...POWERSHELL_UNDER_SYSTEM_ROOT),
    ["-NoProfile", "-NonInteractive", "-Command", windowsRecordQuery(filter)],
    { encoding: "utf8", timeout: COMMAND_LINE_QUERY_MS, windowsHide: true },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `cannot query processes (${filter}): ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  let entries;
  try {
    entries = JSON.parse(result.stdout);
    if (!Array.isArray(entries)) throw new Error("the query printed no list");
  } catch (error) {
    throw new Error(`cannot read the process query (${filter}): ${error}`, {
      cause: error,
    });
  }
  const records = entries.map(windowsRecord).filter(Boolean);
  return new Map(records.map((record) => [record.pid, record]));
}

function readProc(pid, name) {
  try {
    return readFileSync(join(PROC, String(pid), name), "utf8");
  } catch {
    // The process ended, or is not this user's to read.
    return undefined;
  }
}

const linuxCommandLine = (pid) =>
  readProc(pid, "cmdline")?.replaceAll("\0", " ");

function linuxWorkingDirectory(pid) {
  try {
    return readlinkSync(join(PROC, String(pid), "cwd"));
  } catch {
    return undefined;
  }
}

/**
 * The parent and start time from a Linux `/proc/<pid>/stat` line, read after its command name, which may itself
 * hold spaces and parentheses. Undefined for a line not in that shape.
 */
function linuxStat(pid) {
  const stat = readProc(pid, "stat");
  const nameEnd = stat?.lastIndexOf(")") ?? -1;
  if (nameEnd < 0) return undefined;
  const fields = stat.slice(nameEnd + 2).split(" ");
  const parent = fields[STAT_PARENT_FIELD] ?? "";
  const startedAt = fields[STAT_START_TIME_FIELD] ?? "";
  if (![parent, startedAt].every((field) => DECIMAL_DIGITS.test(field))) {
    return undefined;
  }
  return { parent: Number(parent), startedAt: BigInt(startedAt) };
}

function linuxRecord(pid) {
  const stat = linuxStat(pid);
  if (stat === undefined) return undefined;
  const workingDirectory = linuxWorkingDirectory(pid);
  return {
    pid,
    ...stat,
    commandLine: linuxCommandLine(pid) ?? "",
    ...(workingDirectory === undefined ? {} : { workingDirectory }),
  };
}

function linuxRecords(pids) {
  const records = new Map();
  const add = (pid) => {
    const record = linuxRecord(pid);
    if (record !== undefined) records.set(pid, record);
    return record;
  };
  for (const pid of pids) {
    const record = add(pid);
    if (record !== undefined && !records.has(record.parent)) add(record.parent);
  }
  return records;
}

const linuxChildIds = (pid) =>
  readdirSync(PROC)
    .filter((name) => DECIMAL_DIGITS.test(name))
    .map(Number)
    .filter((child) => linuxStat(child)?.parent === pid);

/**
 * The record of each of `pids` still running, and of each one's parent, keyed by process id. An id alone names
 * whichever process holds it now; its start time tells that process from every other that ever held the id.
 */
export function processRecords(pids) {
  const ids = pids.filter(isProcessId);
  if (ids.length === 0) return new Map();
  if (process.platform === WINDOWS) {
    return windowsRecords(ids.map((pid) => `ProcessId=${pid}`).join(" OR "));
  }
  return linuxRecords(ids);
}

/** A non-positive id is never a process, and anything but a whole number would break the query. */
const isProcessId = (pid) => Number.isInteger(pid) && pid > 0;

function recordsNamingParent(pid) {
  if (!isProcessId(pid)) return new Map();
  if (process.platform === WINDOWS) {
    return windowsRecords(`ProcessId=${pid} OR ParentProcessId=${pid}`);
  }
  return linuxRecords([pid, ...linuxChildIds(pid)]);
}

/** Whether `parent` started the process `record` describes: a later holder of the parent's id cannot have. */
const isStartedBy = (record, parent) =>
  record.parent === parent.pid && record.startedAt >= parent.startedAt;

/** The processes `pid` started directly that still run, each as its record; none once `pid` has exited. */
export function childProcessesOf(pid) {
  const records = recordsNamingParent(pid);
  const parent = records.get(pid);
  if (parent === undefined) return [];
  return [...records.values()].filter((record) => isStartedBy(record, parent));
}

/**
 * Whether any process still names `pid` as its parent. On Windows that outlives the parent, so it proves no
 * parenthood; it only says whether processes that one started may still run.
 */
export function namedAsParent(pid) {
  return [...recordsNamingParent(pid).values()].some(
    (record) => record.parent === pid,
  );
}

/** Whether a command line is a run watchdog's, which must outlive the process it guards to clean up after it. */
export const isRunWatchdog = (commandLine) =>
  commandLine.includes(basename(WATCHDOG));

function runRootForms(runRoot) {
  const forms = [runRoot];
  try {
    forms.push(realpathSync.native(runRoot));
  } catch {
    // Only the recorded form is left to match once the directory is gone.
  }
  const fold = process.platform === WINDOWS;
  return forms.map((form) => (fold ? form.toLowerCase() : form));
}

/** Whether a process's command line, or on Linux its working directory, lies inside one of `roots`. */
function liesInside(roots) {
  const forms = roots.flatMap(runRootForms);
  const fold = process.platform === WINDOWS;
  return (record) =>
    [record.commandLine, record.workingDirectory ?? ""].some((identity) => {
      const text = fold ? identity.toLowerCase() : identity;
      return forms.some((form) => text.includes(form));
    });
}

/**
 * The records of `pids` whose process lies inside one of `roots`, or was started by a process that does, as a
 * daemon starts the executors whose command lines name only the daemon's own files.
 */
function ownedRecords(roots, pids, records) {
  const inside = liesInside(roots);
  return pids.flatMap((pid) => {
    const record = records.get(pid);
    if (record === undefined) return [];
    const parent = records.get(record.parent);
    const owned =
      inside(record) ||
      (parent !== undefined && isStartedBy(record, parent) && inside(parent));
    return owned ? [record] : [];
  });
}

/**
 * The records whose process id still names the process each was taken of: the same id and start time. The parent
 * is left out, since Linux gives an orphan a new one.
 */
export function stillRunning(records) {
  const running = records.filter(({ pid }) => isRunning(pid));
  if (running.length === 0) return [];
  const current = processRecords(running.map(({ pid }) => pid));
  return running.filter(
    ({ pid, startedAt }) => current.get(pid)?.startedAt === startedAt,
  );
}

/**
 * Kills the process of each record read from the OS just now, and returns the records it killed. Only a
 * check-then-kill window of milliseconds remains, since Node can hold no handle to a process it did not start.
 * Throws, once it has tried every record, when the OS refused a kill.
 */
function endFreshlyRead(records) {
  const ended = [];
  let refused;
  for (const record of records) {
    const { pid } = record;
    try {
      process.kill(pid, KILL_SIGNAL);
      ended.push(record);
    } catch (error) {
      // No such process: it exited between the check and the kill.
      if (error.code !== NO_SUCH_PROCESS) refused ??= error;
    }
  }
  if (refused !== undefined) throw refused;
  return ended;
}

/**
 * Ends each process its record was taken of, re-reading its start time just before the kill, so an id a later
 * process now holds is spared. Returns the records it ended.
 */
export function endRecorded(records) {
  return endFreshlyRead(stillRunning(records));
}

/**
 * Ends each of `pids` still running whose process lies inside one of `roots`, or was started by one that does,
 * reading each one's identity just before the kill, and returns the records it ended. A recorded id some
 * unrelated process now holds is spared.
 */
export function endOwnedProcesses(roots, pids) {
  const running = [...new Set(pids)].filter(isRunning);
  if (running.length === 0) return [];
  return endFreshlyRead(ownedRecords(roots, running, processRecords(running)));
}

/** Removes a daemon's key file with the `.tmp` and `.removing` copies a killed writer leaves beside it. */
export function removeKeyFile(keyFile) {
  const directory = dirname(keyFile);
  if (!existsSync(directory)) return;
  const key = basename(keyFile);
  for (const entry of readdirSync(directory)) {
    const leftover =
      entry.startsWith(`${key}.`) &&
      KEY_LEFTOVER_SUFFIXES.some((suffix) => entry.endsWith(suffix));
    if (entry === key || leftover) {
      rmSync(join(directory, entry), { force: true });
    }
  }
}

function removeRecordedFiles(entries) {
  for (const entry of entries) {
    for (const keyFile of entry.keyFiles ?? []) removeKeyFile(keyFile);
    for (const file of entry.files ?? []) rmSync(file, { force: true });
  }
}

/**
 * Ends every process the run recorded that still runs inside its directory or was started by one that does,
 * removes the files it recorded outside that directory, and removes the directory. Resolves with the processes it
 * ended and whether the directory is gone, which it is not while Windows still holds it. Throws, removing nothing,
 * when it cannot tell which processes are the run's or cannot end one, so a live daemon never loses its key.
 */
export async function cleanUpRun(runRoot) {
  if (!existsSync(runRoot)) return { ended: [], removed: true };
  const entries = readStarted(runRoot);
  const ended = endOwnedProcesses([runRoot], recordedPids(entries)).map(
    ({ pid }) => pid,
  );
  removeRecordedFiles(entries);
  return { ended, removed: await removeDirectory(runRoot) };
}

/**
 * Cleans up each run under the temp directory named `<prefix><pid>-` whose process has ended, since a killed run
 * never cleans up after itself. Resolves with a line for each run it could not clean up, which a later sweep retries.
 */
export async function sweepEndedRuns(prefix) {
  const problems = [];
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(prefix)) continue;
    const owner = Number.parseInt(name.slice(prefix.length), 10);
    if (!Number.isInteger(owner) || isRunning(owner)) continue;
    const run = join(tmpdir(), name);
    try {
      const { removed } = await cleanUpRun(run);
      if (!removed) problems.push(`${run}: a process still holds it`);
    } catch (error) {
      problems.push(`${run}: ${error.message}`);
    }
  }
  return problems;
}

/**
 * Starts a detached watchdog tied to this process by a pipe, and resolves once it is listening. When this process
 * ends, however it ends, the pipe closes and the watchdog cleans up whatever the run left under `runRoot`, then
 * exits. A run that removed its own directory leaves it nothing to do.
 */
export async function guardRun(runRoot) {
  const watchdog = spawn(process.execPath, [WATCHDOG, runRoot], {
    detached: true,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const ready = new Promise((resolveReady, rejectReady) => {
    watchdog.stdout.once("data", resolveReady);
    watchdog.once("error", rejectReady);
    watchdog.once("exit", (code) =>
      rejectReady(
        new Error(`the run watchdog exited with ${code} before it was ready`),
      ),
    );
  });
  try {
    await ready;
  } finally {
    watchdog.removeAllListeners("exit");
    watchdog.stdout.destroy();
  }
  watchdog.on("error", () => undefined);
  watchdog.stdin.on("error", () => undefined);
  watchdog.stdin.unref();
  watchdog.unref();
}
