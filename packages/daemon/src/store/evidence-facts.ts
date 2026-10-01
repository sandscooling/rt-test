import type {
  Reach,
  ReachUnknownReason,
} from "../falsify/experiment-record.js";
import {
  ASSERTION_MARKER,
  ERROR_KIND,
  type AssertionMarker,
  type BaselineFacts,
  type ConfirmingFacts,
  type ErrorFact,
  type ExperimentFacts,
  type ExperimentRunFacts,
  type FailingSuite,
  type HookStates,
  type JobFacts,
  type ModuleFacts,
  type NextRunFact,
  type NotRunFact,
  type RestoredBaselineFacts,
  type RunEnding,
  type RunFacts,
  type TestFacts,
} from "../falsify/fact-types.js";
import type { MutationLoad } from "../falsify/mutation-transform.js";
import type { NoProbeSite, ProbeSite } from "../falsify/reach-probe.js";
import { UNCLEAR_REASON, VERDICT, type Judgement } from "../falsify/verdict.js";
import {
  jsonArray,
  jsonBoolean,
  jsonMember,
  jsonCount,
  jsonOptional,
  jsonRecord,
  jsonStrings,
  jsonText,
  member,
  type Members,
} from "./columns.js";

export type Verdict = NonNullable<Judgement["verdict"]>;

/** A judgement that has a verdict: the verdict, with the reason and detail it carries. */
export type VerdictReading = Extract<Judgement, { readonly verdict: Verdict }>;

/** A judgement that has a verdict, with the facts it was decided from, as an evidence record holds it. */
export type StoredJudgement = VerdictReading & {
  readonly facts: ExperimentFacts;
};

type Invalid = typeof VERDICT.invalidExperiment;
type InvalidReading = Extract<VerdictReading, { verdict: Invalid }>;
/** What a confirming run alone read, which an unclear verdict's detail holds. */
export type ConfirmingReading = Extract<
  VerdictReading,
  { reason: typeof UNCLEAR_REASON.confirmingRunDiffered }
>["detail"]["confirming"];
/** The invalid readings one run can give, which a confirming run's reading is held to. */
type InvalidRunReading = Extract<ConfirmingReading, { verdict: Invalid }>;
type InvalidDetail<Reason extends InvalidReading["reason"]> = NonNullable<
  Extract<InvalidReading, { reason: Reason; detail?: unknown }>["detail"]
>;
type HookName = keyof HookStates;
type HookState = NonNullable<HookStates[HookName]>;
type AppliedLoad = Extract<MutationLoad, { applied: true }>;
type UnrecordedKind = Extract<NotRunFact, { kind: "run-unrecorded" }>["run"];

const RUN_INVALID_REASONS: Members<InvalidRunReading["reason"]> = {
  "run-not-clean": true,
  "module-failed": true,
  "suite-error": true,
  "test-not-run": true,
  "hook-not-passed": true,
  "test-repeated": true,
  "site-not-executed": true,
  "reach-unknown": true,
};
const INVALID_REASONS: Members<InvalidReading["reason"]> = {
  ...RUN_INVALID_REASONS,
  "no-probe-site": true,
  "no-module": true,
  "baseline-not-passed": true,
  "baseline-not-clean": true,
  "restored-baseline-not-passed": true,
  "restored-baseline-not-clean": true,
};
const NOT_RUN_TEST_STATES: Members<InvalidDetail<"test-not-run">["state"]> = {
  pending: true,
  skipped: true,
  absent: true,
};
const UNEXECUTED_MUTATIONS: Members<
  InvalidDetail<"site-not-executed">["mutation"]
> = {
  "never-transformed": true,
  "not-applied": true,
};
const HOOK_NAMES: Members<HookName> = {
  beforeAll: true,
  afterAll: true,
  aroundAll: true,
  beforeEach: true,
  afterEach: true,
  aroundEach: true,
};
const HOOK_STATES: Members<HookState> = {
  run: true,
  skip: true,
  only: true,
  todo: true,
  queued: true,
  pass: true,
  fail: true,
};
const DETAIL_HOOK_STATES: Members<InvalidDetail<"hook-not-passed">["state"]> = {
  ...HOOK_STATES,
  "not-recorded": true,
};
const REACH_VALUES: Members<Reach["executed"]> = {
  "in-test": true,
  "outside-test": true,
  no: true,
  unknown: true,
};
const REACH_UNKNOWN_REASONS: Members<ReachUnknownReason> = {
  "not-observed": true,
  unattributed: true,
  "no-probe": true,
};
const ERROR_KINDS: Members<ErrorFact["kind"]> = {
  [ERROR_KIND.assertion]: true,
  [ERROR_KIND.other]: true,
};
const ASSERTION_MARKERS: Members<AssertionMarker> = {
  [ASSERTION_MARKER.assertionErrorName]: true,
  [ASSERTION_MARKER.extendedMatcher]: true,
  [ASSERTION_MARKER.declaredName]: true,
};
const TEST_STATES: Members<TestFacts["state"]> = {
  pending: true,
  passed: true,
  failed: true,
  skipped: true,
};
const TEST_MODES: Members<TestFacts["mode"]> = {
  run: true,
  only: true,
  skip: true,
  todo: true,
};
const UNCOLLECTED_MODULE_STATES: Members<
  Extract<ModuleFacts, { readonly collected: false }>["state"]
> = {
  queued: true,
  pending: true,
  passed: true,
  failed: true,
  skipped: true,
  missing: true,
};
const RUN_EXECUTIONS: Members<RunEnding["execution"]> = {
  completed: true,
  interrupted: true,
};
const NO_PROBE_SITE_KINDS: Members<NoProbeSite["kind"]> = {
  position: true,
  unparsed: true,
};
const NOT_RUN_KINDS: Members<NotRunFact["kind"]> = {
  "baseline-not-passed": true,
  "baseline-not-run": true,
  "no-module": true,
  unreadable: true,
  "anchor-count": true,
  "no-probe-site": true,
  "run-unrecorded": true,
  interrupted: true,
};
const UNRECORDED_KINDS: Members<UnrecordedKind> = {
  "stale-modules": true,
  "run-failed": true,
};
const CONFIRMING_STATUSES: Members<ConfirmingFacts["status"]> = {
  ran: true,
  unrecorded: true,
  interrupted: true,
};

/** An invalid experiment's reason and detail, each rebuilt by the members its reason names. */
export function invalidReading(value: unknown): InvalidReading {
  const verdict = VERDICT.invalidExperiment;
  const reason = jsonMember(INVALID_REASONS, value, "reason");
  switch (reason) {
    case "no-probe-site":
      return { verdict, reason, detail: noProbeSiteDetail(detailOf(value)) };
    case "baseline-not-passed":
      return {
        verdict,
        reason,
        ...jsonOptional(value, "detail", held(testStateAndMode)),
      };
    case "no-module":
    case "baseline-not-clean":
    case "restored-baseline-not-passed":
    case "restored-baseline-not-clean":
      return { verdict, reason };
    default:
      return runReading(reason, value);
  }
}

/** A confirming run's invalid reading, whose reason is one a run alone can give. */
export function invalidRunReading(value: unknown): InvalidRunReading {
  return runReading(jsonMember(RUN_INVALID_REASONS, value, "reason"), value);
}

function runReading(
  reason: InvalidRunReading["reason"],
  value: unknown,
): InvalidRunReading {
  const verdict = VERDICT.invalidExperiment;
  switch (reason) {
    case "run-not-clean":
    case "module-failed":
      return { verdict, reason };
    case "suite-error":
      return {
        verdict,
        reason,
        detail: { suite: jsonStrings(detailOf(value), "suite") },
      };
    case "test-not-run":
      return {
        verdict,
        reason,
        detail: {
          state: jsonMember(NOT_RUN_TEST_STATES, detailOf(value), "state"),
        },
      };
    case "hook-not-passed":
      return { verdict, reason, detail: hookDetail(detailOf(value)) };
    case "test-repeated":
      return {
        verdict,
        reason,
        detail: { repeats: jsonCount(detailOf(value), "repeats") },
      };
    case "site-not-executed":
      return {
        verdict,
        reason,
        ...jsonOptional(value, "detail", held(unexecutedDetail)),
      };
    case "reach-unknown":
      return {
        verdict,
        reason,
        ...jsonOptional(value, "detail", held(reachUnknownDetail)),
      };
  }
}

function detailOf(value: unknown): Record<string, unknown> {
  return jsonRecord(value, "detail");
}

/** Reads a field that holds an object, rebuilt by `rebuild`. */
function held<T>(
  rebuild: (value: Record<string, unknown>) => T,
): (holder: unknown, key: string) => T {
  return (holder, key) => rebuild(jsonRecord(holder, key));
}

function noProbeSiteDetail(value: unknown): InvalidDetail<"no-probe-site"> {
  return { site: noProbeSite(jsonRecord(value, "site")) };
}

function hookDetail(value: unknown): InvalidDetail<"hook-not-passed"> {
  return {
    hook: jsonMember(HOOK_NAMES, value, "hook"),
    state: jsonMember(DETAIL_HOOK_STATES, value, "state"),
  };
}

function unexecutedDetail(value: unknown): InvalidDetail<"site-not-executed"> {
  const mutation = jsonMember(UNEXECUTED_MUTATIONS, value, "mutation");
  switch (mutation) {
    case "never-transformed":
      return { mutation };
    case "not-applied":
      return { mutation, occurrences: jsonCount(value, "occurrences") };
  }
}

function reachUnknownDetail(value: unknown): InvalidDetail<"reach-unknown"> {
  return { cause: jsonMember(REACH_UNKNOWN_REASONS, value, "cause") };
}

/** The facts a judgement was decided from, each rebuilt by its own named members down to the leaves. */
export function storedFacts(value: unknown): ExperimentFacts {
  const shared = {
    ...jsonOptional(value, "baseline", held(baselineFacts)),
    ...jsonOptional(value, "restoredBaseline", held(restoredBaselineFacts)),
    job: jobFacts(jsonRecord(value, "job")),
  };
  const { notRun } = jsonOptional(value, "notRun", held(notRunFact));
  if (notRun !== undefined) return { ...shared, notRun };
  return {
    ...shared,
    run: experimentRunFacts(jsonRecord(value, "run")),
    ...jsonOptional(value, "confirming", held(confirmingFacts)),
    ...jsonOptional(value, "nextRun", held(nextRunFact)),
  };
}

function jobFacts(value: unknown): JobFacts {
  return {
    unhandledErrorCount: jsonCount(value, "unhandledErrorCount"),
    closed: jsonBoolean(value, "closed"),
  };
}

function notRunFact(value: unknown): NotRunFact {
  const kind = jsonMember(NOT_RUN_KINDS, value, "kind");
  switch (kind) {
    case "anchor-count":
      return { kind, count: jsonCount(value, "count") };
    case "no-probe-site":
      return { kind, site: noProbeSite(jsonRecord(value, "site")) };
    case "run-unrecorded":
      return { kind, run: jsonMember(UNRECORDED_KINDS, value, "run") };
    case "baseline-not-passed":
    case "baseline-not-run":
    case "no-module":
    case "unreadable":
    case "interrupted":
      return { kind };
  }
}

function runFacts(value: unknown): RunFacts {
  return {
    ...jsonOptional(value, "test", held(testFacts)),
    ...jsonOptional(value, "module", held(moduleFacts)),
    unhandledErrorCount: jsonCount(value, "unhandledErrorCount"),
    ending: runEnding(jsonRecord(value, "ending")),
  };
}

function baselineFacts(value: unknown): BaselineFacts {
  return {
    ...runFacts(value),
    countedUnhandledErrorCount: jsonCount(value, "countedUnhandledErrorCount"),
    unnamedUnhandledErrorCount: jsonCount(value, "unnamedUnhandledErrorCount"),
  };
}

function experimentRunFacts(value: unknown): ExperimentRunFacts {
  return {
    ...runFacts(value),
    mutation: jsonArray(value, "mutation", mutationLoad),
  };
}

function restoredBaselineFacts(value: unknown): RestoredBaselineFacts {
  return jsonBoolean(value, "recorded")
    ? { recorded: true, ...baselineFacts(value) }
    : { recorded: false, run: jsonMember(UNRECORDED_KINDS, value, "run") };
}

function confirmingFacts(value: unknown): ConfirmingFacts {
  const status = jsonMember(CONFIRMING_STATUSES, value, "status");
  switch (status) {
    case "ran":
      return { status, ...experimentRunFacts(value) };
    case "unrecorded":
      return { status, run: jsonMember(UNRECORDED_KINDS, value, "run") };
    case "interrupted":
      return { status };
  }
}

function nextRunFact(value: unknown): NextRunFact {
  return jsonBoolean(value, "recorded")
    ? {
        recorded: true,
        unhandledErrorCount: jsonCount(value, "unhandledErrorCount"),
      }
    : { recorded: false };
}

function runEnding(value: unknown): RunEnding {
  return {
    execution: jsonMember(RUN_EXECUTIONS, value, "execution"),
    forceStopped: jsonBoolean(value, "forceStopped"),
    cancelFailed: jsonBoolean(value, "cancelFailed"),
  };
}

function testStateAndMode(value: unknown): Pick<TestFacts, "state" | "mode"> {
  return {
    state: jsonMember(TEST_STATES, value, "state"),
    mode: jsonMember(TEST_MODES, value, "mode"),
  };
}

function testFacts(value: unknown): TestFacts {
  return {
    ...testStateAndMode(value),
    errors: jsonArray(value, "errors", errorFact),
    ...jsonOptional(value, "repeats", jsonCount),
    ...jsonOptional(value, "hooks", held(hookStates)),
    ...jsonOptional(value, "reach", held(reach)),
  };
}

/** An error's name is kept whole, as Vitest serialized it. */
function errorFact(value: unknown): ErrorFact {
  const kind = jsonMember(ERROR_KINDS, value, "kind");
  const name = jsonOptional(value, "name", jsonText);
  switch (kind) {
    case ERROR_KIND.assertion:
      return {
        kind,
        marker: jsonMember(ASSERTION_MARKERS, value, "marker"),
        ...name,
      };
    case ERROR_KIND.other:
      return { kind, ...name };
  }
}

function hookStates(value: Record<string, unknown>): HookStates {
  const states: Partial<Record<HookName, HookState>> = {};
  for (const name of Object.keys(value)) {
    const hook = member(HOOK_NAMES, name, "hook name");
    states[hook] = jsonMember(HOOK_STATES, value, name);
  }
  return states;
}

function reach(value: unknown): Reach {
  const executed = jsonMember(REACH_VALUES, value, "executed");
  switch (executed) {
    case "in-test":
    case "outside-test":
    case "no":
      return { executed };
    case "unknown":
      return {
        executed,
        reason: jsonMember(REACH_UNKNOWN_REASONS, value, "reason"),
      };
  }
}

function moduleFacts(value: unknown): ModuleFacts {
  return jsonBoolean(value, "collected")
    ? {
        collected: true,
        errorCount: jsonCount(value, "errorCount"),
        failingSuites: jsonArray(value, "failingSuites", failingSuite),
      }
    : {
        collected: false,
        state: jsonMember(UNCOLLECTED_MODULE_STATES, value, "state"),
      };
}

function failingSuite(value: unknown): FailingSuite {
  return {
    namePath: jsonStrings(value, "namePath"),
    errorCount: jsonCount(value, "errorCount"),
  };
}

function mutationLoad(value: unknown): MutationLoad {
  return jsonBoolean(value, "applied")
    ? { applied: true, probe: probe(jsonRecord(value, "probe")) }
    : { applied: false, occurrences: jsonCount(value, "occurrences") };
}

function probe(value: unknown): AppliedLoad["probe"] {
  return jsonBoolean(value, "placed")
    ? { placed: true, site: probeSite(jsonRecord(value, "site")) }
    : { placed: false, reason: noProbeSite(jsonRecord(value, "reason")) };
}

function probeSite(value: unknown): ProbeSite {
  return {
    line: jsonCount(value, "line"),
    column: jsonCount(value, "column"),
    nodeKind: jsonText(value, "nodeKind"),
  };
}

function noProbeSite(value: unknown): NoProbeSite {
  const kind = jsonMember(NO_PROBE_SITE_KINDS, value, "kind");
  switch (kind) {
    case "position":
      return {
        kind,
        ...probeSite(value),
        role: jsonText(value, "role"),
      };
    case "unparsed":
      return {
        kind,
        ...jsonOptional(value, "line", jsonCount),
        ...jsonOptional(value, "column", jsonCount),
        ...jsonOptional(value, "nesting", jsonCount),
      };
  }
}
