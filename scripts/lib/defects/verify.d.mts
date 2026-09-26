import type { Git } from "../git.mjs";
import type { RunTests } from "./vitest.mjs";

export interface Options {
  readonly changed: boolean;
  readonly jobs: number;
}

export declare function defaultJobs(cores: number): number;
export declare function parseOptions(
  argv: readonly string[],
  cores: number,
): Options;

export declare function runVerification(options: {
  readonly root: string;
  readonly argv?: readonly string[];
  readonly log?: (line: string) => void;
  readonly runTests?: RunTests;
  readonly git?: Git;
  readonly cores?: number;
}): Promise<number>;
