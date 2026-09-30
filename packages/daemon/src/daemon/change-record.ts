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
  /** Each path whose digest differs between the end of one job and the start of the next, or that a caller edited. */
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

  /** Moves each of `paths` a job changed to the edits. */
  moveToEdits(paths: readonly string[]): void {
    for (const path of paths) {
      if (this.byJobs.delete(path)) this.edits.add(path);
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

/** A caller's report of the input keys it edited, open until the caller's own named read of them has resolved. */
export interface EditReport {
  /** The caller's named read of the keys has resolved, so a job beginning from now holds none of them. */
  read(): void;
}

/**
 * Tells each change to an input apart as one a run or discovery made while it ran, or an edit: a change between jobs,
 * or one to a key a caller reports it edited. Keeps both per subject since that subject's last job began. Every job's
 * begin, and every way it ends, must be told in the order the jobs ran, one at a time; a job that threw never hands
 * over its window, so its changes reach the next interval as edits.
 */
export class ChangeRecord {
  readonly #subjects = new Map<Job, ChangeSets>();
  /** The committed digests at the end of the latest job or reading; undefined when they could not be read. */
  #last: InputDigests | undefined;
  /** By subject whose job runs, the keys a caller reported while it ran, or before it began while their read was open. */
  readonly #running = new Map<Job, Set<string>>();
  /** The keys of each report whose caller has not yet read them. */
  readonly #unread = new Set<readonly string[]>();

  /** What changed for `subject` since its last job began; undefined when none has begun. */
  of(subject: Job): SubjectChanges | undefined {
    return this.#subjects.get(subject);
  }

  /** The subject's job began, so it holds the keys of every report still open until it ends or is abandoned. */
  jobBegan(subject: Job): void {
    this.#running.set(subject, new Set([...this.#unread].flat()));
  }

  /** The subject's job never began, or was refused, so it holds no report and its changes carry on. */
  jobNotBegun(subject: Job): void {
    this.#running.delete(subject);
  }

  /** The subject's job began and threw, so it holds no report and only what changes from now on is its own. */
  jobThrew(subject: Job): void {
    this.#running.delete(subject);
    this.#begun(subject);
  }

  /**
   * Counts every change to `keys` as an edit, never a job's: one a job already recorded moves to every subject's edits
   * now, and one a job records while it holds the keys becomes an edit when that job ends.
   */
  reportEdits(keys: readonly string[]): EditReport {
    for (const sets of this.#subjects.values()) sets.moveToEdits(keys);
    for (const held of this.#running.values()) {
      for (const key of keys) held.add(key);
    }
    const report = [...keys];
    this.#unread.add(report);
    return { read: () => this.#unread.delete(report) };
  }

  /** The digests read while no job runs: every path that differs from the last reading is an edit. */
  observed(digests: InputDigests | undefined): void {
    this.#interval(digests);
    this.#last = digests;
  }

  /**
   * A job that began and ended, whose own subject's changes start afresh with it. Each path it changed that a caller
   * reported edited while the job held the report is an edit.
   */
  jobEnded(window: JobWindow, job: Job): void {
    const reported = this.#running.get(job);
    this.#running.delete(job);
    this.#interval(window.startDigests);
    this.#begun(job);
    if (window.causes.size > 0 || window.paths.size > MAX_COUNTED_CHANGES) {
      this.#everywhere();
    } else {
      const paths = [...window.paths];
      const edits = paths.filter((path) => reported?.has(path) === true);
      const caused = paths.filter((path) => reported?.has(path) !== true);
      for (const sets of this.#subjects.values()) {
        sets.addJob(caused, job);
        sets.addEdits(edits);
      }
    }
    this.#last = window.endDigests;
  }

  /** Only what changes from now on is the subject's own. */
  #begun(subject: Job): void {
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
