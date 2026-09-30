import type { TrackedInputs } from "../inputs/input-tracker.js";
import type { WorkspaceNarrowing } from "../inputs/narrowed-inputs.js";
import type { UnreadPath } from "../inputs/queued-reads.js";
import type { NoAnswer, RefusedQuery } from "../query/answer.js";
import {
  changesAnswer,
  CURSOR_USE,
  determination,
  notDeterminedAnswer,
  type ChangesAnswer,
} from "../query/changes-answer.js";
import { withoutFingerprints } from "../query/path-status.js";
import { queryBasis } from "../query/summary.js";
import { coverageAt } from "../query/wait-answer.js";
import { errorText } from "../vitest/error-text.js";
import { ChangeJournal } from "./change-journal.js";
import type { DaemonLog } from "./daemon-log.js";
import type { DependencyBuilds } from "./dependency-builds.js";
import type { ChangesQuery } from "./server.js";
import { NOT_AWAITED_REASON, resolveFiles, type WaitMoment } from "./waits.js";

const CHANGES_QUERY = "changes query";
const BUILD_END_MOMENT = "the end of a dependency build";
const INPUT_CHANGE_MOMENT = "a change of the inputs or the store";
const COVERAGE_UNKNOWN_REASON =
  "the coverage at a moment whose dependency build had ended could not be taken";

/** What a changes answer or a recording reads, with the builds' state at the revision its inputs were taken at. */
export interface ChangesMoment extends WaitMoment {
  /** From the same reading of the builds the inputs were narrowed over. */
  readonly narrowing: WorkspaceNarrowing;
}

export interface ChangesParts {
  readonly consumerRoot: string;
  readonly inputs: TrackedInputs;
  readonly builds: Pick<DependencyBuilds, "pending" | "ended">;
  readonly stopSignal: AbortSignal;
  readonly log: DaemonLog;
  readonly moment: () => ChangesMoment;
}

/**
 * Answers changes queries at once from the journal of standings this daemon life recorded, and records into it at
 * every determined moment: each changes answer, each stored run or discovery, each ended dependency build, the one
 * over a newly stored discovery included, and each input change.
 */
export class Changes {
  readonly #parts: ChangesParts;
  readonly #journal = new ChangeJournal();
  /** Resolves the build-end loop's wait for the next change, so a store that begins a build is seen. */
  #wake: (() => void) | undefined;
  /** One unresolved wait on the inputs, so the loop does not ask the tracker again at each wake. */
  #inputsChanged: Promise<void> | undefined;

  constructor(parts: ChangesParts) {
    this.#parts = parts;
  }

  /** Records at each ended dependency build and each input change until the stop. */
  start(): void {
    void this.#recordAtBuildEnds().catch((error: unknown) => {
      this.#parts.log.error("recording the changes at build ends", error);
    });
  }

  /**
   * Refuses the query whole when any path is one a wait refuses. Otherwise reads the paths, and once `signal` aborts
   * reads nothing more, since a stop may have closed the store; then answers in one turn with what the read found.
   */
  async answer(
    query: ChangesQuery,
    signal: AbortSignal,
  ): Promise<ChangesAnswer | NoAnswer | RefusedQuery> {
    const { consumerRoot, inputs } = this.#parts;
    const resolved = resolveFiles(query.paths, consumerRoot, CHANGES_QUERY);
    if ("refused" in resolved) return resolved;
    const { paths } = resolved;
    await inputs.readNamed(paths);
    if (signal.aborted) return { noAnswer: NOT_AWAITED_REASON };
    const moment = this.#parts.moment();
    const unread = inputs.unreadNamed(paths);
    return this.#answerAt(moment, unread, paths, query.since);
  }

  /**
   * Records a stored moment when it is determined, and has the build-end loop look again, since storing a discovery
   * begins a build over it with no input change.
   */
  stored(moment: string): void {
    this.#record(moment);
    this.#wake?.();
  }

  /** Records the moment when it is determined; a reading that fails is logged at warning level and skipped. */
  #record(moment: string): void {
    if (this.#parts.stopSignal.aborted) return;
    try {
      const { results, view, inputs, narrowing } = this.#parts.moment();
      if (!determination(inputs, narrowing, []).determined) return;
      const basis = queryBasis(results, view, inputs);
      if ("noAnswer" in basis) return;
      this.#journal.record(basis.standings, basis.notDiscovered);
    } catch (error) {
      this.#parts.log.entry(
        `warning: the changes journal skipped ${moment}, since reading it failed: ${errorText(error)}`,
      );
    }
  }

  /**
   * Lists nothing at a moment not determined, handing back a usable cursor or the latest recorded one. At a determined
   * moment records first, so a change made after the last record is named by the returned cursor and listed now.
   */
  #answerAt(
    moment: ChangesMoment,
    unread: readonly UnreadPath[],
    paths: readonly string[],
    since: string | undefined,
  ): ChangesAnswer | NoAnswer {
    const { results, view, inputs, narrowing } = moment;
    const basis = queryBasis(
      results,
      view,
      withoutFingerprints(inputs, unread),
    );
    if ("noAnswer" in basis) return basis;
    const { revision } = inputs.facts;
    const decided = determination(inputs, narrowing, unread);
    if (!decided.determined) {
      const cursorUse = this.#journal.use(since);
      const cursor =
        cursorUse === CURSOR_USE.used && since !== undefined
          ? since
          : (this.#journal.latest() ?? null);
      return notDeterminedAnswer(
        basis,
        { cursor, cursorUse, revision },
        decided.notDetermined,
      );
    }
    const coverage = coverageAt(
      basis.discovery,
      narrowing,
      decided.snapshot,
      revision,
      paths,
    );
    if (coverage === undefined) throw new Error(COVERAGE_UNKNOWN_REASON);
    const cursor = this.#journal.record(basis.standings, basis.notDiscovered);
    return changesAnswer(basis, {
      revision,
      cursor,
      reading: this.#journal.since(since),
      coverage,
      paths,
    });
  }

  /**
   * Waits for a build only while one is pending, and otherwise for the next input change or store. Records after either,
   * since the inputs becoming available again at an unchanged revision can make the moment determined with no build
   * ending, and a moment left unrecorded can hide a failure that returns at a later one.
   */
  async #recordAtBuildEnds(): Promise<void> {
    const { builds, stopSignal } = this.#parts;
    while (!stopSignal.aborted) {
      if (builds.pending()) {
        await builds.ended();
        this.#record(BUILD_END_MOMENT);
      } else {
        await this.#nextChange();
        this.#record(INPUT_CHANGE_MOMENT);
      }
    }
  }

  #nextChange(): Promise<void> {
    this.#inputsChanged ??= this.#parts.inputs.changed().then(() => {
      this.#inputsChanged = undefined;
    });
    const stored = new Promise<void>((resolve) => {
      this.#wake = resolve;
    });
    return Promise.race([this.#inputsChanged, stored]);
  }
}
