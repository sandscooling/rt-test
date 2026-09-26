import type { RuleIo } from "./expand-cli.mjs";

export declare const BASELINE_FILE: string;
export declare const USAGE: string;

export declare function runRuleHygiene(
  argv: readonly string[],
  io: RuleIo,
): number;
