import type {
  IdentifiedTest,
  TestModuleLocation,
  TestOutcome,
} from "@rt-test/core";
import type {
  TestCase,
  TestModule,
  TestSpecification,
  TestSuite,
} from "vitest/node";
import { errorText } from "./error-text.js";
import {
  identifyTests,
  moduleReport,
  specificationsWithoutModule,
  wasCollected,
  type ModuleLocator,
  type ModuleReport,
} from "./module-tests.js";

export type RunExecution = "completed" | "interrupted";

/** A test left unfinished by an interruption has no outcome from the run. */
export type TestRunState =
  | {
      readonly execution: "finished";
      readonly outcome: TestOutcome;
      readonly errors: readonly string[];
    }
  | { readonly execution: "interrupted" };

export type RecordedTest = IdentifiedTest & TestRunState;

export type RecordedModule = ModuleReport &
  (
    | {
        readonly state: "ran";
        readonly tests: readonly RecordedTest[];
        /** Errors Vitest recorded on the module and its suites, such as a failing hook's, apart from any test outcome. */
        readonly errors: readonly string[];
      }
    | { readonly state: "failed"; readonly errors: readonly string[] }
    | { readonly state: "crashed" }
    | { readonly state: "not-run" }
  );

export type NothingRanReason =
  | "no-module"
  | "no-module-ran"
  | "no-test-declared"
  | "every-test-skipped"
  | "tests-blocked-by-hook"
  | "interrupted-before-any-test-finished";

interface RunEvidence {
  readonly execution: RunExecution;
  readonly specifications: readonly TestSpecification[];
  readonly testModules: readonly TestModule[];
  readonly locate: ModuleLocator;
}

type ModuleWithoutTests = Exclude<RecordedModule, { state: "ran" }>;

const DECLARED_SKIP_MODES: ReadonlySet<TestCase["options"]["mode"]> = new Set([
  "skip",
  "todo",
]);
const INTERRUPTED: TestRunState = { execution: "interrupted" };

export function recordModules(evidence: RunEvidence): RecordedModule[] {
  const interrupted = evidence.execution === "interrupted";
  const recorded = evidence.testModules.map((testModule) =>
    recordModule(
      testModule,
      evidence.locate(testModule.project.name, testModule.moduleId),
      interrupted,
    ),
  );
  const missing = specificationsWithoutModule(
    evidence.specifications,
    evidence.testModules,
  ).map((specification) =>
    unstartedModule(
      evidence.locate(specification.project.name, specification.moduleId),
      interrupted,
    ),
  );
  return [...recorded, ...missing];
}

export function notRunModules(
  specifications: readonly TestSpecification[],
  locate: ModuleLocator,
): RecordedModule[] {
  return specifications.map((specification) =>
    unstartedModule(
      locate(specification.project.name, specification.moduleId),
      true,
    ),
  );
}

/** Absent when at least one test was recorded passed or failed. */
export function nothingRanReason(
  execution: RunExecution,
  modules: readonly RecordedModule[],
): NothingRanReason | undefined {
  const tests = modules.flatMap((module) =>
    module.state === "ran" ? module.tests : [],
  );
  if (tests.some(executedBody)) return undefined;
  if (execution === "interrupted")
    return "interrupted-before-any-test-finished";
  if (modules.length === 0) return "no-module";
  if (!modules.some((module) => module.state === "ran")) return "no-module-ran";
  if (tests.length === 0) return "no-test-declared";
  return tests.some(isError) ? "tests-blocked-by-hook" : "every-test-skipped";
}

function recordModule(
  testModule: TestModule,
  location: TestModuleLocation,
  interrupted: boolean,
): RecordedModule {
  if (!wasCollected(testModule)) return unstartedModule(location, interrupted);
  const tests = identifyTests(location, testModule);
  const report = moduleReport(location);
  if (!interrupted && tests.some(({ test }) => isUnfinished(test))) {
    return { ...report, state: "crashed" };
  }
  const moduleErrors = testModule.errors().map(errorText);
  if (tests.length === 0 && moduleErrors.length > 0) {
    return { ...report, state: "failed", errors: moduleErrors };
  }
  return {
    ...report,
    state: "ran",
    tests: tests.map(({ test, identified }) => ({
      ...identified,
      ...testState(test, interrupted),
    })),
    errors: [
      ...moduleErrors,
      ...[...testModule.children.allSuites()].flatMap((suite) =>
        suite.errors().map(errorText),
      ),
    ],
  };
}

/** Reached only for a module that did not crash, so an unfinished test here was left by an interruption. */
function testState(test: TestCase, interrupted: boolean): TestRunState {
  if (DECLARED_SKIP_MODES.has(test.options.mode)) return finished("skipped");
  const result = test.result();
  switch (result.state) {
    case "pending":
      return INTERRUPTED;
    case "skipped":
      return interrupted ? INTERRUPTED : skippedAtRunTime(test);
    case "passed":
      return finished("passed");
    case "failed":
      return finished("failed", result.errors.map(errorText));
  }
}

function skippedAtRunTime(test: TestCase): TestRunState {
  if (skippedItself(test)) return finished("skipped");
  const blocking = nearestHookErrors(test);
  return blocking.length === 0
    ? finished("skipped")
    : finished("error", blocking.map(errorText));
}

function unstartedModule(
  location: TestModuleLocation,
  interrupted: boolean,
): ModuleWithoutTests {
  return {
    ...moduleReport(location),
    state: interrupted ? "not-run" : "crashed",
  };
}

function finished(
  outcome: TestOutcome,
  errors: readonly string[] = [],
): TestRunState {
  return { execution: "finished", outcome, errors };
}

function isUnfinished(test: TestCase): boolean {
  return test.result().state === "pending";
}

function executedBody(test: RecordedTest): boolean {
  return (
    test.execution === "finished" &&
    (test.outcome === "passed" || test.outcome === "failed")
  );
}

function isError(test: RecordedTest): boolean {
  return test.execution === "finished" && test.outcome === "error";
}

/** `ctx.skip()` sets `pending` on the runner's result; a test skipped because its `beforeAll` failed has it unset. */
function skippedItself(test: TestCase): boolean {
  const { task } = test as unknown as {
    task: { result?: { pending?: boolean } };
  };
  return task.result?.pending === true;
}

function nearestHookErrors(test: TestCase): ReturnType<TestSuite["errors"]> {
  let parent: TestSuite | TestModule = test.parent;
  while (parent.type === "suite") {
    const errors = parent.errors();
    if (errors.length > 0) return errors;
    parent = parent.parent;
  }
  return parent.errors();
}
