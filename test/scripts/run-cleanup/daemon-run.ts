import { rmSync } from "node:fs";
import type { TestProject } from "vitest/node";
import setup from "../../../packages/daemon/test/temp-root.js";
import { childProcessesOf, isRunWatchdog } from "../run-cleanup.mjs";
import { endAll } from "../processes.js";

/** The run watchdogs this process started for `runRoot`. */
export const watchdogsOf = (runRoot: string): number[] =>
  childProcessesOf(process.pid)
    .filter(
      (child) =>
        isRunWatchdog(child.commandLine) && child.commandLine.includes(runRoot),
    )
    .map((child) => child.pid);

/**
 * Runs the daemon project's global setup as Vitest does, hands `body` the run's temp parent and teardown, then ends
 * the setup's watchdog, which otherwise waits for this process to end, and removes the parent however `body` ends.
 */
export async function withDaemonRunSetup<T>(
  body: (runRoot: string, teardown: () => Promise<void>) => Promise<T>,
): Promise<T> {
  let runRoot = "";
  const project = {
    provide: (_key: string, value: string) => {
      runRoot = value;
    },
  } as unknown as TestProject;
  const teardown = await setup(project);
  try {
    return await body(runRoot, teardown);
  } finally {
    endAll(watchdogsOf(runRoot));
    rmSync(runRoot, { recursive: true, force: true });
  }
}
