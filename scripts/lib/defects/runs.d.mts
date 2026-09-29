import type { RunOwner } from "../../../test/scripts/run-cleanup.mjs";

export declare function openRun(
  parent: string,
  log: (line: string) => void,
  running?: (owner: RunOwner) => boolean,
): string;
