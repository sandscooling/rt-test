import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  isRunning,
  processRecords,
  stillRunning,
  type ProcessIdentity,
  type ProcessRecord,
} from "./run-cleanup.mjs";

const IDLE_SCRIPT = "setInterval(() => {}, 1000);";
const POLL_MS = 25;
/** How many exited processes `endedProcessId` tries before it gives up. */
const ENDED_ID_ATTEMPTS = 10;

/** Each idle process this process started and has not ended, by id. */
const idleProcesses = new Map<number, ChildProcess>();

/** Starts a Node process that idles until it is ended, with `args` on its command line, and returns its id. */
export function idleProcess(args: readonly string[] = []): number {
  const child = spawn(process.execPath, ["-e", IDLE_SCRIPT, ...args], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new Error("the idle process did not start");
  }
  const pid = child.pid;
  idleProcesses.set(pid, child);
  child.once("exit", () => {
    if (idleProcesses.get(pid) === child) idleProcesses.delete(pid);
  });
  return pid;
}

function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  return new Promise((resolveId, fail) => {
    child.once("error", fail);
    child.once("exit", () => resolveId(child.pid ?? 0));
  });
}

/**
 * The id of a Node process that has exited, and that Windows has not already handed to another process. Throws
 * naming each id tried when every one was taken at once.
 */
export async function endedProcessId(): Promise<number> {
  const taken: number[] = [];
  while (taken.length < ENDED_ID_ATTEMPTS) {
    const pid = await exitedProcessId();
    if (!isRunning(pid)) return pid;
    taken.push(pid);
  }
  throw new Error(
    `each exited process's id was already taken by another: ${taken.join(", ")}`,
  );
}

/**
 * Ends each of `pids` that is an idle process `idleProcess` started and still runs, through the handle it keeps,
 * so an id another process has since taken is never signalled. Any other id is left alone.
 */
export function endAll(pids: readonly number[]): void {
  for (const pid of pids) idleProcesses.get(pid)?.kill("SIGKILL");
}

/** Polls until `ready` holds or `boundMs` passes, and says whether it held. */
export async function holdsWithin(
  ready: () => boolean,
  boundMs: number,
): Promise<boolean> {
  const deadline = Date.now() + boundMs;
  while (!ready()) {
    if (Date.now() >= deadline) return false;
    await delay(POLL_MS);
  }
  return true;
}

/** The record of the process holding `pid` now, which the caller knows to be the one it means; throws when none does. */
export function recordOf(pid: number): ProcessRecord {
  const record = processRecords([pid]).get(pid);
  if (record === undefined) {
    throw new Error(`no process holds id ${pid}, so it has no record`);
  }
  return record;
}

/** Longer than a Linux clock tick (10 ms), so two processes started this far apart never share a start time. */
const START_TIME_GAP_MS = 100;

/**
 * The id of the live process `held` with the start time of a process that started after it, which is what a process
 * that took `held`'s id after `held` ended would carry.
 */
export async function reusedIdentity(held: number): Promise<ProcessIdentity> {
  await delay(START_TIME_GAP_MS);
  const later = idleProcess();
  try {
    return { pid: held, startedAt: recordOf(later).startedAt };
  } finally {
    endAll([later]);
  }
}

/**
 * Whether each recorded process has ended within `boundMs`, a later holder of its id not counting as it. An ended
 * child must be reaped, which needs the event loop to turn.
 */
export const endsWithin = (
  records: readonly ProcessIdentity[],
  boundMs: number,
): Promise<boolean> =>
  holdsWithin(() => stillRunning(records).length === 0, boundMs);
