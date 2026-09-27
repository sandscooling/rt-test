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

/** Lists, one JSON entry per line, what a test run started, for whoever ends the run to clean up. */
export const STARTED_FILE = "started-processes";
const WATCHDOG = fileURLToPath(new URL("./run-watchdog.mjs", import.meta.url));
const LOCK_EXTENSION = ".lock";
const KEY_LEFTOVER_SUFFIXES = [".tmp", ".removing"];
const WINDOWS = "win32";
const NO_SIGNAL = 0;
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
/** What `process.kill` answers for a process that runs but is not this user's to signal. */
const NOT_PERMITTED = "EPERM";
const POWERSHELL_UNDER_SYSTEM_ROOT = [
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
];
const PROC = "/proc";
const FIELD_SEPARATOR = "\t";
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

export function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, NO_SIGNAL);
    return true;
  } catch (error) {
    return error.code === NOT_PERMITTED;
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
  return [...new Set(pids)].filter(isRunning);
}

/**
 * The command line of each Windows process `filter` selects, keyed by process id. Throws when the query cannot be
 * made, since an empty answer would read as "no such process".
 */
function windowsProcesses(filter) {
  const systemRoot = process.env.SystemRoot;
  if (systemRoot === undefined) {
    throw new Error("cannot query processes: SystemRoot is not set");
  }
  const result = spawnSync(
    join(systemRoot, ...POWERSHELL_UNDER_SYSTEM_ROOT),
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { [string]$_.ProcessId + [char]9 + $_.CommandLine }`,
    ],
    { encoding: "utf8", timeout: COMMAND_LINE_QUERY_MS, windowsHide: true },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `cannot query processes (${filter}): ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return new Map(
    result.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes(FIELD_SEPARATOR))
      .map((line) => {
        const at = line.indexOf(FIELD_SEPARATOR);
        return [Number(line.slice(0, at)), line.slice(at + 1)];
      }),
  );
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

/** Each running process's command line, and on Linux its working directory: what ties a process to a run. */
function processIdentities(pids) {
  if (process.platform === WINDOWS) {
    const filter = pids.map((pid) => `ProcessId=${pid}`).join(" OR ");
    const lines = windowsProcesses(filter);
    return new Map(pids.map((pid) => [pid, [lines.get(pid) ?? ""]]));
  }
  return new Map(
    pids.map((pid) => [
      pid,
      [linuxCommandLine(pid), linuxWorkingDirectory(pid)].filter(
        (identity) => identity !== undefined,
      ),
    ]),
  );
}

/** The field after a Linux `/proc/<pid>/stat` line's command name, which may itself hold spaces and parentheses. */
function linuxParent(pid) {
  const stat = readProc(pid, "stat");
  if (stat === undefined) return undefined;
  const [, parent] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return Number(parent);
}

/** The processes `pid` started directly, each with its command line, found while `pid` still runs. */
export function childProcessesOf(pid) {
  if (process.platform === WINDOWS) {
    return [...windowsProcesses(`ParentProcessId=${pid}`)].map(
      ([child, commandLine]) => ({ pid: child, commandLine }),
    );
  }
  return readdirSync(PROC)
    .filter((name) => DECIMAL_DIGITS.test(name))
    .map(Number)
    .filter((child) => linuxParent(child) === pid)
    .map((child) => ({
      pid: child,
      commandLine: linuxCommandLine(child) ?? "",
    }));
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

/** The recorded processes still running whose command line or working directory lies inside the run's directory. */
function ownedProcesses(runRoot, pids) {
  if (pids.length === 0) return [];
  const forms = runRootForms(runRoot);
  const fold = process.platform === WINDOWS;
  const identities = processIdentities(pids);
  return pids.filter((pid) =>
    (identities.get(pid) ?? []).some((identity) => {
      const text = fold ? identity.toLowerCase() : identity;
      return forms.some((form) => text.includes(form));
    }),
  );
}

export function endProcess(pid) {
  try {
    process.kill(pid, KILL_SIGNAL);
  } catch {
    // It exited between the check and the kill.
  }
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
 * Ends every process the run recorded that still runs inside its directory, removes the files it recorded outside
 * that directory, and removes the directory. Resolves with the processes it ended and whether the directory is gone,
 * which it is not while Windows still holds it. Throws, removing nothing, when it cannot tell which processes are
 * the run's, so a live daemon never loses its key.
 */
export async function cleanUpRun(runRoot) {
  if (!existsSync(runRoot)) return { ended: [], removed: true };
  const entries = readStarted(runRoot);
  const ended = ownedProcesses(runRoot, recordedPids(entries));
  for (const pid of ended) endProcess(pid);
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
