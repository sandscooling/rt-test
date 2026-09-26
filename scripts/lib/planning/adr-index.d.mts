import type { FlowConfig } from "../flow-config.mjs";

export declare function adrIndex(
  config: FlowConfig,
  args: readonly string[],
): { readonly code: 0 | 1; readonly out: string; readonly err: string };
