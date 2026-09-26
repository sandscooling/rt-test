import { realpathSync } from "node:fs";
import { identifyModuleTests } from "@rt-test/core";
import type { IdentifiedTest, TestModuleLocation } from "@rt-test/core";
import type {
  TestCase,
  TestModule,
  TestProject,
  TestSpecification,
  Vitest,
} from "vitest/node";
import { errorText } from "./error-text.js";
import {
  findVitestWorkspaces,
  relativePosixPath,
  type UnreadWorkspaceSource,
  type VitestWorkspace,
} from "./find-workspaces.js";
import {
  importVitestNode,
  resolveWorkspaceVitest,
  type ResolvedVitest,
} from "./load-vitest.js";

export interface DiscoveredTest extends IdentifiedTest {
  readonly mode: TestCase["options"]["mode"];
}

export interface ModuleReport {
  readonly projectName: string;
  readonly modulePath: string;
}

export interface FailedModule extends ModuleReport {
  readonly errors: readonly string[];
}

export interface UnsupportedProject {
  readonly projectName: string;
  readonly reason: string;
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
      readonly vitest: Extract<ResolvedVitest, { supported: false }>;
    }
  | {
      readonly status: "failed";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly error: string;
      readonly closeError?: string;
    };

type LoadedDiscovery = Exclude<WorkspaceDiscovery, { status: "unsupported" }>;

export interface TestDiscovery {
  readonly workspaces: readonly WorkspaceDiscovery[];
  readonly notRead: readonly UnreadWorkspaceSource[];
}

const BROWSER_MODE_REASON = "browser mode is not supported";
/** The Vitest CLI sets this before loading a config and `createVitest` does not, so collection would see Vite's `development`. */
const TEST_NODE_ENV = "test";
const PLACEHOLDER_MODULE_MODE = "queued";
const UNCOLLECTED_MODULE_ERROR =
  "Vitest returned no collection result for this module; see the workspace's unhandled errors";

let discoveryQueue: Promise<unknown> = Promise.resolve();

/** Loads each workspace's Vitest config and imports its test files: call only for a started, trusted project. */
export function discoverTests(consumerRoot: string): Promise<TestDiscovery> {
  const discovery = discoveryQueue.then(() => discoverAll(consumerRoot));
  discoveryQueue = discovery.catch(() => undefined);
  return discovery;
}

/** Restoring the host env and exit code after each workspace is only sound while one discovery runs at a time. */
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
  const vitest = resolveWorkspaceVitest(workspace.directory);
  if (!vitest.supported) return { status: "unsupported", workspace, vitest };
  const restoreHost = captureHostState();
  process.env["NODE_ENV"] ??= TEST_NODE_ENV;
  let instance: Vitest | undefined;
  let discovery: LoadedDiscovery;
  try {
    const { createVitest } = await importVitestNode(vitest);
    instance = await createVitest("test", {
      root: workspace.directory,
      watch: false,
      reporters: [],
      api: false,
      ui: false,
    });
    discovery = await collectWorkspace(instance, workspace, vitest.version);
  } catch (error) {
    discovery = {
      status: "failed",
      workspace,
      vitestVersion: vitest.version,
      error: errorText(error),
    };
  }
  const closeError = await closeInstance(instance);
  restoreHost();
  return closeError === undefined ? discovery : { ...discovery, closeError };
}

/** Vitest writes a workspace's env and defines into `process.env` and sets `process.exitCode`. */
function captureHostState(): () => void {
  const exitCode = process.exitCode;
  const env = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(env, key)) delete process.env[key];
    }
    Object.assign(process.env, env);
    process.exitCode = exitCode;
  };
}

async function closeInstance(
  instance: Vitest | undefined,
): Promise<string | undefined> {
  try {
    await instance?.close();
    return undefined;
  } catch (error) {
    return errorText(error);
  }
}

async function collectWorkspace(
  instance: Vitest,
  workspace: VitestWorkspace,
  vitestVersion: string,
): Promise<LoadedDiscovery> {
  const browserProjects = instance.projects.filter(usesBrowserMode);
  const specifications = (
    await instance.getRelevantTestSpecifications()
  ).filter(
    (specification: TestSpecification) =>
      !usesBrowserMode(specification.project),
  );
  const { testModules, unhandledErrors } =
    specifications.length === 0
      ? { testModules: [], unhandledErrors: [] }
      : await instance.collectTests(specifications);
  const report = {
    status: "discovered" as const,
    workspace,
    vitestVersion,
    tests: [] as DiscoveredTest[],
    failedModules: [] as FailedModule[],
    typecheckModules: [] as ModuleReport[],
    unsupportedProjects: browserProjects.map((project) => ({
      projectName: project.name,
      reason: BROWSER_MODE_REASON,
    })),
    unhandledErrors: unhandledErrors.map(errorText),
  };
  const realDirectory = realPath(workspace.directory);
  for (const testModule of testModules) {
    sortModule(testModule, workspace, realDirectory, report);
  }
  report.failedModules.push(
    ...uncollectedModules(specifications, testModules, realDirectory),
  );
  return report;
}

/**
 * A worker queues a placeholder module, mode `queued`, and replaces it once collected. A worker that crashes
 * first leaves the placeholder, or no module at all, and its error reaches only the workspace's unhandled errors.
 */
function wasCollected(testModule: TestModule): boolean {
  const { task } = testModule as unknown as { task: { mode: string } };
  return task.mode !== PLACEHOLDER_MODULE_MODE;
}

function uncollectedModules(
  specifications: readonly TestSpecification[],
  testModules: readonly TestModule[],
  realDirectory: string,
): FailedModule[] {
  const collected = new Set(
    testModules.map((testModule) =>
      moduleKey(testModule.project.name, testModule.moduleId),
    ),
  );
  return specifications
    .filter(
      (specification) =>
        !collected.has(
          moduleKey(specification.project.name, specification.moduleId),
        ),
    )
    .map((specification) => ({
      projectName: specification.project.name,
      modulePath: relativePosixPath(
        realDirectory,
        realPath(specification.moduleId),
      ),
      errors: [UNCOLLECTED_MODULE_ERROR],
    }));
}

function moduleKey(projectName: string, moduleId: string): string {
  return JSON.stringify([projectName, moduleId]);
}

function sortModule(
  testModule: TestModule,
  workspace: VitestWorkspace,
  realDirectory: string,
  report: {
    tests: DiscoveredTest[];
    failedModules: FailedModule[];
    typecheckModules: ModuleReport[];
  },
): void {
  const location: TestModuleLocation = {
    workspacePath: workspace.path,
    projectName: testModule.project.name,
    modulePath: relativePosixPath(realDirectory, realPath(testModule.moduleId)),
  };
  const moduleReport = {
    projectName: location.projectName,
    modulePath: location.modulePath,
  };
  if (testModule.meta().typecheck === true) {
    report.typecheckModules.push(moduleReport);
    return;
  }
  const errors = testModule.errors();
  if (errors.length > 0) {
    report.failedModules.push({
      ...moduleReport,
      errors: errors.map(errorText),
    });
    return;
  }
  if (!wasCollected(testModule)) {
    report.failedModules.push({
      ...moduleReport,
      errors: [UNCOLLECTED_MODULE_ERROR],
    });
    return;
  }
  const tests = [...testModule.children.allTests()];
  const identified = identifyModuleTests(location, tests.map(namePath));
  identified.forEach((test, index) => {
    report.tests.push({ ...test, mode: modeOf(tests[index]) });
  });
}

function namePath(test: TestCase): string[] {
  const names = [test.name];
  for (
    let parent = test.parent;
    parent.type === "suite";
    parent = parent.parent
  ) {
    names.unshift(parent.name);
  }
  return names;
}

function modeOf(test: TestCase | undefined): DiscoveredTest["mode"] {
  if (test === undefined) throw new Error("identified test has no source test");
  return test.options.mode;
}

/** Vitest resolves module ids through links and, on 4.1, not through Windows short names; compare resolved paths. */
function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function usesBrowserMode(project: TestProject): boolean {
  return project.config.browser.enabled;
}
