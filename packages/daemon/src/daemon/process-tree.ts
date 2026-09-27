import type { ChildProcess } from "node:child_process";
import { errorText } from "../vitest/error-text.js";
import { WINDOWS } from "./endpoint.js";
import { isRunning } from "./runtime-directory.js";
import { WindowsJobs } from "./windows-job.js";
import { runSystemTool } from "./windows-system-tool.js";

const KILL_SIGNAL = "SIGKILL";
const TASKKILL = "taskkill.exe";

/** A child process's tree, held so that ending it reaches every process the tree started without detaching. */
export interface ContainedTree {
  end(): Promise<void>;
}

/** Holds each executor's tree from before it starts its job until the tree is ended. */
export interface TreeContainment {
  contain(child: ChildProcess): Promise<ContainedTree>;
  /** Releases what holds the trees, ending any tree still held. */
  close(): Promise<void>;
}

/**
 * On Linux an executor's process group holds its tree. On Windows a job object that allows no breakaway does, since a
 * process started through `cmd.exe` or any other program joins no job of Node's, and the parent walk cannot reach it
 * once a process between it and the executor, such as a Vitest worker, has ended.
 */
export function treeContainment(): TreeContainment {
  if (process.platform !== WINDOWS) {
    return {
      contain: (child) =>
        Promise.resolve({
          end: () => Promise.resolve(endGroupOf(child)),
        }),
      close: () => Promise.resolve(),
    };
  }
  const jobs = new WindowsJobs();
  return {
    contain: async (child) => {
      const tree = await jobs.contain(child.pid ?? Number.NaN);
      return { end: () => endJobTree(tree, child) };
    },
    close: () => jobs.close(),
  };
}

/** A group that cannot be signalled is reported, as a job the helper cannot end is, rather than thrown into the daemon. */
function endGroupOf(child: ChildProcess): void {
  try {
    endProcessTree(child);
  } catch (error) {
    process.emitWarning(
      `cannot end the process group of executor process ${child.pid}: ${errorText(error)}`,
    );
  }
}

/** A job the helper cannot end is ended by the parent walk instead. */
async function endJobTree(
  tree: ContainedTree,
  child: ChildProcess,
): Promise<void> {
  try {
    await tree.end();
  } catch (error) {
    process.emitWarning(
      `cannot end the job object of executor process ${child.pid}: ${errorText(error)}`,
    );
    endProcessTree(child);
  }
}

/**
 * Whether a child must start its own process group. On Linux that group is how its whole tree is ended. On Windows
 * a detached child would leave the job object that ends its Node children with it, so it stays attached.
 */
export function ownsProcessGroup(): boolean {
  return process.platform !== WINDOWS;
}

/**
 * Ends `child` and every process it started that did not detach itself. On Linux that is the child's process group,
 * which outlives the child while any member runs. On Windows the tree is walked by parent while its root still runs,
 * since only Node's own children join its job object: a process started through `cmd.exe` or another program does
 * not, and would outlive the job.
 */
export function endProcessTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform !== WINDOWS) {
    endGroup(child.pid);
    return;
  }
  if (hasExited(child)) return;
  endWindowsTree(child.pid);
  if (!hasExited(child)) child.kill(KILL_SIGNAL);
}

/** Ends this process with every process it started that did not detach itself. */
export function endOwnTree(): never {
  if (process.platform === WINDOWS) endWindowsTree(process.pid);
  else endGroup(process.pid);
  process.exit();
}

function endGroup(leader: number): void {
  try {
    process.kill(-leader, KILL_SIGNAL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

/**
 * Ends the process and its descendants; the caller still ends the root itself if it survives. A descendant that exits
 * while the tree is ended, as a job object's members do once their parent is gone, makes the tool report a failure,
 * so only a root that still runs is worth a warning.
 */
function endWindowsTree(root: number): void {
  try {
    runSystemTool(TASKKILL, ["/PID", String(root), "/T", "/F"]);
  } catch (error) {
    if (isRunning(root)) {
      process.emitWarning(
        `cannot end the process tree of ${root}: ${errorText(error)}`,
      );
    }
  }
}

export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
