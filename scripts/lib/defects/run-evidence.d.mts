import type { RunResult, VitestReport } from "./vitest.mjs";

export declare const EXIT_RECORD_ENV: string;

export declare const EXIT_ENTRY: Readonly<{
  STARTED: "started";
  UNCAUGHT: "uncaught";
  REJECTION: "rejection";
  EXIT_CALLED: "exit-called";
  EXITED: "exited";
}>;

export declare const QUOTED_ITEMS: number;

/** Ends a text cut to a bounded length. */
export declare const CUT_MARKER: string;

/** The error code of a file that does not exist. */
export declare const NOT_FOUND: string;

/** How Vitest ended the run, from the progress reporter's `run-ended` line. */
export interface RunEnd {
  readonly reason: "passed" | "interrupted" | "failed";
  /** Every unhandled error Vitest collected, including those not quoted. */
  readonly errorCount: number;
  /** The first `QUOTED_ITEMS` unhandled errors, as `errorText` wrote them. */
  readonly errors: readonly string[];
}

export interface ExitEntry {
  readonly kind: (typeof EXIT_ENTRY)[keyof typeof EXIT_ENTRY];
  readonly [field: string]: unknown;
}

/** The exit witness's record of how the Vitest main process ended. */
export interface ExitRecord {
  readonly entries: readonly ExitEntry[];
  /** Lines that were not JSON, as a kill mid-append leaves. */
  readonly unreadable: number;
  /** Why no record could be read, or null. */
  readonly problem: string | null;
}

export declare function errorText(error: unknown): string;

export declare function runEndText(runEnd: RunEnd | null): string;

export declare function readExitRecord(path: string): ExitRecord;

export declare function exitRecordText(record: ExitRecord): string;

/**
 * Why a run did not end cleanly (no run end, unhandled errors Vitest reported, an uncaught exception or unhandled
 * rejection its process recorded, a recorded process.exit call, or no recorded exit), or null.
 */
export declare function uncleanEndProblem(
  run: Pick<RunResult, "runEnd" | "exitRecord">,
): string | null;

export declare function reportEvidence(
  report: VitestReport,
  sandbox: string,
): string[];
