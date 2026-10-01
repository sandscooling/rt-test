import { testIdentityKey } from "@rt-test/core";
import type { IdentifiedTest, TestIdentity } from "@rt-test/core";
import type {
  RunnerTaskResult,
  TestCase,
  TestModule,
  TestModuleState,
  TestSpecification,
  TestState,
  TestSuite,
} from "vitest/node";
import { isRecord } from "../json-guards.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import {
  identifyTests,
  moduleReport,
  specificationsWithoutModule,
  wasCollected,
  type ModuleLocator,
  type ModuleReport,
} from "../vitest/module-tests.js";
import type { RunExecution } from "../vitest/run-states.js";
import type { UnsupportedVitest } from "../vitest/workspace-session.js";
import type { ExperimentFacts } from "./fact-types.js";
import type {
  Mutation,
  MutationLoad,
  OnDiskModuleCache,
} from "./mutation-transform.js";
import type { NoProbeSite } from "./reach-probe.js";
import { REACH_META_KEY, type ReachMark } from "./reach-names.js";
import { moduleFileKey, type StaleModule } from "./stale-transform-guard.js";
import type { Judgement } from "./verdict.js";

/**
 * Raise it whenever what a falsification record, its mutation transform, its reach probe or a judgement means
 * changes, so evidence recorded under the old meaning can be retired.
 */
export const FALSIFIER_VERSION = 2;

/** One defect's experiment as the job is asked to run it: the test that should detect it, and its mutation. */
export interface DefectExperiment {
  readonly defectId: string;
  readonly test: TestIdentity;
  readonly mutation: Mutation;
}

/** An error as Vitest serialized it from its worker, every field kept, the message included. */
export type RawError = Readonly<Record<string, unknown>>;

type HookStates = NonNullable<RunnerTaskResult["hooks"]>;

/** Why no probe tells whether the mutated site executed for a test. */
export type ReachUnknownReason =
  /** The reach setup file never ran for the test, such as when a `beforeAll` failed before it. */
  | "not-observed"
  /** The site executed while this test ran beside others. */
  | "unattributed"
  /** The mutation was served with no probe, since the text Vitest transformed left no probe site. */
  | "no-probe";

export type Reach =
  | { readonly executed: "in-test" }
  /** While the file loaded, or in a hook of the file or of a suite enclosing the test, before the test ran. */
  | { readonly executed: "outside-test" }
  | { readonly executed: "no" }
  | { readonly executed: "unknown"; readonly reason: ReachUnknownReason };

export interface RecordedRunTest extends IdentifiedTest {
  readonly mode: TestCase["options"]["mode"];
  readonly state: TestState;
  readonly errors: readonly RawError[];
  /** Absent when Vitest recorded no hook state on the test's result. */
  readonly hooks?: HookStates;
  /** Present only in an experiment's run. */
  readonly reach?: Reach;
}

export interface RecordedSuiteErrors {
  readonly namePath: readonly string[];
  readonly errors: readonly RawError[];
}

export type RecordedRunModule = ModuleReport &
  (
    | {
        readonly collected: true;
        readonly state: TestModuleState;
        readonly errors: readonly RawError[];
        readonly suiteErrors: readonly RecordedSuiteErrors[];
        readonly tests: readonly RecordedRunTest[];
      }
    /** A worker left only its placeholder module, or Vitest returned no module for the specification. */
    | { readonly collected: false; readonly state: TestModuleState | "missing" }
  );

export interface RunRecord {
  readonly execution: RunExecution;
  /** Whether Vitest force-stopped its workers, skipping the project's `afterAll` hooks and teardown. */
  readonly forceStopped: boolean;
  readonly cancelError?: string;
  readonly modules: readonly RecordedRunModule[];
  readonly unhandledErrors: readonly RawError[];
  /**
   * For each unhandled error, in the same order, the run's modules whose file the worker that raised it was running:
   * several when one file runs under several projects, and none when the error names no file of this run.
   */
  readonly unhandledErrorModules: readonly (readonly ModuleReport[])[];
}

/** A run that left no record. */
export type UnrecordedRun =
  /** Not started, since some module would still have been served from text other than its file's now. */
  | { readonly kind: "stale-modules"; readonly modules: readonly StaleModule[] }
  /** Vitest or the reading of its results threw, so the run has no facts. */
  | { readonly kind: "run-failed"; readonly error: string };

export type RunOutcome =
  | { readonly ran: true; readonly record: RunRecord }
  | { readonly ran: false; readonly unrecorded: UnrecordedRun };

export type ExperimentNotRun =
  | {
      readonly kind: "baseline-not-passed";
      /** `not-reported` when the baseline recorded no result for the test. */
      readonly state: TestState | "not-reported";
    }
  /** The baseline itself left no record. */
  | { readonly kind: "baseline-not-run" }
  /** No module of the workspace's resolved test modules holds the test. */
  | { readonly kind: "no-module" }
  | { readonly kind: "unreadable"; readonly error: string }
  | { readonly kind: "anchor-count"; readonly count: number }
  | { readonly kind: "no-probe-site"; readonly site: NoProbeSite }
  | { readonly kind: "run-unrecorded"; readonly run: UnrecordedRun }
  /** The job was aborted before this experiment's run finished. */
  | { readonly kind: "interrupted" };

/** The second run of an experiment whose first run would be a detection, made at once in the same instance. */
export type ConfirmingRun =
  | {
      readonly status: "ran";
      readonly run: RunRecord;
      readonly mutation: readonly MutationLoad[];
    }
  | { readonly status: "unrecorded"; readonly run: UnrecordedRun }
  /** The job was aborted before the confirming run finished. */
  | { readonly status: "interrupted" };

export type ExperimentRecord =
  | {
      readonly defectId: string;
      readonly status: "ran";
      readonly run: RunRecord;
      /** One entry per transform of the mutated module during the run; none means it was never loaded. */
      readonly mutation: readonly MutationLoad[];
      /** Present only when the run would be a detection. */
      readonly confirming?: ConfirmingRun;
    }
  | {
      readonly defectId: string;
      readonly status: "not-run";
      readonly reason: ExperimentNotRun;
    };

/** Why a loaded workspace ran nothing at all. */
export type JobRefusal =
  | {
      readonly kind: "module-cache";
      readonly caches: readonly OnDiskModuleCache[];
    }
  /** The transform, the stale-transform guard, isolation or the reach setup file could not be installed. */
  | { readonly kind: "not-prepared"; readonly error: string };

/** A loaded job's runs. */
export interface JobRuns {
  /** The job was aborted; it holds only the runs that finished, and no restored baseline. */
  readonly interrupted: boolean;
  /** Absent when no experiment was left to run once the job started, or an abort interrupted it. */
  readonly baseline?: RunOutcome;
  readonly experiments: readonly ExperimentRecord[];
  /** Present when at least one experiment ran and no abort came first. */
  readonly restoredBaseline?: RunOutcome;
}

/** What a loaded job records itself; the session it ran in adds the rest of `LoadedJob`. */
export type SessionJobFacts = {
  readonly falsifierVersion: number;
  /** Unhandled rejections on the executor's own thread while the instance was open. */
  readonly unhandledErrors: readonly string[];
} & (
  | ({ readonly status: "ran" } & JobRuns)
  | { readonly status: "refused"; readonly refusal: JobRefusal }
);

/** One experiment's judgement, with the facts it was decided from. */
export type ExperimentJudgement = Judgement & {
  readonly defectId: string;
  readonly facts: ExperimentFacts;
};

/** A job that ran carries one judgement per experiment it was given, in the order given, decided once its instance closed. */
export type JudgedJobFacts<Job = SessionJobFacts> = Job extends {
  readonly status: "ran";
}
  ? Job & { readonly judgements: readonly ExperimentJudgement[] }
  : Job;

type LoadedJob = JudgedJobFacts & {
  readonly workspace: VitestWorkspace;
  readonly vitestVersion: string;
  readonly closeError?: string;
};

/** A falsification job's reply: each run's raw facts, and each experiment's judgement when the job ran. */
export type FalsificationJob =
  | LoadedJob
  | {
      readonly status: "failed";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly error: string;
      readonly closeError?: string;
    }
  | {
      readonly status: "unsupported";
      readonly workspace: VitestWorkspace;
      readonly vitest: UnsupportedVitest;
    }
  | {
      /** Its config file is no longer the one confirmed at start, so nothing was loaded. */
      readonly status: "not-confirmed";
      readonly workspace: VitestWorkspace;
      readonly reason: string;
    }
  | {
      /** The signal aborted before the job's turn came, so the workspace was never loaded. */
      readonly status: "interrupted-before-load";
      readonly workspace: VitestWorkspace;
    };

/** What one run left behind, as `runTestSpecifications` returned it and the run's interruption recorded it. */
interface RunEvidence {
  readonly execution: RunExecution;
  readonly forceStopped: boolean;
  readonly cancelError?: string;
  readonly specifications: readonly TestSpecification[];
  readonly testModules: readonly TestModule[];
  /** The modules Vitest reported queued during this run; only a queued module's task holds this run's results. */
  readonly queued: readonly TestModule[];
  readonly unhandledErrors: readonly unknown[];
  readonly locate: ModuleLocator;
  /** Present for an experiment's run: what its mutation's transforms did. */
  readonly mutation?: readonly MutationLoad[];
}

const MISSING_MODULE_STATE: RecordedRunModule["state"] = "missing";
/** The field a worker stamps on an unhandled error with the test file it was running when the error was raised. */
const TEST_PATH_FIELD = "VITEST_TEST_PATH";
const BIGINT_SUFFIX = "n";
const CIRCULAR_TEXT = "[circular]";
const MAX_ERROR_FIELD_DEPTH = 32;
const DEPTH_CUT_TEXT = `[fields nested deeper than ${MAX_ERROR_FIELD_DEPTH} levels are left out]`;
const NOT_OBSERVED: Reach = { executed: "unknown", reason: "not-observed" };
const UNATTRIBUTED: Reach = { executed: "unknown", reason: "unattributed" };
const NO_PROBE: Reach = { executed: "unknown", reason: "no-probe" };
const IN_TEST: Reach = { executed: "in-test" };
const OUTSIDE_TEST: Reach = { executed: "outside-test" };
const NOT_EXECUTED: Reach = { executed: "no" };

/**
 * Reads a run's facts from the modules of its own specifications alone, since `runTestSpecifications` also returns
 * the modules earlier runs of the instance left, with their old results.
 */
export function recordRun(evidence: RunEvidence): RunRecord {
  const { specifications, locate, queued } = evidence;
  const executed = evidence.testModules.filter(
    (testModule) =>
      specificationsWithoutModule(specifications, [testModule]).length <
        specifications.length &&
      queued.some(
        (module) =>
          module.project === testModule.project &&
          module.moduleId === testModule.moduleId,
      ),
  );
  const probeMissing = evidence.mutation?.some(
    (load) => load.applied && !load.probe.placed,
  );
  const reachOf =
    evidence.mutation === undefined
      ? undefined
      : (test: TestCase): Reach =>
          probeMissing === true ? NO_PROBE : reachFromMark(test);
  const missing = specificationsWithoutModule(specifications, executed).map(
    (specification) => ({
      ...moduleReport(
        locate(specification.project.name, specification.moduleId),
      ),
      collected: false as const,
      state: MISSING_MODULE_STATE,
    }),
  );
  return {
    execution: evidence.execution,
    forceStopped: evidence.forceStopped,
    ...(evidence.cancelError === undefined
      ? {}
      : { cancelError: evidence.cancelError }),
    modules: [
      ...executed.map((testModule) =>
        recordModule(testModule, locate, reachOf),
      ),
      ...missing,
    ],
    unhandledErrors: evidence.unhandledErrors.map(rawError),
    unhandledErrorModules: modulesNamed(evidence),
  };
}

/** Matches each unhandled error's stamped test file to the run's specifications by file, as Vite keys a module's file. */
function modulesNamed(evidence: RunEvidence): ModuleReport[][] {
  const { specifications, locate } = evidence;
  const keys = new Map<TestSpecification, string>();
  const keyOf = (specification: TestSpecification): string => {
    let key = keys.get(specification);
    if (key === undefined) {
      key = moduleFileKey(specification.moduleId);
      keys.set(specification, key);
    }
    return key;
  };
  return evidence.unhandledErrors.map((error) => {
    const stamped = isRecord(error) ? error[TEST_PATH_FIELD] : undefined;
    if (typeof stamped !== "string") return [];
    const named = moduleFileKey(stamped);
    return specifications
      .filter((specification) => keyOf(specification) === named)
      .map((specification) =>
        moduleReport(
          locate(specification.project.name, specification.moduleId),
        ),
      );
  });
}

/** The intended test's result in a run, found by its full identity; undefined when the run recorded none. */
export function testResultIn(
  record: RunRecord,
  identity: TestIdentity,
): RecordedRunTest | undefined {
  const key = testIdentityKey(identity);
  for (const module of record.modules) {
    if (!module.collected) continue;
    const found = module.tests.find(
      (test) => testIdentityKey(test.identity) === key,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

function recordModule(
  testModule: TestModule,
  locate: ModuleLocator,
  reachOf: ((test: TestCase) => Reach) | undefined,
): RecordedRunModule {
  const location = locate(testModule.project.name, testModule.moduleId);
  const report = moduleReport(location);
  if (!wasCollected(testModule)) {
    return { ...report, collected: false, state: testModule.state() };
  }
  return {
    ...report,
    collected: true,
    state: testModule.state(),
    errors: testModule.errors().map(rawError),
    suiteErrors: [...testModule.children.allSuites()].flatMap(suiteErrors),
    tests: identifyTests(location, testModule).map(({ test, identified }) =>
      recordTest(test, identified, reachOf),
    ),
  };
}

function recordTest(
  test: TestCase,
  identified: IdentifiedTest,
  reachOf: ((test: TestCase) => Reach) | undefined,
): RecordedRunTest {
  const result = test.result();
  const hooks = hookStates(test);
  return {
    ...identified,
    mode: test.options.mode,
    state: result.state,
    errors: (result.errors ?? []).map(rawError),
    ...(hooks === undefined ? {} : { hooks }),
    ...(reachOf === undefined ? {} : { reach: reachOf(test) }),
  };
}

function suiteErrors(suite: TestSuite): RecordedSuiteErrors[] {
  const errors = suite.errors();
  if (errors.length === 0) return [];
  const namePath = [suite.name];
  for (
    let parent = suite.parent;
    parent.type === "suite";
    parent = parent.parent
  ) {
    namePath.unshift(parent.name);
  }
  return [{ namePath, errors: errors.map(rawError) }];
}

function reachFromMark(test: TestCase): Reach {
  const mark = (test.meta() as { [REACH_META_KEY]?: ReachMark })[
    REACH_META_KEY
  ];
  if (mark === undefined) return NOT_OBSERVED;
  if (mark.unattributed === true) return UNATTRIBUTED;
  if (mark.inTest === true) return IN_TEST;
  if (mark.outsideTest === true) return OUTSIDE_TEST;
  return NOT_EXECUTED;
}

/** The public `TestCase.result()` leaves out the hook states the runner records on its task. */
function hookStates(test: TestCase): HookStates | undefined {
  const { task } = test as unknown as {
    task: { result?: { hooks?: HookStates } };
  };
  return task.result?.hooks;
}

/**
 * Vitest serializes a worker's errors into plain objects, whose fields pass as JSON can carry them. An error raised in
 * this process keeps its name, message and stack, and every own field that holds a plain value.
 */
function rawError(error: unknown): RawError {
  if (typeof error !== "object" || error === null) {
    return { thrown: String(error) };
  }
  if (isPlainObject(error)) return jsonFields(error, 0, new Set());
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (isPlainValue(value)) fields[key] = value;
  }
  const { name, message, stack } = error as Partial<Error>;
  for (const [key, value] of Object.entries({ name, message, stack })) {
    if (isPlainValue(value)) fields[key] = value;
  }
  return fields;
}

/** The record crosses IPC as JSON, which throws on a bigint and a cycle; each becomes text saying what it was. */
function jsonValue(value: unknown, depth: number, seen: Set<object>): unknown {
  if (typeof value === "bigint") return `${value}${BIGINT_SUFFIX}`;
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return CIRCULAR_TEXT;
  if (depth >= MAX_ERROR_FIELD_DEPTH) return DEPTH_CUT_TEXT;
  if (Array.isArray(value)) {
    seen.add(value);
    const items = value.map((item) => jsonValue(item, depth + 1, seen));
    seen.delete(value);
    return items;
  }
  return jsonFields(value, depth, seen);
}

function jsonFields(
  value: object,
  depth: number,
  seen: Set<object>,
): Record<string, unknown> {
  seen.add(value);
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    fields[key] = jsonValue(field, depth + 1, seen);
  }
  seen.delete(value);
  return fields;
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainValue(value: unknown): boolean {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}
