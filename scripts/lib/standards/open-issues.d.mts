import type { Result } from "./result.mjs";

export type ProcessRunner = (file: string, args: readonly string[]) => string;

export declare function listOpenIssues(
  argv: readonly string[],
  run?: ProcessRunner,
): Result;
