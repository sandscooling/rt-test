/**
 * The facts an experiment's judgement is decided from. They hold states, kinds, names and counts, never an error's
 * message, its stack or any source text, and a fact a run did not record is absent.
 */

import type {
  ExperimentNotRun,
  Reach,
  RecordedRunModule,
  RecordedRunTest,
  RunRecord,
  UnrecordedRun,
} from "./experiment-record.js";
import type { MutationLoad } from "./mutation-transform.js";

export const ERROR_KIND = { assertion: "assertion", other: "other" } as const;

/**
 * The name an error inherits from `Error` unless it, or a class between it and `Error`, sets another. A plain error's
 * class has this name too.
 */
export const PLAIN_ERROR_NAME = "Error";

export const PASSED = "passed" satisfies RecordedRunTest["state"];

/** What made an error an assertion. */
export const ASSERTION_MARKER = {
  /** It is known by the name `AssertionError`. */
  assertionErrorName: "assertion-error-name",
  /** Vitest marked it as the failure of a matcher `expect.extend` added, with the matcher's name. */
  extendedMatcher: "extended-matcher",
  /** It is known by one of the assertion error names the job was given. */
  declaredName: "declared-name",
} as const;

export type AssertionMarker =
  (typeof ASSERTION_MARKER)[keyof typeof ASSERTION_MARKER];

/**
 * One error of the intended test. `name` is the name it is known by: its own, or its class's when its own is the plain
 * error's. It is absent when Vitest serialized no name.
 */
export type ErrorFact =
  | {
      readonly kind: typeof ERROR_KIND.assertion;
      readonly marker: AssertionMarker;
      readonly name?: string;
    }
  | { readonly kind: typeof ERROR_KIND.other; readonly name?: string };

export type HookStates = NonNullable<RecordedRunTest["hooks"]>;

export interface TestFacts {
  readonly state: RecordedRunTest["state"];
  readonly mode: RecordedRunTest["mode"];
  readonly errors: readonly ErrorFact[];
  /** How many more times than once Vitest was told to run the test; absent when none. */
  readonly repeats?: number;
  /** Absent when Vitest recorded no hook state on the test's result. */
  readonly hooks?: HookStates;
  /** Present only in an experiment's run. */
  readonly reach?: Reach;
}

export interface FailingSuite {
  readonly namePath: readonly string[];
  readonly errorCount: number;
}

/** The intended test's module in one run. */
export type ModuleFacts =
  | {
      readonly collected: true;
      readonly errorCount: number;
      readonly failingSuites: readonly FailingSuite[];
    }
  | {
      readonly collected: false;
      readonly state: Extract<RecordedRunModule, { collected: false }>["state"];
    };

/** How a run ended. It ended cleanly when it completed, was not force-stopped and its cancel raised no error. */
export interface RunEnding {
  readonly execution: RunRecord["execution"];
  readonly forceStopped: boolean;
  readonly cancelFailed: boolean;
}

/** What one run recorded about the intended test, about that test's module alone, and about the run as a whole. */
export interface RunFacts {
  /** Absent when the run recorded no result for the intended test. */
  readonly test?: TestFacts;
  /** Absent when the run's record names no module for the intended test. */
  readonly module?: ModuleFacts;
  /** Every unhandled error the run recorded, whatever it names. */
  readonly unhandledErrorCount: number;
  readonly ending: RunEnding;
}

/** A baseline's facts for one experiment. */
export interface BaselineFacts extends RunFacts {
  /**
   * The baseline's unhandled errors that count against the experiment: those naming its test's module, as the module
   * the worker that raised them was running, and those naming no test module of the baseline.
   */
  readonly countedUnhandledErrorCount: number;
  /** How many of the counted errors named no test module. */
  readonly unnamedUnhandledErrorCount: number;
}

/** A run with the experiment's mutation active, and what each transform of the mutated module did during it. */
export interface ExperimentRunFacts extends RunFacts {
  readonly mutation: readonly MutationLoad[];
}

type UnrecordedKind = UnrecordedRun["kind"];

export type ConfirmingFacts =
  | ({ readonly status: "ran" } & ExperimentRunFacts)
  | { readonly status: "unrecorded"; readonly run: UnrecordedKind }
  | { readonly status: "interrupted" };

export type RestoredBaselineFacts =
  | ({ readonly recorded: true } & BaselineFacts)
  | { readonly recorded: false; readonly run: UnrecordedKind };

/** The run the job started next after an experiment's confirming run; a run the guard refused never started. */
export type NextRunFact =
  | { readonly recorded: true; readonly unhandledErrorCount: number }
  | { readonly recorded: false };

/** Why the job gave an experiment no run. What the baseline gave the test is in the baseline's facts. */
export type NotRunFact =
  | {
      readonly kind: Exclude<
        ExperimentNotRun["kind"],
        "anchor-count" | "no-probe-site" | "run-unrecorded"
      >;
    }
  | Extract<ExperimentNotRun, { kind: "anchor-count" | "no-probe-site" }>
  | { readonly kind: "run-unrecorded"; readonly run: UnrecordedKind };

/** The job's own process: the unhandled errors on its thread while the instance was open, and whether it closed. */
export interface JobFacts {
  readonly unhandledErrorCount: number;
  readonly closed: boolean;
}

interface SharedFacts {
  /** Absent when the baseline left no record or the job ran none. */
  readonly baseline?: BaselineFacts;
  /** Absent when no restored baseline ran to its end: the job started none, or an abort interrupted it. */
  readonly restoredBaseline?: RestoredBaselineFacts;
  readonly job: JobFacts;
}

export type ExperimentFacts = SharedFacts &
  (
    | { readonly notRun: NotRunFact }
    | {
        readonly run: ExperimentRunFacts;
        /** Present only when the run would be a detection. */
        readonly confirming?: ConfirmingFacts;
        /** Present only when the confirming run left a record and the job started a run after it. */
        readonly nextRun?: NextRunFact;
      }
  );
