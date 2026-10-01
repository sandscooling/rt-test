import type { FingerprintResult } from "../inputs/fingerprint.js";
import type { JobVerdict } from "../inputs/input-jobs.js";
import type { TrackedInputs } from "../inputs/input-tracker.js";
import { FINGERPRINT_DIGEST, NOT_FINGERPRINTED } from "../store/schema.js";
import type { StoreBindings, StoreScope } from "../store/stored-records.js";
import { NewerStoreSchemaError } from "../store/transaction.js";
import type { ConfirmedStart } from "../vitest/confirmed-start.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";
import type { DaemonLog } from "./daemon-log.js";
import type { JobOutcome } from "./executor.js";
import type { UnstoredJob } from "./protocol.js";

const JOB_THREW_REASON = "the job could not be run";
const STORE_WRITE_FAILED_REASON = "the store write failed";
export const DISCOVERY_STOPPED_REASON =
  "the stop arrived during the discovery, so it was not stored";

/** A job that threw ended with nothing, the same as one whose process died. */
export function threwOutcome<T>(error: unknown): JobOutcome<T> {
  return { ended: false, reason: `${JOB_THREW_REASON}: ${errorText(error)}` };
}

/**
 * Protects the discovery's files before its fingerprint is taken, so the stored digest counts them as every later
 * answer does. The tracker dropped the events of a file a pattern covered through the job, so the time of each one
 * the discovery names is read before protection moves it into the inputs, and protection reads the time of each one
 * only its walk finds; an input event during protection fails the fingerprint, and protection's own reads do not.
 */
export async function protectDiscovered(
  inputs: TrackedInputs,
  isStopping: () => boolean,
  discovery: TestDiscovery,
  verdict: JobVerdict,
  startedAt: number,
): Promise<JobVerdict> {
  await inputs.settled();
  if (isStopping())
    return {
      fingerprinted: false,
      reason: DISCOVERY_STOPPED_REASON,
      changedWhileRunning: false,
    };
  const unwatched = inputs
    .current()
    .protectedFileChangedSince(discovery, startedAt);
  const guard = inputs.beginJob();
  let released: string | undefined;
  try {
    released = await inputs.protectInputs(discovery, startedAt);
  } catch (error) {
    await inputs.endJob(guard);
    throw error;
  }
  const guarded = await inputs.endJob(guard);
  if (!verdict.fingerprinted) return verdict;
  const changed = unwatched ?? released;
  if (changed !== undefined) {
    return {
      fingerprinted: false,
      reason: changed,
      changedWhileRunning: true,
    };
  }
  return guarded;
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

/** The job's record is bound to `fingerprint` only when its verdict says so; one stored not fingerprinted is logged. */
export function storeBindings(
  { scope, log }: { readonly scope: StoreScope; readonly log: DaemonLog },
  job: string,
  verdict: JobVerdict,
  fingerprint: () => FingerprintResult,
): StoreBindings {
  const print: FingerprintResult = verdict.fingerprinted
    ? fingerprint()
    : { ok: false, reason: verdict.reason };
  if (print.ok) {
    return {
      ...scope,
      inputFingerprint: { kind: FINGERPRINT_DIGEST, digest: print.digest },
    };
  }
  log.entry(`${job} is stored not fingerprinted: ${print.reason}`);
  return { ...scope, inputFingerprint: { kind: NOT_FINGERPRINTED } };
}

/** Only a refusal that names its remedy reaches the reason; any other failure's detail stays in the log. */
export function storeFailureReason(error: unknown): string {
  return error instanceof NewerStoreSchemaError
    ? `${STORE_WRITE_FAILED_REASON}: ${error.message}`
    : STORE_WRITE_FAILED_REASON;
}

/** The jobs whose latest ending stored nothing; an undefined workspace path names the discovery. */
export class UnstoredJobs {
  readonly #log: DaemonLog;
  #jobs: readonly UnstoredJob[] = [];

  constructor(log: DaemonLog) {
    this.#log = log;
  }

  jobs(): readonly UnstoredJob[] {
    return this.#jobs;
  }

  /** Each job is listed once, by its latest ending, so a job retried at every periodic reconciliation cannot grow the list. */
  list(workspacePath: string | undefined, reason: string): void {
    this.unlist(workspacePath);
    this.#jobs = [
      ...this.#jobs,
      workspacePath === undefined ? { reason } : { workspacePath, reason },
    ];
    this.#log.entry(
      `${workspacePath === undefined ? "the discovery" : `the run of ${workspacePath}`} ended with nothing stored: ${reason}`,
    );
  }

  unlist(workspacePath: string | undefined): void {
    this.#jobs = this.#jobs.filter(
      (job) => job.workspacePath !== workspacePath,
    );
  }
}

export function logMissingConfirmed(
  discovery: TestDiscovery,
  confirmed: ConfirmedStart["workspaces"],
  log: DaemonLog,
): void {
  const found = new Set(
    discovery.workspaces.map((entry) => entry.workspace.path),
  );
  for (const workspace of confirmed) {
    if (!found.has(workspace.path)) {
      log.entry(
        `the confirmed workspace ${workspace.path} was not found, so nothing of it was loaded`,
      );
    }
  }
}

export function discoverySummary(discovery: TestDiscovery): string {
  return discovery.workspaces
    .map((entry) => `${entry.workspace.path} ${entry.status}`)
    .join(", ");
}
