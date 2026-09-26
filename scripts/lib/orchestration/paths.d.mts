import type { FlowConfig } from "../flow-config.mjs";

export declare const PATH_CLASS: {
  readonly ORCHESTRATOR_ONLY: "orchestrator-only";
  readonly CLAIMABLE: "claimable";
};

export type PathClass = (typeof PATH_CLASS)[keyof typeof PATH_CLASS];

export interface PathRules {
  readonly owned: readonly string[];
}

export declare function comparable(repoPath: string): string;
export declare function toRepoPath(root: string, input: string): string | null;
export declare function covers(outer: string, inner: string): boolean;
export declare function pathRules(config?: FlowConfig): PathRules;
export declare function classifyPath(
  rules: PathRules,
  repoPath: string,
): PathClass;
