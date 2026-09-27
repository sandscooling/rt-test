import { FORCE_STOP_GRACE_MS } from "../vitest/force-stop.js";
import type { ConfirmedStart } from "../vitest/confirmed-start.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import type { NotConfirmedRun, WorkspaceRun } from "../vitest/run-workspace.js";

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
  | { readonly type: "abort" };

/** Executor to daemon: one per job. */
export type ExecutorReply =
  | { readonly type: "discovered"; readonly discovery: TestDiscovery }
  | { readonly type: "ran"; readonly run: WorkspaceRun | NotConfirmedRun }
  | { readonly type: "job-failed"; readonly error: string };
