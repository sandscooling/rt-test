import type { FalsificationJob } from "../../src/falsify/experiment-record.js";
import type { VitestInstall } from "../harness.js";

export type RanJob = Extract<FalsificationJob, { status: "ran" }>;

/** How a reading of something the job did not record is spelled, so an assertion shows it rather than `undefined`. */
export const MISSING = "missing";

export function ranJob(job: FalsificationJob): RanJob | undefined {
  return job.status === "ran" ? job : undefined;
}

/** What `read` finds in what `on` gives on Vitest 5, then on Vitest 4.1. */
export async function onEachLine<T>(
  on: (install: VitestInstall) => Promise<T>,
  read: (value: T) => unknown,
): Promise<unknown[]> {
  return [read(await on("vitest")), read(await on("vitest-4"))];
}

/** An experiment's judgement as its verdict, reason and detail, without the facts it rests on. */
export function judgementOf(job: FalsificationJob, defectId: string): unknown {
  const found = ranJob(job)?.judgements.find(
    (judgement) => judgement.defectId === defectId,
  );
  if (found === undefined) return MISSING;
  const { defectId: _defectId, facts: _facts, ...judgement } = found;
  return judgement;
}

/** The kinds of the intended test's errors in the experiment's first run, an assertion as the marker that made it one. */
export function errorMarkersOf(
  job: FalsificationJob,
  defectId: string,
): unknown {
  const facts = ranJob(job)?.judgements.find(
    (judgement) => judgement.defectId === defectId,
  )?.facts;
  if (facts === undefined || !("run" in facts)) return MISSING;
  return (
    facts.run.test?.errors.map((error) =>
      error.kind === "assertion" ? error.marker : error.kind,
    ) ?? MISSING
  );
}
