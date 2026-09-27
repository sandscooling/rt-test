/**
 * The longest per-test timeout any suite may declare, held by the tests that start a real daemon. The defect
 * verifier sizes its no-progress window from it and refuses a run holding a test that declares longer.
 */
export const LONGEST_TEST_TIMEOUT_MS = 120_000;
