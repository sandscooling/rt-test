import type { TestIdentity } from "@rt-test/core";
import { isRecord } from "../json-guards.js";
import {
  testResultIn,
  type ConfirmingRun,
  type DefectExperiment,
  type ExperimentNotRun,
  type ExperimentRecord,
  type JobRuns,
  type RawError,
  type RecordedRunTest,
  type RunOutcome,
  type RunRecord,
  type UnrecordedRun,
} from "./experiment-record.js";
import {
  ASSERTION_MARKER,
  ERROR_KIND,
  PLAIN_ERROR_NAME,
  type AssertionMarker,
  type BaselineFacts,
  type ConfirmingFacts,
  type ErrorFact,
  type ExperimentFacts,
  type ExperimentRunFacts,
  type JobFacts,
  type ModuleFacts,
  type NextRunFact,
  type NotRunFact,
  type RestoredBaselineFacts,
  type RunFacts,
  type TestFacts,
} from "./fact-types.js";
import type { MutationLoad } from "./mutation-transform.js";

/** What the job's own process recorded once its instance had closed. */
export interface JobEnd {
  /** Unhandled rejections on the executor's own thread while the instance was open. */
  readonly unhandledErrors: readonly string[];
  readonly closeError?: string;
}

const NAME_FIELD = "name";
const CONSTRUCTOR_FIELD = "constructor";
const ASSERTION_ERROR_NAME = "AssertionError";
/** How Vitest serializes a function, a class among them: by its name, or as `anonymous` when it has none. */
const SERIALIZED_FUNCTION = /^Function<(.+)>$/s;
/** The class of the error Vitest throws for an `expect.extend` matcher's failure. */
const EXTENDED_MATCHER_CLASS = "JestExtendError";
/** Where Vitest puts the failed matcher's name on that error. */
const ERROR_CONTEXT_FIELD = "__vitest_error_context__";
const ASSERTION_NAME_FIELD = "assertionName";
/** A record judged against another experiment's test would credit or blame the wrong defect, so the job fails instead. */
const MISPAIRED_RECORDS =
  "the falsification job's experiment records do not pair, one for one and in order, with the experiments it was given";

export interface DefectFacts {
  readonly defectId: string;
  readonly facts: ExperimentFacts;
}

/**
 * Each experiment's facts, in the order the job was given them, read from the job's raw records once its instance has
 * closed. `assertionErrors` are the error names that count as assertions beside the two forms Vitest marks itself.
 */
export function experimentFacts(
  runs: JobRuns,
  end: JobEnd,
  experiments: readonly DefectExperiment[],
  assertionErrors: readonly string[],
): DefectFacts[] {
  const job: JobFacts = {
    unhandledErrorCount: end.unhandledErrors.length,
    closed: end.closeError === undefined,
  };
  if (runs.experiments.length !== experiments.length) {
    throw new Error(MISPAIRED_RECORDS);
  }
  return runs.experiments.map((record, index): DefectFacts => {
    const experiment = experiments[index];
    if (experiment?.defectId !== record.defectId) {
      throw new Error(MISPAIRED_RECORDS);
    }
    const { test } = experiment;
    const baseline =
      runs.baseline?.ran === true
        ? baselineFacts(runs.baseline.record, test, assertionErrors)
        : undefined;
    const restoredBaseline = restoredFacts(
      runs.restoredBaseline,
      test,
      assertionErrors,
    );
    const shared = {
      ...(baseline === undefined ? {} : { baseline }),
      ...(restoredBaseline === undefined ? {} : { restoredBaseline }),
      job,
    };
    const facts: ExperimentFacts =
      record.status === "not-run"
        ? { ...shared, notRun: notRunFact(record.reason) }
        : {
            ...shared,
            ...ranFacts(runs, index, record, test, assertionErrors),
          };
    return { defectId: record.defectId, facts };
  });
}

type RanRecord = Extract<ExperimentRecord, { status: "ran" }>;

function ranFacts(
  runs: JobRuns,
  index: number,
  record: RanRecord,
  test: TestIdentity,
  assertionErrors: readonly string[],
): Pick<
  Extract<ExperimentFacts, { run: ExperimentRunFacts }>,
  "run" | "confirming" | "nextRun"
> {
  const confirming =
    record.confirming === undefined
      ? undefined
      : confirmingFacts(record.confirming, test, assertionErrors);
  const nextRun =
    record.confirming?.status === "ran" ? nextRunAfter(runs, index) : undefined;
  return {
    run: experimentRunFacts(record.run, record.mutation, test, assertionErrors),
    ...(confirming === undefined ? {} : { confirming }),
    ...(nextRun === undefined ? {} : { nextRun }),
  };
}

/** The facts of one run made with the experiment's mutation active. */
export function experimentRunFacts(
  record: RunRecord,
  loads: readonly MutationLoad[],
  test: TestIdentity,
  assertionErrors: readonly string[],
): ExperimentRunFacts {
  return { ...runFacts(record, test, assertionErrors), mutation: loads };
}

function runFacts(
  record: RunRecord,
  identity: TestIdentity,
  assertionErrors: readonly string[],
): RunFacts {
  const test = testResultIn(record, identity);
  const module = moduleFacts(record, identity);
  return {
    ...(test === undefined ? {} : { test: testFacts(test, assertionErrors) }),
    ...(module === undefined ? {} : { module }),
    unhandledErrorCount: record.unhandledErrors.length,
    ending: {
      execution: record.execution,
      forceStopped: record.forceStopped,
      cancelFailed: record.cancelError !== undefined,
    },
  };
}

/**
 * A baseline's unhandled error counts against the experiment when it names the experiment's test module, as the
 * module its worker was running, or names no test module of the baseline.
 */
function baselineFacts(
  record: RunRecord,
  identity: TestIdentity,
  assertionErrors: readonly string[],
): BaselineFacts {
  const counted = record.unhandledErrorModules.filter(
    (modules) =>
      modules.length === 0 ||
      modules.some((module) => isTestModule(module, identity)),
  );
  return {
    ...runFacts(record, identity, assertionErrors),
    countedUnhandledErrorCount: counted.length,
    unnamedUnhandledErrorCount: counted.filter(
      (modules) => modules.length === 0,
    ).length,
  };
}

function restoredFacts(
  outcome: RunOutcome | undefined,
  identity: TestIdentity,
  assertionErrors: readonly string[],
): RestoredBaselineFacts | undefined {
  if (outcome === undefined) return undefined;
  return outcome.ran
    ? {
        recorded: true,
        ...baselineFacts(outcome.record, identity, assertionErrors),
      }
    : { recorded: false, run: outcome.unrecorded.kind };
}

function confirmingFacts(
  confirming: ConfirmingRun,
  identity: TestIdentity,
  assertionErrors: readonly string[],
): ConfirmingFacts {
  switch (confirming.status) {
    case "ran":
      return {
        status: confirming.status,
        ...experimentRunFacts(
          confirming.run,
          confirming.mutation,
          identity,
          assertionErrors,
        ),
      };
    case "unrecorded":
      return { status: confirming.status, run: confirming.run.kind };
    case "interrupted":
      return { status: confirming.status };
  }
}

function notRunFact(reason: ExperimentNotRun): NotRunFact {
  switch (reason.kind) {
    case "anchor-count":
    case "no-probe-site":
      return reason;
    case "run-unrecorded":
      return { kind: reason.kind, run: reason.run.kind };
    default:
      return { kind: reason.kind };
  }
}

/**
 * The first run the job started after the experiment at `index`: a later experiment's first run, or the restored
 * baseline. An experiment the job gave no run is passed over, and so is a run the guard refused, which never started.
 */
function nextRunAfter(runs: JobRuns, index: number): NextRunFact | undefined {
  for (const record of runs.experiments.slice(index + 1)) {
    const started = startedRun(record);
    if (started !== undefined) return started;
  }
  const restored = runs.restoredBaseline;
  if (restored === undefined) return undefined;
  return restored.ran
    ? recordedRun(restored.record)
    : startedWithoutRecord(restored.unrecorded);
}

function startedRun(record: ExperimentRecord): NextRunFact | undefined {
  if (record.status === "ran") return recordedRun(record.run);
  return record.reason.kind === "run-unrecorded"
    ? startedWithoutRecord(record.reason.run)
    : undefined;
}

function recordedRun(record: RunRecord): NextRunFact {
  return { recorded: true, unhandledErrorCount: record.unhandledErrors.length };
}

function startedWithoutRecord(run: UnrecordedRun): NextRunFact | undefined {
  return run.kind === "run-failed" ? { recorded: false } : undefined;
}

function moduleFacts(
  record: RunRecord,
  identity: TestIdentity,
): ModuleFacts | undefined {
  const module = record.modules.find((candidate) =>
    isTestModule(candidate, identity),
  );
  if (module === undefined) return undefined;
  if (!module.collected) return { collected: false, state: module.state };
  return {
    collected: true,
    errorCount: module.errors.length,
    failingSuites: module.suiteErrors.map((suite) => ({
      namePath: suite.namePath,
      errorCount: suite.errors.length,
    })),
  };
}

/** Whether `module` is the one holding the test; a job's records are all of one workspace. */
function isTestModule(
  module: Pick<TestIdentity, "projectName" | "modulePath">,
  identity: TestIdentity,
): boolean {
  return (
    module.projectName === identity.projectName &&
    module.modulePath === identity.modulePath
  );
}

function testFacts(
  test: RecordedRunTest,
  assertionErrors: readonly string[],
): TestFacts {
  return {
    state: test.state,
    mode: test.mode,
    errors: test.errors.map((error) => errorFact(error, assertionErrors)),
    ...(test.repeats === undefined ? {} : { repeats: test.repeats }),
    ...(test.hooks === undefined ? {} : { hooks: test.hooks }),
    ...(test.reach === undefined ? {} : { reach: test.reach }),
  };
}

function errorFact(
  error: RawError,
  assertionErrors: readonly string[],
): ErrorFact {
  const name = knownName(error);
  const named = typeof name === "string" ? { name } : {};
  const marker = assertionMarker(error, named.name, assertionErrors);
  return marker === undefined
    ? { kind: ERROR_KIND.other, ...named }
    : { kind: ERROR_KIND.assertion, marker, ...named };
}

/**
 * The name an error is known by: its own, or its class's when its own is the one every plain error carries. A plain
 * error's class carries that name too, so it is known by no other.
 */
function knownName(error: RawError): string | undefined {
  const name = ownField(error, NAME_FIELD);
  if (typeof name !== "string") return undefined;
  return name === PLAIN_ERROR_NAME ? (className(error) ?? name) : name;
}

/** The name of the class the error was built from; no class it extends crosses. */
function className(error: RawError): string | undefined {
  const serialized = ownField(error, CONSTRUCTOR_FIELD);
  if (typeof serialized !== "string") return undefined;
  return SERIALIZED_FUNCTION.exec(serialized)?.[1];
}

function assertionMarker(
  error: RawError,
  name: string | undefined,
  assertionErrors: readonly string[],
): AssertionMarker | undefined {
  if (name === ASSERTION_ERROR_NAME) return ASSERTION_MARKER.assertionErrorName;
  if (isExtendedMatcherFailure(error)) return ASSERTION_MARKER.extendedMatcher;
  if (name !== undefined && assertionErrors.includes(name)) {
    return ASSERTION_MARKER.declaredName;
  }
  return undefined;
}

function isExtendedMatcherFailure(error: RawError): boolean {
  if (className(error) !== EXTENDED_MATCHER_CLASS) return false;
  const context = ownField(error, ERROR_CONTEXT_FIELD);
  return isRecord(context) && typeof context[ASSERTION_NAME_FIELD] === "string";
}

/** An error crosses as a plain object, on which a field it does not hold, `constructor` above all, is inherited. */
function ownField(error: RawError, field: string): unknown {
  return Object.hasOwn(error, field) ? error[field] : undefined;
}
