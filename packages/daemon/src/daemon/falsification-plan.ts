import {
  compareStandings,
  type DefectStanding,
} from "../defects/defect-standings.js";
import type { DefectExperiment } from "../falsify/experiment-record.js";
import { namedList } from "../inputs/input-jobs.js";
import { CURRENT } from "../query/answer.js";
import { cutReason } from "../query/summary.js";
import { FALSIFICATION_JOB, type UnstoredJob } from "./protocol.js";

/** A target until measured: how many definitions one falsification job covers. */
export const MAX_JOB_DEFINITIONS = 25;

/** Why a definition was left without a verdict when no judgement of its own says. */
const LEFT_REASON = {
  timeBound: "time-bound",
  repeatedInputChange: "repeated-input-change",
} as const;

const LEFT_LEAD = "left without a verdict, and given no further experiment";
const DEFINITIONS_WAIT =
  "until the input revision, the definition or the declared assertion error names change";
const REASON_SEPARATOR = "; ";

/** One definition a job holds, with the experiment built from its standing. */
export interface JobDefinition {
  readonly id: string;
  /** The definition digest of the standing the experiment was built from, which its evidence is bound to. */
  readonly digest: string;
  readonly state: DefectStanding["state"];
  readonly experiment: DefectExperiment;
}

/** One workspace's next job: its waiting definitions in the order they are taken, up to the bound. */
export interface PlannedJob {
  readonly workspacePath: string;
  readonly definitions: readonly JobDefinition[];
}

export type Look =
  | { readonly kind: "job"; readonly job: PlannedJob }
  | { readonly kind: "nothing-waiting" }
  | {
      readonly kind: "none-taken";
      readonly why: string;
      /** Whether no look at this input revision has said so yet. */
      readonly firstAtRevision: boolean;
    };

/** A waiting definition as a look reads it. */
interface Candidate extends JobDefinition {
  readonly standing: DefectStanding;
  readonly workspacePath: string;
}

/** What the daemon remembers of a definition's experiments, by its definition digest, for this daemon life. */
interface DefinitionMark {
  readonly id: string;
  readonly workspacePath: string;
  /** The input revision at which it is not taken again; undefined when no experiment holds it. */
  heldAt: number | undefined;
  /** Why it got no verdict at that revision; undefined when it got one. */
  reason: string | undefined;
  /** Whether the time bound or two input changes in a row ever left it without a verdict, so it is taken last. */
  takenLast: boolean;
  /** Whether the last job that held it was ended by an input change while it was the one running. */
  endedRunning: boolean;
}

/** A workspace that gets no further job at `revision`; `reason` says what happened and what ends the wait. */
interface WorkspaceMark {
  readonly revision: number;
  readonly reason: string;
}

const NOTHING_WAITING: Look = { kind: "nothing-waiting" };

/**
 * Which waiting definitions the daemon may take next, and what it remembers of the ones it took: a definition is
 * given one experiment for each input revision, a definition a job was ended on is taken last, and a workspace whose
 * job did not run or could not be stored gets no further job until the input revision changes. It reads no file and
 * starts nothing, and its marks are kept in memory only.
 */
export class FalsificationPlan {
  readonly #definitions = new Map<string, DefinitionMark>();
  readonly #workspaces = new Map<string, WorkspaceMark>();
  /** The input revision a look that took nothing was last reported at. */
  #reportedAt: number | undefined;

  /** The next job over the worktree's standings as read at `revision`, or why none is taken. */
  next(standings: readonly DefectStanding[], revision: number): Look {
    this.#forget(standings, revision);
    const waiting = standings.flatMap(candidate);
    if (waiting.length === 0) return NOTHING_WAITING;
    const takeable = waiting
      .filter((waits) => this.#mayTake(waits, revision))
      .sort(
        (left, right) =>
          Number(this.#takenLast(left)) - Number(this.#takenLast(right)) ||
          compareStandings(left.standing, right.standing),
      );
    const [first] = takeable;
    if (first === undefined) return this.#noneTaken(waiting, revision);
    return {
      kind: "job",
      job: {
        workspacePath: first.workspacePath,
        definitions: takeable
          .filter((waits) => waits.workspacePath === first.workspacePath)
          .slice(0, MAX_JOB_DEFINITIONS)
          .map(({ id, digest, state, experiment }) => ({
            id,
            digest,
            state,
            experiment,
          })),
      },
    };
  }

  /** The job's workspace gets no further job at `revision`; `reason` says what happened and what ends the wait. */
  workspaceWaits(job: PlannedJob, revision: number, reason: string): void {
    this.#workspaces.set(job.workspacePath, { revision, reason });
    this.#endStreaks(job, undefined);
  }

  /**
   * The job's reply read `ran` and nothing ended it early, so none of its definitions is taken again at `revision`.
   * `left` gives, by id, why each definition that got no verdict got none.
   */
  ranToEnd(
    job: PlannedJob,
    revision: number,
    left: ReadonlyMap<string, string>,
  ): void {
    for (const definition of job.definitions) {
      const mark = this.#mark(job, definition);
      mark.heldAt = revision;
      mark.reason = left.get(definition.id);
      mark.endedRunning = false;
    }
  }

  /** The time bound ended the job while the experiment of `runningId` ran: that definition alone waits. */
  endedByBound(job: PlannedJob, revision: number, runningId: string): void {
    this.#endStreaks(job, undefined);
    this.#leave(job, runningId, revision, LEFT_REASON.timeBound);
  }

  /**
   * An input change ended the job, which marks none of its definitions but the one that was running, `runningId`,
   * when the last job that held it ended the same way: that one waits at `revisionNow`.
   */
  endedByChange(
    job: PlannedJob,
    revisionNow: number,
    runningId: string | undefined,
  ): void {
    const running = job.definitions.find(({ id }) => id === runningId);
    const again =
      running !== undefined &&
      this.#definitions.get(running.digest)?.endedRunning === true;
    this.#endStreaks(job, running);
    if (running === undefined) return;
    this.#mark(job, running).endedRunning = true;
    if (again) {
      this.#leave(
        job,
        running.id,
        revisionNow,
        LEFT_REASON.repeatedInputChange,
      );
    }
  }

  /**
   * One entry for each workspace that gets no further job at `revision`, or holds a definition left without a
   * verdict that is given no further experiment there. Each reason says what ends its waits before it names a
   * definition, so a reader that cuts it for length loses only names.
   */
  entries(revision: number): UnstoredJob[] {
    const left = new Map<string, DefinitionMark[]>();
    for (const mark of this.#definitions.values()) {
      if (mark.heldAt !== revision || mark.reason === undefined) continue;
      const marks = left.get(mark.workspacePath);
      if (marks === undefined) left.set(mark.workspacePath, [mark]);
      else marks.push(mark);
    }
    const waiting = [...this.#workspaces]
      .filter(([, mark]) => mark.revision === revision)
      .map(([workspacePath]) => workspacePath);
    return [...new Set([...waiting, ...left.keys()])]
      .sort()
      .map((workspacePath) => ({
        workspacePath,
        kind: FALSIFICATION_JOB,
        reason: [
          ...workspaceReason(this.#workspaces.get(workspacePath), revision),
          ...leftReason(left.get(workspacePath) ?? []),
        ].join(REASON_SEPARATOR),
      }));
  }

  /** A definition whose digest no standing holds has changed or gone, so it has had no experiment. */
  #forget(standings: readonly DefectStanding[], revision: number): void {
    const digests = new Set(
      standings.map((standing) => standing.definitionDigest),
    );
    for (const digest of this.#definitions.keys()) {
      if (!digests.has(digest)) this.#definitions.delete(digest);
    }
    for (const [workspacePath, mark] of this.#workspaces) {
      if (mark.revision !== revision) this.#workspaces.delete(workspacePath);
    }
  }

  #mayTake(waits: Candidate, revision: number): boolean {
    return (
      this.#workspaces.get(waits.workspacePath)?.revision !== revision &&
      this.#definitions.get(waits.digest)?.heldAt !== revision
    );
  }

  #takenLast(waits: Candidate): boolean {
    return this.#definitions.get(waits.digest)?.takenLast === true;
  }

  #noneTaken(waiting: readonly Candidate[], revision: number): Look {
    const firstAtRevision = this.#reportedAt !== revision;
    this.#reportedAt = revision;
    const inWaitingWorkspace = waiting.filter(
      (waits) =>
        this.#workspaces.get(waits.workspacePath)?.revision === revision,
    ).length;
    return {
      kind: "none-taken",
      why: `none of the waiting definitions is taken at input revision ${revision}: waiting ${waiting.length}, of which in a workspace that gets no further falsification job until the input revision changes ${inWaitingWorkspace}, and given no further experiment at this revision ${waiting.length - inWaitingWorkspace}`,
      firstAtRevision,
    };
  }

  /** Any ending of a job but an input change while a definition ran ends that definition's run of such endings. */
  #endStreaks(job: PlannedJob, except: JobDefinition | undefined): void {
    for (const definition of job.definitions) {
      if (definition === except) continue;
      const mark = this.#definitions.get(definition.digest);
      if (mark !== undefined) mark.endedRunning = false;
    }
  }

  /** The job's definition `id` is not taken again at `revision`, and is taken last from now on. */
  #leave(job: PlannedJob, id: string, revision: number, reason: string): void {
    const definition = job.definitions.find((held) => held.id === id);
    if (definition === undefined) return;
    const mark = this.#mark(job, definition);
    mark.heldAt = revision;
    mark.reason = reason;
    mark.takenLast = true;
  }

  #mark(job: PlannedJob, definition: JobDefinition): DefinitionMark {
    let mark = this.#definitions.get(definition.digest);
    if (mark === undefined) {
      mark = {
        id: definition.id,
        workspacePath: job.workspacePath,
        heldAt: undefined,
        reason: undefined,
        takenLast: false,
        endedRunning: false,
      };
      this.#definitions.set(definition.digest, mark);
    }
    return mark;
  }
}

/**
 * A definition waits when it is eligible and holds no evidence that reads current. Nothing when its standing lacks
 * what an experiment is built from, which an eligible definition never does.
 */
function candidate(standing: DefectStanding): Candidate[] {
  const { definition, definitionDigest: digest } = standing;
  const { id, resolved, mutation, mutationPath } = definition;
  if (!standing.eligible || standing.evidence?.freshness === CURRENT) return [];
  if (
    digest === undefined ||
    id === undefined ||
    resolved === undefined ||
    mutation === undefined ||
    mutationPath === undefined
  ) {
    return [];
  }
  return [
    {
      standing,
      id,
      digest,
      state: standing.state,
      workspacePath: resolved.identity.workspacePath,
      experiment: {
        defectId: id,
        test: resolved.identity,
        mutation: { file: mutationPath, old: mutation.old, new: mutation.new },
      },
    },
  ];
}

function workspaceReason(
  mark: WorkspaceMark | undefined,
  revision: number,
): string[] {
  return mark?.revision === revision ? [mark.reason] : [];
}

/** Each id is cut as an answer cuts a reason, so the bound on the names bounds their bytes too. */
function leftReason(marks: readonly DefinitionMark[]): string[] {
  if (marks.length === 0) return [];
  const names = namedList(
    marks.map((mark) => `${cutReason(mark.id).reason} (${mark.reason})`),
  );
  return [`${LEFT_LEAD} ${DEFINITIONS_WAIT}: ${names}`];
}
