import type { FlowConfig } from "../flow-config.mjs";

export declare const SKILLS_DIR: string;
export declare const AGENTS_DIR: string;

export declare function skillWiring(
  config: FlowConfig,
  argv: readonly string[],
): { readonly code: 0 | 1; readonly out: string; readonly err: string };
