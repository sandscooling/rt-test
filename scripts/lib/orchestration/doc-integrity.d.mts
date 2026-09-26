import type { FlowConfig } from "../flow-config.mjs";

export interface Gate {
  readonly script: string;
  /** Flow-config keys, or literal repo paths where a trailing slash marks a folder. */
  readonly watches: readonly string[];
}

export interface HookInput {
  readonly stop_hook_active?: boolean;
  readonly transcript_path?: string;
}

export declare const GATES: readonly Gate[];
export declare const GIT_TIMEOUT_MS: number;
export declare const GATE_TIMEOUT_MS: number;
export declare function watchedPaths(
  config: FlowConfig,
  gates?: readonly Gate[],
): { readonly key: string; readonly path: string; readonly dir: boolean }[];
export declare function selectGates(
  config: FlowConfig,
  paths: readonly string[],
  gates?: readonly Gate[],
): Gate[];
export declare function parsePorcelain(text: string): string[];
export declare function namedByToolCalls(
  transcriptTexts: readonly string[],
): string[] | null;
export declare function scopeToSession(
  paths: readonly string[],
  named: readonly string[] | null,
): string[];
export declare function readTranscripts(transcriptPath: unknown): string[];
export declare function runGateScript(
  root: string,
  script: string,
): string | null;
export declare function docIntegrity(
  config: FlowConfig,
  input: HookInput,
  options?: {
    readonly gates?: readonly Gate[];
    readonly runGate?: (root: string, script: string) => string | null;
  },
): { readonly code: 0 | 2; readonly err: string };
