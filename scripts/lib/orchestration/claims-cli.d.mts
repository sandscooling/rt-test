import type { PathRules } from "./paths.mjs";

export interface CliResult {
  readonly code: 0 | 1 | 2;
  readonly out: readonly string[];
  readonly err: readonly string[];
}

export declare function mainCheckoutRoot(root: string): string;
export declare function claimsDirFor(
  root: string,
  env?: Readonly<Record<string, string | undefined>>,
): string;
export declare function runClaimsCli(
  argv: readonly string[],
  ctx: {
    readonly root: string;
    readonly dir: string;
    readonly rules: PathRules;
    readonly now?: () => number;
  },
): CliResult;
