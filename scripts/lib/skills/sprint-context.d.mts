import type { FlowConfig } from "../flow-config.mjs";

export declare const USAGE: string;
export declare const THIN_IDS: number;
export declare const WIDE_SHARE: number;

export declare function checklistStamp(ids: Iterable<string>): {
  readonly count: number;
  readonly sha: string;
};

export declare function parseBundle(text: string): {
  readonly lists: Readonly<Record<string, readonly string[]>>;
  readonly scalars: Readonly<Record<string, string>>;
  readonly problems: readonly string[];
};

export declare function sprintContext(
  config: FlowConfig,
  argv: readonly string[],
): { readonly code: 0 | 1; readonly out: string; readonly err: string };
