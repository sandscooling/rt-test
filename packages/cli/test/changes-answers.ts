import {
  PROTOCOL_VERSION,
  TEST_STATES,
  type ChangesResponse,
  type ListedChange,
  type TestCounts,
} from "@rt-test/daemon/client";
import { HAND_BUILT_ROOT } from "../../daemon/test/harness.js";

/** The consumer root every scripted answer names. */
export const ANSWER_ROOT = HAND_BUILT_ROOT;
export const GIVEN_CURSOR = "life.1";
export const NEW_CURSOR = "life.2";
export const BUILD_NOT_ENDED =
  "the dependency build that decides its inputs at input revision 4 has not ended";

export type Determined = Extract<ChangesResponse, { determined: true }>;
export type NotDetermined = Extract<ChangesResponse, { determined: false }>;

export const NO_TESTS: TestCounts = {
  tests: 0,
  states: Object.fromEntries(
    TEST_STATES.map((state) => [state, 0]),
  ) as TestCounts["states"],
  freshness: { current: 0, stale: 0, unknown: 0 },
};

/** What every answer carries, at input revision 4. */
const CONTEXT = {
  type: "changes",
  protocolVersion: PROTOCOL_VERSION,
  consumerRoot: ANSWER_ROOT,
  currentAdapterVersion: 3,
  discovery: {
    discoveryId: "discovery-1",
    adapterVersion: 3,
    adapterVersionCurrent: true,
    freshness: "current",
  },
  inputs: {
    revision: 4,
    reconciliation: { state: "complete" },
    watcher: { state: "healthy" },
    pendingChanges: 0,
    gitUnread: [],
  },
  unfingerprintedWorkspaces: [],
  activity: { state: "idle" },
  unstoredJobs: [],
  schedule: { round: { state: "planned", revision: 4 }, workspaces: [] },
  latestSelection: { state: "no-round-yet" },
  revision: 4,
} as const;

/** A determined answer listing the changes since the given cursor, none by default, as `more` overrides. */
export function determined(more: Partial<Determined> = {}): Determined {
  return {
    ...CONTEXT,
    cursor: NEW_CURSOR,
    cursorUse: "used",
    determined: true,
    changes: [],
    omittedChanges: { failing: 0, recovered: 0, other: 0 },
    coverage: { state: "selected", revision: 4 },
    files: [{ path: "src/a.ts" }],
    counts: NO_TESTS,
    outside: { counts: NO_TESTS, changed: 0 },
    ...more,
  };
}

/** An answer not determined since the build at revision 4 has not ended, handing back the given cursor. */
export function notDetermined(
  more: Partial<NotDetermined> = {},
): NotDetermined {
  return {
    ...CONTEXT,
    cursor: GIVEN_CURSOR,
    cursorUse: "used",
    determined: false,
    notDetermined: {
      kind: "build-not-ended",
      reason: { reason: BUILD_NOT_ENDED, omittedCharacters: 0 },
    },
    ...more,
  };
}

export const FAILING_CHANGE: ListedChange = {
  kind: "failing",
  firstError: { reason: "boom", omittedCharacters: 0 },
  test: {
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/a.test.ts",
    namePath: ["outer", "inner"],
    occurrence: 0,
  },
  atCursor: { state: "passed", freshness: "current" },
  now: { state: "failed", freshness: "current" },
};

export const RECOVERED_ENTRY: ListedChange = {
  kind: "recovered",
  atCursor: {
    kind: "failed-module",
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/b.test.ts",
    errorCount: 1,
    reason: "SyntaxError: Unexpected token",
    omittedCharacters: 0,
  },
};

export const DROPPED_TEST: ListedChange = {
  kind: "other",
  test: {
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/c.test.ts",
    namePath: ["dropped"],
    occurrence: 0,
  },
  atCursor: { state: "passed", freshness: "current" },
};

/** Counts of `tests` tests, every one standing `state` and `freshness`. */
export function countsOf(
  tests: number,
  state: keyof TestCounts["states"],
  freshness: keyof TestCounts["freshness"],
): TestCounts {
  return {
    tests,
    states: { ...NO_TESTS.states, [state]: tests },
    freshness: { ...NO_TESTS.freshness, [freshness]: tests },
  };
}
