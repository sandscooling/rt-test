import { FORCE_STOP_GRACE_MS } from "../vitest/force-stop.js";
import type { ConfirmedStart } from "../vitest/confirmed-start.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";
import type {
  DependencyInformation,
  SelectableWorkspace,
} from "../selection/selection-types.js";

/** Covers Vitest's force-stop and its close, which took about 10 ms once forced. */
const EXECUTOR_MARGIN_MS = 5_000;
/** How long a job may take to end after its abort before the executor process is ended. */
export const EXECUTOR_BOUND_MS = FORCE_STOP_GRACE_MS + EXECUTOR_MARGIN_MS;

/** Daemon to executor. */
export type ExecutorRequest =
  | { readonly type: "discover"; readonly start: ConfirmedStart }
  | {
      readonly type: "run";
      readonly workspace: VitestWorkspace;
      readonly configFile: string;
    }
  | {
      readonly type: "build-dependencies";
      /** As discovery was given it, so package and Vitest workspace directories are spelled alike. */
      readonly consumerRoot: string;
      readonly workspaces: readonly SelectableWorkspace[];
      /** Absolute; the build keeps the root-relative label of the file it is parsing there. */
      readonly parseRecord: string;
    }
  | { readonly type: "abort" };

export type ExecutorJob = Exclude<ExecutorRequest, { type: "abort" }>;

/** Executor to daemon: one per job. */
export type ExecutorReply =
  | { readonly type: "discovered"; readonly discovery: TestDiscovery }
  | { readonly type: "ran"; readonly run: WorkspaceRun | NotConfirmedRun }
  | {
      readonly type: "dependencies-built";
      readonly dependencies: DependencyInformation;
    }
  | { readonly type: "job-failed"; readonly error: string };
