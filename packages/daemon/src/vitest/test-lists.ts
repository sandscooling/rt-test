import {
  testIdentityKey,
  type IdentifiedTest,
  type TestModuleLocation,
} from "@rt-test/core";
import type { TestModule } from "vitest/node";
import type {
  DiscoveredTest,
  TestDiscovery,
  WorkspaceDiscovery,
} from "./discover-tests.js";
import {
  identifyTests,
  moduleReport,
  type ModuleLocator,
  type ModuleReport,
} from "./module-tests.js";
import type { RecordedModule } from "./run-states.js";
import type { WorkspaceRun } from "./run-workspace.js";

/** One test module's tests as one collection of it found them, the way a discovery lists them. */
export interface ModuleTests extends ModuleReport {
  readonly tests: readonly DiscoveredTest[];
}

/** One Vitest workspace's module lists. */
export interface WorkspaceLists {
  readonly workspacePath: string;
  readonly modules: readonly ModuleTests[];
}

/** A discovery with a workspace's lists replaced, and how many of its test modules the replacement changed. */
export interface ReplacedLists {
  readonly discovery: TestDiscovery;
  readonly changedModules: number;
}

type DiscoveredWorkspace = Extract<
  WorkspaceDiscovery,
  { status: "discovered" }
>;

/** Names a test module within its workspace, one project's listing of a file apart from another's. */
export function moduleListKey(module: ModuleReport): string {
  return JSON.stringify([module.projectName, module.modulePath]);
}

/** The tests of a module Vitest collected, each with the mode its declaration gives it. */
export function collectedTests(
  location: TestModuleLocation,
  testModule: TestModule,
): DiscoveredTest[] {
  return identifyTests(location, testModule).map(({ test, identified }) => ({
    ...identified,
    mode: test.options.mode,
  }));
}

/** The workspace's tests by module, in the order the discovery first lists each module. */
function testsByModule(
  tests: readonly DiscoveredTest[],
): Map<string, ModuleTests> {
  const modules = new Map<string, ModuleReport & { tests: DiscoveredTest[] }>();
  for (const test of tests) {
    const report: ModuleReport = {
      projectName: test.identity.projectName,
      modulePath: test.identity.modulePath,
    };
    const key = moduleListKey(report);
    const listed = modules.get(key);
    if (listed === undefined) modules.set(key, { ...report, tests: [test] });
    else listed.tests.push(test);
  }
  return modules;
}

/** Each module the workspace lists tests for, less a module its discovery could not collect in that project. */
export function listedModules(entry: DiscoveredWorkspace): ModuleTests[] {
  const failed = new Set(entry.failedModules.map(moduleListKey));
  return [...testsByModule(entry.tests)]
    .filter(([key]) => !failed.has(key))
    .map(([, module]) => module);
}

/**
 * The list of each module the run recorded as ran with no error on the module itself. A module in any other state
 * gets none, and neither does one whose own error may have ended its collection part way, since the run did not
 * learn all of its tests.
 */
export function runLists(
  testModules: readonly TestModule[],
  recorded: readonly RecordedModule[],
  locate: ModuleLocator,
): ModuleTests[] {
  const ran = new Set(
    recorded.filter((module) => module.state === "ran").map(moduleListKey),
  );
  return testModules.flatMap((testModule) => {
    const location = locate(testModule.project.name, testModule.moduleId);
    const report = moduleReport(location);
    return ran.has(moduleListKey(report)) && testModule.errors().length === 0
      ? [{ ...report, tests: collectedTests(location, testModule) }]
      : [];
  });
}

/**
 * The modules of `entry` whose list the run vouches for: the run recorded the module as ran, with exactly the tests
 * the list holds. A list that differs from what its workspace's latest run recorded is nobody's to trust.
 */
export function vouchedModules(
  entry: DiscoveredWorkspace,
  run: WorkspaceRun,
): ModuleTests[] {
  if (run.status !== "ran") return [];
  const recorded = new Map(
    run.modules.flatMap((module) =>
      module.state === "ran"
        ? [[moduleListKey(module), identities(module.tests)] as const]
        : [],
    ),
  );
  return listedModules(entry).filter(
    (module) =>
      recorded.get(moduleListKey(module)) === identities(module.tests),
  );
}

/** Equal for two lists that hold the same tests, in whatever order. */
function identities(tests: readonly IdentifiedTest[]): string {
  return JSON.stringify(
    tests.map((test) => testIdentityKey(test.identity)).sort(),
  );
}

/**
 * The discovery with each of `lists` in place of the workspace's own list of that module, where the workspace lists
 * tests for the module, the list holds a test and the two differ. Which modules it lists, and which it could not
 * collect, stay as the discovery found them, since each workspace's fingerprint and selection are built over them.
 * Undefined when the workspace is not discovered there or no list is replaced.
 */
export function withModuleLists(
  discovery: TestDiscovery,
  workspacePath: string,
  lists: readonly ModuleTests[],
): ReplacedLists | undefined {
  const index = discovery.workspaces.findIndex(
    (entry) => entry.workspace.path === workspacePath,
  );
  const entry = discovery.workspaces[index];
  if (entry?.status !== "discovered") return undefined;
  const modules = testsByModule(entry.tests);
  const changed = lists.filter((list) => {
    const held = modules.get(moduleListKey(list));
    return (
      held !== undefined &&
      list.tests.length > 0 &&
      listSignature(held.tests) !== listSignature(list.tests)
    );
  });
  if (changed.length === 0) return undefined;
  for (const list of changed) modules.set(moduleListKey(list), list);
  const refreshed: DiscoveredWorkspace = {
    ...entry,
    tests: [...modules.values()].flatMap((module) => module.tests),
  };
  return {
    discovery: {
      ...discovery,
      workspaces: discovery.workspaces.map((listed, position) =>
        position === index ? refreshed : listed,
      ),
    },
    changedModules: changed.length,
  };
}

/** Equal for two lists of one module that hold the same tests in the same order, each marked and declared alike. */
function listSignature(tests: readonly DiscoveredTest[]): string {
  return JSON.stringify(
    tests.map((test) => [
      testIdentityKey(test.identity),
      test.isDuplicate,
      test.mode,
    ]),
  );
}
