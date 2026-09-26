import type { PathRules } from "./paths.mjs";

export interface Owner {
  readonly lane: string;
  readonly thread: string;
}

export interface Holder extends Owner {
  readonly at: number;
}

export interface PathRecord extends Holder {
  readonly path: string;
  readonly file: string;
}

export interface CreateResult {
  readonly ok: boolean;
  readonly refused: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
  readonly conflicts: readonly {
    readonly path: string;
    readonly holder: Holder & { readonly path: string };
  }[];
  readonly created: readonly string[];
  readonly held: readonly string[];
}

export interface RemoveResult {
  readonly removed: string[];
  readonly refused: string[];
  readonly missing: string[];
}

type Who = { readonly lane?: string; readonly any?: boolean };

export declare const CLAIMS_DIR: string;

export declare function listClaims(dir: string, lane?: string): PathRecord[];
export declare function listGrants(dir: string, lane?: string): PathRecord[];
export declare function claimPaths(
  dir: string,
  rules: PathRules,
  owner: Owner,
  repoPaths: readonly string[],
  now?: number,
): CreateResult;
export declare function grantPaths(
  dir: string,
  rules: PathRules,
  owner: Owner,
  repoPaths: readonly string[],
  now?: number,
): CreateResult;
export declare function claimFailureAdvice(result: CreateResult): string;
export declare function releasePaths(
  dir: string,
  who: Who,
  repoPaths: readonly string[],
): RemoveResult;
export declare function endGrants(
  dir: string,
  who: Who,
  repoPaths: readonly string[],
): RemoveResult;
