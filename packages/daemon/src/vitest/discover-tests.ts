import type { IdentifiedTest } from "@rt-test/core";
import { join, resolve } from "node:path";
import type { TestCase, TestModule } from "vitest/node";
import { confirmedEntry, type ConfirmedStart } from "./confirmed-start.js";
import { errorText } from "./error-text.js";
import {
  findVitestWorkspaces,
  liesInside,
  type NotCoveredWorkspace,
  type UnreadWorkspaceSource,
  type VitestWorkspace,
} from "./find-workspaces.js";
import {
  identifyTests,
  moduleReport,
  specificationsWithoutModule,
  wasCollected,
  type FailedModule,
  type ModuleReport,
} from "./module-tests.js";
import { RunInterruption } from "./run-interruption.js";
import { selectionFacts, type SelectionFacts } from "./selection-facts.js";
import {
  inWorkspaceSession,
  queueSessionJob,
  type UnsupportedProject,
  type UnsupportedVitest,
  type WorkspaceSession,
} from "./workspace-session.js";

export interface DiscoveredTest extends IdentifiedTest {
  readonly mode: TestCase["options"]["mode"];
}

export type WorkspaceDiscovery =
  | {
      readonly status: "discovered";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly tests: readonly DiscoveredTest[];
      readonly failedModules: readonly FailedModule[];
      readonly typecheckModules: readonly ModuleReport[];
      readonly unsupportedProjects: readonly UnsupportedProject[];
      readonly unhandledErrors: readonly string[];
      readonly selectionFacts: SelectionFacts;
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
      /** Not in the confirmed start, or its config file is not the one confirmed, so nothing was loaded. */
      readonly status: "not-confirmed";
      readonly workspace: VitestWorkspace;
      readonly reason: string;
    };

export interface TestDiscovery {
  readonly workspaces: readonly WorkspaceDiscovery[];
  readonly notRead: readonly UnreadWorkspaceSource[];
  /** Absent on a discovery stored before the store kept it, which reads as never reported. */
  readonly notCovered?: readonly NotCoveredWorkspace[];
}

interface CollectedWorkspace {
  readonly tests: DiscoveredTest[];
  readonly failedModules: FailedModule[];
  readonly typecheckModules: readonly ModuleReport[];
  readonly unsupportedProjects: readonly UnsupportedProject[];
  readonly unhandledErrors: readonly string[];
  readonly selectionFacts: SelectionFacts;
}

const UNCOLLECTED_MODULE_ERROR =
  "Vitest returned no collection result for this module; see the workspace's unhandled errors";
export const NOT_CONFIRMED_REASON = "not confirmed at start";

/**
 * Loads the Vitest config and imports the test files of each workspace the start confirmed, and of no other: call
 * only for a started, trusted project. Once the signal aborts it loads no further workspace and rejects with the
 * signal's reason, after the Vitest instance it opened has closed and the host is restored.
 */
export function discoverTests(
  start: ConfirmedStart,
  signal: AbortSignal,
): Promise<TestDiscovery> {
  return queueSessionJob(() => discoverAll(start, signal));
}

async function discoverAll(
  start: ConfirmedStart,
  signal: AbortSignal,
): Promise<TestDiscovery> {
  signal.throwIfAborted();
  const { workspaces, notRead, notCovered } = findVitestWorkspaces(
    start.consumerRoot,
  );
  const discoveries: WorkspaceDiscovery[] = [];
  for (const workspace of workspaces) {
    const confirmed = confirmedEntry(start, workspace);
    discoveries.push(
      confirmed === undefined
        ? notConfirmed(workspace)
        : await discoverWorkspace(workspace, confirmed.configFile, signal),
    );
    signal.throwIfAborted();
  }
  return {
    workspaces: discoveries,
    notRead,
    notCovered: withoutDiscoveredModules(
      notCovered,
      start.consumerRoot,
      discoveries,
    ),
  };
}

/** A test module discovered inside a candidate means another workspace's config runs its tests, so it is covered. */
function withoutDiscoveredModules(
  candidates: readonly NotCoveredWorkspace[],
  consumerRoot: string,
  discoveries: readonly WorkspaceDiscovery[],
): NotCoveredWorkspace[] {
  const moduleFiles = discoveries.flatMap(discoveredModuleFiles);
  return candidates.filter((candidate) => {
    const directory = join(consumerRoot, candidate.path);
    return !moduleFiles.some((file) => liesInside(directory, file));
  });
}

function discoveredModuleFiles(entry: WorkspaceDiscovery): string[] {
  if (entry.status !== "discovered") return [];
  return [
    ...entry.tests.map((test) => test.identity.modulePath),
    ...entry.failedModules.map((module) => module.modulePath),
  ].map((modulePath) => resolve(entry.workspace.directory, modulePath));
}

function notConfirmed(workspace: VitestWorkspace): WorkspaceDiscovery {
  return { status: "not-confirmed", workspace, reason: NOT_CONFIRMED_REASON };
}

async function discoverWorkspace(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  signal: AbortSignal,
): Promise<WorkspaceDiscovery> {
  const result = await inWorkspaceSession(
    workspace,
    confirmedConfigFile,
    [],
    (session) => collectWorkspace(session, new RunInterruption(signal)),
  );
  if (result.status === "not-confirmed") return notConfirmed(workspace);
  if (result.status !== "loaded") return { ...result, workspace };
  const { value, ...loaded } = result;
  return { ...loaded, status: "discovered", workspace, ...value };
}

/**
 * An abort before collection starts, or during the walk for each project's crawled links after it, fails the step,
 * and the caller rejects once the session has closed.
 */
async function collectWorkspace(
  session: WorkspaceSession,
  interruption: RunInterruption,
): Promise<CollectedWorkspace> {
  const { instance, specifications } = session;
  interruption.signal.throwIfAborted();
  const { testModules, unhandledErrors } =
    specifications.length === 0
      ? { testModules: [], unhandledErrors: [] }
      : await interruption.duringCollect(instance, () =>
          instance.collectTests(specifications),
        );
  const report = {
    tests: [] as DiscoveredTest[],
    failedModules: [] as FailedModule[],
    typecheckModules: session.typecheckModules,
    unsupportedProjects: session.unsupportedProjects,
    unhandledErrors: unhandledErrors.map(errorText),
    selectionFacts: await selectionFacts(session, interruption.signal),
  };
  for (const testModule of testModules) {
    sortModule(testModule, session, report);
  }
  report.failedModules.push(
    ...specificationsWithoutModule(specifications, testModules).map(
      (specification) => ({
        ...moduleReport(
          session.locate(specification.project.name, specification.moduleId),
        ),
        errors: [UNCOLLECTED_MODULE_ERROR],
      }),
    ),
  );
  return report;
}

function sortModule(
  testModule: TestModule,
  session: WorkspaceSession,
  report: { tests: DiscoveredTest[]; failedModules: FailedModule[] },
): void {
  const location = session.locate(testModule.project.name, testModule.moduleId);
  const errors = testModule.errors();
  if (errors.length > 0) {
    report.failedModules.push({
      ...moduleReport(location),
      errors: errors.map(errorText),
    });
    return;
  }
  if (!wasCollected(testModule)) {
    report.failedModules.push({
      ...moduleReport(location),
      errors: [UNCOLLECTED_MODULE_ERROR],
    });
    return;
  }
  for (const { test, identified } of identifyTests(location, testModule)) {
    report.tests.push({ ...identified, mode: test.options.mode });
  }
}
