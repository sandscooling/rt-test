import type { ReachUnknownReason } from "./experiment-record.js";
import {
  ERROR_KIND,
  PASSED,
  type BaselineFacts,
  type ConfirmingFacts,
  type ExperimentFacts,
  type ExperimentRunFacts,
  type HookStates,
  type JobFacts,
  type ModuleFacts,
  type NextRunFact,
  type NotRunFact,
  type RunEnding,
  type RunFacts,
  type TestFacts,
} from "./fact-types.js";
import type { NoProbeSite } from "./reach-probe.js";

const VERDICT = {
  detected: "detected",
  survived: "survived",
  invalidExperiment: "invalid-experiment",
  unclear: "unclear",
} as const;

/** Why an experiment has no verdict: its job did not finish its runs, or the job's own check before any run decided it. */
const NO_VERDICT_REASON = {
  interrupted: "interrupted",
  mutationFileUnreadable: "mutation-file-unreadable",
  anchorCount: "anchor-count",
  baselineUnrecorded: "baseline-unrecorded",
  runUnrecorded: "run-unrecorded",
  confirmingRunUnrecorded: "confirming-run-unrecorded",
  restoredBaselineUnrecorded: "restored-baseline-unrecorded",
} as const;

/** Why an experiment cannot say whether its test rejects the mutation, in the order the first that holds is given. */
const INVALID_REASON = {
  noProbeSite: "no-probe-site",
  noModule: "no-module",
  baselineNotPassed: "baseline-not-passed",
  baselineNotClean: "baseline-not-clean",
  restoredBaselineNotPassed: "restored-baseline-not-passed",
  restoredBaselineNotClean: "restored-baseline-not-clean",
  runNotClean: "run-not-clean",
  moduleFailed: "module-failed",
  suiteError: "suite-error",
  testNotRun: "test-not-run",
  hookNotPassed: "hook-not-passed",
  testRepeated: "test-repeated",
  siteNotExecuted: "site-not-executed",
  reachUnknown: "reach-unknown",
} as const;

/** Why a failed test is no detection, in the order the first that holds is given. */
const UNCLEAR_REASON = {
  notAnAssertion: "not-an-assertion",
  unhandledError: "unhandled-error",
  confirmingRunDiffered: "confirming-run-differed",
  nextRunUnclean: "next-run-unclean",
  jobUnclean: "job-unclean",
} as const;

/** What a run reads when everything about it says detection, before its confirming run and the job's end are known. */
const WOULD_DETECT = "would-be-detection";

const COMPLETED = "completed" satisfies RunEnding["execution"];
const FAILED = "failed" satisfies TestFacts["state"];
const TEST_ABSENT = "absent";
/** The reach setup file's own hook gives every test that ran a state under this name. */
const REQUIRED_HOOK = "beforeEach" satisfies keyof HookStates;
const HOOK_PASSED = "pass" satisfies HookState;
const HOOK_NOT_RECORDED = "not-recorded";
const NEVER_TRANSFORMED = "never-transformed";
const NOT_APPLIED = "not-applied";

type HookState = NonNullable<HookStates[keyof HookStates]>;

/** What the mutation's transforms did, which only words why a site did not execute and never stands in for a mark. */
type UnexecutedDetail =
  | { readonly mutation: typeof NEVER_TRANSFORMED }
  | {
      readonly mutation: typeof NOT_APPLIED;
      /** How often `old` occurred in the text transformed. */
      readonly occurrences: number;
    };

type InvalidRun =
  | {
      readonly reason:
        typeof INVALID_REASON.runNotClean | typeof INVALID_REASON.moduleFailed;
    }
  | {
      readonly reason: typeof INVALID_REASON.suiteError;
      readonly detail: { readonly suite: readonly string[] };
    }
  | {
      readonly reason: typeof INVALID_REASON.testNotRun;
      readonly detail: {
        readonly state:
          | Exclude<TestFacts["state"], typeof PASSED | typeof FAILED>
          | typeof TEST_ABSENT;
      };
    }
  | {
      readonly reason: typeof INVALID_REASON.hookNotPassed;
      readonly detail: {
        readonly hook: string;
        readonly state: HookState | typeof HOOK_NOT_RECORDED;
      };
    }
  | {
      readonly reason: typeof INVALID_REASON.testRepeated;
      /** How many more times than once Vitest was told to run the test. */
      readonly detail: { readonly repeats: number };
    }
  | {
      readonly reason: typeof INVALID_REASON.siteNotExecuted;
      readonly detail?: UnexecutedDetail;
    }
  | {
      readonly reason: typeof INVALID_REASON.reachUnknown;
      /** Absent when the run recorded no reach for the test at all. */
      readonly detail?: { readonly cause: ReachUnknownReason };
    };

/** The reasons read from the job's own check before any run and from the two baselines, not from one run. */
type InvalidOutsideRun =
  | {
      readonly reason: typeof INVALID_REASON.noProbeSite;
      readonly detail: { readonly site: NoProbeSite };
    }
  | {
      readonly reason: typeof INVALID_REASON.baselineNotPassed;
      /** What the baseline gave the test; absent when the baseline did not report it. */
      readonly detail?: Pick<TestFacts, "state" | "mode">;
    }
  | {
      readonly reason:
        | typeof INVALID_REASON.noModule
        | typeof INVALID_REASON.baselineNotClean
        | typeof INVALID_REASON.restoredBaselineNotPassed
        | typeof INVALID_REASON.restoredBaselineNotClean;
    };

type UnclearRun = {
  readonly reason:
    typeof UNCLEAR_REASON.notAnAssertion | typeof UNCLEAR_REASON.unhandledError;
};

/** What one run of an experiment reads, taken alone. */
type RunReading =
  | { readonly verdict: typeof VERDICT.survived }
  | ({ readonly verdict: typeof VERDICT.invalidExperiment } & InvalidRun)
  | ({ readonly verdict: typeof VERDICT.unclear } & UnclearRun)
  | { readonly verdict: typeof WOULD_DETECT };

type SettledRunReading = Exclude<RunReading, { verdict: typeof WOULD_DETECT }>;

type Unclear =
  | UnclearRun
  | {
      readonly reason: typeof UNCLEAR_REASON.confirmingRunDiffered;
      /** What the confirming run alone would have read. */
      readonly detail: { readonly confirming: SettledRunReading };
    }
  | {
      readonly reason:
        typeof UNCLEAR_REASON.nextRunUnclean | typeof UNCLEAR_REASON.jobUnclean;
    };

type NoVerdict = { readonly verdict?: never } & (
  | {
      readonly reason: Exclude<
        (typeof NO_VERDICT_REASON)[keyof typeof NO_VERDICT_REASON],
        typeof NO_VERDICT_REASON.anchorCount
      >;
    }
  | {
      readonly reason: typeof NO_VERDICT_REASON.anchorCount;
      /** How often `old` occurred in the mutation's file when the job started. */
      readonly detail: { readonly count: number };
    }
);

/** An experiment's verdict, or none, with its one reason unless it reads detected or survived. */
export type Judgement =
  | {
      readonly verdict: typeof VERDICT.detected | typeof VERDICT.survived;
    }
  | ({ readonly verdict: typeof VERDICT.invalidExperiment } & (
      InvalidOutsideRun | InvalidRun
    ))
  | ({ readonly verdict: typeof VERDICT.unclear } & Unclear)
  | NoVerdict;

type RanFacts = Extract<ExperimentFacts, { readonly run: ExperimentRunFacts }>;
type RecordedConfirmingFacts = Extract<ConfirmingFacts, { status: "ran" }>;

/** Whether one run of an experiment, taken alone, would be a detection. Its first run and its confirming run are read alike. */
export function isWouldBeDetection(run: ExperimentRunFacts): boolean {
  return readRun(run).verdict === WOULD_DETECT;
}

/** An experiment's one judgement, decided from its facts alone. */
export function judge(facts: ExperimentFacts): Judgement {
  return "notRun" in facts
    ? judgeNotRun(facts.notRun, facts.baseline)
    : judgeRan(facts);
}

function judgeNotRun(
  notRun: NotRunFact,
  baseline: BaselineFacts | undefined,
): Judgement {
  switch (notRun.kind) {
    case "interrupted":
      return { reason: NO_VERDICT_REASON.interrupted };
    case "unreadable":
      return { reason: NO_VERDICT_REASON.mutationFileUnreadable };
    case "anchor-count":
      return {
        reason: NO_VERDICT_REASON.anchorCount,
        detail: { count: notRun.count },
      };
    case "baseline-not-run":
      return { reason: NO_VERDICT_REASON.baselineUnrecorded };
    case "run-unrecorded":
      return { reason: NO_VERDICT_REASON.runUnrecorded };
    case "no-probe-site":
      return {
        verdict: VERDICT.invalidExperiment,
        reason: INVALID_REASON.noProbeSite,
        detail: { site: notRun.site },
      };
    case "no-module":
      return {
        verdict: VERDICT.invalidExperiment,
        reason: INVALID_REASON.noModule,
      };
    case "baseline-not-passed":
      return baselineNotPassed(baseline);
  }
}

/** Whether the experiment has a verdict is decided before which, then baseline trouble before its own runs' facts. */
function judgeRan(facts: RanFacts): Judgement {
  const { baseline, restoredBaseline, confirming } = facts;
  if (baseline === undefined) {
    return { reason: NO_VERDICT_REASON.baselineUnrecorded };
  }
  if (confirming !== undefined && confirming.status !== "ran") {
    return { reason: NO_VERDICT_REASON.confirmingRunUnrecorded };
  }
  if (restoredBaseline === undefined || !restoredBaseline.recorded) {
    return { reason: NO_VERDICT_REASON.restoredBaselineUnrecorded };
  }
  return (
    baselineTrouble(baseline, restoredBaseline) ??
    judgeRuns(facts.run, confirming, facts.nextRun, facts.job)
  );
}

function baselineTrouble(
  baseline: BaselineFacts,
  restoredBaseline: BaselineFacts,
): Judgement | undefined {
  if (!passed(baseline)) return baselineNotPassed(baseline);
  if (!untroubled(baseline)) {
    return {
      verdict: VERDICT.invalidExperiment,
      reason: INVALID_REASON.baselineNotClean,
    };
  }
  if (!passed(restoredBaseline)) {
    return {
      verdict: VERDICT.invalidExperiment,
      reason: INVALID_REASON.restoredBaselineNotPassed,
    };
  }
  if (!untroubled(restoredBaseline)) {
    return {
      verdict: VERDICT.invalidExperiment,
      reason: INVALID_REASON.restoredBaselineNotClean,
    };
  }
  return undefined;
}

function baselineNotPassed(baseline: BaselineFacts | undefined): Judgement {
  const test = baseline?.test;
  return {
    verdict: VERDICT.invalidExperiment,
    reason: INVALID_REASON.baselineNotPassed,
    ...(test === undefined
      ? {}
      : { detail: { state: test.state, mode: test.mode } }),
  };
}

/** A would-be detection counts only when its confirming run, the run started next and the job's own end all agree. */
function judgeRuns(
  run: ExperimentRunFacts,
  confirming: RecordedConfirmingFacts | undefined,
  nextRun: NextRunFact | undefined,
  job: JobFacts,
): Judgement {
  const first = readRun(run);
  if (first.verdict !== WOULD_DETECT) return first;
  if (confirming === undefined) {
    return { reason: NO_VERDICT_REASON.confirmingRunUnrecorded };
  }
  const second = readRun(confirming);
  if (second.verdict !== WOULD_DETECT) {
    return {
      verdict: VERDICT.unclear,
      reason: UNCLEAR_REASON.confirmingRunDiffered,
      detail: { confirming: second },
    };
  }
  if (
    nextRun === undefined ||
    !nextRun.recorded ||
    nextRun.unhandledErrorCount > 0
  ) {
    return { verdict: VERDICT.unclear, reason: UNCLEAR_REASON.nextRunUnclean };
  }
  if (job.unhandledErrorCount > 0 || !job.closed) {
    return { verdict: VERDICT.unclear, reason: UNCLEAR_REASON.jobUnclean };
  }
  return { verdict: VERDICT.detected };
}

function readRun(run: ExperimentRunFacts): RunReading {
  if (!endedCleanly(run.ending)) {
    return {
      verdict: VERDICT.invalidExperiment,
      reason: INVALID_REASON.runNotClean,
    };
  }
  const moduleTrouble = readModule(run.module);
  if (moduleTrouble !== undefined) return moduleTrouble;
  const { test } = run;
  if (test === undefined) return testNotRun(TEST_ABSENT);
  if (test.state !== PASSED && test.state !== FAILED) {
    return testNotRun(test.state);
  }
  return (
    readHooks(test.hooks) ??
    readRepeats(test) ??
    readReach(test.reach, run) ??
    readBody(test, run.unhandledErrorCount)
  );
}

function readModule(module: ModuleFacts | undefined): RunReading | undefined {
  if (module === undefined || !module.collected || module.errorCount > 0) {
    return {
      verdict: VERDICT.invalidExperiment,
      reason: INVALID_REASON.moduleFailed,
    };
  }
  const [suite] = module.failingSuites;
  if (suite === undefined) return undefined;
  return {
    verdict: VERDICT.invalidExperiment,
    reason: INVALID_REASON.suiteError,
    detail: { suite: suite.namePath },
  };
}

function testNotRun(
  state: Extract<
    InvalidRun,
    { reason: typeof INVALID_REASON.testNotRun }
  >["detail"]["state"],
): RunReading {
  return {
    verdict: VERDICT.invalidExperiment,
    reason: INVALID_REASON.testNotRun,
    detail: { state },
  };
}

function readHooks(hooks: HookStates | undefined): RunReading | undefined {
  if (hooks?.[REQUIRED_HOOK] === undefined) {
    return hookNotPassed(REQUIRED_HOOK, HOOK_NOT_RECORDED);
  }
  for (const [hook, state] of Object.entries(hooks)) {
    if (state !== HOOK_PASSED) return hookNotPassed(hook, state);
  }
  return undefined;
}

function hookNotPassed(
  hook: string,
  state: HookState | typeof HOOK_NOT_RECORDED,
): RunReading {
  return {
    verdict: VERDICT.invalidExperiment,
    reason: INVALID_REASON.hookNotPassed,
    detail: { hook, state },
  };
}

/**
 * A repeated test stays failed once any repeat failed and keeps that repeat's errors, while the hook states it holds
 * are its last repeat's alone, so its failure cannot be told from one in a hook. It passes only when every repeat did.
 */
function readRepeats(test: TestFacts): RunReading | undefined {
  if (test.state !== FAILED || test.repeats === undefined) return undefined;
  return {
    verdict: VERDICT.invalidExperiment,
    reason: INVALID_REASON.testRepeated,
    detail: { repeats: test.repeats },
  };
}

function readReach(
  reach: TestFacts["reach"],
  run: ExperimentRunFacts,
): RunReading | undefined {
  if (reach === undefined) {
    return {
      verdict: VERDICT.invalidExperiment,
      reason: INVALID_REASON.reachUnknown,
    };
  }
  switch (reach.executed) {
    case "in-test":
    case "outside-test":
      return undefined;
    case "no": {
      const detail = unexecutedDetail(run.mutation);
      return {
        verdict: VERDICT.invalidExperiment,
        reason: INVALID_REASON.siteNotExecuted,
        ...(detail === undefined ? {} : { detail }),
      };
    }
    case "unknown":
      return {
        verdict: VERDICT.invalidExperiment,
        reason: INVALID_REASON.reachUnknown,
        detail: { cause: reach.reason },
      };
  }
}

function unexecutedDetail(
  loads: ExperimentRunFacts["mutation"],
): UnexecutedDetail | undefined {
  const [first] = loads;
  if (first === undefined) return { mutation: NEVER_TRANSFORMED };
  if (first.applied || loads.some((load) => load.applied)) return undefined;
  return { mutation: NOT_APPLIED, occurrences: first.occurrences };
}

/** Reached only for a test that ran, with every hook passed and the mutated site executed. */
function readBody(test: TestFacts, unhandledErrorCount: number): RunReading {
  if (test.state === PASSED) return { verdict: VERDICT.survived };
  if (
    test.errors.length === 0 ||
    test.errors.some((error) => error.kind !== ERROR_KIND.assertion)
  ) {
    return { verdict: VERDICT.unclear, reason: UNCLEAR_REASON.notAnAssertion };
  }
  if (unhandledErrorCount > 0) {
    return { verdict: VERDICT.unclear, reason: UNCLEAR_REASON.unhandledError };
  }
  return { verdict: WOULD_DETECT };
}

function passed(run: RunFacts): boolean {
  return run.test?.state === PASSED;
}

function endedCleanly(ending: RunEnding): boolean {
  return (
    ending.execution === COMPLETED &&
    !ending.forceStopped &&
    !ending.cancelFailed
  );
}

/** A baseline that ended cleanly and recorded no unhandled error that counts against the experiment. */
function untroubled(baseline: BaselineFacts): boolean {
  return (
    endedCleanly(baseline.ending) && baseline.countedUnhandledErrorCount === 0
  );
}
