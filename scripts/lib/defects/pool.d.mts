import type { Defect, Files } from "./catalog.mjs";
import type { RunTests } from "./vitest.mjs";

export interface PoolResult {
  readonly detected: readonly string[];
  readonly failures: readonly string[];
  readonly ok: boolean;
  readonly sandboxes: number;
  readonly undetected: readonly string[];
}

export declare function writeTree(dir: string, files: Files): void;
export declare function treeDifference(
  expected: Files,
  actual: Files,
): string | null;

export declare function verifyInSandboxes(options: {
  readonly files: Files;
  readonly baseline: readonly Defect[];
  readonly baselineFiles?: readonly string[];
  readonly selected: readonly Defect[];
  readonly jobs: number;
  readonly runTests: RunTests;
  readonly scratch: string;
  readonly log: (line: string) => void;
}): Promise<PoolResult>;
