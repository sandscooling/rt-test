import {
  worktreeStandings,
  type WorktreeStandings,
} from "../defects/worktree-standings.js";
import type {
  ExperimentRecord,
  FalsificationJob,
  JobRefusal,
} from "../falsify/experiment-record.js";
import {
  namedList,
  type JobMark,
  type JobVerdict,
} from "../inputs/input-jobs.js";
import type { TrackedInputs } from "../inputs/input-tracker.js";
import { isRecord } from "../json-guards.js";
import { omittedText, type NoAnswer } from "../query/answer.js";
import type { StoredEvidence } from "../store/defect-evidence.js";
import type { RtTestStore } from "../store/open-store.js";
import type { StoreScope } from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type { DaemonLog } from "./daemon-log.js";
import { ABORT_PURPOSE, type Executor, type JobOutcome } from "./executor.js";
import { FalsificationPlan, type PlannedJob } from "./falsification-plan.js";
import { storeFailureReason, threwOutcome } from "./job-endings.js";
import type {
  DaemonActivity,
  DaemonIdentity,
  UnstoredJob,
} from "./protocol.js";
import type { WaitMoment } from "./waits.js";

/** A target until measured: how long after a falsification job was sent to its executor it is aborted. */
export const JOB_TIME_BOUND_MS = 600_000;
const MS_PER_MINUTE = 60_000;
const BOUND_ENDED = `the time bound of ${JOB_TIME_BOUND_MS / MS_PER_MINUTE} minutes ended its job`;
const WORKSPACE_WAIT =
  "so no further falsification job of the workspace begins until the input revision changes";
const NOT_CONFIRMED_REASON =
  "its job was not sent, since the confirmed start does not hold the workspace";
const NO_FINGERPRINT_REASON =
  "its job was not sent, since the workspace's current input fingerprint cannot be computed";
const NO_JOB_IN_REPLY = "its executor's reply held no job";
/** Why the log names a definition as left without a verdict when no judgement of its own says. */
const JOB_DID_NOT_RUN = "job-did-not-run";
const VERDICT_NOT_STORED = "verdict-not-stored";
const LIST_SEPARATOR = ", ";
/** How much of what happened to a workspace its mark keeps, so what ends each wait stays inside an answer's cut of a reason. */
const MAX_HAPPENED_CHARACTERS = 400;
const LINE_BREAKS = /\s*[\r\n]+\s*/;
const LINE_JOIN = " ";

/** What ended a job: what this module asked of it first, or that it returned unasked. */
const ENDING = {
  stop: "stop",
  change: "change",
  bound: "bound",
  returned: "returned",
} as const;

type Ending = (typeof ENDING)[keyof typeof ENDING];
type AskedEnding = typeof ENDING.change | typeof ENDING.bound;
type RanReply = Extract<FalsificationJob, { readonly status: "ran" }>;

export interface FalsificationParts {
  /** The consumer root and state directory the `defects` query reads by, so a stored definition digest is the one a query computes. */
  readonly identity: Pick<DaemonIdentity, "consumerRoot" | "stateDirectory">;
  readonly scope: StoreScope;
  readonly start: ConfirmedStart;
  readonly store: Pick<RtTestStore, "writeEvidence">;
  readonly log: DaemonLog;
  /** The executor the runs use, whose jobs the scheduler takes one at a time. */
  readonly executor: Pick<Executor, "falsify" | "abort">;
  readonly inputs: TrackedInputs;
  readonly stopSignal: AbortSignal;
  /** The latest stored results, the daemon's view and the inputs, read when it is called. */
  readonly moment: () => WaitMoment;
  readonly setActivity: (activity: DaemonActivity) => void;
}

/** A job sent to its executor, with what its standings were read at. */
interface SentJob {
  readonly job: PlannedJob;
  readonly revision: number;
  /** The digest of the workspace's input fingerprint its tests' current passes were rated against. */
  readonly fingerprintDigest: string;
  /** The window on the tracker, open since the standings were read. */
  readonly mark: JobMark;
  readonly startedAt: number;
  readonly outcome: Promise<JobOutcome<FalsificationJob>>;
  /** What this module first asked the job to end for, when its abort found the job in progress. */
  readonly asked: () => AskedEnding | undefined;
  /** Ends the watch for a change and the time bound, so neither aborts a later job. */
  readonly release: () => void;
}

/**
 * Falsifies the worktree's waiting definitions for the scheduler, one job of one workspace at a time: it reads the
 * standings, sends the next job on the runs' executor, ends it at a change of the input revision or at the time bound,
 * and stores its verdicts as evidence only when no input changed from that read to the job's end.
 */
export class Falsification {
  readonly #parts: FalsificationParts;
  readonly #plan = new FalsificationPlan();

  constructor(parts: FalsificationParts) {
    this.#parts = parts;
  }

  /** What falsification left waiting at the input revision now, as entries of the jobs that stored nothing. */
  entries(): UnstoredJob[] {
    return this.#plan.entries(this.#revision());
  }

  /**
   * One look for waiting definitions and at most one job. Resolves true when the scheduler is to plan again: a job
   * began, or the look found a workspace it cannot send a job for; false when it took nothing.
   */
  async look(plannedRevision: number): Promise<boolean> {
    const { inputs, stopSignal } = this.#parts;
    await inputs.settled();
    if (stopSignal.aborted || this.#revision() !== plannedRevision) {
      return false;
    }
    const opened: { mark?: JobMark } = {};
    let read: WorktreeStandings | NoAnswer;
    try {
      read = await worktreeStandings({
        consumerRoot: this.#parts.identity.consumerRoot,
        stateDirectory: this.#parts.identity.stateDirectory,
        signal: stopSignal,
        moment: () => {
          opened.mark = inputs.beginJob();
          return this.#parts.moment();
        },
      });
    } catch (error) {
      await this.#close(opened.mark);
      // The read throws once a stop has aborted its signal, and a stop may close the store under a read begun before it.
      if (stopSignal.aborted) return false;
      throw error;
    }
    let begun: SentJob | boolean = false;
    try {
      begun = this.#begin(read, plannedRevision, opened.mark);
    } finally {
      if (typeof begun === "boolean") await this.#close(opened.mark);
    }
    if (typeof begun === "boolean") return begun;
    let outcome: JobOutcome<FalsificationJob>;
    try {
      outcome = await begun.outcome;
    } finally {
      begun.release();
    }
    const verdict = await inputs.endJob(begun.mark);
    this.#settle(begun, outcome, verdict);
    return true;
  }

  #revision(): number {
    return this.#parts.inputs.current().facts.revision;
  }

  async #close(mark: JobMark | undefined): Promise<void> {
    if (mark !== undefined) await this.#parts.inputs.endJob(mark);
  }

  /**
   * Decides the look and sends its job with no await, so the stop and the revision it checks are the ones the job
   * begins under. True when the look found a workspace it cannot send a job for, false when it took nothing.
   */
  #begin(
    read: WorktreeStandings | NoAnswer,
    plannedRevision: number,
    mark: JobMark | undefined,
  ): SentJob | boolean {
    const { stopSignal, log } = this.#parts;
    if (mark === undefined || "noAnswer" in read || stopSignal.aborted) {
      return false;
    }
    const revision = read.basis.context.inputs.revision;
    if (revision !== plannedRevision) return false;
    const look = this.#plan.next(read.standings, revision);
    if (look.kind === "none-taken" && look.firstAtRevision) {
      log.entry(`falsification: ${look.why}`);
    }
    if (look.kind !== "job") return false;
    return this.#send(look.job, read, revision, mark);
  }

  #send(
    job: PlannedJob,
    read: WorktreeStandings,
    revision: number,
    mark: JobMark,
  ): SentJob | true {
    const { start, executor, log, setActivity } = this.#parts;
    const { workspacePath, definitions } = job;
    const entry = read.basis.discovery.discovery.workspaces.find(
      (listed) => listed.workspace.path === workspacePath,
    );
    const confirmed =
      entry === undefined ? undefined : confirmedEntry(start, entry.workspace);
    if (entry === undefined || confirmed === undefined) {
      return this.#waits(job, revision, NOT_CONFIRMED_REASON);
    }
    const fingerprintDigest = read.basis.currentFingerprint(workspacePath);
    if (fingerprintDigest === undefined) {
      return this.#waits(job, revision, NO_FINGERPRINT_REASON);
    }
    const [first] = definitions;
    log.entry(
      `falsification started: ${workspacePath}, definitions ${definitions.length}${first === undefined ? "" : `, first ${first.id} (${first.state})`}`,
    );
    setActivity({
      state: "falsifying",
      workspacePath,
      definitions: definitions.length,
    });
    return {
      job,
      revision,
      fingerprintDigest,
      mark,
      startedAt: performance.now(),
      outcome: executor
        .falsify(
          entry.workspace,
          confirmed.configFile,
          definitions.map((definition) => definition.experiment),
          read.assertionErrors,
        )
        .catch((error: unknown) => threwOutcome<FalsificationJob>(error)),
      ...this.#watch(revision),
    };
  }

  /**
   * Aborts the job at the first change of the input revision and at the time bound, until it is released. The
   * tracker's change also resolves when a reconciliation ends or its reads drain, so the revision is compared first.
   */
  #watch(revision: number): Pick<SentJob, "asked" | "release"> {
    const { inputs, executor, stopSignal, log } = this.#parts;
    let asked: AskedEnding | undefined;
    let watching = true;
    const end = (ending: AskedEnding): void => {
      if (!watching) return;
      if (executor.abort(ABORT_PURPOSE.interruption)) asked ??= ending;
    };
    const timer = setTimeout(() => end(ENDING.bound), JOB_TIME_BOUND_MS);
    const untilChange = async (): Promise<void> => {
      while (watching && !stopSignal.aborted) {
        await inputs.changed();
        if (this.#revision() !== revision) return end(ENDING.change);
      }
    };
    untilChange().catch((error: unknown) => {
      log.error("watching the inputs during a falsification job", error);
    });
    return {
      asked: () => asked,
      release: () => {
        watching = false;
        clearTimeout(timer);
      },
    };
  }

  /** The workspace gets no further job at `revision`; true, since the scheduler is to plan again. */
  #waits(job: PlannedJob, revision: number, what: string): true {
    this.#plan.workspaceWaits(
      job,
      revision,
      `${markText(what)}, ${WORKSPACE_WAIT}`,
    );
    this.#parts.log.entry(
      `the falsification of ${job.workspacePath} waits: ${what}, ${WORKSPACE_WAIT}`,
    );
    return true;
  }

  /**
   * Stores and marks by what ended the job. A stop stores and marks nothing; an input change stores nothing; the
   * time bound leaves the definition that was running, or the workspace when the reply names none; a job that
   * returned unasked leaves its workspace when it did not run, and otherwise each of its definitions.
   */
  #settle(
    sent: SentJob,
    outcome: JobOutcome<FalsificationJob>,
    verdict: JobVerdict,
  ): void {
    const revisionNow = this.#revision();
    const reply = readReply(outcome);
    const ran = typeof reply === "string" ? undefined : reply;
    const ending = this.#ending(sent, revisionNow, ran);
    let stored: readonly StoredEvidence[] = [];
    if (ending === ENDING.change) {
      const running = ran === undefined ? undefined : runningDefinition(ran);
      this.#plan.endedByChange(sent.job, revisionNow, running);
    }
    if (ending === ENDING.bound) {
      stored = this.#afterBound(sent, reply, verdict);
    }
    if (ending === ENDING.returned) {
      stored = this.#afterReturn(sent, reply, verdict);
    }
    this.#logEnd(sent, endingText(ending, ran), ran, stored);
  }

  #afterBound(
    sent: SentJob,
    reply: RanReply | string,
    verdict: JobVerdict,
  ): readonly StoredEvidence[] {
    const { job, revision } = sent;
    const running =
      typeof reply === "string" ? undefined : runningDefinition(reply);
    if (typeof reply === "string" || running === undefined) {
      this.#waits(job, revision, boundReason(reply));
      return [];
    }
    this.#plan.endedByBound(job, revision, running);
    return this.#store(sent, reply, verdict);
  }

  #afterReturn(
    sent: SentJob,
    reply: RanReply | string,
    verdict: JobVerdict,
  ): readonly StoredEvidence[] {
    const { job, revision } = sent;
    if (typeof reply === "string") {
      this.#waits(job, revision, `its job did not run: ${reply}`);
      return [];
    }
    const stored = this.#store(sent, reply, verdict);
    this.#plan.ranToEnd(job, revision, withoutVerdict(reply));
    return stored;
  }

  /**
   * Decided from what this module asked for, never from an outcome's reason text. A reply that ran and reads not
   * interrupted holds every run, so an abort that reached its job ended nothing.
   */
  #ending(
    sent: SentJob,
    revisionNow: number,
    ran: RanReply | undefined,
  ): Ending {
    if (this.#parts.stopSignal.aborted) return ENDING.stop;
    const unasked =
      revisionNow === sent.revision ? ENDING.returned : ENDING.change;
    if (ran?.interrupted === false) return unasked;
    return sent.asked() ?? unasked;
  }

  /**
   * Stores the reply's verdicts in one write, bound to the fingerprint and the definition digests its standings were
   * read at, only when the job's window vouches that no input changed; the records stored. A reply that carries no
   * verdict is not handed to the store, whose every write makes its next read rebuild every record.
   */
  #store(
    sent: SentJob,
    reply: RanReply,
    verdict: JobVerdict,
  ): readonly StoredEvidence[] {
    const { job, revision, fingerprintDigest } = sent;
    const { scope, store, log } = this.#parts;
    if (!verdict.fingerprinted) {
      if (this.#revision() === revision) {
        this.#waits(
          job,
          revision,
          `nothing of its job was stored, since ${verdict.reason}`,
        );
      }
      return [];
    }
    if (reply.judgements.every(({ verdict: given }) => given === undefined)) {
      return [];
    }
    try {
      return store.writeEvidence(
        { ...scope, inputFingerprintDigest: fingerprintDigest },
        reply,
        new Map(job.definitions.map(({ id, digest }) => [id, digest])),
      );
    } catch (error) {
      log.error(
        `storing the evidence of the falsification of ${job.workspacePath}`,
        error,
      );
      this.#waits(
        job,
        revision,
        `the verdicts of its job could not be stored: ${storeFailureReason(error)}`,
      );
      return [];
    }
  }

  #logEnd(
    sent: SentJob,
    how: string,
    ran: RanReply | undefined,
    stored: readonly StoredEvidence[],
  ): void {
    const { job, startedAt } = sent;
    const storedIds = new Set(stored.map((record) => record.defectId));
    const reasons = ran === undefined ? undefined : withoutVerdict(ran);
    const unspoken = ran === undefined ? JOB_DID_NOT_RUN : VERDICT_NOT_STORED;
    const left = job.definitions
      .filter(({ id }) => !storedIds.has(id))
      .map(({ id }) => `${id} (${reasons?.get(id) ?? unspoken})`);
    const names = left.length === 0 ? "" : `: ${left.join(LIST_SEPARATOR)}`;
    this.#parts.log.entry(
      `falsification ended: ${job.workspacePath}, ${how}; ${storedText(stored)}; left without a verdict ${left.length}${names}; ${Math.round(performance.now() - startedAt)} ms`,
    );
  }
}

/** What a workspace's mark says happened: `what` on one line, cut by code point; the log holds the whole text. */
function markText(what: string): string {
  const characters = Array.from(what.trim().split(LINE_BREAKS).join(LINE_JOIN));
  const omitted = Math.max(0, characters.length - MAX_HAPPENED_CHARACTERS);
  return `${characters.slice(0, MAX_HAPPENED_CHARACTERS).join("")}${omittedText(omitted)}`;
}

/**
 * The reply of a job that ran, or why the job did not run. A value that is no object, holds no status this module
 * knows, or reads `ran` without its lists of experiments and judgements, is a reply that held no job.
 */
function readReply(outcome: JobOutcome<FalsificationJob>): RanReply | string {
  if (!outcome.ended) return `it ended with no reply: ${outcome.reason}`;
  const job = outcome.value;
  if (!isRecord(job as unknown)) return NO_JOB_IN_REPLY;
  switch (job.status) {
    case "ran":
      return Array.isArray(job.judgements) && Array.isArray(job.experiments)
        ? job
        : NO_JOB_IN_REPLY;
    case "refused":
      return refusalReason(job.refusal);
    case "unsupported":
      return `its workspace's Vitest is not supported: ${job.vitest.reason}`;
    case "not-confirmed":
      return job.reason;
    case "failed":
      return `its workspace failed to load: ${job.error}`;
    case "interrupted-before-load":
      return "it was interrupted before its workspace loaded";
    default:
      return NO_JOB_IN_REPLY;
  }
}

function refusalReason(refusal: JobRefusal): string {
  if (refusal.kind === "not-prepared") {
    return `it was refused, since its Vitest instance could not be prepared: ${refusal.error}`;
  }
  const caches = refusal.caches.map(
    ({ projectName, setting }) =>
      `project ${JSON.stringify(projectName)} (${setting})`,
  );
  return `it was refused, since a project keeps an on-disk module cache on: ${namedList(caches)}`;
}

function boundReason(reply: RanReply | string): string {
  return typeof reply === "string"
    ? `${BOUND_ENDED}: ${reply}`
    : `${BOUND_ENDED} in a baseline`;
}

/**
 * The definition whose run an abort ended: the first experiment interrupted in its first run or its confirming run.
 * None when a baseline was the run in progress: the first, which leaves every experiment interrupted and no baseline,
 * or the restored one, which leaves none interrupted.
 */
function runningDefinition(reply: RanReply): string | undefined {
  if (!reply.interrupted || reply.baseline === undefined) return undefined;
  return reply.experiments.find(wasInterrupted)?.defectId;
}

function wasInterrupted(record: ExperimentRecord): boolean {
  return record.status === "ran"
    ? record.confirming?.status === "interrupted"
    : record.reason.kind === "interrupted";
}

/** By defect id, the judge's reason for each experiment it gave no verdict. */
function withoutVerdict(reply: RanReply): Map<string, string> {
  return new Map(
    reply.judgements.flatMap((judgement) =>
      judgement.verdict === undefined
        ? [[judgement.defectId, judgement.reason] as const]
        : [],
    ),
  );
}

function endingText(ending: Ending, ran: RanReply | undefined): string {
  switch (ending) {
    case ENDING.stop:
      return "a stop ended it";
    case ENDING.change:
      return "a change of the input revision ended it";
    case ENDING.bound:
      return "the time bound ended it";
    case ENDING.returned:
      return ran === undefined ? "it did not run" : "it ran to its end";
  }
}

function storedText(stored: readonly StoredEvidence[]): string {
  const counts = new Map<string, number>();
  for (const { verdict } of stored) {
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  if (counts.size === 0) return "no verdict stored";
  const kinds = [...counts].map(([verdict, count]) => `${count} ${verdict}`);
  return `verdicts stored: ${kinds.join(LIST_SEPARATOR)}`;
}
