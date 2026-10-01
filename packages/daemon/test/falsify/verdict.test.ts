import type { TestIdentity } from "@rt-test/core";
import { describe, expect, it } from "vitest";
import type {
  DefectExperiment,
  ExperimentRecord,
  JobRuns,
  RawError,
  Reach,
  RunRecord,
  UnrecordedRun,
} from "../../src/falsify/experiment-record.js";
import type {
  BaselineFacts,
  ErrorFact,
  ExperimentFacts,
  FailingSuite,
  HookStates,
  RunEnding,
  TestFacts,
} from "../../src/falsify/fact-types.js";
import { experimentFacts, type JobEnd } from "../../src/falsify/run-facts.js";
import { judge, type Judgement } from "../../src/falsify/verdict.js";
import {
  APPLIED,
  ASSERTION,
  baseline,
  CLEAN_END,
  CLEAN_JOB,
  detection,
  HOOKS_PASSED,
  IN_TEST,
  mutatedRun,
  PASSED_TEST,
  ranOnce,
  REJECTING_TEST,
  SURVIVING_TEST,
  TYPE_ERROR,
  type RanFacts,
} from "../experiment-facts.js";

const DETECTED = { verdict: "detected" };

/** What the judge reads from facts that hold every condition of a detection, then from each of `others`. */
function besideDetection(...others: ExperimentFacts[]): Judgement[] {
  return [detection(), ...others].map((facts) => judge(facts));
}

/** Everything a ladder of troubles can vary; the defaults are a detection's. */
interface Knobs {
  readonly baselineState: TestFacts["state"];
  readonly baselineCounted: number;
  readonly restoredState: TestFacts["state"];
  readonly restoredCounted: number;
  readonly ending: RunEnding;
  readonly moduleErrors: number;
  readonly failingSuites: readonly FailingSuite[];
  readonly state: TestFacts["state"];
  readonly hooks: HookStates;
  /** Absent for a test Vitest runs once. */
  readonly repeats?: number;
  readonly reach: Reach;
  readonly errors: readonly ErrorFact[];
  readonly unhandled: number;
  readonly confirmingTest: TestFacts;
  readonly nextRunUnhandled: number;
  readonly jobUnhandled: number;
}

const NO_TROUBLE: Knobs = {
  baselineState: "passed",
  baselineCounted: 0,
  restoredState: "passed",
  restoredCounted: 0,
  ending: CLEAN_END,
  moduleErrors: 0,
  failingSuites: [],
  state: "failed",
  hooks: HOOKS_PASSED,
  reach: IN_TEST,
  errors: [ASSERTION],
  unhandled: 0,
  confirmingTest: REJECTING_TEST,
  nextRunUnhandled: 0,
  jobUnhandled: 0,
};

function baselineWith(
  state: TestFacts["state"],
  counted: number,
): BaselineFacts {
  return baseline({
    test: { ...PASSED_TEST, state },
    unhandledErrorCount: counted,
    countedUnhandledErrorCount: counted,
  });
}

function troubled(troubles: Partial<Knobs>): RanFacts {
  const knobs = { ...NO_TROUBLE, ...troubles };
  return {
    baseline: baselineWith(knobs.baselineState, knobs.baselineCounted),
    restoredBaseline: {
      recorded: true,
      ...baselineWith(knobs.restoredState, knobs.restoredCounted),
    },
    job: { unhandledErrorCount: knobs.jobUnhandled, closed: true },
    run: mutatedRun({
      test: {
        state: knobs.state,
        mode: "run",
        errors: knobs.errors,
        ...(knobs.repeats === undefined ? {} : { repeats: knobs.repeats }),
        hooks: knobs.hooks,
        reach: knobs.reach,
      },
      module: {
        collected: true,
        errorCount: knobs.moduleErrors,
        failingSuites: knobs.failingSuites,
      },
      unhandledErrorCount: knobs.unhandled,
      ending: knobs.ending,
    }),
    confirming: {
      status: "ran",
      ...mutatedRun({ test: knobs.confirmingTest }),
    },
    nextRun: { recorded: true, unhandledErrorCount: knobs.nextRunUnhandled },
  };
}

/**
 * The reason read while every trouble holds at once, then as each is taken away from the front: entry `i` is read from
 * facts that hold trouble `i` and every later one.
 */
function reasonsAsEachIsRemoved(
  troubles: readonly Partial<Knobs>[],
): unknown[] {
  return troubles.map((_, index) => {
    const remaining: Partial<Knobs> = Object.assign(
      {},
      ...troubles.slice(index),
    );
    const judgement = judge(troubled(remaining));
    return "reason" in judgement ? judgement.reason : judgement.verdict;
  });
}

describe("a detection needs both baselines", () => {
  it("D3750: a baseline's unhandled error that counts against the experiment reads baseline not clean, and one that does not count leaves the detection", () => {
    expect(
      besideDetection(
        detection({ baseline: baseline({ unhandledErrorCount: 1 }) }),
        detection({
          baseline: baseline({
            unhandledErrorCount: 1,
            countedUnhandledErrorCount: 1,
          }),
        }),
      ),
    ).toEqual([
      DETECTED,
      DETECTED,
      { verdict: "invalid-experiment", reason: "baseline-not-clean" },
    ]);
  });

  it("D3751: a baseline whose workers Vitest force-stopped reads baseline not clean", () => {
    expect(
      besideDetection(
        detection({
          baseline: baseline({
            ending: { ...CLEAN_END, forceStopped: true },
          }),
        }),
      ),
    ).toEqual([
      DETECTED,
      { verdict: "invalid-experiment", reason: "baseline-not-clean" },
    ]);
  });

  it("D3752: an experiment that ran though the baseline failed its test reads baseline not passed, never detected", () => {
    expect(
      besideDetection(
        detection({
          baseline: baseline({ test: { ...PASSED_TEST, state: "failed" } }),
        }),
      ),
    ).toEqual([
      DETECTED,
      {
        verdict: "invalid-experiment",
        reason: "baseline-not-passed",
        detail: { state: "failed", mode: "run" },
      },
    ]);
  });

  it("D3753: a test the baseline skipped reads baseline not passed with its mode, so one declared with it.skip reads as one", () => {
    expect(
      judge({
        baseline: baseline({
          test: { state: "skipped", mode: "skip", errors: [] },
        }),
        job: CLEAN_JOB,
        notRun: { kind: "baseline-not-passed" },
      }),
    ).toEqual({
      verdict: "invalid-experiment",
      reason: "baseline-not-passed",
      detail: { state: "skipped", mode: "skip" },
    });
  });

  it("D3754: a restored baseline that failed the test reads restored baseline not passed", () => {
    expect(
      besideDetection(
        detection({
          restoredBaseline: {
            recorded: true,
            ...baseline({ test: { ...PASSED_TEST, state: "failed" } }),
          },
        }),
      ),
    ).toEqual([
      DETECTED,
      { verdict: "invalid-experiment", reason: "restored-baseline-not-passed" },
    ]);
  });

  it("D3755: a restored baseline's unhandled error that counts against the experiment reads restored baseline not clean", () => {
    expect(
      besideDetection(
        detection({
          restoredBaseline: {
            recorded: true,
            ...baseline({
              unhandledErrorCount: 1,
              countedUnhandledErrorCount: 1,
            }),
          },
        }),
      ),
    ).toEqual([
      DETECTED,
      { verdict: "invalid-experiment", reason: "restored-baseline-not-clean" },
    ]);
  });

  it("D3756: a restored baseline that started and left no record gives the experiment no verdict", () => {
    expect(
      besideDetection(
        detection({
          restoredBaseline: { recorded: false, run: "run-failed" },
        }),
      ),
    ).toEqual([DETECTED, { reason: "restored-baseline-unrecorded" }]);
  });
});

describe("a detection needs its confirming run, the run after it and the job's own end", () => {
  it("D3757: a confirming run that left no record, or that an abort interrupted, gives the experiment no verdict", () => {
    const { nextRun: _unread, ...unconfirmed } = detection();
    expect(
      besideDetection(
        {
          ...unconfirmed,
          confirming: { status: "unrecorded", run: "run-failed" },
        },
        { ...unconfirmed, confirming: { status: "interrupted" } },
      ),
    ).toEqual([
      DETECTED,
      { reason: "confirming-run-unrecorded" },
      { reason: "confirming-run-unrecorded" },
    ]);
  });

  it("D3799: an experiment whose baseline or whose own run left no record has no verdict, with the reason that says which", () => {
    expect([
      judge({ job: CLEAN_JOB, notRun: { kind: "baseline-not-run" } }),
      judge({
        baseline: baseline(),
        job: CLEAN_JOB,
        notRun: { kind: "run-unrecorded", run: "run-failed" },
      }),
    ]).toEqual([
      { reason: "baseline-unrecorded" },
      { reason: "run-unrecorded" },
    ]);
  });

  it("D3763: a run started next that left no record reads next run unclean", () => {
    expect(
      besideDetection(detection({ nextRun: { recorded: false } })),
    ).toEqual([DETECTED, { verdict: "unclear", reason: "next-run-unclean" }]);
  });

  it("D3764: an unhandled error on the job's own thread, or an instance that failed to close, reads job unclean", () => {
    expect(
      besideDetection(
        detection({ job: { unhandledErrorCount: 1, closed: true } }),
        detection({ job: { unhandledErrorCount: 0, closed: false } }),
      ),
    ).toEqual([
      DETECTED,
      { verdict: "unclear", reason: "job-unclean" },
      { verdict: "unclear", reason: "job-unclean" },
    ]);
  });
});

describe("what one run of an experiment reads", () => {
  it("D3758: a run that was interrupted, force-stopped or whose cancel raised an error reads run not clean", () => {
    const notClean = { verdict: "invalid-experiment", reason: "run-not-clean" };
    expect(
      besideDetection(
        ranOnce({ ending: { ...CLEAN_END, execution: "interrupted" } }),
        ranOnce({ ending: { ...CLEAN_END, forceStopped: true } }),
        ranOnce({ ending: { ...CLEAN_END, cancelFailed: true } }),
      ),
    ).toEqual([DETECTED, notClean, notClean, notClean]);
  });

  it("D3759: a failed test holding no beforeEach state reads hook not passed, as not recorded", () => {
    const { hooks: _recorded, ...withoutHooks } = REJECTING_TEST;
    const notRecorded = {
      verdict: "invalid-experiment",
      reason: "hook-not-passed",
      detail: { hook: "beforeEach", state: "not-recorded" },
    };
    expect(
      besideDetection(
        ranOnce({ test: withoutHooks }),
        ranOnce({ test: { ...withoutHooks, hooks: { afterEach: "pass" } } }),
      ),
    ).toEqual([DETECTED, notRecorded, notRecorded]);
  });

  it("D3760: a passed test holding no beforeEach state reads hook not passed, not survived", () => {
    const { hooks: _recorded, ...withoutHooks } = SURVIVING_TEST;
    expect(judge(ranOnce({ test: withoutHooks }))).toEqual({
      verdict: "invalid-experiment",
      reason: "hook-not-passed",
      detail: { hook: "beforeEach", state: "not-recorded" },
    });
  });

  it("D3800: a failed test that declares repeats reads test repeated, naming how many, though its hook state reads pass and its error is an assertion", () => {
    expect(
      besideDetection(ranOnce({ test: { ...REJECTING_TEST, repeats: 2 } })),
    ).toEqual([
      DETECTED,
      {
        verdict: "invalid-experiment",
        reason: "test-repeated",
        detail: { repeats: 2 },
      },
    ]);
  });

  it("D3801: a test that declares repeats and passed, so every repeat passed after executing the site, reads survived", () => {
    expect(judge(ranOnce({ test: { ...SURVIVING_TEST, repeats: 2 } }))).toEqual(
      { verdict: "survived" },
    );
  });

  it("D3761: a failed test holding no error reads unclear, not an assertion", () => {
    expect(
      besideDetection(ranOnce({ test: { ...REJECTING_TEST, errors: [] } })),
    ).toEqual([DETECTED, { verdict: "unclear", reason: "not-an-assertion" }]);
  });

  it("D3762: a test that passed after executing the site stays survived beside an unhandled error in its own run", () => {
    expect(
      judge(ranOnce({ test: SURVIVING_TEST, unhandledErrorCount: 1 })),
    ).toEqual({ verdict: "survived" });
  });

  it("D3767: a site that did not execute because the anchor occurred twice in the text transformed names that count", () => {
    expect(
      judge(
        ranOnce({
          test: { ...SURVIVING_TEST, reach: { executed: "no" } },
          mutation: [{ applied: false, occurrences: 2 }],
        }),
      ),
    ).toEqual({
      verdict: "invalid-experiment",
      reason: "site-not-executed",
      detail: { mutation: "not-applied", occurrences: 2 },
    });
  });
});

describe("the first reason that holds", () => {
  it("D3765: an invalid experiment reads baseline trouble first, then its run's end, module, suite, test, hook, repeats and reach, in that order", () => {
    expect(
      reasonsAsEachIsRemoved([
        { baselineState: "failed" },
        { baselineCounted: 1 },
        { restoredState: "failed" },
        { restoredCounted: 1 },
        { ending: { ...CLEAN_END, forceStopped: true } },
        { moduleErrors: 1 },
        { failingSuites: [{ namePath: ["outer"], errorCount: 1 }] },
        { state: "skipped" },
        { hooks: { beforeEach: "run" } },
        { repeats: 1 },
        { reach: { executed: "no" } },
      ]),
    ).toEqual([
      "baseline-not-passed",
      "baseline-not-clean",
      "restored-baseline-not-passed",
      "restored-baseline-not-clean",
      "run-not-clean",
      "module-failed",
      "suite-error",
      "test-not-run",
      "hook-not-passed",
      "test-repeated",
      "site-not-executed",
    ]);
  });

  it("D3808: an experiment its job did not finish has no verdict, though its baseline held an unhandled error that counts against it", () => {
    const leaky = detection({
      baseline: baseline({
        unhandledErrorCount: 1,
        countedUnhandledErrorCount: 1,
      }),
    });
    const { restoredBaseline: _absent, ...unrestored } = leaky;
    const { nextRun: _unread, ...unconfirmed } = leaky;
    expect([
      judge({
        ...leaky,
        restoredBaseline: { recorded: false, run: "run-failed" },
      }),
      judge(unrestored),
      judge({ ...unconfirmed, confirming: { status: "interrupted" } }),
    ]).toEqual([
      { reason: "restored-baseline-unrecorded" },
      { reason: "restored-baseline-unrecorded" },
      { reason: "confirming-run-unrecorded" },
    ]);
  });

  it("D3766: an unclear experiment reads an error that is no assertion first, then its run's unhandled error, its confirming run, the run after it and the job", () => {
    expect(
      reasonsAsEachIsRemoved([
        { errors: [TYPE_ERROR] },
        { unhandled: 1 },
        { confirmingTest: SURVIVING_TEST },
        { nextRunUnhandled: 1 },
        { jobUnhandled: 1 },
      ]),
    ).toEqual([
      "not-an-assertion",
      "unhandled-error",
      "confirming-run-differed",
      "next-run-unclean",
      "job-unclean",
    ]);
  });
});

const INTENDED: TestIdentity = {
  workspacePath: ".",
  projectName: "unit",
  modulePath: "test/a.test.mjs",
  namePath: ["a"],
  occurrence: 0,
};
const NO_JOB_ERRORS: JobEnd = { unhandledErrors: [] };
const MISSING = "missing";
/** An error as Vitest serializes a failed `expect`. */
const REJECTION: RawError = { name: "AssertionError" };

/**
 * A run of the intended test's module alone, in which the test passed unless `errors` names what failed it. The run
 * ended cleanly but for what `ending` holds, and the test holds a reach or repeats only when given one.
 */
function runRecord(
  record: {
    readonly errors?: readonly RawError[];
    readonly reach?: Reach;
    readonly repeats?: number;
    readonly ending?: Partial<
      Pick<RunRecord, "execution" | "forceStopped" | "cancelError">
    >;
    readonly unhandledErrors?: readonly RawError[];
    readonly unhandledErrorModules?: RunRecord["unhandledErrorModules"];
  } = {},
): RunRecord {
  const errors = record.errors ?? [];
  const state = errors.length === 0 ? "passed" : "failed";
  return {
    execution: "completed",
    forceStopped: false,
    ...record.ending,
    modules: [
      {
        projectName: INTENDED.projectName,
        modulePath: INTENDED.modulePath,
        collected: true,
        state,
        errors: [],
        suiteErrors: [],
        tests: [
          {
            identity: INTENDED,
            isDuplicate: false,
            mode: "run",
            state,
            errors,
            ...(record.repeats === undefined
              ? {}
              : { repeats: record.repeats }),
            hooks: HOOKS_PASSED,
            ...(record.reach === undefined ? {} : { reach: record.reach }),
          },
        ],
      },
    ],
    unhandledErrors: record.unhandledErrors ?? [],
    unhandledErrorModules: record.unhandledErrorModules ?? [],
  };
}

function experiment(defectId: string): DefectExperiment {
  return {
    defectId,
    test: INTENDED,
    mutation: { file: "src/a.mjs", old: "a + b", new: "a - b" },
  };
}

function ran(
  defectId: string,
  run: RunRecord,
): Extract<ExperimentRecord, { status: "ran" }> {
  return { defectId, status: "ran", run, mutation: [APPLIED] };
}

/** An experiment whose test rejected the mutation at an assertion in both its run and its confirming run. */
function confirmed(defectId: string): ExperimentRecord {
  const run = runRecord({ errors: [REJECTION], reach: IN_TEST });
  return {
    ...ran(defectId, run),
    confirming: { status: "ran", run, mutation: [APPLIED] },
  };
}

function unrecorded(defectId: string, run: UnrecordedRun): ExperimentRecord {
  return {
    defectId,
    status: "not-run",
    reason: { kind: "run-unrecorded", run },
  };
}

function jobOf(
  experiments: readonly ExperimentRecord[],
  baselineRecord: RunRecord = runRecord(),
): JobRuns {
  return {
    interrupted: false,
    baseline: { ran: true, record: baselineRecord },
    experiments,
    restoredBaseline: { ran: true, record: runRecord() },
  };
}

/** The first experiment's facts, of a job whose records pair with experiments of the same ids. */
function firstFacts(
  runs: JobRuns,
  assertionErrors: readonly string[] = [],
  end: JobEnd = NO_JOB_ERRORS,
): ExperimentFacts | undefined {
  return experimentFacts(
    runs,
    end,
    runs.experiments.map((record) => experiment(record.defectId)),
    assertionErrors,
  )[0]?.facts;
}

/** The first experiment's judgement, decided from the facts its job's records and the job's own end give. */
function firstJudgement(runs: JobRuns, end: JobEnd = NO_JOB_ERRORS): unknown {
  const facts = firstFacts(runs, [], end);
  return facts === undefined ? MISSING : judge(facts);
}

/** A job whose one experiment reads detected, but for what `baselineRecord` holds. */
function detectingJob(baselineRecord?: RunRecord): JobRuns {
  return jobOf([confirmed("a")], baselineRecord);
}

const BASELINE_NOT_CLEAN = {
  verdict: "invalid-experiment",
  reason: "baseline-not-clean",
};
const JOB_UNCLEAN = { verdict: "unclear", reason: "job-unclean" };

function nextRunOf(runs: JobRuns): unknown {
  const facts = firstFacts(runs);
  return facts !== undefined && "run" in facts
    ? (facts.nextRun ?? MISSING)
    : MISSING;
}

describe("an experiment's facts, read from the job's records", () => {
  it("D3802: the repeats a run's record holds for the test reach its facts, so the failed test reads test repeated", () => {
    expect(
      firstJudgement(
        jobOf([
          ran(
            "a",
            runRecord({ errors: [REJECTION], reach: IN_TEST, repeats: 1 }),
          ),
        ]),
      ),
    ).toEqual({
      verdict: "invalid-experiment",
      reason: "test-repeated",
      detail: { repeats: 1 },
    });
  });

  it("D3803: an unhandled error the job's own thread recorded reaches the facts, so a would-be detection reads job unclean", () => {
    expect([
      firstJudgement(detectingJob()),
      firstJudgement(detectingJob(), {
        unhandledErrors: ["unhandled rejection on the host thread"],
      }),
    ]).toEqual([DETECTED, JOB_UNCLEAN]);
  });

  it("D3804: an instance that failed to close reaches the facts, so a would-be detection reads job unclean", () => {
    expect([
      firstJudgement(detectingJob()),
      firstJudgement(detectingJob(), {
        unhandledErrors: [],
        closeError: "Error: close timed out",
      }),
    ]).toEqual([DETECTED, JOB_UNCLEAN]);
  });

  it("D3805: a baseline record whose workers Vitest force-stopped reaches the facts, so the experiment reads baseline not clean", () => {
    expect([
      firstJudgement(detectingJob()),
      firstJudgement(
        detectingJob(runRecord({ ending: { forceStopped: true } })),
      ),
    ]).toEqual([DETECTED, BASELINE_NOT_CLEAN]);
  });

  it("D3806: a baseline record whose cancel raised an error reaches the facts, so the experiment reads baseline not clean", () => {
    expect([
      firstJudgement(detectingJob()),
      firstJudgement(
        detectingJob(
          runRecord({ ending: { cancelError: "Error: cancel failed" } }),
        ),
      ),
    ]).toEqual([DETECTED, BASELINE_NOT_CLEAN]);
  });

  it("D3807: a baseline record that reads interrupted reaches the facts, so the experiment reads baseline not clean", () => {
    expect([
      firstJudgement(detectingJob()),
      firstJudgement(
        detectingJob(runRecord({ ending: { execution: "interrupted" } })),
      ),
    ]).toEqual([DETECTED, BASELINE_NOT_CLEAN]);
  });

  it("D3768: a baseline's unhandled error that names no test module counts against the experiment, as an unnamed one", () => {
    const facts = firstFacts(
      jobOf(
        [ran("a", runRecord())],
        runRecord({
          unhandledErrors: [{ name: "Error" }],
          unhandledErrorModules: [[]],
        }),
      ),
    )?.baseline;
    expect({
      counted: facts?.countedUnhandledErrorCount,
      unnamed: facts?.unnamedUnhandledErrorCount,
    }).toEqual({ counted: 1, unnamed: 1 });
  });

  it("D3769: an experiment whose run started and left no record is the run started next, read as leaving no record", () => {
    expect(
      nextRunOf(
        jobOf([
          confirmed("a"),
          unrecorded("b", { kind: "run-failed", error: "the run threw" }),
        ]),
      ),
    ).toEqual({ recorded: false });
  });

  it("D3770: a run the stale-transform guard refused never started, so the run after it is the one read", () => {
    expect(
      nextRunOf(
        jobOf([
          confirmed("a"),
          unrecorded("b", { kind: "stale-modules", modules: [] }),
          ran(
            "c",
            runRecord({
              unhandledErrors: [{ name: "Error" }],
              unhandledErrorModules: [[]],
            }),
          ),
        ]),
      ),
    ).toEqual({ recorded: true, unhandledErrorCount: 1 });
  });

  it("D3771: records that do not pair with the experiments given fail the job rather than judge one experiment's record against another's test", () => {
    expect(() =>
      experimentFacts(
        jobOf([confirmed("a")]),
        NO_JOB_ERRORS,
        [experiment("b")],
        [],
      ),
    ).toThrow("do not pair");
  });

  it("D3772: an error is an assertion by a declared name only when its name is exactly that name", () => {
    const facts = firstFacts(
      jobOf([
        ran(
          "a",
          runRecord({
            errors: [
              { name: "QueryError" },
              { name: "QueryErrorDetail" },
              { name: "queryerror" },
            ],
          }),
        ),
      ]),
      ["QueryError"],
    );
    expect(
      facts !== undefined && "run" in facts ? facts.run.test?.errors : MISSING,
    ).toEqual([
      { kind: "assertion", marker: "declared-name", name: "QueryError" },
      { kind: "other", name: "QueryErrorDetail" },
      { kind: "other", name: "queryerror" },
    ]);
  });

  it("D4037: an error whose name is anything but Error, its own or one it inherits, is called by that name whatever class it was built from, so its declared name counts and its declared class does not", () => {
    expect(
      errorFactsUnder(
        [
          {
            name: "TestingLibraryElementError",
            constructor: "Function<Error>",
          },
          { name: "SelfNamedError", constructor: "Function<SelfNamed>" },
          { name: "TypeError", constructor: "Function<OfType>" },
        ],
        ["TestingLibraryElementError", "SelfNamed", "OfType"],
      ),
    ).toEqual([
      {
        kind: "assertion",
        marker: "declared-name",
        name: "TestingLibraryElementError",
      },
      { kind: "other", name: "SelfNamedError" },
      { kind: "other", name: "TypeError" },
    ]);
  });

  it("D4038: an own constructor field that is not in Vitest's serialized function form leaves the error called by the name Vitest serialized", () => {
    expect(
      errorFactsUnder(
        [{ name: "Error", constructor: "a string of its own" }],
        ["a string of its own"],
      ),
    ).toEqual([{ kind: "other", name: "Error" }]);
  });

  it("D4039: an error Vitest serialized with no name has no name, whatever its constructor field holds", () => {
    expect(
      errorFactsUnder(
        [{ message: "forged", constructor: "Function<Unnamed>" }],
        ["Unnamed"],
      ),
    ).toStrictEqual([{ kind: "other" }]);
  });
});

/** The facts of `errors`, as the intended test's errors in an experiment's run, under the declared `assertionErrors`. */
function errorFactsUnder(
  errors: readonly RawError[],
  assertionErrors: readonly string[],
): unknown {
  const facts = firstFacts(
    jobOf([ran("a", runRecord({ errors }))]),
    assertionErrors,
  );
  return facts !== undefined && "run" in facts
    ? facts.run.test?.errors
    : MISSING;
}
