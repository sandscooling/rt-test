import type { ChildProcess } from "node:child_process";

/** Whether Node has recorded the child's exit. */
export function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
