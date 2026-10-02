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
import { runLists, type ModuleTests } from "./test-lists.js";
import {
  inWorkspaceSession,
  queueSessionJob,
  type UnsupportedProject,
  type UnsupportedVitest,
  type WorkspaceSession,
} from "./workspace-session.js";

/** A run `runWorkspace` ended with, whatever the workspace's Vitest did. */
export type VitestRun =
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
    };

/** A stored run: one `runWorkspace` ended with, or one the daemon's executor recorded when its process ended mid-run. */
export type WorkspaceRun =
  | VitestRun
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
  Extract<VitestRun, { status: "ran" }>,
  "status" | "workspace" | "vitestVersion" | "closeError"
>;

/** A run, with each test module it ran as a discovery lists one; they travel beside the run, whose record keeps no test's declared mode. */
export interface ListedRun {
  readonly run: VitestRun | NotConfirmedRun;
  readonly lists: readonly ModuleTests[];
}

export const CONFIG_NOT_CONFIRMED_REASON =
  "its config file is no longer the one confirmed at start";
const NO_LISTS: readonly ModuleTests[] = [];

/** Runs the workspace's tests through its confirmed config file, so it executes project code: call only for a started, trusted project. */
export function runWorkspace(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  signal: AbortSignal,
): Promise<VitestRun | NotConfirmedRun> {
  return runWorkspaceListing(workspace, confirmedConfigFile, signal).then(
    ({ run }) => run,
  );
}

/** Runs as `runWorkspace` does, and also hands back the test lists the run collected. */
export function runWorkspaceListing(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  signal: AbortSignal,
): Promise<ListedRun> {
  return queueSessionJob(async () => {
    if (signal.aborted) {
      return {
        run: { status: "interrupted-before-load", workspace },
        lists: NO_LISTS,
      };
    }
    const interruption = new RunInterruption(signal);
    const result = await inWorkspaceSession(
      workspace,
      confirmedConfigFile,
      [interruption],
      (session) => runSession(session, interruption),
    );
    if (result.status === "not-confirmed") {
      return {
        run: { ...result, workspace, reason: CONFIG_NOT_CONFIRMED_REASON },
        lists: NO_LISTS,
      };
    }
    if (result.status !== "loaded") {
      return { run: { ...result, workspace }, lists: NO_LISTS };
    }
    const { value, ...loaded } = result;
    const { lists, ...ran } = value;
    return { run: { ...loaded, status: "ran", workspace, ...ran }, lists };
  });
}

async function runSession(
  session: WorkspaceSession,
  interruption: RunInterruption,
): Promise<RanWorkspace & { readonly lists: readonly ModuleTests[] }> {
  const { instance, specifications, locate } = session;
  const shared = {
    typecheckModules: session.typecheckModules,
    unsupportedProjects: session.unsupportedProjects,
    lists: NO_LISTS,
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
    lists: runLists(testModules, modules, locate),
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
