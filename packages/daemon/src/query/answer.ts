import type { Freshness, TestOutcome } from "@rt-test/core";
import type { DaemonActivity, UnstoredJob } from "../daemon/protocol.js";
import type { NothingRanReason, RunExecution } from "../vitest/run-states.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";

export const INTERRUPTED = "interrupted";
export const MODULE_NOT_RUN = "module-not-run";
export const MODULE_CRASHED = "module-crashed";
export const MODULE_FAILED_TO_LOAD = "module-failed-to-load";
export const RUN_FAILED = "run-failed";
export const RUN_UNSUPPORTED_VITEST = "run-unsupported-vitest";
export const RUN_INTERRUPTED_BEFORE_LOAD = "run-interrupted-before-load";
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

export const WORKSPACE_UNSUPPORTED_VITEST = "workspace-unsupported-vitest";
export const WORKSPACE_DISCOVERY_FAILED = "workspace-discovery-failed";
export const WORKSPACE_NOT_CONFIRMED = "workspace-not-confirmed";
export const FAILED_MODULE = "failed-module";
export const TYPECHECK_MODULE = "typecheck-module";
export const UNSUPPORTED_PROJECT = "unsupported-project";
export const SOURCE_NOT_READ = "source-not-read";

/** A reason cut to a bounded length; the full text stays in the store. */
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

export type LatestRunFacts = AdapterVersionFacts & {
  readonly runId: string;
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
    | { readonly status: Exclude<WorkspaceRun["status"], RanStatus> }
  );

export interface WorkspaceFacts {
  readonly workspacePath: string;
  /** Null when no run of the workspace is stored. */
  readonly latestRun: LatestRunFacts | null;
}

/** What every answer carries beside its counts. */
export interface AnswerContext {
  readonly consumerRoot: string;
  readonly currentAdapterVersion: number;
  readonly discovery: DiscoveryFacts;
  readonly inputs: InputFacts;
  /** Only those whose own inputs failed; `inputs` says when none can be computed. */
  readonly unfingerprintedWorkspaces: readonly UnfingerprintedWorkspace[];
  readonly activity: DaemonActivity;
  readonly unstoredJobs: readonly UnstoredJob[];
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

/** Why a query has no answer; the daemon sends it as its nothing-to-answer error. */
export interface NoAnswer {
  readonly noAnswer: string;
}
