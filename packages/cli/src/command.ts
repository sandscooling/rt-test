import { resolve } from "node:path";
import type { ExitCode } from "./output.js";

/** Everything a command reads from and writes to its process, so a caller can drive `main` in process. */
export interface CliIo {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
  readonly stdinIsTerminal: boolean;
  readonly stderrIsTerminal: boolean;
  /** Absolute; every path argument resolves against it. */
  readonly cwd: string;
  /** Ends the process at once, whatever work is pending; absent when a caller drives `main` in process. */
  readonly exit?: (code: ExitCode) => void;
}

export type CommandRun = (io: CliIo) => Promise<ExitCode>;

export interface Command {
  readonly name: string;
  readonly usage: string;
  /** Throws a usage error when the arguments do not fit, before anything runs. */
  readonly parse: (args: string[]) => CommandRun;
}

/** Every command takes it. */
export const JSON_OPTION = { json: { type: "boolean" } } as const;

const PARSE_ARGS_ERROR_PREFIX = "ERR_PARSE_ARGS_";
const MAX_ROOT_POSITIONALS = 1;

export class UsageError extends Error {}

/** `parseArgs` signals a usage error by a coded error, and a command signals its own by `UsageError`. */
export function isUsageError(error: unknown): error is Error {
  if (error instanceof UsageError) return true;
  const code: unknown =
    error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && code.startsWith(PARSE_ARGS_ERROR_PREFIX);
}

/** Absolute, against the command's current directory, never the process's; no argument is the current directory. */
export function absolutePath(io: CliIo, path: string | undefined): string {
  return path === undefined ? io.cwd : resolve(io.cwd, path);
}

/** The one optional `root` positional. */
export function optionalRoot(positionals: string[]): string | undefined {
  if (positionals.length > MAX_ROOT_POSITIONALS) {
    throw new UsageError(
      `Unexpected argument: ${positionals.slice(MAX_ROOT_POSITIONALS).join(" ")}`,
    );
  }
  return nonEmptyPath(positionals[0], "root");
}

/** One or more file positionals, none empty. */
export function requiredFiles(positionals: string[]): string[] {
  if (positionals.length === 0) throw new UsageError("Missing file.");
  for (const file of positionals) nonEmptyPath(file, "file");
  return positionals;
}

/** An empty path would resolve to the current directory, so an unset shell variable would silently pick it. */
export function nonEmptyPath(
  path: string | undefined,
  name: string,
): string | undefined {
  if (path === "") throw new UsageError(`The ${name} path is empty.`);
  return path;
}
