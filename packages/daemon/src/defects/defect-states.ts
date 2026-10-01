import { VERDICT } from "../falsify/verdict.js";

export const DEFECT_STATE = {
  invalidDefinition: "invalid-definition",
  anchorMissing: "anchor-missing",
  survived: VERDICT.survived,
  invalidExperiment: VERDICT.invalidExperiment,
  unclear: VERDICT.unclear,
  neverVerified: "never-verified",
  detected: VERDICT.detected,
} as const;

export type DefectState = (typeof DEFECT_STATE)[keyof typeof DEFECT_STATE];

/**
 * Every state a definition can read, in the order `DEFECT_STATE` declares them, which is the order an answer lists
 * them: what withholds verified first, a detection last.
 */
export const DEFECT_STATES: readonly DefectState[] =
  Object.values(DEFECT_STATE);

/** The states of a definition that cannot run, which it reads whatever evidence is stored for it. */
export const NOT_RUNNABLE_STATES: readonly DefectState[] = [
  DEFECT_STATE.invalidDefinition,
  DEFECT_STATE.anchorMissing,
];

/** The verdicts that are not a detection. */
export const UNDETECTED_VERDICTS: readonly DefectState[] = [
  DEFECT_STATE.survived,
  DEFECT_STATE.invalidExperiment,
  DEFECT_STATE.unclear,
];
