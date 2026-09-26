import type { FlowConfig } from "../flow-config.mjs";
import type { Result } from "../standards/result.mjs";

export interface GitRun {
  readonly ok: boolean;
  readonly out: string;
}

export type Git = (args: readonly string[]) => GitRun;

export declare const USAGE: string;

export declare function gitIn(root: string): Git;

export declare function listUnbuiltWork(
  config: FlowConfig,
  argv: readonly string[],
  git?: Git,
): Result;
