import type { DefectStanding } from "../src/defects/defect-standings.js";
import {
  FALSIFIER_VERSION,
  type ExperimentJudgement,
  type ExperimentRecord,
  type Reach,
  type RunRecord,
} from "../src/falsify/experiment-record.js";
import type {
  BaselineFacts,
  ErrorFact,
  ExperimentFacts,
  ExperimentRunFacts,
  HookStates,
  ModuleFacts,
  RunEnding,
  TestFacts,
} from "../src/falsify/fact-types.js";
import type { MutationLoad } from "../src/falsify/mutation-transform.js";
import { judge } from "../src/falsify/verdict.js";
import type { StoredEvidence } from "../src/store/defect-evidence.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { RanJob } from "./falsify/job-readings.js";
import { DISCOVERED_VITEST_VERSION } from "./scheduling-harness.js";

export type RanFacts = Extract<ExperimentFacts, { run: ExperimentRunFacts }>;

export const CLEAN_END: RunEnding = {
  execution: "completed",
  forceStopped: false,
  cancelFailed: false,
};
const COLLECTED: ModuleFacts = {
  collected: true,
  errorCount: 0,
  failingSuites: [],
};
export const ASSERTION: ErrorFact = {
  kind: "assertion",
  marker: "assertion-error-name",
  name: "AssertionError",
};
export const TYPE_ERROR: ErrorFact = { kind: "other", name: "TypeError" };
export const APPLIED: MutationLoad = {
  applied: true,
  probe: {
    placed: true,
    site: { line: 2, column: 10, nodeKind: "BinaryExpression" },
  },
};
export const HOOKS_PASSED: HookStates = { beforeEach: "pass" };
export const IN_TEST: Reach = { executed: "in-test" };
export const PASSED_TEST: TestFacts = {
  state: "passed",
  mode: "run",
  errors: [],
  hooks: HOOKS_PASSED,
};
/** The intended test as a detection's run records it: failed at an assertion, its hook passed, the site executed in it. */
export const REJECTING_TEST: TestFacts = {
  state: "failed",
  mode: "run",
  errors: [ASSERTION],
  hooks: HOOKS_PASSED,
  reach: IN_TEST,
};
export const SURVIVING_TEST: TestFacts = { ...PASSED_TEST, reach: IN_TEST };
export const CLEAN_JOB = { unhandledErrorCount: 0, closed: true };

export function baseline(facts: Partial<BaselineFacts> = {}): BaselineFacts {
  return {
    test: PASSED_TEST,
    module: COLLECTED,
    unhandledErrorCount: 0,
    ending: CLEAN_END,
    countedUnhandledErrorCount: 0,
    unnamedUnhandledErrorCount: 0,
    ...facts,
  };
}

export function mutatedRun(
  facts: Partial<ExperimentRunFacts> = {},
): ExperimentRunFacts {
  return {
    test: REJECTING_TEST,
    module: COLLECTED,
    unhandledErrorCount: 0,
    ending: CLEAN_END,
    mutation: [APPLIED],
    ...facts,
  };
}

/** Facts that hold every condition of a detection, but for what `facts` replaces. */
export function detection(facts: Partial<RanFacts> = {}): RanFacts {
  return {
    baseline: baseline(),
    restoredBaseline: { recorded: true, ...baseline() },
    job: CLEAN_JOB,
    run: mutatedRun(),
    confirming: { status: "ran", ...mutatedRun() },
    nextRun: { recorded: true, unhandledErrorCount: 0 },
    ...facts,
  };
}

/** An experiment whose one run was no would-be detection, as the job leaves it: no confirming run and no run read after it. */
export function ranOnce(run: Partial<ExperimentRunFacts>): RanFacts {
  return {
    baseline: baseline(),
    restoredBaseline: { recorded: true, ...baseline() },
    job: CLEAN_JOB,
    run: mutatedRun(run),
  };
}

/**
 * A detection as the store holds it for the definition `standing` describes: bound to the definition's digest, its
 * mutation file's digest as its anchor was read, the fingerprint digest given, the current falsifier and adapter
 * versions and the Vitest version the hand-built discoveries report.
 */
export function detectionFor(
  standing: DefectStanding | undefined,
  inputFingerprintDigest: string,
): StoredEvidence {
  if (standing?.definitionDigest === undefined) {
    throw new Error("the definition has no digest to bind evidence to");
  }
  return {
    projectIdentity: "/consumer/.git",
    worktreeIdentity: "/consumer",
    evidenceId: "evidence-1",
    inputFingerprintDigest,
    defectId: standing.definition.id ?? "",
    definitionDigest: standing.definitionDigest,
    mutationFileDigest: standing.definition.mutationFileDigest ?? "",
    vitestVersion: DISCOVERED_VITEST_VERSION,
    falsifierVersion: FALSIFIER_VERSION,
    adapterVersion: VITEST_ADAPTER_VERSION,
    verdict: "detected",
    judgement: { verdict: "detected", facts: detection() },
  };
}

/** One experiment of a reply: the facts its judgement is decided from, and what its record carries. */
export interface ReplyExperiment {
  readonly defectId: string;
  readonly facts: ExperimentFacts;
  /** Absent for a record that carries no mutation file digest. */
  readonly mutationFileDigest?: string;
  /** The raw record of its run; one that recorded nothing when absent. */
  readonly run?: RunRecord;
}

/** A run's raw record holding no module and no unhandled error. */
export const EMPTY_RUN: RunRecord = {
  execution: "completed",
  forceStopped: false,
  modules: [],
  unhandledErrors: [],
  unhandledErrorModules: [],
};

/** The judgement the judge gives the experiment's facts, as a job's reply carries it. */
function judged({ defectId, facts }: ReplyExperiment): ExperimentJudgement {
  return { ...judge(facts), defectId, facts };
}

function recordOf(experiment: ReplyExperiment): ExperimentRecord {
  const { defectId, mutationFileDigest } = experiment;
  return {
    defectId,
    status: "ran",
    run: experiment.run ?? EMPTY_RUN,
    mutation: [APPLIED],
    ...(mutationFileDigest === undefined ? {} : { mutationFileDigest }),
  };
}

/**
 * The reply of a job that ran `experiments`: each one's judgement as the judge gives it, and each one's record, under
 * the current falsifier version.
 */
export function ranReply(experiments: readonly ReplyExperiment[]): RanJob {
  return {
    status: "ran",
    workspace: { path: "packages/cart", directory: "/work/shop/packages/cart" },
    vitestVersion: DISCOVERED_VITEST_VERSION,
    falsifierVersion: FALSIFIER_VERSION,
    unhandledErrors: [],
    interrupted: false,
    experiments: experiments.map(recordOf),
    judgements: experiments.map(judged),
  };
}
