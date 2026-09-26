import type { FlowConfig } from "../flow-config.mjs";
import type { Git } from "../git.mjs";
import type { Result } from "../standards/result.mjs";

export declare const USAGE: string;

export declare function listUnbuiltWork(
  config: FlowConfig,
  argv: readonly string[],
  git?: Git,
): Result;
