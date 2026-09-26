export interface HunkSpec {
  readonly path: string;
  readonly substring: string;
}

export interface StageOptions {
  readonly root: string;
  readonly claimsDir: string;
  readonly lane: string;
  readonly hunkSpecs?: readonly HunkSpec[];
  readonly also?: readonly string[];
  readonly dryRun?: boolean;
}

export interface StagePlan {
  readonly errors: readonly string[];
  readonly whole: readonly { readonly path: string; readonly xy: string }[];
  readonly unchanged: readonly string[];
  readonly alreadyStaged: readonly string[];
  readonly patches: readonly {
    readonly path: string;
    readonly total: number;
    readonly matches: readonly {
      readonly substring: string;
      readonly count: number;
    }[];
  }[];
}

export interface NumstatRow {
  readonly added: string;
  readonly removed: string;
  readonly path: string;
}

export declare const HUNK_SEPARATOR: string;
export declare function planLane(options: StageOptions): StagePlan;
export declare function indexNumstat(root: string): NumstatRow[];
export declare function stageLane(options: StageOptions): {
  readonly code: 0 | 1;
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly plan?: StagePlan;
};
