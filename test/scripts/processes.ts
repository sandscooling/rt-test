import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { isRunning } from "./run-cleanup.mjs";

const IDLE_SCRIPT = "setInterval(() => {}, 1000);";
const POLL_MS = 25;

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

/** The id of a Node process that has exited, and that Windows has not already handed to another process. */
export async function endedProcessId(): Promise<number> {
  for (;;) {
    const pid = await exitedProcessId();
    if (!isRunning(pid)) return pid;
  }
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

/** Whether the process ends within `boundMs`; an ended child must be reaped, which needs the event loop to turn. */
export const endsWithin = (pid: number, boundMs: number): Promise<boolean> =>
  holdsWithin(() => !isRunning(pid), boundMs);
