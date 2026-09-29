import { errorText } from "./error-text.js";
import type { VitestWorkspace } from "./find-workspaces.js";
import type { ModuleReport } from "./module-tests.js";
import { RunInterruption } from "./run-interruption.js";
import {
  notRunModules,
  nothingRanReason,
  recordModules,
  type NothingRanReason,
  type RecordedModule,
  type RunExecution,
} from "./run-states.js";
import {
  inWorkspaceSession,
  queueSessionJob,
  type UnsupportedProject,
  type UnsupportedVitest,
  type WorkspaceSession,
} from "./workspace-session.js";

export type WorkspaceRun =
  | {
      readonly status: "ran";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly execution: RunExecution;
      readonly modules: readonly RecordedModule[];
      readonly typecheckModules: readonly ModuleReport[];
      readonly unsupportedProjects: readonly UnsupportedProject[];
      readonly unhandledErrors: readonly string[];
      /** Present exactly when no test was recorded passed or failed. */
      readonly nothingRan?: NothingRanReason;
      /** Whether the second cancel, which force-stops Vitest's workers and skips the project's `afterAll` hooks and teardown, was issued before the run ended. */
      readonly forceStopped: boolean;
      readonly cancelError?: string;
      readonly closeError?: string;
    }
  | {
      readonly status: "unsupported";
      readonly workspace: VitestWorkspace;
      readonly vitest: UnsupportedVitest;
    }
  | {
      readonly status: "failed";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly error: string;
      readonly closeError?: string;
    }
  | {
      /** The signal aborted before the run's turn came, so the workspace was never loaded. */
      readonly status: "interrupted-before-load";
      readonly workspace: VitestWorkspace;
    }
  | {
      /** The run's executor process ended during the run with no stop asked of it, so the run left no result. */
      readonly status: "crashed";
      readonly workspace: VitestWorkspace;
      /** How the process ended. */
      readonly error: string;
    };

/** A run that loaded nothing because its workspace no longer matched the start the user confirmed; it is never stored. */
export interface NotConfirmedRun {
  readonly status: "not-confirmed";
  readonly workspace: VitestWorkspace;
  readonly reason: string;
}

type RanWorkspace = Omit<
  Extract<WorkspaceRun, { status: "ran" }>,
  "status" | "workspace" | "vitestVersion" | "closeError"
>;

export const CONFIG_NOT_CONFIRMED_REASON =
  "its config file is no longer the one confirmed at start";

/** Runs the workspace's tests through its confirmed config file, so it executes project code: call only for a started, trusted project. */
export function runWorkspace(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  signal: AbortSignal,
): Promise<WorkspaceRun | NotConfirmedRun> {
  return queueSessionJob(async () => {
    if (signal.aborted) {
      return { status: "interrupted-before-load", workspace };
    }
    const interruption = new RunInterruption(signal);
    const result = await inWorkspaceSession(
      workspace,
      confirmedConfigFile,
      [interruption],
      (session) => runSession(session, interruption),
    );
    if (result.status === "not-confirmed") {
      return { ...result, workspace, reason: CONFIG_NOT_CONFIRMED_REASON };
    }
    if (result.status !== "loaded") return { ...result, workspace };
    const { value, ...loaded } = result;
    return { ...loaded, status: "ran", workspace, ...value };
  });
}

async function runSession(
  session: WorkspaceSession,
  interruption: RunInterruption,
): Promise<RanWorkspace> {
  const { instance, specifications, locate } = session;
  const shared = {
    typecheckModules: session.typecheckModules,
    unsupportedProjects: session.unsupportedProjects,
  };
  if (interruption.signal.aborted) {
    const modules = notRunModules(specifications, locate);
    return {
      ...shared,
      execution: "interrupted",
      modules,
      unhandledErrors: [],
      forceStopped: false,
      ...nothingRan("interrupted", modules),
    };
  }
  if (specifications.length === 0) {
    return {
      ...shared,
      execution: "completed",
      modules: [],
      unhandledErrors: [],
      forceStopped: false,
      ...nothingRan("completed", []),
    };
  }
  const { testModules, unhandledErrors } = await interruption.duringRun(
    instance,
    () => instance.runTestSpecifications(specifications),
  );
  const execution = interruption.execution();
  const modules = recordModules({
    execution,
    specifications,
    testModules,
    locate,
  });
  const cancelError = await interruption.cancelError();
  return {
    ...shared,
    execution,
    modules,
    unhandledErrors: unhandledErrors.map(errorText),
    ...nothingRan(execution, modules),
    forceStopped: interruption.forceStopped(),
    ...(cancelError === undefined ? {} : { cancelError }),
  };
}

function nothingRan(
  execution: RunExecution,
  modules: readonly RecordedModule[],
): { nothingRan?: NothingRanReason } {
  const reason = nothingRanReason(execution, modules);
  return reason === undefined ? {} : { nothingRan: reason };
}
