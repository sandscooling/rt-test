import type { Reporter, TestRunEndReason, Vitest } from "vitest/node";
import { errorText } from "./error-text.js";
import type { VitestWorkspace } from "./find-workspaces.js";
import type { ModuleReport } from "./module-tests.js";
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

type RanWorkspace = Omit<
  Extract<WorkspaceRun, { status: "ran" }>,
  "status" | "workspace" | "vitestVersion" | "closeError"
>;

/** The reason Vitest's own CLI gives a user-initiated cancel; `test-failure` is its `bail`. */
const INTERRUPT_REASON: Parameters<Vitest["cancelCurrentRun"]>[0] =
  "keyboard-input";
const INTERRUPTED_END_REASON: TestRunEndReason = "interrupted";

/** Runs the workspace's tests, so it executes project code: call only for a started, trusted project. */
export function runWorkspace(
  workspace: VitestWorkspace,
  signal: AbortSignal,
): Promise<WorkspaceRun> {
  return queueSessionJob(async () => {
    if (signal.aborted) {
      return { status: "interrupted-before-load", workspace };
    }
    const interruption = new RunInterruption(signal);
    const result = await inWorkspaceSession(
      workspace,
      [interruption],
      (session) => runSession(session, interruption),
    );
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
      ...nothingRan("interrupted", modules),
    };
  }
  if (specifications.length === 0) {
    return {
      ...shared,
      execution: "completed",
      modules: [],
      unhandledErrors: [],
      ...nothingRan("completed", []),
    };
  }
  const { testModules, unhandledErrors } = await interruption.during(
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

/**
 * Vitest resets its cancel state as a run starts and drops a cancel issued before that, so an abort that arrives
 * before the first module is queued is issued at that point. A second cancel would make Vitest force-stop its
 * workers and skip the project's teardown, so at most one is issued.
 */
class RunInterruption implements Reporter {
  readonly signal: AbortSignal;
  private instance: Vitest | undefined;
  private queued = false;
  private cancelled: Promise<string | undefined> | undefined;
  private abortedDuringRun = false;
  private endReason: TestRunEndReason | undefined;

  constructor(signal: AbortSignal) {
    this.signal = signal;
  }

  async during<T>(instance: Vitest, run: () => Promise<T>): Promise<T> {
    this.instance = instance;
    const onAbort = (): void => {
      if (this.endReason === undefined) this.abortedDuringRun = true;
      if (this.queued) this.cancel();
    };
    this.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await run();
    } finally {
      this.signal.removeEventListener("abort", onAbort);
      this.instance = undefined;
    }
  }

  onTestModuleQueued(): void {
    if (this.queued) return;
    this.queued = true;
    if (this.signal.aborted) this.cancel();
  }

  onTestRunEnd(
    _testModules: unknown,
    _unhandledErrors: unknown,
    reason: TestRunEndReason,
  ): void {
    this.endReason = reason;
  }

  /**
   * Vitest ends a run it cancelled, for this signal or the consumer's `bail`, with reason `interrupted`. A run in
   * which Vitest never queued a module ends without the withheld cancel ever being issued.
   */
  execution(): RunExecution {
    const withheldAbort = this.abortedDuringRun && this.cancelled === undefined;
    return this.endReason === INTERRUPTED_END_REASON || withheldAbort
      ? "interrupted"
      : "completed";
  }

  cancelError(): Promise<string | undefined> {
    return this.cancelled ?? Promise.resolve(undefined);
  }

  /** `cancelCurrentRun` waits for the run, so a reporter hook that awaited it would never return. */
  private cancel(): void {
    if (this.instance === undefined || this.cancelled !== undefined) return;
    this.cancelled = this.instance
      .cancelCurrentRun(INTERRUPT_REASON)
      .then(() => undefined, errorText);
  }
}
