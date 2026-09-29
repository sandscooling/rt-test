import type { FingerprintResult } from "../inputs/fingerprint.js";
import {
  CHANGED_WHILE_RUNNING_REASON,
  namedList,
  type JobVerdict,
  type JobWindow,
} from "../inputs/input-jobs.js";
import type { CurrentInputs } from "../inputs/input-tracker.js";
import {
  NARROWING,
  narrowingAt,
  type BuildPlacement,
  type EndedBuild,
  type QueryNarrowing,
} from "../inputs/narrowed-inputs.js";
import { workspaceTestModules } from "../inputs/non-inputs.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import type { DaemonLog } from "./daemon-log.js";
import type { DependencyBuilds } from "./dependency-builds.js";

const CAUSES_REASON = "its inputs could not be vouched for while it ran";
const NO_START_FINGERPRINT_REASON = "it started without an input fingerprint";
const END_UNAVAILABLE_REASON =
  "its workspace's input fingerprint could not be taken at its end";
const MOVED_REASON =
  "its workspace's input fingerprint at its end differs from the one at its start";
const INTERRUPTED_REASON =
  "a change inside its workspace's inputs interrupted it, so nothing of it was stored";
const INTERRUPTION_ASKED =
  "is being interrupted, since a change inside its workspace's inputs means it can no longer become current";
const KEPT_ALTHOUGH_CHANGED =
  "is stored under its input fingerprint, since only paths outside its workspace's inputs changed while it ran";

export const JUDGMENT = {
  noStartFingerprint: "no-start-fingerprint",
  changedInside: "changed-inside",
  causes: "causes",
  endUnavailable: "end-unavailable",
  moved: "moved",
  kept: "kept",
} as const;

/** Each kind of judgment that stores a run not fingerprinted. */
export type NotKeptKind = Exclude<RunJudgment["kind"], typeof JUDGMENT.kept>;

/** Why a run was stored not fingerprinted, as the predicate judged it. */
export interface NotKeptVerdict {
  readonly kind: NotKeptKind;
  readonly reason: string;
}

/** Whether a run can still be stored under the fingerprint it started from, and when not, the first reason that applies. */
export type RunJudgment =
  | {
      readonly kind: typeof JUDGMENT.noStartFingerprint;
      readonly reason: string;
    }
  | {
      readonly kind: typeof JUDGMENT.changedInside;
      /** Every changed path inside its workspace's inputs, in the order the window recorded them. */
      readonly paths: readonly string[];
      /** Those a narrowed build places inside, the only ones that interrupt a run. */
      readonly narrowed: readonly string[];
      /** Whether its workspace's fingerprint was taken at its end, so a rerun could be bound to one. */
      readonly endFingerprinted: boolean;
    }
  | {
      readonly kind: typeof JUDGMENT.causes;
      readonly causes: readonly string[];
    }
  | {
      readonly kind: typeof JUDGMENT.endUnavailable;
      readonly reason: string;
    }
  | { readonly kind: typeof JUDGMENT.moved }
  | {
      readonly kind: typeof JUDGMENT.kept;
      /** The paths that changed while it ran, every one outside its workspace's inputs. */
      readonly outside: readonly string[];
    };

/** How one dependency build places a changed path: by selecting it over the build's own information, or widened. */
type HeldPlacement =
  | { readonly kind: typeof NARROWING.narrowed; readonly build: BuildPlacement }
  | { readonly kind: typeof NARROWING.widened };

const WIDENED_PLACEMENT: HeldPlacement = { kind: NARROWING.widened };

interface RunFacts {
  readonly workspacePath: string;
  readonly start: FingerprintResult;
  readonly window: JobWindow;
  /** The test modules the discovery lists for the workspace, each inside its inputs whatever selection says. */
  readonly testModules: ReadonlySet<string>;
  /** The start revision's build, each build that ended since, and at the end the end revision's. */
  readonly placements: readonly HeldPlacement[];
  /** Its workspace's fingerprint at its end; undefined while it runs. */
  readonly end: FingerprintResult | undefined;
}

/** One predicate for a run in progress and a run that ended, so both moments judge alike. */
function judgeRun(facts: RunFacts): RunJudgment {
  const { start, window, end } = facts;
  if (!start.ok) {
    return { kind: JUDGMENT.noStartFingerprint, reason: start.reason };
  }
  const { inside, narrowed } = placedInside(facts);
  if (inside.length > 0) {
    return {
      kind: JUDGMENT.changedInside,
      paths: inside,
      narrowed,
      endFingerprinted: end?.ok === true,
    };
  }
  if (window.causes.size > 0) {
    return { kind: JUDGMENT.causes, causes: [...window.causes] };
  }
  if (end !== undefined && !end.ok) {
    return { kind: JUDGMENT.endUnavailable, reason: end.reason };
  }
  if (end !== undefined && end.digest !== start.digest) {
    return { kind: JUDGMENT.moved };
  }
  return { kind: JUDGMENT.kept, outside: [...window.paths] };
}

/**
 * A path lies inside when any of these holds: a narrowed build's selection of it includes the workspace, that build
 * cannot place it, a widened build is held, or it is a listed test module. Only a narrowed build's placement interrupts.
 */
function placedInside(facts: RunFacts): {
  readonly inside: readonly string[];
  readonly narrowed: readonly string[];
} {
  const { workspacePath, window, testModules, placements } = facts;
  const paths = [...window.paths];
  const modules = paths.filter((path) => testModules.has(path));
  const inside = new Set(modules);
  const narrowed = new Set<string>();
  for (const placement of placements) {
    if (placement.kind === NARROWING.widened) {
      for (const path of paths) inside.add(path);
      continue;
    }
    const placed = placement.build.place(paths, workspacePath);
    for (const path of [...placed.inside, ...modules]) {
      inside.add(path);
      narrowed.add(path);
    }
    for (const path of placed.widened) inside.add(path);
  }
  return {
    inside: paths.filter((path) => inside.has(path)),
    narrowed: paths.filter((path) => narrowed.has(path)),
  };
}

/** The verdict the store binds a run by: its starting fingerprint only when kept. */
export function runVerdict(judgment: RunJudgment): JobVerdict {
  if (judgment.kind === JUDGMENT.kept) return { fingerprinted: true };
  return {
    fingerprinted: false,
    reason: judgmentReason(judgment),
    changedWhileRunning:
      judgment.kind === JUDGMENT.moved ||
      (judgment.kind === JUDGMENT.changedInside && judgment.endFingerprinted),
  };
}

/** The judgment's kind and reason when it stores the run not fingerprinted; undefined when the run is kept. */
export function notKeptVerdict(
  judgment: RunJudgment,
): NotKeptVerdict | undefined {
  if (judgment.kind === JUDGMENT.kept) return undefined;
  return { kind: judgment.kind, reason: judgmentReason(judgment) };
}

/** Whether its inputs changed while it ran and a rerun could be bound to a fingerprint, as the scheduler reads it. */
export function changedWhileRunning(judgment: RunJudgment): boolean {
  const verdict = runVerdict(judgment);
  return !verdict.fingerprinted && verdict.changedWhileRunning;
}

function judgmentReason(
  judgment: Exclude<RunJudgment, { readonly kind: typeof JUDGMENT.kept }>,
): string {
  switch (judgment.kind) {
    case JUDGMENT.noStartFingerprint:
      return `${NO_START_FINGERPRINT_REASON}: ${judgment.reason}`;
    case JUDGMENT.changedInside:
      return `${CHANGED_WHILE_RUNNING_REASON}: ${namedList(judgment.paths)}`;
    case JUDGMENT.causes:
      return `${CAUSES_REASON}: ${namedList(judgment.causes)}`;
    case JUDGMENT.endUnavailable:
      return `${END_UNAVAILABLE_REASON}: ${judgment.reason}`;
    case JUDGMENT.moved:
      return MOVED_REASON;
  }
}

/** The changed paths a narrowed build places inside, which interrupt the run; undefined when there are none. */
function interruptingPaths(
  judgment: RunJudgment,
): readonly string[] | undefined {
  if (judgment.kind !== JUDGMENT.changedInside) return undefined;
  return judgment.narrowed.length === 0 ? undefined : judgment.narrowed;
}

/** What the log says of a run stored under its fingerprint while paths outside its inputs changed; undefined otherwise. */
export function keptAlthoughChanged(judgment: RunJudgment): string | undefined {
  if (judgment.kind !== JUDGMENT.kept || judgment.outside.length === 0) {
    return undefined;
  }
  return `${KEPT_ALTHOUGH_CHANGED}: ${namedList(judgment.outside)}`;
}

/**
 * How `view`'s revision places a path, as the view fingerprints by: narrowed only when its build narrowed and
 * selection took the view's inputs; undefined while that build has not ended or the view can vouch for no inputs.
 */
function placementOf(
  view: CurrentInputs,
  query: QueryNarrowing,
): HeldPlacement | undefined {
  if (view.unavailable !== undefined) return undefined;
  const workspaces = narrowingAt(query, view.facts.revision);
  if (workspaces.kind === NARROWING.building) return undefined;
  const confirmed =
    workspaces.kind === NARROWING.narrowed &&
    view.inputsNotNarrowed === undefined;
  return confirmed
    ? { kind: NARROWING.narrowed, build: workspaces.narrowing.placement }
    : WIDENED_PLACEMENT;
}

/** The latest build over the discovery in effect; widened when the builds give that discovery no narrowing at all. */
function latestEnded(
  query: QueryNarrowing,
): EndedBuild | typeof NARROWING.widened | undefined {
  if (query.buildsEnded !== undefined) return NARROWING.widened;
  const { state } = query;
  if (state === undefined || state.discoveryId !== query.discoveryId) {
    return undefined;
  }
  return state.selectionInput ? state.latest : NARROWING.widened;
}

export interface RunWatchParts {
  readonly entry: WorkspaceDiscovery;
  readonly window: JobWindow;
  /** The view the run's start fingerprint is taken from, read with no await after its job began. */
  readonly startView: CurrentInputs;
  readonly builds: Pick<DependencyBuilds, "narrowing" | "pending" | "ended">;
  /** The inputs as a run is fingerprinted over them now. */
  readonly view: () => CurrentInputs;
  readonly inputsChanged: () => Promise<void>;
  readonly isStopping: () => boolean;
  /** Aborts the run watched, returning whether the abort reached its job before the job ended. */
  readonly interrupt: () => boolean;
  readonly log: DaemonLog;
}

/**
 * Holds how each dependency build that ends while a run is watched places a path, since the builds keep only their
 * latest, and interrupts the run once a newer build has ended and a changed path a narrowed build places inside its
 * workspace's inputs makes it worthless. Every recorded build wakes it before the next can be recorded, so it misses
 * none. Once the run returns it interrupts nothing, and it holds builds until it is closed.
 */
export class RunWatch {
  /** The run's workspace fingerprint at its start. */
  readonly started: FingerprintResult;
  readonly #parts: RunWatchParts;
  readonly #testModules: ReadonlySet<string>;
  readonly #held: HeldPlacement[] = [];
  readonly #heldBuilds = new Set<BuildPlacement>();
  /** Weak, so a replaced build's narrowed sets are not kept alive by the watch. */
  readonly #seen = new WeakSet<EndedBuild>();
  #heldWidened = false;
  /** Whether a build newer than the start revision's has ended, from which each change can interrupt the run. */
  #newerBuildEnded = false;
  #returned = false;
  #closed = false;
  #interruption: string | undefined;
  #interruptedBy: readonly string[] | undefined;
  #wake: () => void = () => undefined;
  readonly #watching: Promise<void>;

  constructor(parts: RunWatchParts) {
    this.#parts = parts;
    const { startView, builds, entry, log } = parts;
    this.started = startView.workspaceFingerprint(entry);
    this.#testModules = new Set(workspaceTestModules(entry));
    const query = builds.narrowing();
    const latest = latestEnded(query);
    if (typeof latest === "object") this.#seen.add(latest);
    const start = placementOf(startView, query);
    if (start !== undefined) this.#hold(start);
    this.#watching = this.#watch().catch((error: unknown) => {
      this.#hold(WIDENED_PLACEMENT);
      log.error(
        `watching the run of ${entry.workspace.path}, so every path it saw change counts inside its inputs`,
        error,
      );
    });
  }

  /** Why the run was interrupted; undefined when it was not. */
  get interruption(): string | undefined {
    return this.#interruption;
  }

  /** The changed paths inside its workspace's inputs that interrupted the run, all of them; undefined when it was not. */
  get interruptedBy(): readonly string[] | undefined {
    return this.#interruptedBy;
  }

  /** From now on nothing interrupts the run, since its executor has returned it. */
  runReturned(): void {
    this.#returned = true;
  }

  /**
   * Judges the run by `endView`, the inputs once its end revision's build has ended or none could. A build that fails
   * to place the changed paths widens them, so the run is still stored, not fingerprinted.
   */
  judge(endView: CurrentInputs): RunJudgment {
    const end = placementOf(endView, this.#parts.builds.narrowing());
    if (end !== undefined) this.#hold(end);
    const { entry, log } = this.#parts;
    const fingerprint = endView.workspaceFingerprint(entry);
    try {
      return this.#judgment(fingerprint);
    } catch (error) {
      log.error(
        `placing the paths that changed during the run of ${entry.workspace.path}, so every one counts inside its inputs`,
        error,
      );
      return this.#judgment(fingerprint, [WIDENED_PLACEMENT]);
    }
  }

  /** Ends the watch and resolves once it has stopped; call once the end view is taken. */
  close(): Promise<void> {
    this.#closed = true;
    this.#wake();
    return this.#watching;
  }

  async #watch(): Promise<void> {
    while (!this.#closed && !this.#parts.isStopping()) {
      if (this.#capture()) this.#newerBuildEnded = true;
      if (this.#newerBuildEnded) this.#interruptIfWorthless();
      await this.#nextChange();
    }
  }

  /** Resolves when a pending build ends, or otherwise at the next input change, or at the watch's close. */
  #nextChange(): Promise<void> {
    const { builds, inputsChanged } = this.#parts;
    const change = builds.pending() ? builds.ended() : inputsChanged();
    return new Promise((resolve) => {
      this.#wake = resolve;
      void change.then(resolve);
    });
  }

  /**
   * Holds the latest build once, narrowed only when a view at its own revision confirms selection took that
   * revision's inputs, and widened otherwise. Returns whether a build ended since the last capture.
   */
  #capture(): boolean {
    const query = this.#parts.builds.narrowing();
    const latest = latestEnded(query);
    if (latest === undefined) return false;
    if (latest === NARROWING.widened) {
      this.#hold(WIDENED_PLACEMENT);
      return false;
    }
    if (this.#seen.has(latest)) return false;
    this.#seen.add(latest);
    const view = this.#parts.view();
    const placement =
      view.facts.revision === latest.revision
        ? placementOf(view, query)
        : undefined;
    this.#hold(placement ?? WIDENED_PLACEMENT);
    return true;
  }

  #hold(placement: HeldPlacement): void {
    if (placement.kind === NARROWING.widened) {
      if (this.#heldWidened) return;
      this.#heldWidened = true;
    } else {
      if (this.#heldBuilds.has(placement.build)) return;
      this.#heldBuilds.add(placement.build);
    }
    this.#held.push(placement);
  }

  /** The check and the abort run with no await between them, so only the run judged is aborted. */
  #interruptIfWorthless(): void {
    const { isStopping, log, interrupt, entry } = this.#parts;
    if (this.#returned || this.#closed || isStopping()) return;
    if (this.#interruption !== undefined) return;
    const paths = interruptingPaths(this.#judgment(undefined));
    if (paths === undefined || !interrupt()) return;
    this.#interruptedBy = paths;
    const named = namedList(paths);
    this.#interruption = `${INTERRUPTED_REASON}: ${named}`;
    log.entry(
      `the run of ${entry.workspace.path} ${INTERRUPTION_ASKED}: ${named}`,
    );
  }

  #judgment(
    end: FingerprintResult | undefined,
    placements: readonly HeldPlacement[] = this.#held,
  ): RunJudgment {
    return judgeRun({
      workspacePath: this.#parts.entry.workspace.path,
      start: this.started,
      window: this.#parts.window,
      testModules: this.#testModules,
      placements,
      end,
    });
  }
}
