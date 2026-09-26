import { realpathSync } from "node:fs";
import { identifyModuleTests } from "@rt-test/core";
import type { IdentifiedTest, TestModuleLocation } from "@rt-test/core";
import type { TestCase, TestModule, TestSpecification } from "vitest/node";
import { relativePosixPath, type VitestWorkspace } from "./find-workspaces.js";

export type ModuleReport = Omit<TestModuleLocation, "workspacePath">;

export interface FailedModule extends ModuleReport {
  readonly errors: readonly string[];
}

interface IdentifiedTestCase {
  readonly test: TestCase;
  readonly identified: IdentifiedTest;
}

/** Locates a module the workspace's Vitest resolved, by project name and module id. */
export type ModuleLocator = (
  projectName: string,
  moduleId: string,
) => TestModuleLocation;

const PLACEHOLDER_MODULE_MODE = "queued";

export function moduleLocator(workspace: VitestWorkspace): ModuleLocator {
  const realDirectory = realPath(workspace.directory);
  return (projectName, moduleId) => ({
    workspacePath: workspace.path,
    projectName,
    modulePath: relativePosixPath(realDirectory, realPath(moduleId)),
  });
}

export function moduleReport(location: TestModuleLocation): ModuleReport {
  return { projectName: location.projectName, modulePath: location.modulePath };
}

export function identifyTests(
  location: TestModuleLocation,
  testModule: TestModule,
): IdentifiedTestCase[] {
  const tests = [...testModule.children.allTests()];
  const identified = identifyModuleTests(location, tests.map(namePath));
  return tests.map((test, index) => ({
    test,
    identified: identifiedAt(identified, index),
  }));
}

/**
 * A worker queues a placeholder module, mode `queued`, and replaces it once collected. A worker that crashes
 * first leaves the placeholder, or no module at all, and its error reaches only the workspace's unhandled errors.
 */
export function wasCollected(testModule: TestModule): boolean {
  const { task } = testModule as unknown as { task: { mode: string } };
  return task.mode !== PLACEHOLDER_MODULE_MODE;
}

export function specificationsWithoutModule(
  specifications: readonly TestSpecification[],
  testModules: readonly TestModule[],
): TestSpecification[] {
  const present = new Set(
    testModules.map((testModule) =>
      moduleKey(testModule.project.name, testModule.moduleId),
    ),
  );
  return specifications.filter(
    (specification) =>
      !present.has(
        moduleKey(specification.project.name, specification.moduleId),
      ),
  );
}

function moduleKey(projectName: string, moduleId: string): string {
  return JSON.stringify([projectName, moduleId]);
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

function identifiedAt(
  identified: readonly IdentifiedTest[],
  index: number,
): IdentifiedTest {
  const test = identified[index];
  if (test === undefined) throw new Error("source test has no identity");
  return test;
}

/** Vitest resolves module ids through links and, on 4.1, not through Windows short names; compare resolved paths. */
function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
