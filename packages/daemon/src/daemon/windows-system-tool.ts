import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SYSTEM_ROOT_VARIABLE = "SystemRoot";
const SYSTEM_DIRECTORY = "System32";
/** The longest one run of, or one answer from, a Windows system tool may take. */
export const TOOL_TIMEOUT_MS = 10_000;

/** A Windows system tool's full path under System32, since a `PATH` entry could shadow it. */
export function systemToolPath(...segments: readonly string[]): string {
  const systemRoot = process.env[SYSTEM_ROOT_VARIABLE];
  if (systemRoot === undefined) {
    throw new Error(
      `${SYSTEM_ROOT_VARIABLE} is not set, so ${segments.at(-1)} cannot be found`,
    );
  }
  return join(systemRoot, SYSTEM_DIRECTORY, ...segments);
}

/** Runs a Windows system tool and returns its stdout. Throws when the tool cannot run or exits non-zero. */
export function runSystemTool(tool: string, args: readonly string[]): string {
  const result = spawnSync(systemToolPath(tool), args, {
    encoding: "utf8",
    timeout: TOOL_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${tool} exited with ${result.status ?? result.signal}: ${`${result.stdout}${result.stderr}`.trim()}`,
    );
  }
  return result.stdout;
}
