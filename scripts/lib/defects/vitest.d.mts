import type { Defect } from "./catalog.mjs";
import type { ExitRecord, RunEnd } from "./run-evidence.mjs";

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
    /** The file's first error, such as a failed import; empty when it had none. */
    readonly message?: string;
    readonly assertionResults: readonly AssertionResult[];
  }[];
}

export interface RunResult {
  readonly status: number | null;
  readonly report: VitestReport;
  /** The run's whole stderr, unbounded. */
  readonly stderr: string;
  /** The last non-blank stdout lines that were not progress, cut to a bounded length. */
  readonly stdoutTail: string;
  /** How Vitest said the run ended, with its unhandled errors; null when it never said. */
  readonly runEnd: RunEnd | null;
  /** How the Vitest main process ended, as its exit witness recorded it. */
  readonly exitRecord: ExitRecord;
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

export declare const IDLE_WINDOW_MS: number;
export declare const EXIT_RECORD_SUFFIX: string;

export declare function createVitestRunner(options: {
  readonly root: string;
  readonly entry?: string;
  /** How long a run may go without progress before it is stopped; `IDLE_WINDOW_MS` unless given. */
  readonly idleWindowMs?: number;
}): RunTests;

export declare function testFilesOf(defects: readonly Defect[]): string[];

export declare function baselineProblem(
  run: RunResult,
  sandbox: string,
  defects: readonly Defect[],
  files?: readonly string[],
): string | null;

export declare function detectionProblem(
  run: RunResult,
  sandbox: string,
  defect: Defect,
): string | null;
