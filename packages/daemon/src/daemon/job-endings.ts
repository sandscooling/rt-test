import { NewerStoreSchemaError } from "../store/transaction.js";
import { errorText } from "../vitest/error-text.js";
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";
import type { JobOutcome } from "./executor.js";

const JOB_THREW_REASON = "the job could not be run";
const STORE_WRITE_FAILED_REASON = "the store write failed";

/** A job that threw ended with nothing, the same as one whose process died. */
export function threwOutcome<T>(error: unknown): JobOutcome<T> {
  return { ended: false, reason: `${JOB_THREW_REASON}: ${errorText(error)}` };
}

/** A run its abort ended: interrupted before or after it loaded, or with nothing, as an exit after an abort ends it. */
export function interruptedRun(
  outcome: JobOutcome<WorkspaceRun | NotConfirmedRun>,
): boolean {
  if (!outcome.ended) return true;
  const run = outcome.value;
  return (
    run.status === "interrupted-before-load" ||
    (run.status === "ran" && run.execution === "interrupted")
  );
}

/** The run a job left to store, or why it left none. */
export function runToStore(
  outcome: JobOutcome<WorkspaceRun | NotConfirmedRun>,
): { readonly run: WorkspaceRun } | { readonly unstored: string } {
  if (!outcome.ended) return { unstored: outcome.reason };
  const run = outcome.value;
  return run.status === "not-confirmed" ? { unstored: run.reason } : { run };
}

/** Only a refusal that names its remedy reaches the reason; any other failure's detail stays in the log. */
export function storeFailureReason(error: unknown): string {
  return error instanceof NewerStoreSchemaError
    ? `${STORE_WRITE_FAILED_REASON}: ${error.message}`
    : STORE_WRITE_FAILED_REASON;
}
