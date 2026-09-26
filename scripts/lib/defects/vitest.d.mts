import type { Defect } from "./catalog.mjs";

export interface AssertionResult {
  readonly title: string;
  readonly status: string;
  readonly failureMessages: readonly string[];
}

export interface VitestReport {
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly testResults: readonly {
    readonly name: string;
    readonly assertionResults: readonly AssertionResult[];
  }[];
}

export interface RunResult {
  readonly status: number | null;
  readonly report: VitestReport;
}

export interface RunRequest {
  readonly sandbox: string;
  readonly report: string;
  readonly files?: readonly string[];
  readonly pattern?: string;
}

export type RunTests = (request: RunRequest) => Promise<RunResult>;

export declare function vitestArgs(
  request: RunRequest & { readonly entry: string; readonly config: string },
): string[];

export declare function createVitestRunner(options: {
  readonly root: string;
  readonly entry?: string;
}): RunTests;

export declare function testFilesOf(defects: readonly Defect[]): string[];

export declare function baselineProblem(
  result: RunResult,
  sandbox: string,
  defects: readonly Defect[],
  files?: readonly string[],
): string | null;

export declare function detectionProblem(
  result: RunResult,
  sandbox: string,
  defect: Defect,
): string | null;
