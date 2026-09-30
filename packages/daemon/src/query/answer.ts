import type { Freshness, TestOutcome } from "@rt-test/core";
import type { DaemonActivity, UnstoredJob } from "../daemon/protocol.js";
import type {
  BroadFallback,
  ChainStep,
  ChangedPathReport,
  NotRunnableWorkspace,
  PathSelection,
  SelectionCounts,
  SelectionReason,
} from "../selection/selection-types.js";
import type { NothingRanReason, RunExecution } from "../vitest/run-states.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";

export const INTERRUPTED = "interrupted";
export const MODULE_NOT_RUN = "module-not-run";
export const MODULE_CRASHED = "module-crashed";
export const MODULE_FAILED_TO_LOAD = "module-failed-to-load";
export const RUN_FAILED = "run-failed";
export const RUN_UNSUPPORTED_VITEST = "run-unsupported-vitest";
export const RUN_INTERRUPTED_BEFORE_LOAD = "run-interrupted-before-load";
export const RUN_CRASHED = "run-crashed";
/** Its workspace's latest stored run was refused as unreadable. */
export const RUN_REFUSED = "run-refused";
export const NOT_IN_LATEST_RUN = "not-in-latest-run";
export const NEVER_RUN = "never-run";

/** A discovered test's one state, from its workspace's latest stored run: a finished test's outcome, or why it has none. */
export type TestState =
  | TestOutcome
  | typeof INTERRUPTED
  | typeof MODULE_NOT_RUN
  | typeof MODULE_CRASHED
  | typeof MODULE_FAILED_TO_LOAD
  | typeof RUN_FAILED
  | typeof RUN_UNSUPPORTED_VITEST
  | typeof RUN_INTERRUPTED_BEFORE_LOAD
  | typeof RUN_CRASHED
  | typeof RUN_REFUSED
  | typeof NOT_IN_LATEST_RUN
  | typeof NEVER_RUN;

const STATE_MEMBERS: Readonly<Record<TestState, true>> = {
  passed: true,
  failed: true,
  skipped: true,
  error: true,
  [INTERRUPTED]: true,
  [MODULE_NOT_RUN]: true,
  [MODULE_CRASHED]: true,
  [MODULE_FAILED_TO_LOAD]: true,
  [RUN_FAILED]: true,
  [RUN_UNSUPPORTED_VITEST]: true,
  [RUN_INTERRUPTED_BEFORE_LOAD]: true,
  [RUN_CRASHED]: true,
  [RUN_REFUSED]: true,
  [NOT_IN_LATEST_RUN]: true,
  [NEVER_RUN]: true,
};
/** Every state, in the order an answer lists them. */
export const TEST_STATES = Object.keys(STATE_MEMBERS) as TestState[];

export const CURRENT = "current" satisfies Freshness;
export const STALE = "stale" satisfies Freshness;
export const UNKNOWN = "unknown" satisfies Freshness;
const FRESHNESS_MEMBERS: Readonly<Record<Freshness, true>> = {
  [CURRENT]: true,
  [STALE]: true,
  [UNKNOWN]: true,
};
export const FRESHNESS_VALUES = Object.keys(FRESHNESS_MEMBERS) as Freshness[];

export type StateCounts = Readonly<Record<TestState, number>>;
export type FreshnessCounts = Readonly<Record<Freshness, number>>;

/** Every test of a set counted once by state and once by freshness, so each set of counts adds up to `tests`. */
export interface TestCounts {
  readonly tests: number;
  readonly states: StateCounts;
  readonly freshness: FreshnessCounts;
}

export interface AdapterVersionFacts {
  readonly adapterVersion: number;
  readonly adapterVersionCurrent: boolean;
}

export interface DiscoveryFacts extends AdapterVersionFacts {
  readonly discoveryId: string;
  /**
   * Stale when stored under another adapter version; otherwise current only when its stored digest equals the
   * discovery's current input fingerprint, as for a result.
   */
  readonly freshness: Freshness;
}

export const RECONCILIATION_COMPLETE = "complete";
export const RECONCILIATION_INCOMPLETE = "incomplete";
export const WATCHER_HEALTHY = "healthy";
export const WATCHER_UNHEALTHY = "unhealthy";

export type ReconciliationFacts =
  | { readonly state: typeof RECONCILIATION_COMPLETE }
  | {
      readonly state: typeof RECONCILIATION_INCOMPLETE;
      readonly reason: string;
    };

export type WatcherFacts =
  | { readonly state: typeof WATCHER_HEALTHY }
  | { readonly state: typeof WATCHER_UNHEALTHY; readonly reason: string };

/** The daemon's view of its inputs when it answered. */
export interface InputFacts {
  /** Rises each time an input is seen to change, by an event or a reconciliation. */
  readonly revision: number;
  readonly reconciliation: ReconciliationFacts;
  /** When the last reconciliation ended, as an ISO time; absent before the first one ends. */
  readonly lastReconciledAt?: string;
  readonly watcher: WatcherFacts;
  /** Paths an event named that the daemon has not yet read; while any remain, no result is current. */
  readonly pendingChanges: number;
  /**
   * What of git could not be read, and what that cost: its ignored paths, so every file there counted as an input,
   * or its HEAD and ignore-rule files, read or watched, so a branch change went unwatched. Empty when git was read in
   * full.
   */
  readonly gitUnread: readonly string[];
}

/** A workspace whose current input fingerprint cannot be computed, so none of its results reads current. */
export interface UnfingerprintedWorkspace {
  readonly workspacePath: string;
  readonly reason: string;
}

export const DEPENDENCY_BUILD_FAILED = "dependency-build-failed";
export const DEPENDENCY_BUILD_TIMED_OUT = "dependency-build-timed-out";
export const DEPENDENCY_BUILDS_ENDED = "dependency-builds-ended";
export const NO_SELECTION_INPUT = "no-selection-input";
export const SELECTION_REFUSED = "selection-refused";

/** How a dependency build ended with no dependency information. */
export type BuildFailureKind =
  typeof DEPENDENCY_BUILD_FAILED | typeof DEPENDENCY_BUILD_TIMED_OUT;

/**
 * Why no workspace's inputs are narrowed to those its selection includes: each is fingerprinted over the whole
 * project's inputs, or, while the build after a failed or timed-out one runs, has no fingerprint.
 */
export interface InputsNotNarrowed {
  readonly kind:
    | BuildFailureKind
    | typeof DEPENDENCY_BUILDS_ENDED
    | typeof NO_SELECTION_INPUT
    | typeof SELECTION_REFUSED;
  readonly reason: string;
}

export const NO_BUILD_ENDED = "no-build-ended";
export const INPUT_DIGESTS_UNREAD = "input-digests-unread";
export const FIRST_ROUND = "first-round";

/** Whether the latest round that planned made a selection, or no round has planned in this daemon life. */
export const ROUND_SELECTION = {
  made: "made",
  notMade: "not-made",
  noRoundYet: "no-round-yet",
} as const;

/** Why a round made no selection: the inputs were not narrowed, or it had no earlier inputs to compare with. */
export type NoRoundSelection =
  | InputsNotNarrowed["kind"]
  | typeof NO_BUILD_ENDED
  | typeof INPUT_DIGESTS_UNREAD
  | typeof FIRST_ROUND;

export const WORKSPACE_UNSUPPORTED_VITEST = "workspace-unsupported-vitest";
export const WORKSPACE_DISCOVERY_FAILED = "workspace-discovery-failed";
export const WORKSPACE_NOT_CONFIRMED = "workspace-not-confirmed";
export const WORKSPACE_UNHANDLED_ERRORS = "workspace-unhandled-errors";
export const FAILED_MODULE = "failed-module";
export const TYPECHECK_MODULE = "typecheck-module";
export const UNSUPPORTED_PROJECT = "unsupported-project";
export const SOURCE_NOT_READ = "source-not-read";

/** Why the scheduler finds a workspace due: its latest run is not bound to its current fingerprint, or it is retried. */
export const DUE_REASON = {
  noRun: "no-run",
  runRefused: "run-refused",
  anotherAdapterVersion: "another-adapter-version",
  notFingerprinted: "not-fingerprinted",
  noCurrentFingerprint: "no-current-fingerprint",
  inputsChanged: "inputs-changed",
  failedRun: "failed-run",
  crashedRun: "crashed-run",
} as const;

export type DueReason = (typeof DUE_REASON)[keyof typeof DUE_REASON];

/** A reason cut to a bounded length; the full text stays in the store or the daemon log. */
export interface CutReason {
  readonly reason: string;
  readonly omittedCharacters: number;
}

/** Something the latest discovery did not turn into tests, and why. */
export type NotDiscoveredEntry = CutReason &
  (
    | {
        readonly kind:
          | typeof WORKSPACE_UNSUPPORTED_VITEST
          | typeof WORKSPACE_DISCOVERY_FAILED
          | typeof WORKSPACE_NOT_CONFIRMED;
        readonly workspacePath: string;
      }
    | {
        /** A discovered workspace whose collection raised unhandled errors, so its listed tests may not be all it holds. */
        readonly kind: typeof WORKSPACE_UNHANDLED_ERRORS;
        readonly workspacePath: string;
        readonly errorCount: number;
      }
    | {
        readonly kind: typeof FAILED_MODULE;
        readonly workspacePath: string;
        readonly projectName: string;
        readonly modulePath: string;
        readonly errorCount: number;
      }
    | {
        readonly kind: typeof TYPECHECK_MODULE;
        readonly workspacePath: string;
        readonly projectName: string;
        readonly modulePath: string;
      }
    | {
        readonly kind: typeof UNSUPPORTED_PROJECT;
        readonly workspacePath: string;
        readonly projectName: string;
      }
    | { readonly kind: typeof SOURCE_NOT_READ; readonly source: string }
  );

type RanStatus = Extract<WorkspaceRun, { status: "ran" }>["status"];
type CrashedStatus = Extract<WorkspaceRun, { status: "crashed" }>["status"];

export type LatestRunFacts = AdapterVersionFacts & {
  readonly runId: string;
  /** Present when this daemon stored the run not fingerprinted because its inputs changed while it ran. */
  readonly invalidated?: CutReason;
} & (
    | {
        readonly status: RanStatus;
        readonly execution: RunExecution;
        readonly forceStopped: boolean;
        /** Null when at least one test was recorded passed or failed. */
        readonly nothingRan: NothingRanReason | null;
        readonly unhandledErrors: number;
        readonly moduleErrors: number;
      }
    | ({
        readonly status: CrashedStatus;
      } & CutReason)
    | {
        readonly status: Exclude<
          WorkspaceRun["status"],
          RanStatus | CrashedStatus
        >;
      }
  );

export type WorkspaceFacts = { readonly workspacePath: string } & (
  | { readonly latestRun: LatestRunFacts; readonly refusedRun?: never }
  | {
      /** No run of the workspace is stored, or the one stored last was refused. */
      readonly latestRun: null;
      /** Why the run stored last was refused as unreadable, present only then. */
      readonly refusedRun?: CutReason;
    }
);

/** Up to a bound of a list's items, and how many it leaves out. */
export interface NamedList<T> {
  readonly named: readonly T[];
  readonly more: number;
}

export const ROUND = {
  pending: "pending",
  planned: "planned",
  held: "held",
} as const;

/** What a pending round waits for before it plans. */
export const ROUND_WAIT = {
  firstReconciliation: "first-reconciliation",
  quietWindow: "quiet-window",
  inputsSettling: "inputs-settling",
  dependencyBuild: "dependency-build",
  rediscovery: "rediscovery",
  jobInProgress: "job-in-progress",
} as const;

export type RoundWait = (typeof ROUND_WAIT)[keyof typeof ROUND_WAIT];

/** The daemon's round: pending, planned at an input revision, or held after a failed step until the next input event or reconciliation. */
export type RoundFacts =
  | { readonly state: typeof ROUND.pending; readonly waitsFor: RoundWait }
  | { readonly state: typeof ROUND.planned; readonly revision: number }
  | { readonly state: typeof ROUND.held; readonly failure: CutReason };

export const EXECUTION_STATE = {
  running: "running",
  queued: "queued",
  interrupted: "interrupted",
  idle: "idle",
} as const;

/** A run stored not fingerprinted because its inputs changed while it ran. */
export const INVALIDATED = "invalidated";
/** A run stored not fingerprinted before this daemon started, whose reason it does not hold. */
export const EARLIER_DAEMON_LIFE = "earlier-daemon-life";

/** A due reason as an answer gives it: a run stored not fingerprinted reads invalidated or from an earlier daemon life when either holds. */
export type ScheduleDueReason =
  DueReason | typeof INVALIDATED | typeof EARLIER_DAEMON_LIFE;

export interface DueFacts {
  readonly kind: ScheduleDueReason;
  /** The verdict's reason, or why no current fingerprint can be computed. */
  readonly detail?: CutReason;
}

/** Why an idle workspace that is not current, or is due a retry, has no run begun. */
export const IDLE_REASON = {
  retryPending: "retry-pending",
  noRunUntilInputChange: "no-run-until-input-change",
  roundHeld: "round-held",
  selfChanging: "self-changing",
} as const;

export type IdleReason = (typeof IDLE_REASON)[keyof typeof IDLE_REASON];

export type NotSelfChangingReason = Exclude<
  IdleReason,
  typeof IDLE_REASON.selfChanging
>;

/** A path the daemon's own runs and discoveries changed each time a held workspace or the held discovery became due. */
export interface SelfChangedPath {
  readonly path: string;
  /** Each job it changed during: the run of a workspace, or the discovery, which names none. */
  readonly jobs: NamedList<Pick<UnstoredJob, "workspacePath">>;
}

/** A reason a round's selection chose a workspace, with the broad fallback's scope when it was one. */
export type ChoosingReason = Pick<SelectionReason, "path" | "trigger"> &
  Partial<Pick<BroadFallback, "scope">>;

/** One confirmed workspace's execution state, which changes none of its outcome or freshness counts. */
export type WorkspaceExecution = { readonly workspacePath: string } & (
  | { readonly state: typeof EXECUTION_STATE.running }
  | {
      readonly state: typeof EXECUTION_STATE.queued;
      readonly due: DueFacts;
      readonly chosenBy: NamedList<ChoosingReason>;
      /** The changed paths inside its inputs that interrupted its last run. */
      readonly interruptedBy?: NamedList<string>;
    }
  | {
      readonly state: typeof EXECUTION_STATE.interrupted;
      readonly interruptedBy: NamedList<string>;
    }
  | {
      readonly state: typeof EXECUTION_STATE.idle;
      /** Present while no round is pending and the workspace is not current or is due a retry. */
      readonly notRunning?:
        | {
            readonly why: typeof IDLE_REASON.selfChanging;
            readonly due: DueFacts;
            /** The paths that changed each time it became due. */
            readonly selfChanged: NamedList<SelfChangedPath>;
          }
        | {
            readonly why: NotSelfChangingReason;
            readonly due: DueFacts;
            readonly selfChanged?: never;
          };
    }
);

export interface ScheduleFacts {
  readonly round: RoundFacts;
  /** Each confirmed workspace the discovery in effect lists. */
  readonly workspaces: readonly WorkspaceExecution[];
  /**
   * Present while the discovery is held and no round is pending: the paths that changed each time it became due. No
   * rediscovery begins until an edit or a change the daemon cannot attribute, which changes no freshness or count.
   */
  readonly selfChangingDiscovery?: NamedList<SelfChangedPath>;
}

type ExplainedNotRunnable = Omit<NotRunnableWorkspace, "reason"> & CutReason;

type ExplainedStep = Omit<ChainStep, "detail"> & { readonly detail: CutReason };

type ExplainedReason = Omit<SelectionReason, "steps"> & {
  readonly steps: readonly ExplainedStep[];
};

type ExplainedSelection = Omit<PathSelection, "reasons"> & {
  readonly reasons: readonly ExplainedReason[];
};

/** A changed path's selection as an answer carries it: each list bounded, each free-text reason and detail cut. */
export type ExplainedPath = Omit<
  ChangedPathReport,
  "selected" | "notRunnable" | "nothingSelected"
> & {
  readonly selected: NamedList<ExplainedSelection>;
  readonly notRunnable: NamedList<ExplainedNotRunnable>;
  readonly nothingSelected:
    | {
        readonly kind: NonNullable<
          ChangedPathReport["nothingSelected"]
        >["kind"];
        readonly detail: CutReason;
      }
    | undefined;
};

export type ExplainedFallback = Omit<BroadFallback, "workspaces"> & {
  readonly workspaces: NamedList<string>;
};

/** The selection the latest round that planned made, why it made none, or that no round has planned yet. */
export type SelectionExplanation =
  | { readonly state: typeof ROUND_SELECTION.noRoundYet }
  | {
      readonly state: typeof ROUND_SELECTION.made;
      readonly revision: number;
      readonly paths: NamedList<ExplainedPath>;
      readonly fallbacks: NamedList<ExplainedFallback>;
      readonly counts: SelectionCounts;
    }
  | {
      readonly state: typeof ROUND_SELECTION.notMade;
      readonly revision: number;
      readonly kind: NoRoundSelection;
      readonly reason: CutReason;
    };

/** What every answer carries beside its counts. */
export interface AnswerContext {
  readonly consumerRoot: string;
  readonly currentAdapterVersion: number;
  readonly discovery: DiscoveryFacts;
  readonly inputs: InputFacts;
  /**
   * Each discovered workspace with no fingerprint while one can be computed for the project: its own inputs could not
   * be read, or the dependency build its inputs wait for has not ended. `inputs` says when none can be computed.
   */
  readonly unfingerprintedWorkspaces: readonly UnfingerprintedWorkspace[];
  /** Why every file stays an input, present only while the daemon's `rt-test.json` cannot be used. */
  readonly nonInputsUnusable?: string;
  /**
   * Why no workspace's inputs are narrowed, absent while they are. Selection refusing an input's path is known only
   * while a fingerprint can be computed.
   */
  readonly inputsNotNarrowed?: InputsNotNarrowed;
  readonly activity: DaemonActivity;
  readonly unstoredJobs: readonly UnstoredJob[];
  /** The daemon's round and what it is doing with each confirmed workspace; `running` follows `activity`. */
  readonly schedule: ScheduleFacts;
  readonly latestSelection: SelectionExplanation;
}

export interface SummaryAnswer extends AnswerContext {
  readonly counts: TestCounts;
  readonly duplicateTests: number;
  readonly notDiscovered: readonly NotDiscoveredEntry[];
  readonly workspaces: readonly WorkspaceFacts[];
}

export const FILE_PATH = "file";
export const FOLDER_PATH = "folder";

export interface FileCounts {
  /** Relative to the consumer root, `/`-separated. */
  readonly file: string;
  readonly counts: TestCounts;
}

export interface PathStatusAnswer extends AnswerContext {
  /** Relative to the consumer root, `/`-separated, `.` for the root. */
  readonly path: string;
  readonly pathKind: typeof FILE_PATH | typeof FOLDER_PATH;
  readonly counts: TestCounts;
  /** One entry per test file under a folder; empty for a file. */
  readonly files: readonly FileCounts[];
  readonly notDiscovered: readonly NotDiscoveredEntry[];
  /** Workspace, project and source entries above the path, each leaving part of what lies under it undiscovered. */
  readonly enclosingNotDiscovered: readonly NotDiscoveredEntry[];
}

export function activityText(activity: DaemonActivity): string {
  switch (activity.state) {
    case "discovering":
      return "discovering tests";
    case "running":
      return `running workspace ${activity.workspacePath}`;
    case "idle":
      return "idle";
  }
}

const ROUND_WAIT_TEXT: Readonly<Record<RoundWait, string>> = {
  [ROUND_WAIT.firstReconciliation]: "the first reconciliation of the inputs",
  [ROUND_WAIT.quietWindow]: "the input revision to hold still",
  [ROUND_WAIT.inputsSettling]: "the input events seen so far to be read",
  [ROUND_WAIT.dependencyBuild]: "the dependency build at the input revision",
  [ROUND_WAIT.rediscovery]: "a rediscovery",
  [ROUND_WAIT.jobInProgress]:
    "the job in progress, begun at an earlier input revision",
};

/** The daemon's round, one phrasing for its reasons and the CLI's text. */
export function roundText(round: RoundFacts): string {
  switch (round.state) {
    case ROUND.pending:
      return `a round is pending, waiting for ${ROUND_WAIT_TEXT[round.waitsFor]}`;
    case ROUND.planned:
      return `the round was planned at input revision ${round.revision}`;
    case ROUND.held:
      return `a scheduling step failed, so the daemon tries again at the next input event or reconciliation: ${round.failure.reason}${omittedText(round.failure.omittedCharacters)}`;
  }
}

/** Says where the rest of a reason cut from an answer is; empty when nothing was cut. */
export function omittedText(omittedCharacters: number): string {
  return omittedCharacters === 0
    ? ""
    : ` (${omittedCharacters} more characters are in the daemon log)`;
}

/** Why a query has no answer; the daemon sends it as its nothing-to-answer error. */
export interface NoAnswer {
  readonly noAnswer: string;
}
