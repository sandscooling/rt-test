/**
 * How long after its signal aborts a run or discovery may take to end before Vitest's workers are force-stopped,
 * skipping the project's `afterAll` hooks and teardown. Work on Vitest's own thread, such as config loading or
 * `globalSetup`, is beyond it.
 */
export const FORCE_STOP_GRACE_MS = 10_000;
