import { realpathSync } from "node:fs";
import type { JobVerdict } from "../inputs/input-jobs.js";
import {
  DEPENDENCY_BUILD_FAILED,
  DEPENDENCY_BUILD_TIMED_OUT,
  type BuildFailureKind,
} from "../query/answer.js";
import type { TrackedInputs } from "../inputs/input-tracker.js";
import {
  Narrowing,
  type EndedBuild,
  type NarrowingState,
  type QueryNarrowing,
} from "../inputs/narrowed-inputs.js";
import {
  buildSelectionInput,
  type DiscoveredSelectionInput,
  type SelectionInputBuild,
} from "../selection/selection-input.js";
import type { DependencyInformation } from "../selection/selection-types.js";
import type { StoredDiscovery } from "../store/stored-records.js";
import { errorText } from "../vitest/error-text.js";
import type { DaemonLog } from "./daemon-log.js";
import type { Executor, JobOutcome } from "./executor.js";

const WIDENED_CONSEQUENCE =
  "so every workspace covers the whole project's inputs";
const NO_REAL_ROOT_REASON = "the consumer root's real path could not be read";
const DISCOVERY_REPLACED_REASON = "a new discovery took effect while it ran";
const NO_SELECTION_INPUT_BUILT_REASON =
  "the selection input could not be built from the discovery";
const BUILD_THREW_REASON = "the dependency build could not be run";
const BUILDS_ENDED_CONSEQUENCE = `${WIDENED_CONSEQUENCE} for the rest of the daemon's life`;

/** A target until measured: a real build parses every source file of the consumer once. */
const DEPENDENCY_BUILD_BOUND_MS = 120_000;
/** The build a run waited on and one rebuild; a run waits through no more discards than these. */
const DISCARDS_A_RUN_WAITS_THROUGH = 2;

interface Discards {
  readonly total: number;
  /** Over the discovery in effect: a build its discovery's replacement discarded is not one of them. */
  readonly consecutive: number;
  /** Why the latest was discarded; undefined before any is. */
  readonly reason: string | undefined;
}

interface DependencyBuildParts {
  readonly inputs: TrackedInputs;
  /** Takes builds only, so a build never waits behind a run. */
  readonly executor: Executor;
  /** As discovery was given it. */
  readonly consumerRoot: string;
  /** Holds each build's parse record. */
  readonly parseRecordDirectory: string;
  readonly log: DaemonLog;
  /** How long after it began a build is ended; `DEPENDENCY_BUILD_BOUND_MS` when absent. */
  readonly boundMs?: number;
}

/**
 * Builds the dependency information over the discovery in effect at each input revision, one build at a time, once
 * the inputs have settled and while the tracker can vouch for them, and keeps the latest build that ended with no
 * input moving while it ran, or ended at the bound. A build the revision overtakes runs to its end and is discarded,
 * unless the bound ends it first.
 */
export class DependencyBuilds {
  readonly #parts: DependencyBuildParts;
  #discovery: StoredDiscovery | undefined;
  #state: NarrowingState | undefined;
  #stopped = false;
  /** Why the rounds ended by throwing; undefined while they work and when a stop ended them. */
  #endedBy: string | undefined;
  #boundTimer: NodeJS.Timeout | undefined;
  #rounds: Promise<void> = Promise.resolve();
  #wakeRounds: (() => void) | undefined;
  #waits: (() => void)[] = [];
  #discards: Discards = { total: 0, consecutive: 0, reason: undefined };

  readonly #boundMs: number;

  constructor(parts: DependencyBuildParts) {
    this.#parts = parts;
    this.#boundMs = parts.boundMs ?? DEPENDENCY_BUILD_BOUND_MS;
  }

  /** Makes `discovery` the one in effect; undefined leaves none. */
  use(discovery: StoredDiscovery | undefined): void {
    if (discovery?.discoveryId === this.#discovery?.discoveryId) return;
    this.#discovery = discovery;
    this.#discards = { ...this.#discards, consecutive: 0 };
    // Whether it yields a selection input is known once its first build begins.
    this.#state =
      discovery === undefined
        ? undefined
        : {
            discoveryId: discovery.discoveryId,
            selectionInput: true,
            latest: undefined,
            lastFailure: undefined,
          };
    this.#wakeRounds?.();
    if (discovery === undefined) this.#resolveWaits();
  }

  start(): void {
    this.#rounds = this.#run()
      .catch((error: unknown) => {
        if (this.#stopped) {
          this.#parts.log.error(
            "the dependency builds failed during a stop",
            error,
          );
          return;
        }
        this.#endedBy = errorText(error);
        this.#parts.log.entry(
          `warning: the dependency builds ended, ${BUILDS_ENDED_CONSEQUENCE}: ${this.#endedBy}`,
        );
      })
      .finally(() => {
        this.#stopped = true;
        this.#resolveWaits();
      });
  }

  /** The builds' state beside the discovery they build over. */
  narrowing(): QueryNarrowing {
    return {
      discoveryId: this.#discovery?.discoveryId,
      state: this.#state,
      buildsEnded: this.#endedBy,
    };
  }

  /** Whether a build is still to end at the current revision while the tracker can vouch for its inputs. */
  pending(): boolean {
    if (this.#stopped) return false;
    const current = this.#parts.inputs.current();
    return (
      current.unavailable === undefined &&
      !this.#endedAt(current.facts.revision)
    );
  }

  /** The builds discarded since the daemon started and since the last recorded build or new discovery. */
  discards(): Discards {
    return this.#discards;
  }

  /** Resolves at once when no build is pending, and otherwise once the builds next record or discard a build or can begin none. */
  ended(): Promise<void> {
    if (!this.pending()) return Promise.resolve();
    return new Promise((resolve) => this.#waits.push(resolve));
  }

  /**
   * Waits for the dependency build at the settled revision, through one rebuild: a second build discarded in a row
   * while `subject` waits means its inputs keep moving, so it proceeds without the build.
   */
  async awaitBuild(subject: string): Promise<void> {
    const waitedFrom = this.discards().total;
    while (this.pending()) {
      const discards = this.discards();
      const inARow = Math.min(
        discards.total - waitedFrom,
        discards.consecutive,
      );
      if (inARow >= DISCARDS_A_RUN_WAITS_THROUGH) {
        this.#parts.log.entry(
          `${subject} proceeds without its dependency build, discarded ${inARow} times in a row while it waited: ${discards.reason}`,
        );
        return;
      }
      await this.ended();
      await this.#parts.inputs.settled();
    }
  }

  /** Ends the build in progress, which is never recorded, and resolves once the builds have ended. */
  stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#boundTimer);
    this.#parts.executor.abort();
    this.#wakeRounds?.();
    this.#resolveWaits();
    return this.#rounds;
  }

  async #run(): Promise<void> {
    await this.#parts.inputs.firstReconciled();
    while (!this.#stopped) await this.#round();
  }

  async #round(): Promise<void> {
    const { inputs } = this.#parts;
    const discovery = this.#discovery;
    if (discovery === undefined || !this.#state?.selectionInput) {
      this.#resolveWaits();
      await this.#nextChange();
      return;
    }
    await inputs.settled();
    if (this.#stopped || this.#discovery !== discovery) return;
    const current = inputs.current();
    const { revision } = current.facts;
    if (current.unavailable !== undefined || this.#endedAt(revision)) {
      this.#resolveWaits();
      await this.#nextChange(inputs.changed());
      return;
    }
    await this.#build(discovery, revision);
  }

  /** Begins at `revision` with no await after the caller read it, so the job mark vouches for that revision. */
  async #build(discovery: StoredDiscovery, revision: number): Promise<void> {
    const { inputs, executor, consumerRoot, parseRecordDirectory, log } =
      this.#parts;
    let realRoot: string;
    try {
      realRoot = realpathSync.native(consumerRoot);
    } catch (error) {
      this.#record(
        discovery,
        failedBuild(revision, `${NO_REAL_ROOT_REASON}: ${errorText(error)}`),
      );
      return;
    }
    let selection: SelectionInputBuild;
    try {
      selection = buildSelectionInput(
        discovery.discovery,
        realRoot,
        inputs.nonInputsDeclaration(),
      );
    } catch (error) {
      this.#record(
        discovery,
        failedBuild(
          revision,
          `${NO_SELECTION_INPUT_BUILT_REASON}: ${errorText(error)}`,
        ),
      );
      return;
    }
    if (!selection.built) {
      this.#noSelectionInput(discovery, selection.reason);
      return;
    }
    log.entry(`dependency build started at input revision ${revision}`);
    const mark = inputs.beginJob();
    let timedOut = false;
    this.#boundTimer = setTimeout(() => {
      timedOut = true;
      executor.abort();
    }, this.#boundMs);
    const outcome = await executor
      .buildDependencies(
        consumerRoot,
        selection.input.workspaces,
        parseRecordDirectory,
      )
      .catch((error: unknown): JobOutcome<DependencyInformation> => ({
        ended: false,
        reason: `${BUILD_THREW_REASON}: ${errorText(error)}`,
      }))
      .finally(() => clearTimeout(this.#boundTimer));
    const verdict = await inputs.endJob(mark);
    if (this.#stopped) return;
    const replaced = this.#discovery !== discovery;
    if (timedOut && !outcome.ended && !replaced) {
      this.#recordTimedOut(discovery, revision, verdict);
      return;
    }
    const discarded = discardReason(replaced, verdict);
    if (discarded !== undefined) {
      log.entry(
        `the dependency build at input revision ${revision} was discarded: ${discarded}`,
      );
      this.#discards = {
        total: this.#discards.total + 1,
        consecutive: this.#discards.consecutive + (replaced ? 0 : 1),
        reason: discarded,
      };
      this.#resolveWaits();
      return;
    }
    this.#record(
      discovery,
      outcome.ended
        ? {
            revision,
            built: true,
            narrowing: this.#narrowing(
              selection.input,
              outcome.value,
              revision,
            ),
          }
        : failedBuild(revision, outcome.reason),
    );
  }

  /**
   * Records a build the bound ended at its revision, never the abort's own outcome, which names a stop. A build whose
   * inputs moved while it ran still counts as a discard, so a run waiting through a moving revision proceeds.
   */
  #recordTimedOut(
    discovery: StoredDiscovery,
    revision: number,
    verdict: JobVerdict,
  ): void {
    const build: EndedBuild = {
      revision,
      built: false,
      kind: DEPENDENCY_BUILD_TIMED_OUT,
      reason: `the build did not end within ${this.#boundMs} ms of its start and was ended`,
    };
    if (verdict.fingerprinted) {
      this.#record(discovery, build);
      return;
    }
    this.#parts.log.entry(
      `the dependency build at input revision ${revision} timed out while its inputs moved, so it counts as discarded: ${verdict.reason}`,
    );
    this.#record(discovery, build, {
      total: this.#discards.total + 1,
      consecutive: this.#discards.consecutive + 1,
      reason: verdict.reason,
    });
  }

  /** Sets `discards` before any wait resolves, so a waiting run reads the count this build leaves. */
  #record(
    discovery: StoredDiscovery,
    build: EndedBuild,
    discards: Discards = { ...this.#discards, consecutive: 0 },
  ): void {
    this.#discards = discards;
    this.#state = {
      discoveryId: discovery.discoveryId,
      selectionInput: true,
      latest: build,
      lastFailure: build.built
        ? undefined
        : { kind: build.kind, reason: build.reason },
    };
    this.#parts.log.entry(
      build.built
        ? `dependency build ended at input revision ${build.revision}`
        : `warning: the dependency build at input revision ${build.revision} ${FAILURE_VERBS[build.kind]}, ${WIDENED_CONSEQUENCE}: ${build.reason}`,
    );
    this.#resolveWaits();
  }

  /** A narrowing whose refusal of the inputs' paths is logged at warning level, as a failed build is. */
  #narrowing(
    input: DiscoveredSelectionInput,
    dependencies: DependencyInformation,
    revision: number,
  ): Narrowing {
    return new Narrowing(input, dependencies, (reason) => {
      this.#parts.log.entry(
        `warning: selection refused an input's path at input revision ${revision}, ${WIDENED_CONSEQUENCE}: ${reason}`,
      );
    });
  }

  #noSelectionInput(discovery: StoredDiscovery, reason: string): void {
    const { discoveryId } = discovery;
    this.#state = { discoveryId, selectionInput: false, reason };
    this.#parts.log.entry(
      `warning: discovery ${discoveryId} yields no selection input, ${WIDENED_CONSEQUENCE}: ${reason}`,
    );
  }

  /** True also while there is nothing to build over. */
  #endedAt(revision: number): boolean {
    const state = this.#state;
    if (state === undefined || !state.selectionInput) return true;
    return state.latest?.revision === revision;
  }

  /** Resolves at a new discovery, a stop, or the first of `changes`. */
  #nextChange(...changes: Promise<void>[]): Promise<void> {
    return new Promise((resolve) => {
      this.#wakeRounds = resolve;
      for (const change of changes) void change.then(resolve);
    });
  }

  #resolveWaits(): void {
    const waits = this.#waits;
    this.#waits = [];
    for (const resolve of waits) resolve();
  }
}

const FAILURE_VERBS: Readonly<Record<BuildFailureKind, string>> = {
  [DEPENDENCY_BUILD_FAILED]: "failed",
  [DEPENDENCY_BUILD_TIMED_OUT]: "timed out",
};

function failedBuild(revision: number, reason: string): EndedBuild {
  return {
    revision,
    built: false,
    kind: DEPENDENCY_BUILD_FAILED,
    reason,
  };
}

/** Why an ended build describes no revision of the discovery in effect; undefined when it describes its own. */
function discardReason(
  replaced: boolean,
  verdict: JobVerdict,
): string | undefined {
  if (replaced) return DISCOVERY_REPLACED_REASON;
  return verdict.fingerprinted ? undefined : verdict.reason;
}
