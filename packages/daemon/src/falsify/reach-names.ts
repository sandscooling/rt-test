/** The global the reach setup file defines in each worker and every reach probe calls. */
export const REACH_RECORDER = "__rtTestReach";

/** A probe's call: a worker without the recorder runs it as nothing. */
export const REACH_PROBE_CALL = `globalThis.${REACH_RECORDER}?.()`;

/** The key of the mark the reach setup file writes on each test's metadata. */
export const REACH_META_KEY = "rtTestReach";

/** The reach setup file's mark on a test it ran for; a test without one was not observed. */
export interface ReachMark {
  readonly observed: true;
  /** The probe fired while this test, its `beforeEach` or its `afterEach` ran. */
  readonly inTest?: true;
  /** The probe fired while no test ran, under the file or a suite enclosing this test. */
  readonly outsideTest?: true;
  /** The probe fired while this test ran beside others, so the firing cannot be attributed. */
  readonly unattributed?: true;
}
