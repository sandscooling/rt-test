import type { JobWindow } from "../inputs/input-jobs.js";
import type { InputDigests } from "../inputs/input-inventory.js";
import { changedPaths } from "./round-selection.js";

/**
 * How many changed paths one job's window, one interval between jobs, or one subject since its last run began may
 * hold before it counts as an edit to every input, since placing each of them per workspace per round is unbounded.
 */
export const MAX_COUNTED_CHANGES = 1_000;

/** A job, and the subject whose changes start afresh with it: a run by its workspace path, or the discovery. */
export type Job = string | undefined;

/** By changed path, each job that changed it. */
export type JobsByPath = ReadonlyMap<string, ReadonlySet<Job>>;

/** What changed since one subject's last job began, not yet placed in its inputs. */
export interface SubjectChanges {
  /** Each path a run or discovery changed while it ran. */
  readonly byJobs: JobsByPath;
  /** Each path whose digest differs between the end of one job and the start of the next. */
  readonly edits: ReadonlySet<string>;
  /** Whether an edit counts as reaching every input: a cause naming no path, unreadable digests, or past the bound. */
  readonly everywhere: boolean;
}

class ChangeSets implements SubjectChanges {
  readonly byJobs = new Map<string, Set<Job>>();
  readonly edits = new Set<string>();
  everywhere = false;
  #distinct = 0;

  addJob(paths: readonly string[], job: Job): void {
    for (const path of paths) {
      const jobs = this.byJobs.get(path);
      if (jobs !== undefined) jobs.add(job);
      else if (this.#counts(path)) this.byJobs.set(path, new Set([job]));
      if (this.everywhere) return;
    }
  }

  addEdits(paths: readonly string[]): void {
    for (const path of paths) {
      if (!this.edits.has(path) && this.#counts(path)) this.edits.add(path);
      if (this.everywhere) return;
    }
  }

  editedEverywhere(): void {
    this.everywhere = true;
    this.byJobs.clear();
    this.edits.clear();
  }

  /** Whether the path may be added, counting it once however many sets hold it; false once past the bound. */
  #counts(path: string): boolean {
    if (this.everywhere) return false;
    if (this.byJobs.has(path) || this.edits.has(path)) return true;
    this.#distinct += 1;
    if (this.#distinct <= MAX_COUNTED_CHANGES) return true;
    this.editedEverywhere();
    return false;
  }
}

/**
 * Tells each change to an input apart as one a run or discovery made while it ran, or an edit between jobs, and keeps
 * both per subject since that subject's last job began. Every job must be reported in the order the jobs ran, one at
 * a time; a job that threw is never reported, so its changes reach the next interval as edits.
 */
export class ChangeRecord {
  readonly #subjects = new Map<Job, ChangeSets>();
  /** The committed digests at the end of the latest job or reading; undefined when they could not be read. */
  #last: InputDigests | undefined;

  /** What changed for `subject` since its last job began; undefined when none has begun. */
  of(subject: Job): SubjectChanges | undefined {
    return this.#subjects.get(subject);
  }

  /** The digests read while no job runs: every path that differs from the last reading is an edit. */
  observed(digests: InputDigests | undefined): void {
    this.#interval(digests);
    this.#last = digests;
  }

  /** A job that began and ended, whose own subject's changes start afresh with it. */
  jobEnded(window: JobWindow, job: Job): void {
    this.#interval(window.startDigests);
    this.begun(job);
    if (window.causes.size > 0 || window.paths.size > MAX_COUNTED_CHANGES) {
      this.#everywhere();
    } else {
      const paths = [...window.paths];
      for (const sets of this.#subjects.values()) sets.addJob(paths, job);
    }
    this.#last = window.endDigests;
  }

  /** The subject's job began, so only what changes from now on is its own. */
  begun(subject: Job): void {
    this.#subjects.set(subject, new ChangeSets());
  }

  #interval(to: InputDigests | undefined): void {
    const from = this.#last;
    if (from === undefined || to === undefined) {
      this.#everywhere();
      return;
    }
    // An unmoved revision usually hands back the same digests object, which needs no comparison.
    if (from === to) return;
    const edits = changedPaths(from, to);
    if (edits.length > MAX_COUNTED_CHANGES) {
      this.#everywhere();
      return;
    }
    for (const sets of this.#subjects.values()) sets.addEdits(edits);
  }

  #everywhere(): void {
    for (const sets of this.#subjects.values()) sets.editedEverywhere();
  }
}
