export declare const PROGRESS_MARKER: string;

export declare const PROGRESS_EVENT: Readonly<{
  LIMITS: "limits";
  COLLECTED: "collected";
  STARTED: "started";
  FINISHED: "finished";
  HOOK_STARTED: "hook-started";
  HOOK_FINISHED: "hook-finished";
  RUN_ENDED: "run-ended";
}>;

/**
 * Writes one `PROGRESS_MARKER` line per event. A `started` line's `timeout` is the test's timeout times its retries
 * and repeats; a `limits` line carries the global `teardownTimeout` and each project's `hookTimeout`; a `run-ended`
 * line carries Vitest's end reason, its unhandled error count and the first `QUOTED_ITEMS` of them as text.
 */
declare class ProgressReporter {
  onInit(vitest: {
    readonly config: { readonly teardownTimeout?: number };
    readonly projects: readonly {
      readonly name: string;
      readonly config: { readonly hookTimeout: number };
    }[];
  }): void;
  onTestModuleCollected(testModule: { readonly moduleId: string }): void;
  onTestCaseReady(testCase: unknown): void;
  onTestCaseResult(testCase: unknown): void;
  onHookStart(hook: { readonly name: string }): void;
  onHookEnd(hook: { readonly name: string }): void;
  onTestRunEnd(
    testModules: readonly unknown[],
    unhandledErrors: readonly unknown[],
    reason: "passed" | "interrupted" | "failed",
  ): void;
}
export default ProgressReporter;
