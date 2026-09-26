import type { IdentifiedTest } from "@rt-test/core";
import type { TestCase, TestModule } from "vitest/node";
import { errorText } from "./error-text.js";
import {
  findVitestWorkspaces,
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
    };

export interface TestDiscovery {
  readonly workspaces: readonly WorkspaceDiscovery[];
  readonly notRead: readonly UnreadWorkspaceSource[];
}

interface CollectedWorkspace {
  readonly tests: DiscoveredTest[];
  readonly failedModules: FailedModule[];
  readonly typecheckModules: readonly ModuleReport[];
  readonly unsupportedProjects: readonly UnsupportedProject[];
  readonly unhandledErrors: readonly string[];
}

const UNCOLLECTED_MODULE_ERROR =
  "Vitest returned no collection result for this module; see the workspace's unhandled errors";

/** Loads each workspace's Vitest config and imports its test files: call only for a started, trusted project. */
export function discoverTests(consumerRoot: string): Promise<TestDiscovery> {
  return queueSessionJob(() => discoverAll(consumerRoot));
}

async function discoverAll(consumerRoot: string): Promise<TestDiscovery> {
  const { workspaces, notRead } = findVitestWorkspaces(consumerRoot);
  const discoveries: WorkspaceDiscovery[] = [];
  for (const workspace of workspaces) {
    discoveries.push(await discoverWorkspace(workspace));
  }
  return { workspaces: discoveries, notRead };
}

async function discoverWorkspace(
  workspace: VitestWorkspace,
): Promise<WorkspaceDiscovery> {
  const result = await inWorkspaceSession(workspace, [], collectWorkspace);
  if (result.status !== "loaded") return { ...result, workspace };
  const { value, ...loaded } = result;
  return { ...loaded, status: "discovered", workspace, ...value };
}

async function collectWorkspace(
  session: WorkspaceSession,
): Promise<CollectedWorkspace> {
  const { instance, specifications } = session;
  const { testModules, unhandledErrors } =
    specifications.length === 0
      ? { testModules: [], unhandledErrors: [] }
      : await instance.collectTests(specifications);
  const report = {
    tests: [] as DiscoveredTest[],
    failedModules: [] as FailedModule[],
    typecheckModules: session.typecheckModules,
    unsupportedProjects: session.unsupportedProjects,
    unhandledErrors: unhandledErrors.map(errorText),
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
