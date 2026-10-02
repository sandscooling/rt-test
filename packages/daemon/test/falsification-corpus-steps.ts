/**
 * The falsification corpus's steps as data. In the fixture `packages/app` imports `packages/lib` by package name, so
 * a file of the library is an input of both workspaces and a file of the app is an input of the app alone. Each step
 * declares what the rules give, never what a run read: every definition's state, eligibility, evidence freshness and
 * reason, the answer's counts as numbers, and the definitions whose evidence the step replaces, which are the
 * eligible definitions of each workspace an edited file is an input of.
 */

import type { VerdictReason } from "../src/defects/defect-standings.js";
import {
  DEFECT_STATE,
  type DefectState,
} from "../src/defects/defect-states.js";
import { CURRENT } from "../src/query/answer.js";
import type { ListedEvidence } from "../src/query/defects-answer.js";

export const FALSIFICATION_CORPUS_FIXTURE = "falsification-corpus";

const LIB = "packages/lib";
const APP = "packages/app";

/** The Vitest workspaces the fixture holds, each of which a start confirms. */
export const CORPUS_WORKSPACES: readonly string[] = [LIB, APP];

/** The definition files the fixture's `rt-test.json` lists, relative to the consumer root. */
export const DEFINITION_FILES: readonly string[] = [
  `${LIB}/named-defects.json`,
  `${APP}/named-defects.json`,
];

/** One exact text replaced once in a file. */
export interface FileChange {
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

/** What an answer gives beside a verdict. */
export type DeclaredEvidence = Pick<ListedEvidence, "freshness" | "reason">;

export interface DeclaredDefinition {
  readonly state: DefectState;
  readonly eligible: boolean;
  /** Absent where the state is no verdict, which an answer gives no evidence beside. */
  readonly evidence?: DeclaredEvidence;
}

export interface DeclaredCounts {
  readonly total: number;
  readonly eligible: number;
  readonly verified: number;
  readonly states: Readonly<Record<DefectState, number>>;
}

export interface CorpusStep {
  readonly name: string;
  /** None at the baseline, which starts every confirmed workspace with no edit. */
  readonly changes: readonly FileChange[];
  /** Every definition the fixture holds, by id. */
  readonly definitions: Readonly<Record<string, DeclaredDefinition>>;
  readonly counts: DeclaredCounts;
  /** The ids of the definitions whose stored evidence the step replaces, or first stores. */
  readonly falsified: readonly string[];
}

const LIB_DISCOUNT = "lib-discount";
const LIB_RATE_SETUP = "lib-rate-setup";
const LIB_LABEL = "lib-label";
const APP_TOTAL_FIRST = "app-total-first";
const APP_TOTAL_SECOND = "app-total-second";
const APP_TOTAL_UNNAMED = "app-total-unnamed";
const APP_RECEIPT = "app-receipt";

const HOOK_NOT_PASSED: VerdictReason = "hook-not-passed";

/** The intended test fails an assertion in its body under the mutation. */
const DETECTED: DeclaredDefinition = {
  state: DEFECT_STATE.detected,
  eligible: true,
  evidence: { freshness: CURRENT },
};
/** The intended test reaches the mutated code and passes. */
const SURVIVED: DeclaredDefinition = {
  state: DEFECT_STATE.survived,
  eligible: true,
  evidence: { freshness: CURRENT },
};
/** The mutation fails an assertion in a setup hook, which is no detection by the intended test. */
const FAILED_IN_SETUP: DeclaredDefinition = {
  state: DEFECT_STATE.invalidExperiment,
  eligible: true,
  evidence: { freshness: CURRENT, reason: HOOK_NOT_PASSED },
};
/** Its name path is shared by two tests and it names no occurrence, so it resolves to neither. */
const AMBIGUOUS: DeclaredDefinition = {
  state: DEFECT_STATE.invalidDefinition,
  eligible: false,
};
/** Its `old` text no longer occurs in its file, whatever evidence the store keeps for it. */
const ANCHOR_MISSING: DeclaredDefinition = {
  state: DEFECT_STATE.anchorMissing,
  eligible: false,
};

const NO_DEFINITION_IN_ANY_STATE: Readonly<Record<DefectState, number>> = {
  [DEFECT_STATE.invalidDefinition]: 0,
  [DEFECT_STATE.anchorMissing]: 0,
  [DEFECT_STATE.survived]: 0,
  [DEFECT_STATE.invalidExperiment]: 0,
  [DEFECT_STATE.unclear]: 0,
  [DEFECT_STATE.neverVerified]: 0,
  [DEFECT_STATE.detected]: 0,
};

const AT_BASELINE: Readonly<Record<string, DeclaredDefinition>> = {
  [LIB_DISCOUNT]: DETECTED,
  [LIB_RATE_SETUP]: FAILED_IN_SETUP,
  [LIB_LABEL]: DETECTED,
  [APP_TOTAL_FIRST]: DETECTED,
  [APP_TOTAL_SECOND]: SURVIVED,
  [APP_TOTAL_UNNAMED]: AMBIGUOUS,
  [APP_RECEIPT]: DETECTED,
};

/** Every definition that reads a verdict is falsified once, since the store holds no evidence before the start. */
export const BASELINE: CorpusStep = {
  name: "baseline",
  changes: [],
  definitions: AT_BASELINE,
  counts: {
    total: 7,
    eligible: 6,
    verified: 4,
    states: {
      ...NO_DEFINITION_IN_ANY_STATE,
      [DEFECT_STATE.detected]: 4,
      [DEFECT_STATE.survived]: 1,
      [DEFECT_STATE.invalidExperiment]: 1,
      [DEFECT_STATE.invalidDefinition]: 1,
    },
  },
  falsified: [
    LIB_DISCOUNT,
    LIB_RATE_SETUP,
    LIB_LABEL,
    APP_TOTAL_FIRST,
    APP_TOTAL_SECOND,
    APP_RECEIPT,
  ],
};

const AFTER_REWRITE: Readonly<Record<string, DeclaredDefinition>> = {
  ...AT_BASELINE,
  [APP_RECEIPT]: ANCHOR_MISSING,
};

/**
 * Rewrites the line the receipt's anchor names, leaving what the code does unchanged. The app's source is no input of
 * the library, whose evidence stays the baseline's records, and the receipt's definition can no longer run.
 */
export const ANCHOR_REWRITTEN: CorpusStep = {
  name: "the app's anchored line rewritten",
  changes: [
    {
      path: `${APP}/src/cart.mjs`,
      from: "return `Total: ${total(prices)}`;",
      to: "return `Total: ${String(total(prices))}`;",
    },
  ],
  definitions: AFTER_REWRITE,
  counts: {
    total: 7,
    eligible: 5,
    verified: 3,
    states: {
      ...NO_DEFINITION_IN_ANY_STATE,
      [DEFECT_STATE.detected]: 3,
      [DEFECT_STATE.survived]: 1,
      [DEFECT_STATE.invalidExperiment]: 1,
      [DEFECT_STATE.invalidDefinition]: 1,
      [DEFECT_STATE.anchorMissing]: 1,
    },
  },
  falsified: [APP_TOTAL_FIRST, APP_TOTAL_SECOND],
};

/**
 * Weakens the assertion that detected the discount's mutation, so its test passes with and without it. The library's
 * test module is an input of both workspaces, so every eligible definition of both is falsified again.
 */
export const ASSERTION_WEAKENED: CorpusStep = {
  name: "the library's assertion weakened",
  changes: [
    {
      path: `${LIB}/test/price.test.mjs`,
      from: "expect(discounted(100)).toBe(90);",
      to: "expect(discounted(100)).toBeGreaterThan(0);",
    },
  ],
  definitions: { ...AFTER_REWRITE, [LIB_DISCOUNT]: SURVIVED },
  counts: {
    total: 7,
    eligible: 5,
    verified: 2,
    states: {
      ...NO_DEFINITION_IN_ANY_STATE,
      [DEFECT_STATE.detected]: 2,
      [DEFECT_STATE.survived]: 2,
      [DEFECT_STATE.invalidExperiment]: 1,
      [DEFECT_STATE.invalidDefinition]: 1,
      [DEFECT_STATE.anchorMissing]: 1,
    },
  },
  falsified: [
    LIB_DISCOUNT,
    LIB_RATE_SETUP,
    LIB_LABEL,
    APP_TOTAL_FIRST,
    APP_TOTAL_SECOND,
  ],
};

/** The steps of a replay in order, the baseline first. */
export const CORPUS_STEPS: readonly CorpusStep[] = [
  BASELINE,
  ANCHOR_REWRITTEN,
  ASSERTION_WEAKENED,
];
