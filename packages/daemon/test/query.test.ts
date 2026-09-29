import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceSchedule } from "../src/daemon/workspace-schedule.js";
import { currentInputs } from "../src/inputs/current-inputs.js";
import { countEnvironment } from "../src/inputs/environment-digest.js";
import {
  ProjectInputs,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import type { CurrentInputs } from "../src/inputs/input-tracker.js";
import type {
  Narrowing,
  NarrowingState,
  QueryNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import {
  DUE_REASON,
  ROUND_WAIT,
  type InputFacts,
  type NoAnswer,
  type PathStatusAnswer,
  type SummaryAnswer,
  type TestCounts,
} from "../src/query/answer.js";
import { pathStatusAnswer } from "../src/query/path-status.js";
import { summaryAnswer, type DaemonView } from "../src/query/summary.js";
import type { LatestResults } from "../src/store/open-store.js";
import type {
  InputFingerprint,
  StoredDiscovery,
  StoredRun,
} from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type {
  DiscoveredTest,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { UnreadWorkspaceSource } from "../src/vitest/find-workspaces.js";
import type { RecordedModule, RecordedTest } from "../src/vitest/run-states.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import type { TestOutcome } from "@rt-test/core";
import { inTempDir } from "./harness.js";

type RanRun = Extract<WorkspaceRun, { status: "ran" }>;
type DiscoveredWorkspace = Extract<
  WorkspaceDiscovery,
  { status: "discovered" }
>;

const ROOT = "/consumer";
const PROJECT = "unit";
const WORKSPACE_A = "packages/a";
const WORKSPACE_B = "packages/b";
const MODULE = "src/a.test.ts";
const UNFINGERPRINTED: InputFingerprint = { kind: "not-fingerprinted" };
const CRASH_EXIT = "the executor process 7 exited during the job (exit code 1)";
const CRASHED_RUN: WorkspaceRun = {
  status: "crashed",
  workspace: { path: WORKSPACE_A, directory: `${ROOT}/${WORKSPACE_A}` },
  error: CRASH_EXIT,
};
const DIGEST = {
  kind: "digest",
  digest: "sha256:9F86D081884C7D65",
} as const satisfies InputFingerprint;
/** Any adapter version but the daemon's current one. */
const OTHER_ADAPTER_VERSION = VITEST_ADAPTER_VERSION + 1;
/** A schedule as the daemon's starts, pending on the first reconciliation with no round planned yet. */
function freshSchedule(): WorkspaceSchedule {
  return new WorkspaceSchedule({
    confirmed: () => true,
    storedNothing: () => false,
  });
}

const IDLE: DaemonView = {
  consumerRoot: ROOT,
  activity: { state: "idle" },
  unstoredJobs: [],
  schedule: freshSchedule(),
};
const FIRST_RECONCILIATION = "the first reconciliation has not ended";
const OTHER_DIGEST = "sha256:2C26B46B68FFC68F";

/** Inputs before the first reconciliation has ended, when no fingerprint can be computed. */
const UNSETTLED: CurrentInputs = {
  facts: {
    revision: 0,
    reconciliation: { state: "incomplete", reason: FIRST_RECONCILIATION },
    watcher: { state: "healthy" },
    pendingChanges: 0,
    gitUnread: [],
  },
  unavailable: FIRST_RECONCILIATION,
  snapshot: undefined,
  workspaceFingerprint: () => ({ ok: false, reason: FIRST_RECONCILIATION }),
  discoveryFingerprint: () => ({ ok: false, reason: FIRST_RECONCILIATION }),
  protectedFileChangedSince: () => FIRST_RECONCILIATION,
};

const SETTLED_FACTS: InputFacts = {
  revision: 3,
  reconciliation: { state: "complete" },
  lastReconciledAt: "2026-09-27T12:00:00.000Z",
  watcher: { state: "healthy" },
  pendingChanges: 0,
  gitUnread: [],
};

/** Settled inputs whose current fingerprint is `workspaces[path]` for each workspace, and `discovery` for the discovery. */
function settled(
  workspaces: Readonly<Record<string, FingerprintResult>>,
  discovery: FingerprintResult = { ok: true, digest: OTHER_DIGEST },
): CurrentInputs {
  return {
    facts: SETTLED_FACTS,
    snapshot: undefined,
    workspaceFingerprint: (entry) =>
      workspaces[entry.workspace.path] ?? {
        ok: false,
        reason: `no fingerprint was scripted for ${entry.workspace.path}`,
      },
    discoveryFingerprint: () => discovery,
    protectedFileChangedSince: () => undefined,
  };
}

function digestOf(fingerprint: InputFingerprint): FingerprintResult {
  return fingerprint.kind === "digest"
    ? { ok: true, digest: fingerprint.digest }
    : { ok: false, reason: "not fingerprinted" };
}

interface TestPlace {
  readonly workspacePath?: string;
  readonly projectName?: string;
  readonly modulePath?: string;
  readonly isDuplicate?: boolean;
}

function discovered(name: string, place: TestPlace = {}): DiscoveredTest {
  return {
    identity: {
      workspacePath: place.workspacePath ?? WORKSPACE_A,
      projectName: place.projectName ?? PROJECT,
      modulePath: place.modulePath ?? MODULE,
      namePath: [name],
      occurrence: 0,
    },
    isDuplicate: place.isDuplicate ?? false,
    mode: "run",
  };
}

function workspaceOf(path: string, root = ROOT) {
  return { path, directory: join(root, path) };
}

function discoveredWorkspace(
  path: string,
  tests: readonly DiscoveredTest[],
  more: Partial<DiscoveredWorkspace> = {},
): DiscoveredWorkspace {
  return {
    status: "discovered",
    workspace: workspaceOf(path),
    vitestVersion: "5.0.1",
    tests,
    failedModules: [],
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
    selectionFacts: { reported: true, projects: [] },
    ...more,
  };
}

function storedDiscovery(
  workspaces: readonly WorkspaceDiscovery[],
  notRead: readonly UnreadWorkspaceSource[] = [],
  adapterVersion = VITEST_ADAPTER_VERSION,
  inputFingerprint = UNFINGERPRINTED,
): StoredDiscovery {
  return {
    projectIdentity: `${ROOT}/.git`,
    worktreeIdentity: ROOT,
    inputFingerprint,
    adapterVersion,
    discoveryId: "discovery-1",
    discovery: { workspaces, notRead },
  };
}

function finished(test: DiscoveredTest, outcome: TestOutcome): RecordedTest {
  return {
    identity: test.identity,
    isDuplicate: test.isDuplicate,
    execution: "finished",
    outcome,
    errors: [],
  };
}

function ranModule(
  tests: readonly RecordedTest[],
  modulePath = MODULE,
  projectName = PROJECT,
): Extract<RecordedModule, { state: "ran" }> {
  return { projectName, modulePath, state: "ran", tests, errors: [] };
}

function ranRun(
  modules: readonly RecordedModule[],
  more: Partial<RanRun> = {},
  path = WORKSPACE_A,
): RanRun {
  return {
    status: "ran",
    workspace: workspaceOf(path),
    vitestVersion: "5.0.1",
    execution: "completed",
    modules,
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
    forceStopped: false,
    ...more,
  };
}

function storedRun(
  run: WorkspaceRun,
  adapterVersion = VITEST_ADAPTER_VERSION,
  inputFingerprint = UNFINGERPRINTED,
): StoredRun {
  return {
    projectIdentity: `${ROOT}/.git`,
    worktreeIdentity: ROOT,
    inputFingerprint,
    adapterVersion,
    runId: `run-${run.workspace.path}`,
    run,
  };
}

function results(
  discovery: StoredDiscovery | undefined,
  latestRuns: readonly StoredRun[] = [],
  discoveryRefusal?: string,
): LatestResults {
  return { discovery, discoveryRefusal, latestRuns };
}

function answered<A extends object>(answer: A | NoAnswer): A {
  if ("noAnswer" in answer) throw new Error(answer.noAnswer);
  return answer;
}

function summaryOf(
  discovery: StoredDiscovery,
  latestRuns: readonly StoredRun[] = [],
  inputs: CurrentInputs = UNSETTLED,
): SummaryAnswer {
  return answered(summaryAnswer(results(discovery, latestRuns), IDLE, inputs));
}

/** The counts of a set that are not zero, which is all a test of one state or freshness needs to read. */
function nonZero(counts: Readonly<Record<string, number>>) {
  return Object.fromEntries(
    Object.entries(counts).filter(([, count]) => count !== 0),
  );
}

/** A summary of two tests of workspace A whose latest run crashed, under settled inputs whose fingerprint is the run's. */
function crashedUnderCurrentInputs(): SummaryAnswer {
  return summaryOf(
    storedDiscovery([
      discoveredWorkspace(WORKSPACE_A, [discovered("a"), discovered("b")]),
    ]),
    [storedRun(CRASHED_RUN, VITEST_ADAPTER_VERSION, DIGEST)],
    settled({ [WORKSPACE_A]: { ok: true, digest: DIGEST.digest } }),
  );
}

/** The states of one test of workspace A, answered by `run`. */
function statesOf(test: DiscoveredTest, run: WorkspaceRun) {
  const summary = summaryOf(
    storedDiscovery([discoveredWorkspace(WORKSPACE_A, [test])]),
    [storedRun(run)],
  );
  return nonZero(summary.counts.states);
}

function nonZeroCounts(counts: TestCounts) {
  return {
    states: nonZero(counts.states),
    freshness: nonZero(counts.freshness),
  };
}

describe("each discovered test's one state", () => {
  it("D1792: a finished test's state is its own outcome, each outcome counted apart", () => {
    const tests = (["passed", "failed", "skipped", "error"] as const).map(
      (outcome) => [discovered(outcome), outcome] as const,
    );
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(
          WORKSPACE_A,
          tests.map(([test]) => test),
        ),
      ]),
      [
        storedRun(
          ranRun([
            ranModule(tests.map(([test, outcome]) => finished(test, outcome))),
          ]),
        ),
      ],
    );
    expect(nonZero(summary.counts.states)).toStrictEqual({
      passed: 1,
      failed: 1,
      skipped: 1,
      error: 1,
    });
  });

  it("D1793: a test its latest run left unfinished is interrupted, with no outcome", () => {
    const test = discovered("left");
    const unfinished: RecordedTest = {
      identity: test.identity,
      isDuplicate: false,
      execution: "interrupted",
    };
    expect(statesOf(test, ranRun([ranModule([unfinished])]))).toStrictEqual({
      interrupted: 1,
    });
  });

  it("D1794: a test whose module the latest run did not run is module-not-run", () => {
    const test = discovered("later");
    const module: RecordedModule = {
      projectName: PROJECT,
      modulePath: MODULE,
      state: "not-run",
    };
    expect(statesOf(test, ranRun([module]))).toStrictEqual({
      "module-not-run": 1,
    });
  });

  it("D1795: a test whose module crashed in the latest run is module-crashed", () => {
    const test = discovered("crashing");
    const module: RecordedModule = {
      projectName: PROJECT,
      modulePath: MODULE,
      state: "crashed",
    };
    expect(statesOf(test, ranRun([module]))).toStrictEqual({
      "module-crashed": 1,
    });
  });

  it("D1796: a test whose module failed to load in the latest run is module-failed-to-load", () => {
    const test = discovered("broken");
    const module: RecordedModule = {
      projectName: PROJECT,
      modulePath: MODULE,
      state: "failed",
      errors: ["SyntaxError: Unexpected token"],
    };
    expect(statesOf(test, ranRun([module]))).toStrictEqual({
      "module-failed-to-load": 1,
    });
  });

  it("D1797: a test whose workspace's latest run failed to load it is run-failed", () => {
    const run: WorkspaceRun = {
      status: "failed",
      workspace: workspaceOf(WORKSPACE_A),
      vitestVersion: "5.0.1",
      error: "Error: config boom",
    };
    expect(statesOf(discovered("any"), run)).toStrictEqual({ "run-failed": 1 });
  });

  it("D1798: a test whose workspace's latest run found no supported Vitest is run-unsupported-vitest", () => {
    const run: WorkspaceRun = {
      status: "unsupported",
      workspace: workspaceOf(WORKSPACE_A),
      vitest: {
        supported: false,
        version: "3.2.4",
        supportedRange: "^4.1.0 || ^5.0.0",
        reason: "Vitest 3.2.4 is outside the supported range",
      },
    };
    expect(statesOf(discovered("any"), run)).toStrictEqual({
      "run-unsupported-vitest": 1,
    });
  });

  it("D1799: a test whose workspace's latest run was interrupted before loading it is run-interrupted-before-load", () => {
    const run: WorkspaceRun = {
      status: "interrupted-before-load",
      workspace: workspaceOf(WORKSPACE_A),
    };
    expect(statesOf(discovered("any"), run)).toStrictEqual({
      "run-interrupted-before-load": 1,
    });
  });

  it("D1800: a test the latest run does not hold, whether or not it holds the test's module, is not-in-latest-run and never passed", () => {
    const added = discovered("added after the run");
    const elsewhere = discovered("in a module the run lacks", {
      modulePath: "src/new.test.ts",
    });
    const kept = discovered("kept");
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [added, elsewhere, kept]),
      ]),
      [storedRun(ranRun([ranModule([finished(kept, "failed")])]))],
    );
    expect(nonZero(summary.counts.states)).toStrictEqual({
      failed: 1,
      "not-in-latest-run": 2,
    });
  });

  it("D1801: a test of a workspace with no stored run is never-run", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
        discoveredWorkspace(WORKSPACE_B, [
          discovered("b", { workspacePath: WORKSPACE_B }),
        ]),
      ]),
      [storedRun(ranRun([ranModule([finished(discovered("a"), "passed")])]))],
    );
    expect(nonZero(summary.counts.states)).toStrictEqual({
      passed: 1,
      "never-run": 1,
    });
  });

  it("D1802: the answer lists every state by name, a state with no test included", () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
    );
    expect(Object.keys(summary.counts.states).sort()).toStrictEqual([
      "error",
      "failed",
      "interrupted",
      "module-crashed",
      "module-failed-to-load",
      "module-not-run",
      "never-run",
      "not-in-latest-run",
      "passed",
      "run-crashed",
      "run-failed",
      "run-interrupted-before-load",
      "run-unsupported-vitest",
      "skipped",
    ]);
  });

  it("D2782: every test of a workspace whose latest run crashed reads run-crashed, with freshness unknown", () => {
    expect(nonZeroCounts(crashedUnderCurrentInputs().counts)).toStrictEqual({
      states: { "run-crashed": 2 },
      freshness: { unknown: 2 },
    });
  });

  it("D2794: a test of a workspace whose latest run crashed never reads current, even with the run's inputs unchanged", () => {
    expect(nonZero(crashedUnderCurrentInputs().counts.freshness)).toStrictEqual(
      { unknown: 2 },
    );
  });

  it("D2785: an answer counts run-crashed at zero when no test is in it", () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
    );
    expect(summary.counts.states["run-crashed"]).toBe(0);
  });

  it("D2783: a workspace whose latest run crashed has a latest run reading crashed, with the exit as its reason", () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
      [storedRun(CRASHED_RUN)],
    );
    expect(summary.workspaces[0]?.latestRun).toStrictEqual({
      runId: `run-${WORKSPACE_A}`,
      adapterVersion: VITEST_ADAPTER_VERSION,
      adapterVersionCurrent: true,
      status: "crashed",
      reason: CRASH_EXIT,
      omittedCharacters: 0,
    });
  });

  it("D2784: a crashed run's reason past 1,000 characters is cut to 1,000, counting the rest", () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
      [storedRun({ ...CRASHED_RUN, error: "x".repeat(1500) })],
    );
    const latestRun = summary.workspaces[0]?.latestRun;
    expect(
      latestRun !== null && latestRun !== undefined && "reason" in latestRun
        ? {
            kept: latestRun.reason.length,
            omitted: latestRun.omittedCharacters,
          }
        : latestRun,
    ).toStrictEqual({ kept: 1000, omitted: 500 });
  });

  it("D1803: a run's result for a same-named test of another project never answers the discovered test", () => {
    const test = discovered("shared name");
    const otherProject = discovered("shared name", { projectName: "e2e" });
    const run = ranRun([
      ranModule([]),
      ranModule([finished(otherProject, "passed")], MODULE, "e2e"),
    ]);
    expect(statesOf(test, run)).toStrictEqual({ "not-in-latest-run": 1 });
  });
});

describe("each test's freshness, beside its state", () => {
  it("D1804: a finished result from a run of another adapter version keeps its outcome and is stale", () => {
    const test = discovered("old");
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [test])]),
      [
        storedRun(
          ranRun([ranModule([finished(test, "passed")])]),
          OTHER_ADAPTER_VERSION,
        ),
      ],
    );
    expect(nonZeroCounts(summary.counts)).toStrictEqual({
      states: { passed: 1 },
      freshness: { stale: 1 },
    });
  });

  it("D1805: a test with no finished result is unknown, even from a run of another adapter version", () => {
    const test = discovered("left");
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [test])]),
      [
        storedRun(
          ranRun([
            ranModule([
              {
                identity: test.identity,
                isDuplicate: false,
                execution: "interrupted",
              },
            ]),
          ]),
          OTHER_ADAPTER_VERSION,
        ),
      ],
    );
    expect(nonZero(summary.counts.freshness)).toStrictEqual({ unknown: 1 });
  });

  it("D1806: a finished result of the current adapter version stored with a digest is unknown while no current fingerprint can be computed", () => {
    const test = discovered("fingerprinted");
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [test])]),
      [
        storedRun(
          ranRun([ranModule([finished(test, "passed")])]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
    );
    expect(nonZero(summary.counts.freshness)).toStrictEqual({ unknown: 1 });
  });

  it("D1807: a discovery of another adapter version still counts its tests, and the answer says it is not current", () => {
    const summary = summaryOf(
      storedDiscovery(
        [discoveredWorkspace(WORKSPACE_A, [discovered("a"), discovered("b")])],
        [],
        OTHER_ADAPTER_VERSION,
      ),
    );
    expect({
      tests: summary.counts.tests,
      discovery: summary.discovery,
    }).toStrictEqual({
      tests: 2,
      discovery: {
        discoveryId: "discovery-1",
        adapterVersion: OTHER_ADAPTER_VERSION,
        adapterVersionCurrent: false,
        freshness: "stale",
      },
    });
  });

  it("D1883: a finished result stored with a digest equal to its workspace's current fingerprint is current", () => {
    const test = discovered("unchanged");
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [test])]),
      [
        storedRun(
          ranRun([ranModule([finished(test, "passed")])]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
      settled({ [WORKSPACE_A]: digestOf(DIGEST) }),
    );
    expect(nonZero(summary.counts.freshness)).toStrictEqual({ current: 1 });
  });

  it("D1884: each result is compared with its own workspace's current fingerprint, so one stored under another workspace's digest is stale", () => {
    const inA = discovered("a");
    const inB = discovered("b", { workspacePath: WORKSPACE_B });
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [inA]),
        discoveredWorkspace(WORKSPACE_B, [inB]),
      ]),
      [
        storedRun(
          ranRun([ranModule([finished(inA, "passed")])]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
        storedRun(
          ranRun([ranModule([finished(inB, "passed")])], {}, WORKSPACE_B),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
      settled({
        [WORKSPACE_A]: digestOf(DIGEST),
        [WORKSPACE_B]: { ok: true, digest: OTHER_DIGEST },
      }),
    );
    expect(nonZero(summary.counts.freshness)).toStrictEqual({
      current: 1,
      stale: 1,
    });
  });

  it("D1885: the answer's discovery is current when its stored digest equals the discovery's current fingerprint", () => {
    const summary = summaryOf(
      storedDiscovery(
        [discoveredWorkspace(WORKSPACE_A, [discovered("a")])],
        [],
        VITEST_ADAPTER_VERSION,
        DIGEST,
      ),
      [],
      settled({ [WORKSPACE_A]: digestOf(DIGEST) }, digestOf(DIGEST)),
    );
    expect(summary.discovery.freshness).toBe("current");
  });

  it("D1886: a workspace whose own fingerprint cannot be computed is listed with the reason, while the others answer", () => {
    const reason =
      "the test module packages/b/gen/b.test.ts cannot be read: EISDIR: illegal operation on a directory, read";
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
        discoveredWorkspace(WORKSPACE_B, [
          discovered("b", { workspacePath: WORKSPACE_B }),
        ]),
      ]),
      [],
      settled({
        [WORKSPACE_A]: digestOf(DIGEST),
        [WORKSPACE_B]: { ok: false, reason },
      }),
    );
    expect(summary.unfingerprintedWorkspaces).toStrictEqual([
      { workspacePath: WORKSPACE_B, reason },
    ]);
  });

  it("D1887: while the discovery is not current, a duplicate-marked test's result is unknown and a uniquely named test's is current", () => {
    const first = discovered("twin", { isDuplicate: true });
    const second: DiscoveredTest = {
      ...first,
      identity: { ...first.identity, occurrence: 1 },
    };
    const alone = discovered("alone");
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [first, second, alone]),
      ]),
      [
        storedRun(
          ranRun([
            ranModule([
              finished(first, "passed"),
              finished(second, "failed"),
              finished(alone, "passed"),
            ]),
          ]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
      settled({ [WORKSPACE_A]: digestOf(DIGEST) }),
    );
    expect({
      freshness: nonZero(summary.counts.freshness),
      discovery: summary.discovery.freshness,
    }).toStrictEqual({
      freshness: { unknown: 2, current: 1 },
      discovery: "unknown",
    });
  });

  it("D1935: while the discovery is not current, a test it lists once but the run records twice is unknown, not current from the new test's result", () => {
    const listed = discovered("twin");
    const recordedFirst: RecordedTest = {
      ...finished(listed, "failed"),
      isDuplicate: true,
    };
    const recordedSecond: RecordedTest = {
      ...finished(listed, "passed"),
      identity: { ...listed.identity, occurrence: 1 },
      isDuplicate: true,
    };
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [listed])]),
      [
        storedRun(
          ranRun([ranModule([recordedFirst, recordedSecond])]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
      settled({ [WORKSPACE_A]: digestOf(DIGEST) }),
    );
    expect(nonZero(summary.counts.freshness)).toStrictEqual({ unknown: 1 });
  });

  it("D1936: while the discovery is current, a duplicate-marked test's result stored under the current digest is current", () => {
    const first = discovered("twin", { isDuplicate: true });
    const second: DiscoveredTest = {
      ...first,
      identity: { ...first.identity, occurrence: 1 },
    };
    const summary = summaryOf(
      storedDiscovery(
        [discoveredWorkspace(WORKSPACE_A, [first, second])],
        [],
        VITEST_ADAPTER_VERSION,
        DIGEST,
      ),
      [
        storedRun(
          ranRun([
            ranModule([finished(first, "passed"), finished(second, "passed")]),
          ]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
      settled({ [WORKSPACE_A]: digestOf(DIGEST) }, digestOf(DIGEST)),
    );
    expect(nonZero(summary.counts.freshness)).toStrictEqual({ current: 2 });
  });

  it("D1937: a discovery stored under another digest than its current fingerprint is stale, and vouches for no duplicate's position", () => {
    const first = discovered("twin", { isDuplicate: true });
    const second: DiscoveredTest = {
      ...first,
      identity: { ...first.identity, occurrence: 1 },
    };
    const summary = summaryOf(
      storedDiscovery(
        [discoveredWorkspace(WORKSPACE_A, [first, second])],
        [],
        VITEST_ADAPTER_VERSION,
        DIGEST,
      ),
      [
        storedRun(
          ranRun([
            ranModule([finished(first, "passed"), finished(second, "passed")]),
          ]),
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      ],
      settled(
        { [WORKSPACE_A]: digestOf(DIGEST) },
        { ok: true, digest: OTHER_DIGEST },
      ),
    );
    expect({
      discovery: summary.discovery.freshness,
      freshness: nonZero(summary.counts.freshness),
    }).toStrictEqual({ discovery: "stale", freshness: { unknown: 2 } });
  });

  it("D1938: a summary and a path status carry the input facts of the inputs they were answered from", async () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
      [],
      settled({ [WORKSPACE_A]: digestOf(DIGEST) }),
    );
    const pathStatus = await statusIn(
      WORKSPACE_A,
      (answer) => ("noAnswer" in answer ? answer : answer.inputs),
      settled({}),
    );
    expect({ summary: summary.inputs, pathStatus }).toStrictEqual({
      summary: SETTLED_FACTS,
      pathStatus: SETTLED_FACTS,
    });
  });

  it("D2019: while the daemon's rt-test.json cannot be used, a summary and a path status each carry the reason", async () => {
    const reason =
      "rt-test.json declares no non-inputs, so every file stays an input: its top level is not a JSON object";
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
      [],
      { ...settled({}), nonInputsUnusable: reason },
    );
    const pathStatus = await statusIn(
      WORKSPACE_A,
      (answer) => ("noAnswer" in answer ? answer : answer.nonInputsUnusable),
      { ...settled({}), nonInputsUnusable: reason },
    );
    expect({
      summary: summary.nonInputsUnusable,
      pathStatus,
    }).toStrictEqual({ summary: reason, pathStatus: reason });
  });

  it("D1939: while no fingerprint can be computed, no workspace is listed as unfingerprinted on its own", () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
    );
    expect(summary.unfingerprintedWorkspaces).toStrictEqual([]);
  });
});

const A_MODULE = `${WORKSPACE_A}/${MODULE}`;
const A_SOURCE = `${WORKSPACE_A}/src/a.ts`;
const B_MODULE = `${WORKSPACE_B}/${MODULE}`;
const B_SOURCE = `${WORKSPACE_B}/src/b.ts`;
/** Every input of the project, each path to its content digest. */
const PROJECT_INPUTS: Readonly<Record<string, string>> = {
  [A_MODULE]: "a-module",
  [A_SOURCE]: "a-source",
  [B_MODULE]: "b-module",
  [B_SOURCE]: "b-source",
};
const NARROWED_SETS: Readonly<Record<string, readonly string[]>> = {
  [WORKSPACE_A]: [A_MODULE, A_SOURCE],
  [WORKSPACE_B]: [B_MODULE, B_SOURCE],
};
const DISCOVERY_ID = "discovery-1";
const BUILD_FAILED =
  "the executor process 7 exited during the job (exit code 1)";
const REFUSAL = "../outside.ts leaves the consumer root";

/**
 * A narrowing that gives each workspace the inputs `NARROWED_SETS` lists for it, as a build's selection would, or,
 * given a refusal, every input of the project, as `Narrowing` does once selection refuses.
 */
function narrowedTo(refusal?: string): Narrowing {
  const standIn: Pick<Narrowing, "workspaceInputs" | "refusal"> = {
    refusal: () => refusal,
    workspaceInputs: (project, workspacePath) =>
      refusal !== undefined
        ? project
        : new ProjectInputs(
            project.root,
            new Map(
              [...project.digests].filter(([path]) =>
                (NARROWED_SETS[workspacePath] ?? []).includes(path),
              ),
            ),
          ),
  };
  return standIn as Narrowing;
}

/** The builds' state for the discovery the query reads, `DISCOVERY_ID`, with the builds still working. */
function narrowingOf(state: NarrowingState): QueryNarrowing {
  return { discoveryId: DISCOVERY_ID, state, buildsEnded: undefined };
}

function builtAt(
  revision: number,
  narrowing: Narrowing = narrowedTo(),
  discoveryId = DISCOVERY_ID,
): QueryNarrowing {
  return narrowingOf({
    discoveryId,
    selectionInput: true,
    latest: { revision, built: true, narrowing },
    lastFailure: undefined,
  });
}

function failedAt(revision: number): QueryNarrowing {
  return narrowingOf({
    discoveryId: DISCOVERY_ID,
    selectionInput: true,
    latest: {
      revision,
      built: false,
      kind: "dependency-build-failed",
      reason: BUILD_FAILED,
    },
    lastFailure: { kind: "dependency-build-failed", reason: BUILD_FAILED },
  });
}

/**
 * The tracker's view over `PROJECT_INPUTS`, with `edits` applied, at revision 3 under `narrowing`; undefined for every
 * input of the project, as before any build. While the tracker cannot vouch for its inputs (`unavailable`), the
 * committed inputs it holds are the last ones it read.
 */
function viewOf(
  narrowing: QueryNarrowing | undefined,
  edits: Readonly<Record<string, string>> = {},
  unavailable: string | undefined = undefined,
): CurrentInputs {
  return currentInputs({
    facts: SETTLED_FACTS,
    unavailable,
    nonInputsUnusable: undefined,
    environment: countEnvironment(process.env, []).digest,
    narrowing,
    project: () =>
      new ProjectInputs(
        ROOT,
        new Map(Object.entries({ ...PROJECT_INPUTS, ...edits })),
      ),
  });
}

function asStored(fingerprint: FingerprintResult): InputFingerprint {
  return fingerprint.ok
    ? { kind: "digest", digest: fingerprint.digest }
    : UNFINGERPRINTED;
}

const TEST_A = discovered("a");
const ENTRY_A = discoveredWorkspace(WORKSPACE_A, [TEST_A]);
const TWO_WORKSPACES = storedDiscovery([
  ENTRY_A,
  discoveredWorkspace(WORKSPACE_B, [
    discovered("b", { workspacePath: WORKSPACE_B }),
  ]),
]);

/** Workspace `a`'s one passing test, stored under `fingerprint`, read through `inputs`; the discovery lists `a` alone. */
function freshnessOfA(
  fingerprint: FingerprintResult,
  inputs: CurrentInputs,
): Record<string, number> {
  return nonZero(
    summaryOf(
      storedDiscovery([ENTRY_A]),
      [
        storedRun(
          ranRun([ranModule([finished(TEST_A, "passed")])]),
          VITEST_ADAPTER_VERSION,
          asStored(fingerprint),
        ),
      ],
      inputs,
    ).counts.freshness,
  );
}

/** Each unfingerprinted workspace, and whether its reason names the dependency build. */
function unfingerprintedIn(inputs: CurrentInputs): unknown {
  return summaryOf(TWO_WORKSPACES, [], inputs).unfingerprintedWorkspaces.map(
    ({ workspacePath, reason }) => ({
      workspacePath,
      namesBuild: reason.includes("dependency build"),
    }),
  );
}

const BOTH_BUILDING = [
  { workspacePath: WORKSPACE_A, namesBuild: true },
  { workspacePath: WORKSPACE_B, namesBuild: true },
];

describe("each workspace's inputs as the dependency builds narrow them", () => {
  it("D2523: while the build at the current revision has not ended, each workspace is unfingerprinted naming the build, and the discovery's freshness is unaffected", () => {
    const stored = asStored(
      viewOf(undefined).discoveryFingerprint(TWO_WORKSPACES.discovery),
    );
    const building = viewOf(
      narrowingOf({
        discoveryId: DISCOVERY_ID,
        selectionInput: true,
        latest: undefined,
        lastFailure: undefined,
      }),
    );
    const summary = summaryOf(
      { ...TWO_WORKSPACES, inputFingerprint: stored },
      [],
      building,
    );
    expect({
      discovery: summary.discovery.freshness,
      unfingerprinted: unfingerprintedIn(building),
    }).toStrictEqual({ discovery: "current", unfingerprinted: BOTH_BUILDING });
  });

  it("D2524: a narrowing built at an earlier input revision is never used; each workspace reads as waiting for the build", () => {
    expect(unfingerprintedIn(viewOf(builtAt(2)))).toStrictEqual(BOTH_BUILDING);
  });

  it("D2525: a narrowing built over another discovery than the one the answer reads is never used", () => {
    expect(
      unfingerprintedIn(viewOf(builtAt(3, narrowedTo(), "discovery-0"))),
    ).toStrictEqual(BOTH_BUILDING);
  });

  it("D2526: after a failed build, a summary and a path status each carry why no workspace's inputs are narrowed", async () => {
    const expected = { kind: "dependency-build-failed", reason: BUILD_FAILED };
    const summary = summaryOf(TWO_WORKSPACES, [], viewOf(failedAt(3)));
    const pathStatus = await statusIn(
      WORKSPACE_A,
      (answer) => ("noAnswer" in answer ? answer : answer.inputsNotNarrowed),
      viewOf(failedAt(3)),
    );
    expect({
      summary: summary.inputsNotNarrowed,
      pathStatus,
    }).toStrictEqual({ summary: expected, pathStatus: expected });
  });

  it("D2527: after a failed build, a result stored under the whole project's fingerprint reads current", () => {
    const whole = viewOf(undefined).workspaceFingerprint(ENTRY_A);
    expect(freshnessOfA(whole, viewOf(failedAt(3)))).toStrictEqual({
      current: 1,
    });
  });

  it("D2528: while the build after a failed one runs, answers still carry the failure", () => {
    const rebuilding = narrowingOf({
      discoveryId: DISCOVERY_ID,
      selectionInput: true,
      latest: {
        revision: 2,
        built: false,
        kind: "dependency-build-failed",
        reason: BUILD_FAILED,
      },
      lastFailure: { kind: "dependency-build-failed", reason: BUILD_FAILED },
    });
    expect(
      summaryOf(TWO_WORKSPACES, [], viewOf(rebuilding)).inputsNotNarrowed,
    ).toStrictEqual({ kind: "dependency-build-failed", reason: BUILD_FAILED });
  });

  it("D2529: a discovery that yields no selection input is named as the reason no workspace's inputs are narrowed", () => {
    const reason =
      "the discovery in effect does not report the setup files and aliases of the Vitest workspace packages/a";
    const unreported = narrowingOf({
      discoveryId: DISCOVERY_ID,
      selectionInput: false,
      reason,
    });
    expect(
      summaryOf(TWO_WORKSPACES, [], viewOf(unreported)).inputsNotNarrowed,
    ).toStrictEqual({ kind: "no-selection-input", reason });
  });

  it("D2530: a narrowing whose selection refuses an input's path is named as the reason no workspace's inputs are narrowed", () => {
    expect(
      summaryOf(TWO_WORKSPACES, [], viewOf(builtAt(3, narrowedTo(REFUSAL))))
        .inputsNotNarrowed,
    ).toStrictEqual({ kind: "selection-refused", reason: REFUSAL });
  });

  it("D2602: once the builds ended, a narrowing built at the current revision is never used, and the builds' end is the reason no workspace's inputs are narrowed", () => {
    const reason = "the tracker failed: EIO";
    expect(
      summaryOf(
        TWO_WORKSPACES,
        [],
        viewOf({ ...builtAt(3), buildsEnded: reason }),
      ).inputsNotNarrowed,
    ).toStrictEqual({ kind: "dependency-builds-ended", reason });
  });

  it("D2531: once narrowed, an edit to an input outside a workspace's set leaves its result current, and one inside makes it stale", () => {
    const stored = viewOf(builtAt(3)).workspaceFingerprint(ENTRY_A);
    expect({
      outside: freshnessOfA(
        stored,
        viewOf(builtAt(3), { [B_SOURCE]: "b-edited" }),
      ),
      inside: freshnessOfA(
        stored,
        viewOf(builtAt(3), { [A_SOURCE]: "a-edited" }),
      ),
    }).toStrictEqual({ outside: { current: 1 }, inside: { stale: 1 } });
  });
});

describe("what the summary lists as not discovered", () => {
  it("D1808: a workspace the start did not confirm is listed as not confirmed, by its status", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
        {
          status: "not-confirmed",
          workspace: workspaceOf(WORKSPACE_B),
          reason: "not confirmed at start",
        },
      ]),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "workspace-not-confirmed",
        workspacePath: WORKSPACE_B,
        reason: "not confirmed at start",
        omittedCharacters: 0,
      },
    ]);
  });

  it("D1809: a workspace whose discovery failed is listed with its error", () => {
    const summary = summaryOf(
      storedDiscovery([
        {
          status: "failed",
          workspace: workspaceOf(WORKSPACE_B),
          vitestVersion: "5.0.1",
          error: "Error: config boom",
        },
      ]),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "workspace-discovery-failed",
        workspacePath: WORKSPACE_B,
        reason: "Error: config boom",
        omittedCharacters: 0,
      },
    ]);
  });

  it("D1810: a workspace with no supported Vitest is listed with the reason", () => {
    const summary = summaryOf(
      storedDiscovery([
        {
          status: "unsupported",
          workspace: workspaceOf(WORKSPACE_B),
          vitest: {
            supported: false,
            version: "3.2.4",
            supportedRange: "^4.1.0 || ^5.0.0",
            reason: "Vitest 3.2.4 is outside the supported range",
          },
        },
      ]),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "workspace-unsupported-vitest",
        workspacePath: WORKSPACE_B,
        reason: "Vitest 3.2.4 is outside the supported range",
        omittedCharacters: 0,
      },
    ]);
  });

  it("D1811: a module that failed to load during discovery is listed with its errors and their count", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [], {
          failedModules: [
            {
              projectName: PROJECT,
              modulePath: "src/broken.test.ts",
              errors: ["SyntaxError: one", "Error: two"],
            },
          ],
        }),
      ]),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "failed-module",
        workspacePath: WORKSPACE_A,
        projectName: PROJECT,
        modulePath: "src/broken.test.ts",
        errorCount: 2,
        reason: "SyntaxError: one\nError: two",
        omittedCharacters: 0,
      },
    ]);
  });

  it("D2772: a discovered workspace whose collection raised unhandled errors is listed first among its entries, with the errors and their count", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [discovered("a")], {
          unhandledErrors: ["Error: one", "Error: two"],
          failedModules: [
            {
              projectName: PROJECT,
              modulePath: "src/broken.test.ts",
              errors: ["SyntaxError: one"],
            },
          ],
        }),
      ]),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "workspace-unhandled-errors",
        workspacePath: WORKSPACE_A,
        errorCount: 2,
        reason: "Error: one\nError: two",
        omittedCharacters: 0,
      },
      {
        kind: "failed-module",
        workspacePath: WORKSPACE_A,
        projectName: PROJECT,
        modulePath: "src/broken.test.ts",
        errorCount: 1,
        reason: "SyntaxError: one",
        omittedCharacters: 0,
      },
    ]);
  });

  it("D1812: a typecheck module is listed as not discovered", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [discovered("a")], {
          typecheckModules: [
            { projectName: PROJECT, modulePath: "src/types.test-d.ts" },
          ],
        }),
      ]),
    );
    expect(
      summary.notDiscovered.map((entry) => [
        entry.kind,
        "modulePath" in entry ? entry.modulePath : undefined,
      ]),
    ).toStrictEqual([["typecheck-module", "src/types.test-d.ts"]]);
  });

  it("D1813: an unsupported project is listed with its reason", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [discovered("a")], {
          unsupportedProjects: [
            { projectName: "browser", reason: "browser mode is not supported" },
          ],
        }),
      ]),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "unsupported-project",
        workspacePath: WORKSPACE_A,
        projectName: "browser",
        reason: "browser mode is not supported",
        omittedCharacters: 0,
      },
    ]);
  });

  it("D1814: each workspace source that was not read, outside the root or a duplicate, is listed with its reason", () => {
    const notRead: UnreadWorkspaceSource[] = [
      { source: "../elsewhere", reason: "it lies outside the consumer root" },
      { source: "packages/a", reason: "it was reached twice" },
    ];
    const summary = summaryOf(
      storedDiscovery(
        [discoveredWorkspace(WORKSPACE_A, [discovered("a")])],
        notRead,
      ),
    );
    expect(summary.notDiscovered).toStrictEqual(
      notRead.map((unread) => ({
        kind: "source-not-read",
        ...unread,
        omittedCharacters: 0,
      })),
    );
  });

  it("D1815: a reason past 1,000 characters is cut by code point, keeping a character that straddles the cut whole", () => {
    const kept = `${"a".repeat(999)}\u{1F600}`;
    const summary = summaryOf(
      storedDiscovery([
        {
          status: "failed",
          workspace: workspaceOf(WORKSPACE_A),
          vitestVersion: "5.0.1",
          error: `${kept}bbbbb`,
        },
      ]),
    );
    const [entry] = summary.notDiscovered;
    expect({
      kept: entry?.reason === kept,
      omittedCharacters: entry?.omittedCharacters,
    }).toStrictEqual({ kept: true, omittedCharacters: 5 });
  });

  it("D1816: a reason of exactly 1,000 characters is kept whole", () => {
    const reason = "r".repeat(1000);
    const summary = summaryOf(
      storedDiscovery([
        {
          status: "failed",
          workspace: workspaceOf(WORKSPACE_A),
          vitestVersion: "5.0.1",
          error: reason,
        },
      ]),
    );
    const [entry] = summary.notDiscovered;
    expect({
      whole: entry?.reason === reason,
      omittedCharacters: entry?.omittedCharacters,
    }).toStrictEqual({ whole: true, omittedCharacters: 0 });
  });

  it("D1817: the answer counts the discovered tests marked duplicate", () => {
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [
          discovered("twin", { isDuplicate: true }),
          discovered("twin", { isDuplicate: true }),
          discovered("alone"),
        ]),
      ]),
    );
    expect(summary.duplicateTests).toBe(2);
  });
});

describe("each workspace's latest run", () => {
  it("D1818: each workspace of the discovery gives its latest run's facts, or that none is stored", () => {
    const test = discovered("a");
    const run = ranRun([ranModule([finished(test, "passed")])], {
      execution: "interrupted",
      forceStopped: true,
      unhandledErrors: ["Error: leaked timer"],
    });
    const summary = summaryOf(
      storedDiscovery([
        discoveredWorkspace(WORKSPACE_A, [test]),
        discoveredWorkspace(WORKSPACE_B, []),
      ]),
      [storedRun(run)],
    );
    expect(summary.workspaces).toStrictEqual([
      {
        workspacePath: WORKSPACE_A,
        latestRun: {
          runId: `run-${WORKSPACE_A}`,
          adapterVersion: VITEST_ADAPTER_VERSION,
          adapterVersionCurrent: true,
          status: "ran",
          execution: "interrupted",
          forceStopped: true,
          nothingRan: null,
          unhandledErrors: 1,
          moduleErrors: 0,
        },
      },
      { workspacePath: WORKSPACE_B, latestRun: null },
    ]);
  });

  it("D1819: a run's module errors count every error its modules recorded", () => {
    const test = discovered("a");
    const run = ranRun([
      { ...ranModule([finished(test, "passed")]), errors: ["Error: afterAll"] },
      {
        projectName: PROJECT,
        modulePath: "src/broken.test.ts",
        state: "failed",
        errors: ["SyntaxError: one", "Error: two"],
      },
    ]);
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [test])]),
      [storedRun(run)],
    );
    const latestRun = summary.workspaces[0]?.latestRun;
    expect(
      latestRun !== null &&
        latestRun !== undefined &&
        "moduleErrors" in latestRun
        ? latestRun.moduleErrors
        : latestRun,
    ).toBe(3);
  });

  it("D1864: a workspace's latest run gives the reason nothing ran", () => {
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
      [storedRun(ranRun([], { nothingRan: "no-module" }))],
    );
    const latestRun = summary.workspaces[0]?.latestRun;
    expect(
      latestRun !== null && latestRun !== undefined && "nothingRan" in latestRun
        ? latestRun.nothingRan
        : latestRun,
    ).toBe("no-module");
  });

  it("D3099: a summary reads the schedule at its own input revision, so a round planned there reads planned, with the workspace it found due queued and a stale one idle, saying why", () => {
    const schedule = freshSchedule();
    schedule.planned(
      SETTLED_FACTS.revision,
      new Map([[WORKSPACE_A, DUE_REASON.inputsChanged]]),
    );
    const summary = answered(
      summaryAnswer(
        results(
          storedDiscovery([
            discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
            discoveredWorkspace(WORKSPACE_B, []),
          ]),
          [
            storedRun(ranRun([], {}, WORKSPACE_B), VITEST_ADAPTER_VERSION, {
              kind: "digest",
              digest: OTHER_DIGEST,
            }),
          ],
        ),
        { ...IDLE, schedule },
        settled({
          [WORKSPACE_A]: { ok: true, digest: DIGEST.digest },
          [WORKSPACE_B]: { ok: true, digest: DIGEST.digest },
        }),
      ),
    );
    expect(summary.schedule).toStrictEqual({
      round: { state: "planned", revision: SETTLED_FACTS.revision },
      workspaces: [
        {
          workspacePath: WORKSPACE_A,
          state: "queued",
          due: { kind: "inputs-changed" },
          chosenBy: { named: [], more: 0 },
        },
        {
          workspacePath: WORKSPACE_B,
          state: "idle",
          notRunning: {
            why: "no-run-until-input-change",
            due: { kind: "inputs-changed" },
          },
        },
      ],
    });
  });

  it("D3013: a workspace's latest run, stored in this daemon life not fingerprinted because a path inside its inputs changed while it ran, reads invalidated with the verdict's reason", () => {
    const reason = "its inputs changed while it ran: packages/a/src/a.ts";
    const run = storedRun(
      ranRun([ranModule([finished(discovered("a"), "passed")])]),
    );
    const schedule = freshSchedule();
    schedule.runEnded(
      WORKSPACE_A,
      { runId: run.runId, notKept: { kind: "changed-inside", reason } },
      false,
    );
    const summary = answered(
      summaryAnswer(
        results(
          storedDiscovery([
            discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
          ]),
          [run],
        ),
        { ...IDLE, schedule },
        UNSETTLED,
      ),
    );
    const latestRun = summary.workspaces[0]?.latestRun;
    expect(latestRun?.invalidated).toStrictEqual({
      reason,
      omittedCharacters: 0,
    });
  });

  it("D1865: a workspace whose latest run failed to load it gives that run's status and adapter version", () => {
    const run: WorkspaceRun = {
      status: "failed",
      workspace: workspaceOf(WORKSPACE_A),
      vitestVersion: "5.0.1",
      error: "Error: config boom",
    };
    const summary = summaryOf(
      storedDiscovery([discoveredWorkspace(WORKSPACE_A, [discovered("a")])]),
      [storedRun(run, OTHER_ADAPTER_VERSION)],
    );
    expect(summary.workspaces).toStrictEqual([
      {
        workspacePath: WORKSPACE_A,
        latestRun: {
          runId: `run-${WORKSPACE_A}`,
          adapterVersion: OTHER_ADAPTER_VERSION,
          adapterVersionCurrent: false,
          status: "failed",
        },
      },
    ]);
  });
});

describe("a summary with nothing to answer", () => {
  it("D1820: a latest discovery holding no test and nothing not discovered answers nothing", () => {
    const answer = summaryAnswer(
      results(storedDiscovery([discoveredWorkspace(WORKSPACE_A, [])])),
      IDLE,
      UNSETTLED,
    );
    expect("noAnswer" in answer).toBe(true);
  });

  it("D1821: with no stored discovery, the reason names the daemon's activity", () => {
    const answer = summaryAnswer(
      results(undefined),
      {
        ...IDLE,
        activity: { state: "running", workspacePath: WORKSPACE_A },
      },
      UNSETTLED,
    );
    expect("noAnswer" in answer ? answer.noAnswer : answer).toMatch(
      /running workspace packages\/a/,
    );
  });

  /** The reason a summary gives for answering nothing while the latest discovery is refused with `refusal`. */
  function refusedDiscoveryReason(refusal: string): string {
    const answer = summaryAnswer(
      results(undefined, [], refusal),
      { ...IDLE, activity: { state: "running", workspacePath: WORKSPACE_A } },
      UNSETTLED,
    );
    return "noAnswer" in answer ? answer.noAnswer : "answered";
  }

  it("D2933: with the latest discovery refused, the reason names the refusal, that the daemon answers once a new discovery replaces it, and its activity", () => {
    const refusal = 'The store holds an unreadable not_read: {"x":1}';
    const reason = refusedDiscoveryReason(refusal);
    expect({
      refusal: reason.includes(refusal),
      replaced: reason.includes("answers once a new discovery replaces it"),
      activity: reason.includes("running workspace packages/a"),
    }).toStrictEqual({ refusal: true, replaced: true, activity: true });
  });

  it("D2934: a refusal past 1,000 characters is quoted cut to 1,000, counting the rest, and one of exactly 1,000 whole", () => {
    const kept = "r".repeat(1000);
    const over = refusedDiscoveryReason(`${kept}#####`);
    const atLimit = refusedDiscoveryReason(kept);
    expect({
      over: {
        kept: over.includes(kept),
        cut: !over.includes("#"),
        counted: over.includes("(5 more characters are in the daemon log)"),
      },
      atLimit: {
        kept: atLimit.includes(kept),
        counted: atLimit.includes("more characters"),
      },
    }).toStrictEqual({
      over: { kept: true, cut: true, counted: true },
      atLimit: { kept: true, counted: false },
    });
  });

  /** The reason a summary gives for answering nothing while no discovery is stored, from `view`. */
  function noDiscoveryReason(view: Partial<DaemonView>): string {
    const answer = summaryAnswer(
      results(undefined),
      { ...IDLE, ...view },
      UNSETTLED,
    );
    return "noAnswer" in answer ? answer.noAnswer : "answered";
  }

  it("D3014: with no stored discovery, the reason also says what the daemon's round waits for", () => {
    const schedule = freshSchedule();
    schedule.pending(ROUND_WAIT.rediscovery);
    expect(
      noDiscoveryReason({ schedule }).includes(
        "a round is pending, waiting for a rediscovery",
      ),
    ).toBe(true);
  });

  it("D3015: with the latest discovery refused, the reason also says the round is held after a failed scheduling step, when it is tried again, and the failure", () => {
    const schedule = freshSchedule();
    schedule.held("the store was migrated by a newer RT Test");
    const answer = summaryAnswer(
      results(undefined, [], "The store holds an unreadable not_read"),
      { ...IDLE, schedule },
      UNSETTLED,
    );
    expect(
      ("noAnswer" in answer ? answer.noAnswer : "answered").includes(
        "a scheduling step failed, so the daemon tries again at the next input event or reconciliation: the store was migrated by a newer RT Test",
      ),
    ).toBe(true);
  });

  it("D3016: the reason names at most 20 of the jobs that ended with nothing stored and counts the rest, and names exactly 20 whole", () => {
    const jobs = Array.from({ length: 21 }, (_, index) => ({
      workspacePath: `packages/w${index}`,
      reason: "the store write failed",
    }));
    const named = jobs
      .slice(0, 20)
      .map((job) => `the run of ${job.workspacePath}: ${job.reason}`)
      .join("; ");
    const over = noDiscoveryReason({ unstoredJobs: jobs });
    const atBound = noDiscoveryReason({ unstoredJobs: jobs.slice(0, 20) });
    expect({
      over: over.endsWith(`; ended with nothing stored: ${named}; and 1 more`),
      atBound: atBound.endsWith(`; ended with nothing stored: ${named}`),
    }).toStrictEqual({ over: true, atBound: true });
  });

  it("D3017: each job that ended with nothing stored has its reason cut to 1,000 characters in the reason, counting the rest", () => {
    const kept = "r".repeat(1000);
    const reason = noDiscoveryReason({
      unstoredJobs: [{ reason: `${kept}#####` }],
    });
    expect(
      reason.endsWith(
        `; ended with nothing stored: the discovery: ${kept} (5 more characters are in the daemon log)`,
      ),
    ).toBe(true);
  });
});

/**
 * A consumer tree under `root`: workspace A holds `src/a.test.ts` (two tests) and `src/b.test.ts` (one), a test file
 * `src/gone.test.ts` that is deleted, a module `src/broken.test.ts`, deleted, that failed to load, and a module that
 * reaches `packages/shared` through `..`. Workspace `packages/ab` shares A's name as a prefix, workspace B has an
 * unsupported project, and the discovery of `packages/failed` failed.
 */
function consumerTree(root: string): LatestResults {
  for (const file of [
    "packages/a/src/a.test.ts",
    "packages/a/src/b.test.ts",
    "packages/ab/src/c.test.ts",
    "packages/b/src/d.test.ts",
    "packages/shared/x.test.ts",
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  mkdirSync(join(root, "packages/failed"));
  const inA = (name: string, modulePath: string) =>
    discovered(name, { modulePath });
  const discovery: StoredDiscovery = {
    ...storedDiscovery([
      discoveredWorkspace(
        WORKSPACE_A,
        [
          inA("one", "src/a.test.ts"),
          inA("two", "src/a.test.ts"),
          inA("three", "src/b.test.ts"),
          inA("gone", "src/gone.test.ts"),
          inA("shared", "../shared/x.test.ts"),
        ],
        {
          failedModules: [
            {
              projectName: PROJECT,
              modulePath: "src/broken.test.ts",
              errors: ["SyntaxError: Unexpected token"],
            },
          ],
        },
      ),
      discoveredWorkspace("packages/ab", [
        discovered("c", {
          workspacePath: "packages/ab",
          modulePath: "src/c.test.ts",
        }),
      ]),
      discoveredWorkspace(
        WORKSPACE_B,
        [
          discovered("d", {
            workspacePath: WORKSPACE_B,
            modulePath: "src/d.test.ts",
          }),
        ],
        {
          unsupportedProjects: [
            { projectName: "browser", reason: "browser mode is not supported" },
          ],
        },
      ),
      {
        status: "failed",
        workspace: workspaceOf("packages/failed", root),
        vitestVersion: "5.0.1",
        error: "Error: config boom",
      },
    ]),
  };
  return results(discovery);
}

/** Answers `status <path>` over the consumer tree, with `path` relative to its root. */
function statusIn(
  path: string,
  work: (answer: PathStatusAnswer | NoAnswer, root: string) => unknown = (
    answer,
  ) => answer,
  inputs: CurrentInputs = UNSETTLED,
): Promise<unknown> {
  return inTempDir((root) => {
    const answer = pathStatusAnswer(
      join(root, path),
      consumerTree(root),
      { ...IDLE, consumerRoot: root },
      inputs,
    );
    return work(answer, root);
  });
}

function pathFacts(answer: PathStatusAnswer | NoAnswer) {
  if ("noAnswer" in answer) return answer;
  return {
    path: answer.path,
    pathKind: answer.pathKind,
    tests: answer.counts.tests,
  };
}

describe("the status of a file or folder", () => {
  it("D1822: a test file answers for its own tests alone", async () => {
    expect(await statusIn("packages/a/src/a.test.ts", pathFacts)).toStrictEqual(
      {
        path: "packages/a/src/a.test.ts",
        pathKind: "file",
        tests: 2,
      },
    );
  });

  it("D1823: a folder answers for the tests under it, not for a sibling folder its name prefixes", async () => {
    expect(await statusIn("packages/a", pathFacts)).toStrictEqual({
      path: "packages/a",
      pathKind: "folder",
      tests: 4,
    });
  });

  it("D1824: a folder gives one entry per test file under it with that file's own counts", async () => {
    expect(
      await statusIn("packages/a", (answer) =>
        "noAnswer" in answer
          ? answer
          : answer.files.map((file) => [file.file, file.counts.tests]),
      ),
    ).toStrictEqual([
      ["packages/a/src/a.test.ts", 2],
      ["packages/a/src/b.test.ts", 1],
      ["packages/a/src/gone.test.ts", 1],
    ]);
  });

  it("D1825: a module reached through .. from its workspace answers under the folder it lies in", async () => {
    expect(await statusIn("packages/shared", pathFacts)).toStrictEqual({
      path: "packages/shared",
      pathKind: "folder",
      tests: 1,
    });
  });

  it("D1826: a deleted test file is decided through its nearest existing folder and answers as a file", async () => {
    expect(
      await statusIn("packages/a/src/gone.test.ts", pathFacts),
    ).toStrictEqual({
      path: "packages/a/src/gone.test.ts",
      pathKind: "file",
      tests: 1,
    });
  });

  it("D1827: a deleted file known only as a module that failed to load answers as a file", async () => {
    expect(
      await statusIn("packages/a/src/broken.test.ts", pathFacts),
    ).toStrictEqual({
      path: "packages/a/src/broken.test.ts",
      pathKind: "file",
      tests: 0,
    });
  });

  it("D1828: a folder lists each not-discovered entry under it", async () => {
    expect(
      await statusIn("packages/a", (answer) =>
        "noAnswer" in answer
          ? answer
          : answer.notDiscovered.map((entry) => entry.kind),
      ),
    ).toStrictEqual(["failed-module"]);
  });

  it("D1829: a path outside the consumer root has no answer, and the reason says it lies outside", async () => {
    expect(
      await statusIn("../elsewhere", (answer) =>
        "noAnswer" in answer ? answer.noAnswer : answer,
      ),
    ).toMatch(/lies outside the consumer root/);
  });

  it("D1830: a path with nothing at or under it inside a workspace whose discovery failed names that workspace", async () => {
    expect(
      await statusIn("packages/failed/src/x.test.ts", (answer) =>
        "noAnswer" in answer ? answer.noAnswer : answer,
      ),
    ).toMatch(/workspace-discovery-failed packages\/failed/);
  });

  it("D1831: an answer names each not-discovered entry above the path, such as an unsupported project of its workspace", async () => {
    expect(
      await statusIn("packages/b/src/d.test.ts", (answer) =>
        "noAnswer" in answer
          ? answer
          : answer.enclosingNotDiscovered.map((entry) => entry.kind),
      ),
    ).toStrictEqual(["unsupported-project"]);
  });

  it("D1866: the consumer root answers as a folder holding every test of the tree", async () => {
    expect(await statusIn(".", pathFacts)).toStrictEqual({
      path: ".",
      pathKind: "folder",
      tests: 7,
    });
  });

  it("D1870: an entry at the path is listed at it and not above it", async () => {
    expect(
      await statusIn(WORKSPACE_B, (answer) =>
        "noAnswer" in answer
          ? answer
          : {
              at: answer.notDiscovered.map((entry) => entry.kind),
              above: answer.enclosingNotDiscovered.map((entry) => entry.kind),
            },
      ),
    ).toStrictEqual({ at: ["unsupported-project"], above: [] });
  });

  it("D2773: a file inside a discovered workspace whose collection raised unhandled errors names that workspace's entry above it", async () => {
    const file = "packages/a/src/a.test.ts";
    const above = await inTempDir((root) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "");
      const answer = pathStatusAnswer(
        join(root, file),
        results(
          storedDiscovery([
            discoveredWorkspace(
              WORKSPACE_A,
              [discovered("one", { modulePath: "src/a.test.ts" })],
              { unhandledErrors: ["Error: one"] },
            ),
          ]),
        ),
        { ...IDLE, consumerRoot: root },
        UNSETTLED,
      );
      return "noAnswer" in answer
        ? answer
        : answer.enclosingNotDiscovered.map((entry) => entry.kind);
    });
    expect(above).toStrictEqual(["workspace-unhandled-errors"]);
  });
});

describe("the committed inputs a view carries", () => {
  it("D2688: a view over settled inputs carries the committed inputs its fingerprints are computed from, each path with its digest", () => {
    expect(
      Object.fromEntries(viewOf(undefined).snapshot?.digests ?? []),
    ).toStrictEqual(PROJECT_INPUTS);
  });

  it("D2746: a view over inputs the tracker cannot vouch for carries no committed inputs, so a round over it cannot select from them", () => {
    expect(
      viewOf(undefined, {}, "the watcher failed: ENOSPC").snapshot,
    ).toBeUndefined();
  });
});
