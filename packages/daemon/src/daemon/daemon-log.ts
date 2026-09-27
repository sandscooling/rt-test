import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { errorText } from "../vitest/error-text.js";
import { identityHash } from "./endpoint.js";

const LOG_PREFIX = "daemon-";
const LOG_EXTENSION = ".log";

/** One file per worktree, since the worktrees of one project may share a state directory. */
export function daemonLogFile(
  stateDirectory: string,
  worktreeIdentity: string,
): string {
  return join(
    stateDirectory,
    `${LOG_PREFIX}${identityHash(worktreeIdentity)}${LOG_EXTENSION}`,
  );
}

/** Appends timestamped entries to the worktree's log, which also receives the daemon's own stdout and stderr. */
export class DaemonLog {
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  entry(message: string): void {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      appendFileSync(this.file, line);
    } catch (error) {
      process.stderr.write(
        `cannot append to ${this.file}: ${errorText(error)}\n${line}`,
      );
    }
  }

  error(context: string, error: unknown): void {
    this.entry(`error: ${context}: ${errorText(error)}`);
  }
}
