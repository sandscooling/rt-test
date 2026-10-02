import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceSchedule } from "../src/daemon/workspace-schedule.js";
import { currentInputs } from "../src/inputs/current-inputs.js";
import {
  ProjectInputs,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import type { CurrentInputs } from "../src/inputs/input-tracker.js";
import type {
  Narrowing,
  NarrowingState,
  QueryNarrowing,
  WorkspaceNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import {
  DEPENDENCY_BUILD_FAILED,
  DUE_REASON,
  ROUND_WAIT,
  WAIT_OUTCOME,
  type WaitAnswer,
  type InputFacts,
  type NoAnswer,
  type PathStatusAnswer,
  type SummaryAnswer,
  type TestCounts,
} from "../src/query/answer.js";
import { resolveCallerPath } from "../src/query/caller-paths.js";
import { pathStatusAnswer } from "../src/query/path-status.js";
import {
  queryBasis,
  summaryAnswer,
  type DaemonView,
  type QueryBasis,
} from "../src/query/summary.js";
import {
  coverageAt,
  waitAnswer,
  type Coverage,
} from "../src/query/wait-answer.js";
import { defectStandings } from "../src/defects/defect-standings.js";
import { readDefinitionFiles } from "../src/defects/definition-files.js";
import { checkDefinitions } from "../src/defects/definitions.js";
import {
  readAnchors,
  resolveDefinitions,
} from "../src/defects/resolve-definitions.js";
import type {
  LatestEvidence,
  StoredEvidence,
} from "../src/store/defect-evidence.js";
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
import {
  handBuiltEnvironment,
  inTempDir,
  onPlatform,
  projectFacts,
} from "./harness.js";
import { detectionFor, ranOnce, REJECTING_TEST } from "./experiment-facts.js";
import type { ErrorFact } from "../src/falsify/fact-types.js";
import { narrowingSelecting } from "./round-fixtures.js";
import {
  defectsAnswer,
  type DefectsAnswer,
} from "../src/query/defects-answer.js";
import { DAEMON_TEST_TIMEOUT_MS } from "./daemon-harness.js";
import { worktreeStandings } from "../src/defects/worktree-standings.js";

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
    heldBy: () => undefined,
    discoveryHeldBy: () => undefined,
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

/** Answers `status <path>` for the absolute `path` as the daemon does: resolved against the view's root, then answered. */
function answerFor(
  path: string,
  latest: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): PathStatusAnswer | NoAnswer {
  const target = resolveCallerPath(path, daemon.consumerRoot);
  if (!target.ok) return { noAnswer: target.reason };
  return pathStatusAnswer(target, latest, daemon, inputs);
}

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
  runRefusals: LatestResults["runRefusals"] = [],
  evidence: LatestEvidence = { evidence: [], evidenceRefusals: [] },
): LatestResults {
  return { discovery, discoveryRefusal, latestRuns, runRefusals, ...evidence };
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
      "run-refused",
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

describe("a workspace whose latest run the store refused as unreadable", () => {
  const REFUSAL = 'The store holds an unreadable runs.status: "bogus"';
  const B_TEST = discovered("b", { workspacePath: WORKSPACE_B });

  /** A summary of tests a and b of workspace A, whose latest run was refused for `reason`, beside `workspaceB`. */
  function refusedSummary(
    reason: string,
    workspaceB: { run?: StoredRun; inputs?: CurrentInputs } = {},
  ): SummaryAnswer {
    return answered(
      summaryAnswer(
        results(
          storedDiscovery([
            discoveredWorkspace(WORKSPACE_A, [
              discovered("a"),
              discovered("b"),
            ]),
            discoveredWorkspace(WORKSPACE_B, [B_TEST]),
          ]),
          workspaceB.run === undefined ? [] : [workspaceB.run],
          undefined,
          [{ workspacePath: WORKSPACE_A, reason }],
        ),
        IDLE,
        workspaceB.inputs ?? UNSETTLED,
      ),
    );
  }

  /** Workspace B holding a passed test from a run whose inputs are unchanged, so B's test reads current. */
  const CURRENT_B = {
    run: storedRun(
      ranRun([ranModule([finished(B_TEST, "passed")])], {}, WORKSPACE_B),
      VITEST_ADAPTER_VERSION,
      DIGEST,
    ),
    inputs: settled({ [WORKSPACE_B]: { ok: true, digest: DIGEST.digest } }),
  };

  /** Answers `status <path>` over the consumer tree, with workspace A's latest run refused for `REFUSAL`. */
  function refusedStatus(path: string): Promise<unknown> {
    return inTempDir((root) => {
      const answer = answerFor(
        join(root, path),
        {
          ...consumerTree(root),
          runRefusals: [{ workspacePath: WORKSPACE_A, reason: REFUSAL }],
        },
        { ...IDLE, consumerRoot: root },
        UNSETTLED,
      );
      return "noAnswer" in answer ? answer : nonZeroCounts(answer.counts);
    });
  }

  it("D3271: each test of a refused workspace reads run-refused, never never-run, beside another workspace's own states", () => {
    expect(
      nonZero(refusedSummary(REFUSAL, CURRENT_B).counts.states),
    ).toStrictEqual({ "run-refused": 2, passed: 1 });
  });

  it("D3272: each test of a refused workspace reads freshness unknown, beside another workspace's current test", () => {
    expect(
      nonZero(refusedSummary(REFUSAL, CURRENT_B).counts.freshness),
    ).toStrictEqual({ unknown: 2, current: 1 });
  });

  it("D3273: a path status counts each test of a refused workspace under the path as run-refused, with freshness unknown", async () => {
    expect(await refusedStatus("packages/a/src/a.test.ts")).toStrictEqual({
      states: { "run-refused": 2 },
      freshness: { unknown: 2 },
    });
  });

  it("D3274: a path status lists run-refused at zero when no test under the path is in it", async () => {
    expect(
      await statusIn("packages/a/src/a.test.ts", (answer) =>
        "noAnswer" in answer ? answer : answer.counts.states["run-refused"],
      ),
    ).toBe(0);
  });

  it("D3275: a refused workspace's facts give no latest run and the refusal", () => {
    expect(refusedSummary(REFUSAL).workspaces[0]).toStrictEqual({
      workspacePath: WORKSPACE_A,
      latestRun: null,
      refusedRun: { reason: REFUSAL, omittedCharacters: 0 },
    });
  });

  it("D3322: an answer's schedule gives a refused workspace, idle in a planned round, the due reason run-refused", () => {
    const schedule = freshSchedule();
    schedule.planned(SETTLED_FACTS.revision, new Map());
    const answer = answered(
      summaryAnswer(
        results(
          storedDiscovery([
            discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
          ]),
          [],
          undefined,
          [{ workspacePath: WORKSPACE_A, reason: REFUSAL }],
        ),
        { ...IDLE, schedule },
        settled({}),
      ),
    );
    const [execution] = answer.schedule.workspaces;
    expect(
      execution?.state === "idle" ? execution.notRunning?.due : execution,
    ).toStrictEqual({ kind: "run-refused" });
  });

  it("D3276: a refusal past 1,000 characters is given cut to 1,000, counting the rest", () => {
    const kept = "r".repeat(1000);
    expect(
      refusedSummary(`${kept}#####`).workspaces[0]?.refusedRun,
    ).toStrictEqual({ reason: kept, omittedCharacters: 5 });
  });

  it("D3277: a workspace with no run stored is given no refusal, even beside a refused workspace", () => {
    expect(refusedSummary(REFUSAL).workspaces[1]).toStrictEqual({
      workspacePath: WORKSPACE_B,
      latestRun: null,
    });
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
    environment: handBuiltEnvironment(process.env),
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
  it("D2523: while the build at the current revision has not ended, each workspace is unfingerprinted naming the build, and the discovery's freshness, with no stored run to rate its lists, is unaffected", () => {
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

  it("D3109: an answer cuts each job that ended with nothing stored to 1,000 characters of reason, saying where the rest is, and keeps one of exactly 1,000 whole", () => {
    const kept = "r".repeat(1000);
    const jobsOf = (reason: string): unknown =>
      answered(
        summaryAnswer(
          results(
            storedDiscovery([
              discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
            ]),
          ),
          { ...IDLE, unstoredJobs: [{ workspacePath: WORKSPACE_A, reason }] },
          UNSETTLED,
        ),
      ).unstoredJobs;
    expect({
      over: jobsOf(`${kept}#####`),
      atLimit: jobsOf(kept),
    }).toStrictEqual({
      over: [
        {
          workspacePath: WORKSPACE_A,
          reason: `${kept} (5 more characters are in the daemon log)`,
        },
      ],
      atLimit: [{ workspacePath: WORKSPACE_A, reason: kept }],
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

  it("D4110: the reason words a falsification entry as the falsification of its workspace, beside a run's entry worded as the run of it", () => {
    const reason = noDiscoveryReason({
      unstoredJobs: [
        { workspacePath: WORKSPACE_A, reason: "the store write failed" },
        {
          workspacePath: WORKSPACE_A,
          kind: "falsification",
          reason: "its job did not run",
        },
      ],
    });
    expect(
      reason.endsWith(
        `; ended with nothing stored: the run of ${WORKSPACE_A}: the store write failed; the falsification of ${WORKSPACE_A}: its job did not run`,
      ),
    ).toBe(true);
  });

  it("D4111: the reason says the daemon is falsifying, with the workspace and the number of definitions in the job", () => {
    const reason = noDiscoveryReason({
      activity: {
        state: "falsifying",
        workspacePath: WORKSPACE_A,
        definitions: 2,
      },
    });
    expect(
      reason.includes(
        `falsifying workspace ${WORKSPACE_A}, with 2 of its defect definitions in the job`,
      ),
    ).toBe(true);
  });
});

describe("the worktree's standings once nobody waits for them", () => {
  it("D4108: a read whose signal aborts while its files are read throws before it takes the daemon's moment", async () => {
    const outcome = await inTempDir(async (root) => {
      const controller = new AbortController();
      let moments = 0;
      const reading = worktreeStandings({
        consumerRoot: root,
        stateDirectory: join(root, ".rt-test"),
        signal: controller.signal,
        moment: () => {
          moments += 1;
          return {
            results: results(undefined),
            view: { ...IDLE, consumerRoot: root },
            inputs: UNSETTLED,
          };
        },
      });
      controller.abort();
      const threw = await reading.then(
        () => false,
        () => true,
      );
      return { threw, moments };
    });
    expect(outcome).toStrictEqual({ threw: true, moments: 0 });
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
    const answer = answerFor(
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
      const answer = answerFor(
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

/** How a caller's path was refused: whether its reason names the whole path, and apart from it the offending name. */
interface Refusal {
  readonly namesPath: boolean;
  readonly namesName: boolean;
}

/**
 * Resolves the root-relative `path`, written with `/`, under a consumer root holding each root-relative file in
 * `existing`, with `process.platform` read as `platform`: the root-relative path it resolved to, or how it was refused
 * for `name`.
 */
function resolvedOn(
  platform: NodeJS.Platform,
  path: string,
  name: string,
  existing: readonly string[] = [],
): Promise<string | Refusal> {
  return inTempDir((root) => {
    for (const file of existing) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    const absolute = join(root, ...path.split("/"));
    return onPlatform<string | Refusal>(platform, () => {
      const resolved = resolveCallerPath(absolute, root);
      if (resolved.ok) return Promise.resolve(resolved.path);
      return Promise.resolve({
        namesPath: resolved.reason.includes(absolute),
        namesName: resolved.reason.split(absolute).join("").includes(name),
      });
    });
  });
}

const NAMES_PATH_AND_NAME: Refusal = { namesPath: true, namesName: true };

describe("resolving a caller's path", () => {
  it("D3360: on Windows, a missing file whose name ends in a dot is refused, naming the path and the name", async () => {
    expect(
      await resolvedOn("win32", "src/gone.ts.", "gone.ts.", ["src/kept.ts"]),
    ).toStrictEqual(NAMES_PATH_AND_NAME);
  });

  it("D3361: on Windows, a missing file whose name ends in a space is refused, naming the path and the name", async () => {
    expect(
      await resolvedOn("win32", "src/gone.ts ", "gone.ts ", ["src/kept.ts"]),
    ).toStrictEqual(NAMES_PATH_AND_NAME);
  });

  it("D3362: on Windows, a missing file named in an 8.3 short-name form is refused, naming the path and the name", async () => {
    expect(
      await resolvedOn("win32", "src/GONE~1.TS", "GONE~1.TS", ["src/kept.ts"]),
    ).toStrictEqual(NAMES_PATH_AND_NAME);
  });

  it("D3363: on Windows, a path under a missing directory whose name ends in a dot is refused, naming that directory", async () => {
    expect(
      await resolvedOn("win32", "src/gen./a.ts", "gen.", ["src/kept.ts"]),
    ).toStrictEqual(NAMES_PATH_AND_NAME);
  });

  it("D3364: on Linux, a missing file whose name ends in a dot is an ordinary name and resolves as given", async () => {
    expect(
      await resolvedOn("linux", "src/gone.ts.", "gone.ts.", ["src/kept.ts"]),
    ).toBe("src/gone.ts.");
  });

  it("D3365: on Windows, an existing file whose long name holds a tilde and a digit resolves, since only a missing name is refused", async () => {
    expect(
      await resolvedOn("win32", "src/notes~1.md", "notes~1.md", [
        "src/notes~1.md",
      ]),
    ).toBe("src/notes~1.md");
  });

  it("D3388: on Windows, a missing file ending in a dot under an ordinary missing directory is refused, naming the file", async () => {
    expect(
      await resolvedOn("win32", "src/newdir/gone.ts.", "gone.ts.", [
        "src/kept.ts",
      ]),
    ).toStrictEqual(NAMES_PATH_AND_NAME);
  });
});

const NOT_VITEST_PATH = "packages/tooling";
const NOT_VITEST_REASON =
  'has a test script, "node run-tests.js", but is not a Vitest workspace';

/** Workspace A with one test, beside a stored package workspace with a test script that is not a Vitest workspace. */
function withNotVitestWorkspace(): LatestResults {
  const workspaces = [discoveredWorkspace(WORKSPACE_A, [discovered("a")])];
  return results({
    ...storedDiscovery(workspaces),
    discovery: {
      workspaces,
      notRead: [],
      notCovered: [{ path: NOT_VITEST_PATH, reason: NOT_VITEST_REASON }],
    },
  });
}

/** Answers `status <path>` over a tree holding the not-Vitest workspace's `src/lint.js`, or names what it threw. */
function notVitestStatus(
  path: string,
  work: (answer: PathStatusAnswer | NoAnswer) => unknown,
): Promise<unknown> {
  return inTempDir((root) => {
    const file = join(root, NOT_VITEST_PATH, "src/lint.js");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    try {
      return work(
        answerFor(
          join(root, path),
          withNotVitestWorkspace(),
          { ...IDLE, consumerRoot: root },
          UNSETTLED,
        ),
      );
    } catch (error) {
      return `threw: ${String(error)}`;
    }
  });
}

describe("a package workspace with a test script that is not a Vitest workspace", () => {
  it("D3355: the summary lists each stored not-covered workspace as not discovered, by kind, path and reason", () => {
    const summary = answered(
      summaryAnswer(withNotVitestWorkspace(), IDLE, UNSETTLED),
    );
    expect(summary.notDiscovered).toStrictEqual([
      {
        kind: "workspace-not-vitest",
        workspacePath: NOT_VITEST_PATH,
        reason: NOT_VITEST_REASON,
        omittedCharacters: 0,
      },
    ]);
  });

  it("D3356: status for the workspace itself lists it as not discovered at the path", async () => {
    expect(
      await notVitestStatus(NOT_VITEST_PATH, (answer) =>
        "noAnswer" in answer
          ? answer.noAnswer
          : answer.notDiscovered.map((entry) => entry.kind),
      ),
    ).toStrictEqual(["workspace-not-vitest"]);
  });

  it("D3357: status for a path inside the workspace, with nothing else at or under it, is refused naming the workspace it lies in", async () => {
    expect(
      await notVitestStatus(`${NOT_VITEST_PATH}/src/lint.js`, (answer) =>
        "noAnswer" in answer ? answer.noAnswer : answer,
      ),
    ).toMatch(/; it lies in workspace-not-vitest packages\/tooling$/);
  });
});

const B_SETUP = `${WORKSPACE_B}/setup.ts`;
const ENV_LOCAL = ".env.local";
const ENV_NOT_KNOWN = "a nested projects container gives its tests an env";
/** The committed inputs at the settled facts' revision: every input of the project. */
const PROJECT_SNAPSHOT = new ProjectInputs(
  ROOT,
  new Map(Object.entries(PROJECT_INPUTS)),
);
/** Selection selects no workspace for any path, and each workspace's inputs are its own files. */
const SELECTING_NOTHING: WorkspaceNarrowing = {
  kind: "narrowed",
  narrowing: narrowingSelecting({}, NARROWED_SETS),
};

/** Workspace `b` of the discovery, reporting one project with `facts`. */
function workspaceBReporting(
  facts: Parameters<typeof projectFacts>[0],
): WorkspaceDiscovery {
  return discoveredWorkspace(WORKSPACE_B, [], {
    selectionFacts: { reported: true, projects: [projectFacts(facts)] },
  });
}

/** The covering workspaces of `path` at the settled revision under `narrowing`, and the listings that cover it. */
function coveringOf(
  entries: readonly WorkspaceDiscovery[],
  narrowing: WorkspaceNarrowing,
  path: string,
): unknown {
  const coverage = coverageAt(
    storedDiscovery(entries),
    narrowing,
    PROJECT_SNAPSHOT,
    SETTLED_FACTS.revision,
    [path],
  );
  return coverage === undefined
    ? coverage
    : {
        workspaces: [...coverage.workspaces],
        listed: coverage.files.get(path)?.listed,
      };
}

/** A settled wait's answer over `basis` whose covering workspaces are `coverage`'s, every one's when undefined. */
function waitOver(
  basis: QueryBasis,
  coverage: Coverage | undefined,
  paths: readonly string[] = [],
): WaitAnswer {
  return waitAnswer(basis, {
    outcome: { outcome: WAIT_OUTCOME.settled },
    boundRevision: SETTLED_FACTS.revision,
    paths,
    unread: [],
    coverage,
  });
}

describe("the workspaces covering a waited file", () => {
  it("D3439: a file selection selects no workspace for is covered by each discovered workspace whose fingerprint lists it, naming the listing", () => {
    expect(
      coveringOf(
        [ENTRY_A, workspaceBReporting({ setupFiles: [B_SETUP] })],
        SELECTING_NOTHING,
        B_SETUP,
      ),
    ).toStrictEqual({
      workspaces: [WORKSPACE_B],
      listed: {
        named: [{ workspacePath: WORKSPACE_B, listedAs: "setup-file" }],
        more: 0,
      },
    });
  });

  it("D3440: a workspace whose env files are not known covers a named .env.local its listing cannot rule out", () => {
    expect(
      coveringOf(
        [
          ENTRY_A,
          workspaceBReporting({ envSources: { notKnown: ENV_NOT_KNOWN } }),
        ],
        SELECTING_NOTHING,
        ENV_LOCAL,
      ),
    ).toStrictEqual({
      workspaces: [WORKSPACE_B],
      listed: {
        named: [
          { workspacePath: WORKSPACE_B, listedAs: "env-files-not-known" },
        ],
        more: 0,
      },
    });
  });

  it("D3441: with no dependency information every discovered workspace covers every file, and the coverage names the widening and its cause", () => {
    const coverage = coverageAt(
      TWO_WORKSPACES,
      {
        kind: "widened",
        notNarrowed: { kind: DEPENDENCY_BUILD_FAILED, reason: BUILD_FAILED },
      },
      PROJECT_SNAPSHOT,
      SETTLED_FACTS.revision,
      [A_SOURCE],
    );
    expect(
      coverage === undefined
        ? coverage
        : { facts: coverage.facts, workspaces: [...coverage.workspaces] },
    ).toStrictEqual({
      facts: {
        state: "widened",
        revision: SETTLED_FACTS.revision,
        widenedBy: DEPENDENCY_BUILD_FAILED,
        reason: { reason: BUILD_FAILED, omittedCharacters: 0 },
      },
      workspaces: [WORKSPACE_A, WORKSPACE_B],
    });
  });
});

describe("a wait's answer", () => {
  it("D3442: the counts take each covering workspace's tests once, however many named files it covers, and no other workspace's", () => {
    const coverage = coverageAt(
      TWO_WORKSPACES,
      {
        kind: "narrowed",
        narrowing: narrowingSelecting(
          { [A_SOURCE]: [WORKSPACE_A], [A_MODULE]: [WORKSPACE_A] },
          NARROWED_SETS,
        ),
      },
      PROJECT_SNAPSHOT,
      SETTLED_FACTS.revision,
      [A_SOURCE, A_MODULE],
    );
    const basis = answered(
      queryBasis(results(TWO_WORKSPACES), IDLE, UNSETTLED),
    );
    expect(waitOver(basis, coverage).counts.tests).toBe(1);
  });

  it("D3443: an answer names 20 covering tests that failed and counts the rest", () => {
    const failing = Array.from({ length: 21 }, (_, index) =>
      discovered(`f${index}`),
    );
    const basis = answered(
      queryBasis(
        results(storedDiscovery([discoveredWorkspace(WORKSPACE_A, failing)]), [
          storedRun(
            ranRun([
              ranModule(failing.map((test) => finished(test, "failed"))),
            ]),
          ),
        ]),
        IDLE,
        UNSETTLED,
      ),
    );
    const { namedFailures } = waitOver(basis, undefined);
    expect({
      named: namedFailures.named.length,
      more: namedFailures.more,
    }).toStrictEqual({ named: 20, more: 1 });
  });

  it("D3444: a named failure carries the first line of its first error, and a crashed module, which records none, is named with none", () => {
    const crashedModule = "src/c.test.ts";
    const basis = answered(
      queryBasis(
        results(storedDiscovery([ENTRY_A]), [
          storedRun(
            ranRun([
              ranModule([
                {
                  identity: TEST_A.identity,
                  isDuplicate: false,
                  execution: "finished",
                  outcome: "failed",
                  errors: [
                    "AssertionError: expected 1 to be 2\n    at src/a.test.ts:3:5",
                    "a second error",
                  ],
                },
              ]),
              {
                projectName: PROJECT,
                modulePath: crashedModule,
                state: "crashed",
              },
            ]),
          ),
        ]),
        IDLE,
        UNSETTLED,
      ),
    );
    expect(
      waitOver(basis, undefined).namedFailures.named.map(
        ({ modulePath, state, firstError }) => ({
          modulePath,
          state,
          firstError,
        }),
      ),
    ).toStrictEqual([
      {
        modulePath: MODULE,
        state: "failed",
        firstError: {
          reason: "AssertionError: expected 1 to be 2",
          omittedCharacters: 0,
        },
      },
      { modulePath: crashedModule, state: "module-crashed", firstError: null },
    ]);
  });
});

/** Definition files as the answer reads them: `defects/<name>` with the definitions listed, or with raw text. */
type DefinitionFilesTree = Readonly<
  Record<string, readonly unknown[] | string>
>;

/** A definition naming the test `name` in `module`, whose mutation replaces `return 1;` in `A_SOURCE`. */
function defectDefinition(
  id: unknown,
  name: string,
  module: string = A_MODULE,
  old = "return 1;",
): Record<string, unknown> {
  return {
    id,
    defect: "a returns 2",
    required: "a returns 1",
    test: { module, name: [name] },
    mutation: { file: A_SOURCE, old, new: "return 2;" },
  };
}

interface DefectsSetup {
  /** The inputs the daemon's moment carries; unsettled when absent. */
  readonly inputs?: CurrentInputs;
  /** Patterns `rt-test.json` names beside `defects/*.json`. */
  readonly morePatterns?: readonly string[];
  /** What `rt-test.json` holds, in place of one naming the definition files alone. */
  readonly settings?: unknown;
}

/**
 * Writes `A_SOURCE`, and with any definition files an `rt-test.json` naming `defects/*.json` and those files, under
 * `root`, then answers `defects` as the daemon does, for the absolute `path` or the whole worktree. The moment it
 * hands over reads `latest` when it is called.
 */
function defectsOver(
  root: string,
  latest: LatestResults | (() => LatestResults),
  files: DefinitionFilesTree = {},
  path?: string,
  setup: DefectsSetup = {},
): Promise<DefectsAnswer | NoAnswer> {
  const written: Record<string, string> = {
    [A_SOURCE]: "export function a() {\n  return 1;\n}\n",
  };
  if (Object.keys(files).length > 0) {
    written["rt-test.json"] = JSON.stringify({
      defects: ["defects/*.json", ...(setup.morePatterns ?? [])],
    });
  }
  if (setup.settings !== undefined) {
    written["rt-test.json"] = JSON.stringify(setup.settings);
  }
  for (const [name, definitions] of Object.entries(files)) {
    written[`defects/${name}`] =
      typeof definitions === "string"
        ? definitions
        : JSON.stringify({ defects: definitions });
  }
  for (const [file, text] of Object.entries(written)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return defectsAnswer({
    path,
    consumerRoot: root,
    stateDirectory: join(root, ".rt-test"),
    signal: new AbortController().signal,
    moment: () => ({
      results: typeof latest === "function" ? latest() : latest,
      view: { ...IDLE, consumerRoot: root },
      inputs: setup.inputs ?? UNSETTLED,
    }),
  });
}

/** A count of zero for each state a definition can read. */
const NO_DEFINITIONS = {
  "invalid-definition": 0,
  "anchor-missing": 0,
  survived: 0,
  "invalid-experiment": 0,
  unclear: 0,
  "never-verified": 0,
  detected: 0,
};

/** A stored discovery of the tests named in `A_MODULE` and of the test `d` in `B_MODULE`. */
function discoveryOfAAndB(...names: readonly string[]): LatestResults {
  return results(
    storedDiscovery([
      discoveredWorkspace(
        WORKSPACE_A,
        names.map((name) => discovered(name)),
      ),
      discoveredWorkspace(WORKSPACE_B, [
        discovered("d", { workspacePath: WORKSPACE_B }),
      ]),
    ]),
  );
}

describe(
  "the defects answer's gaps and scope",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3691: a test only invalid definitions name is covered, never a gap, while a test no definition names is one", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one", "two", "three"),
            {
              "a.json": [
                defectDefinition("D1", "one"),
                defectDefinition("D1", "one"),
                defectDefinition(7, "two"),
              ],
            },
            join(root, WORKSPACE_A),
          ),
        ),
      );
      expect({
        gaps: answer.gaps,
        gapTests: answer.gapTests.map(({ module, tests }) => ({
          module,
          names: tests.map((test) => test.identity.namePath),
        })),
      }).toStrictEqual({
        gaps: 1,
        gapTests: [{ module: A_MODULE, names: [["three"]] }],
      });
    });

    it("D3692: a path leaves out each definition whose test's module lies outside it, and each test outside it", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one"),
            {
              "a.json": [
                defectDefinition("D1", "one"),
                defectDefinition("D2", "d", B_MODULE),
              ],
            },
            join(root, WORKSPACE_A),
          ),
        ),
      );
      expect({
        total: answer.counts.total,
        ids: answer.definitions.map((definition) => definition.id),
        testsInScope: answer.testsInScope,
      }).toStrictEqual({ total: 1, ids: ["D1"], testsInScope: 1 });
    });

    it("D3693: a definition naming no usable module lies in every scope", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one"),
            {
              "a.json": [
                defectDefinition("D1", "one"),
                defectDefinition("D9", "x", ""),
              ],
            },
            join(root, WORKSPACE_B),
          ),
        ),
      );
      expect(
        answer.definitions.map(({ id, state }) => ({ id, state })),
      ).toStrictEqual([{ id: "D9", state: "invalid-definition" }]);
    });

    it("D3694: a definition file problem counts in the total and is listed whole in every scope", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one"),
            {
              "a.json": [defectDefinition("D1", "one")],
              "broken.json": "not json",
            },
            join(root, WORKSPACE_B),
          ),
        ),
      );
      expect({
        total: answer.counts.total,
        invalidEntries: answer.counts.invalidEntries,
        listed: answer.invalidEntries.map(
          ({ kind, path }) => `${kind} ${path}`,
        ),
      }).toStrictEqual({
        total: 1,
        invalidEntries: 1,
        listed: ["not-json defects/broken.json"],
      });
    });

    it("D3695: of 503 definitions it lists 500, invalid ones first, with how many of each state it left out and every count complete", async () => {
      const invalid = Array.from({ length: 501 }, (_, index) =>
        defectDefinition(`D${index + 100}`, `missing ${index}`),
      );
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(root, discoveryOfAAndB("one", "two"), {
            "a.json": [
              defectDefinition("D1", "one"),
              defectDefinition("D2", "two", A_MODULE, "absent();"),
              ...invalid,
            ],
          }),
        ),
      );
      expect({
        listed: answer.definitions.length,
        listedStates: [
          ...new Set(answer.definitions.map(({ state }) => state)),
        ],
        notListed: answer.definitionsNotListed,
        states: answer.counts.states,
      }).toStrictEqual({
        listed: 500,
        listedStates: ["invalid-definition"],
        notListed: {
          ...NO_DEFINITIONS,
          "invalid-definition": 1,
          "anchor-missing": 1,
          "never-verified": 1,
        },
        states: {
          ...NO_DEFINITIONS,
          "invalid-definition": 501,
          "anchor-missing": 1,
          "never-verified": 1,
        },
      });
    });

    it("D3713: a definition whose module the latest discovery does not list lies in every scope, while one whose module is discovered elsewhere is left out", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one"),
            {
              "a.json": [
                defectDefinition("D1", "x", "packages/zzz/src/a.test.ts"),
                defectDefinition("D2", "one"),
              ],
            },
            join(root, WORKSPACE_B),
          ),
        ),
      );
      expect({
        total: answer.counts.total,
        ids: answer.definitions.map((definition) => definition.id),
      }).toStrictEqual({ total: 1, ids: ["D1"] });
    });

    it("D3721: a not-discovered reason says the discovery is not current when the daemon's moment reads it stale, and not when it reads it current", async () => {
      const latest = results(
        storedDiscovery(
          [discoveredWorkspace(WORKSPACE_A, [discovered("one")])],
          [],
          VITEST_ADAPTER_VERSION,
          DIGEST,
        ),
      );
      const files = { "a.json": [defectDefinition("D1", "missing")] };
      const reasons = await inTempDir(async (root) => {
        const stale = answered(
          await defectsOver(join(root, "a"), latest, files, undefined, {
            inputs: settled({}),
          }),
        );
        const current = answered(
          await defectsOver(join(root, "b"), latest, files, undefined, {
            inputs: settled({}, { ok: true, digest: DIGEST.digest }),
          }),
        );
        return [stale, current].map((answer) =>
          /not current/.test(answer.definitions[0]?.reason?.reason ?? ""),
        );
      });
      expect(reasons).toStrictEqual([true, false]);
    });

    it("D3722: a listed definition's reason over 1000 characters is cut to 1000, with the rest counted", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(root, discoveryOfAAndB("one"), {
            "a.json": [defectDefinition("D1", "x".repeat(2000))],
          }),
        ),
      );
      const reason = answer.definitions[0]?.reason;
      expect({
        characters: Array.from(reason?.reason ?? "").length,
        restCounted: (reason?.omittedCharacters ?? 0) > 0,
      }).toStrictEqual({ characters: 1000, restCounted: true });
    });

    it("D3723: a listed definition file problem's reason over 1000 characters is cut to 1000, with the rest counted", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one"),
            { "a.json": [defectDefinition("D1", "one")] },
            undefined,
            { morePatterns: [`${"x".repeat(2000)}/*.json`] },
          ),
        ),
      );
      const [entry] = answer.invalidEntries;
      expect({
        characters: Array.from(entry?.reason ?? "").length,
        restCounted: (entry?.omittedCharacters ?? 0) > 0,
      }).toStrictEqual({ characters: 1000, restCounted: true });
    });

    it("D3724: a path holding no test is still answered when a definition file problem lies in it, as one lies in every scope", async () => {
      const answer = await inTempDir((root) => {
        mkdirSync(join(root, "docs"));
        return defectsOver(
          root,
          discoveryOfAAndB("one"),
          { "broken.json": "not json" },
          join(root, "docs"),
        );
      });
      expect(
        "noAnswer" in answer
          ? answer
          : {
              testsInScope: answer.testsInScope,
              invalidEntries: answer.counts.invalidEntries,
            },
      ).toStrictEqual({ testsInScope: 0, invalidEntries: 1 });
    });

    it("D3725: a path holding no test is still answered when a definition lying in every scope lies in it", async () => {
      const answer = await inTempDir((root) => {
        mkdirSync(join(root, "docs"));
        return defectsOver(
          root,
          discoveryOfAAndB("one"),
          { "a.json": [defectDefinition("D9", "x", "")] },
          join(root, "docs"),
        );
      });
      expect(
        "noAnswer" in answer
          ? answer
          : { testsInScope: answer.testsInScope, total: answer.counts.total },
      ).toStrictEqual({ testsInScope: 0, total: 1 });
    });

    it("D3732: definitions are listed invalid first, then anchor missing, then never verified, whatever their order in the file", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(root, discoveryOfAAndB("one", "two"), {
            "a.json": [
              defectDefinition("D1", "one"),
              defectDefinition("D2", "two", A_MODULE, "absent();"),
              defectDefinition("D3", "missing"),
            ],
          }),
        ),
      );
      expect(
        answer.definitions.map(({ id, state }) => [id, state]),
      ).toStrictEqual([
        ["D3", "invalid-definition"],
        ["D2", "anchor-missing"],
        ["D1", "never-verified"],
      ]);
    });

    it("D3733: a listed definition carries the identity of the test it resolves to and that test's duplicate mark", async () => {
      const first = discovered("one", { isDuplicate: true });
      const second = {
        ...first,
        identity: { ...first.identity, occurrence: 1 },
      };
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            results(
              storedDiscovery([
                discoveredWorkspace(WORKSPACE_A, [first, second]),
              ]),
            ),
            {
              "a.json": [
                {
                  ...defectDefinition("D1", "one"),
                  test: { module: A_MODULE, name: ["one"], occurrence: 1 },
                },
              ],
            },
          ),
        ),
      );
      expect(answer.definitions[0]?.resolvedTest).toStrictEqual({
        identity: {
          workspacePath: WORKSPACE_A,
          projectName: PROJECT,
          modulePath: MODULE,
          namePath: ["one"],
          occurrence: 1,
        },
        duplicate: true,
      });
    });
  },
);

/** A stored discovery of 600 tests in `A_MODULE` and 401 in `B_MODULE`, 1001 in all. */
function thousandAndOneTests(): LatestResults {
  const named = (count: number, workspacePath: string) =>
    Array.from({ length: count }, (_, index) =>
      discovered(`t${index}`, { workspacePath }),
    );
  return results(
    storedDiscovery([
      discoveredWorkspace(WORKSPACE_A, named(600, WORKSPACE_A)),
      discoveredWorkspace(WORKSPACE_B, named(401, WORKSPACE_B)),
    ]),
  );
}

describe("the defects answer's gap listing and refusals", () => {
  it("D3696: of 1001 gap tests it lists 1000 by module and says one was not listed", async () => {
    const answer = answered(
      await inTempDir((root) => defectsOver(root, thousandAndOneTests())),
    );
    expect({
      listed: answer.gapTests.map(({ module, tests }) => [
        module,
        tests.length,
      ]),
      notListed: answer.gapTestsNotListed,
    }).toStrictEqual({
      listed: [
        [A_MODULE, 600],
        [B_MODULE, 400],
      ],
      notListed: 1,
    });
  });

  it("D3697: every module holding a gap has its whole gap count, the tests past the listing's bound included", async () => {
    const answer = answered(
      await inTempDir((root) => defectsOver(root, thousandAndOneTests())),
    );
    expect(answer.gapModules).toStrictEqual([
      { module: A_MODULE, gaps: 600 },
      { module: B_MODULE, gaps: 401 },
    ]);
  });

  it(
    "D3698: a path outside the consumer root is refused with the reason naming it, though a definition lying in every scope would give it something to answer",
    async () => {
      const answer = await inTempDir((root) =>
        defectsOver(
          join(root, "consumer"),
          discoveryOfAAndB("one"),
          { "a.json": [defectDefinition("D9", "x", "")] },
          join(root, "elsewhere"),
        ),
      );
      expect(answer).toStrictEqual({
        noAnswer: expect.stringMatching(
          /elsewhere lies outside the consumer root/,
        ),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D3699: a path holding no test, no definition and no definition file problem has nothing to answer", async () => {
    const answer = await inTempDir((root) => {
      mkdirSync(join(root, "docs"));
      return defectsOver(root, discoveryOfAAndB("one"), {}, join(root, "docs"));
    });
    expect(answer).toStrictEqual({
      noAnswer: expect.stringMatching(
        /^no discovered test, no defect definition and no problem reading the definition files lies at or under /,
      ),
    });
  });

  it("D3710: the answer takes the daemon's moment only once its file reads have ended, so a discovery stored during them is the one it answers from", async () => {
    const answer = answered(
      await inTempDir((root) => {
        let latest = discoveryOfAAndB("one");
        const pending = defectsOver(root, () => latest);
        latest = discoveryOfAAndB("one", "two");
        return pending;
      }),
    );
    expect(answer.testsInScope).toBe(3);
  });

  it("D3734: the answer carries the facts every answer carries: the consumer root, the inputs, the activity and the jobs that stored nothing", async () => {
    const [answer, root] = await inTempDir(
      async (dir) =>
        [
          answered(await defectsOver(dir, discoveryOfAAndB("one"))),
          dir,
        ] as const,
    );
    expect({
      consumerRoot: answer.consumerRoot,
      inputs: answer.inputs,
      activity: answer.activity,
      unstoredJobs: answer.unstoredJobs,
    }).toStrictEqual({
      consumerRoot: root,
      inputs: UNSETTLED.facts,
      activity: { state: "idle" },
      unstoredJobs: [],
    });
  });
});

/** Settled inputs under which workspace A's current fingerprint is the one each stored detection below ran at. */
const A_AT_DIGEST = settled({
  [WORKSPACE_A]: { ok: true, digest: DIGEST.digest },
});

/**
 * A detection for each definition the files under `root` hold, bound as a job that ran at `DIGEST` binds it: to the
 * definition's digest from its standing and to its mutation file's digest from its anchor read.
 */
async function detectionsUnder(
  root: string,
  latest: LatestResults,
): Promise<StoredEvidence[]> {
  const signal = new AbortController().signal;
  const files = await readDefinitionFiles(root, join(root, ".rt-test"), signal);
  const checked = checkDefinitions(files.definitions, root);
  const discovery = latest.discovery?.discovery ?? {
    workspaces: [],
    notRead: [],
  };
  return defectStandings(
    resolveDefinitions(
      checked,
      await readAnchors(checked, signal),
      discovery,
      true,
    ),
    {
      consumerRoot: root,
      assertionErrors: files.assertionErrors,
      evidence: { evidence: [], evidenceRefusals: [] },
      discovery,
      discoveryCurrent: true,
      currentFingerprint: () => undefined,
      testStandings: [],
    },
  ).map((standing) => detectionFor(standing, DIGEST.digest));
}

interface EvidenceCase {
  readonly latest: LatestResults;
  readonly files: DefinitionFilesTree;
  /** What the store holds of the detections a job stored for the definitions, once this has altered them. */
  readonly alter?: (stored: StoredEvidence[]) => StoredEvidence[];
}

/**
 * Writes a case's files under `root` and stores a detection for each of its definitions, then gives the function
 * that answers `defects` for the whole worktree under the inputs handed to it, unsettled when none are.
 */
async function withDetections(
  root: string,
  given: EvidenceCase,
): Promise<(inputs?: CurrentInputs) => Promise<DefectsAnswer>> {
  answered(await defectsOver(root, given.latest, given.files));
  const stored = await detectionsUnder(root, given.latest);
  const latest: LatestResults = {
    ...given.latest,
    evidence: given.alter?.(stored) ?? stored,
  };
  return async (inputs) =>
    answered(
      await defectsOver(
        root,
        latest,
        given.files,
        undefined,
        inputs === undefined ? {} : { inputs },
      ),
    );
}

describe(
  "the defects answer over stored evidence",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    const ONE_DEFINITION: EvidenceCase = {
      latest: discoveryOfAAndB("one"),
      files: { "a.json": [defectDefinition("D1", "one")] },
    };

    it("D3951: before the first reconciliation has ended, evidence nothing made stale reads unknown and is not verified, though it reads current and verified once its workspace's fingerprint can be computed", async () => {
      const read = await inTempDir(async (root) => {
        const answer = await withDetections(root, ONE_DEFINITION);
        const fingerprinted = await answer(A_AT_DIGEST);
        const unsettled = await answer();
        return [fingerprinted, unsettled].map(({ definitions, counts }) => ({
          evidence: definitions[0]?.evidence,
          verified: counts.verified,
        }));
      });
      expect(read).toStrictEqual([
        { evidence: { freshness: "current" }, verified: 1 },
        {
          evidence: {
            freshness: "unknown",
            unknownReasons: ["no-current-fingerprint"],
          },
          verified: 0,
        },
      ]);
    });

    it("D3952: an answer over a scope whose every definition is verified carries the same fields as one over a scope where none is", async () => {
      const fieldsOf = (answer: DefectsAnswer) => ({
        answer: Object.keys(answer).sort(),
        counts: Object.keys(answer.counts).sort(),
      });
      const { verified, unverified } = await inTempDir(async (root) => {
        const all = await withDetections(join(root, "all"), ONE_DEFINITION);
        const none = await withDetections(join(root, "none"), {
          ...ONE_DEFINITION,
          alter: () => [],
        });
        return {
          verified: await all(A_AT_DIGEST),
          unverified: await none(A_AT_DIGEST),
        };
      });
      expect({
        fields: fieldsOf(verified),
        verified: verified.counts.verified,
        total: verified.counts.total,
      }).toStrictEqual({ fields: fieldsOf(unverified), verified: 1, total: 1 });
    });

    it("D3953: within a state, a definition whose evidence is not current is listed before one whose evidence is, whatever their order in the file", async () => {
      const listed = await inTempDir(async (root) => {
        const answer = await withDetections(root, {
          latest: discoveryOfAAndB("one", "two"),
          files: {
            "a.json": [
              defectDefinition("D1", "one"),
              defectDefinition("D2", "two"),
            ],
          },
          alter: (stored) =>
            stored.map((record) =>
              record.defectId === "D2"
                ? { ...record, adapterVersion: OTHER_ADAPTER_VERSION }
                : record,
            ),
        });
        const { definitions } = await answer(A_AT_DIGEST);
        return definitions.map(({ id, state, evidence }) => [
          id,
          state,
          evidence?.freshness,
        ]);
      });
      expect(listed).toStrictEqual([
        ["D2", "detected", "stale"],
        ["D1", "detected", "current"],
      ]);
    });

    it("D3954: a listed definition says whether it is eligible, and one whose verdict is not a detection carries the verdict's reason and detail beside its freshness and causes", async () => {
      const listed = await inTempDir(async (root) => {
        const passed = discovered("one");
        const answer = await withDetections(root, {
          latest: results(
            storedDiscovery([discoveredWorkspace(WORKSPACE_A, [passed])]),
            [
              storedRun(
                ranRun([ranModule([finished(passed, "passed")])]),
                VITEST_ADAPTER_VERSION,
                DIGEST,
              ),
            ],
          ),
          files: ONE_DEFINITION.files,
          alter: (stored) =>
            stored.map((record) => ({
              ...record,
              adapterVersion: OTHER_ADAPTER_VERSION,
              verdict: "invalid-experiment",
              judgement: {
                verdict: "invalid-experiment",
                reason: "hook-not-passed",
                detail: { hook: "beforeEach", state: "fail" },
                facts: ranOnce({
                  test: { ...REJECTING_TEST, hooks: { beforeEach: "fail" } },
                }),
              },
            })),
        });
        const [only] = (await answer(A_AT_DIGEST)).definitions;
        return {
          state: only?.state,
          eligible: only?.eligible,
          evidence: only?.evidence,
        };
      });
      expect(listed).toStrictEqual({
        state: "invalid-experiment",
        eligible: true,
        evidence: {
          freshness: "stale",
          staleCauses: ["another-adapter-version"],
          reason: "hook-not-passed",
          detail: { hook: "beforeEach", state: "fail" },
          omittedCharacters: 0,
        },
      });
    });

    it("D3997: a listed unclear verdict whose intended test held five errors, one not an assertion, lists three of them by kind and name alone, with the 2 it did not list", async () => {
      const errors: ErrorFact[] = [
        { kind: "other", name: "TypeError" },
        { kind: "other" },
        {
          kind: "assertion",
          marker: "assertion-error-name",
          name: "AssertionError",
        },
        {
          kind: "assertion",
          marker: "assertion-error-name",
          name: "AssertionError",
        },
        {
          kind: "assertion",
          marker: "assertion-error-name",
          name: "AssertionError",
        },
      ];
      const listed = await inTempDir(async (root) => {
        const answer = await withDetections(root, {
          ...ONE_DEFINITION,
          alter: (stored) =>
            stored.map((record) => ({
              ...record,
              verdict: "unclear",
              judgement: {
                verdict: "unclear",
                reason: "not-an-assertion",
                facts: ranOnce({ test: { ...REJECTING_TEST, errors } }),
              },
            })),
        });
        const [only] = (await answer(A_AT_DIGEST)).definitions;
        return { state: only?.state, evidence: only?.evidence };
      });
      expect(listed).toStrictEqual({
        state: "unclear",
        evidence: {
          freshness: "current",
          reason: "not-an-assertion",
          errors: [
            { kind: "other", name: "TypeError" },
            { kind: "other" },
            { kind: "assertion", name: "AssertionError" },
          ],
          errorsNotListed: 2,
          omittedCharacters: 0,
        },
      });
    });

    it("D3998: a listed definition whose test holds no current pass says it is not eligible, beside one whose test holds one", async () => {
      const listed = await inTempDir(async (root) => {
        const passed = discovered("one");
        const failed = discovered("two");
        const answer = await withDetections(root, {
          latest: results(
            storedDiscovery([
              discoveredWorkspace(WORKSPACE_A, [passed, failed]),
            ]),
            [
              storedRun(
                ranRun([
                  ranModule([
                    finished(passed, "passed"),
                    finished(failed, "failed"),
                  ]),
                ]),
                VITEST_ADAPTER_VERSION,
                DIGEST,
              ),
            ],
          ),
          files: {
            "a.json": [
              defectDefinition("D1", "one"),
              defectDefinition("D2", "two"),
            ],
          },
        });
        const { definitions } = await answer(A_AT_DIGEST);
        return definitions.map(({ id, eligible }) => [id, eligible]);
      });
      expect(listed).toStrictEqual([
        ["D1", true],
        ["D2", false],
      ]);
    });

    it("D3955: evidence for a test told apart only by its position reads unknown when the daemon's moment reads the discovery stale, and current when it reads it current", async () => {
      const read = await inTempDir(async (root) => {
        const first = discovered("one", { isDuplicate: true });
        const second = {
          ...first,
          identity: { ...first.identity, occurrence: 1 },
        };
        const answer = await withDetections(root, {
          latest: results(
            storedDiscovery(
              [discoveredWorkspace(WORKSPACE_A, [first, second])],
              [],
              VITEST_ADAPTER_VERSION,
              DIGEST,
            ),
          ),
          files: {
            "a.json": [
              {
                ...defectDefinition("D1", "one"),
                test: { module: A_MODULE, name: ["one"], occurrence: 1 },
              },
            ],
          },
        });
        const current = await answer(
          settled(
            { [WORKSPACE_A]: { ok: true, digest: DIGEST.digest } },
            { ok: true, digest: DIGEST.digest },
          ),
        );
        const stale = await answer(A_AT_DIGEST);
        return [current, stale].map(
          ({ definitions }) => definitions[0]?.evidence,
        );
      });
      expect(read).toStrictEqual([
        { freshness: "current" },
        {
          freshness: "unknown",
          unknownReasons: ["duplicate-test-discovery-not-current"],
        },
      ]);
    });
  },
);

/** An `rt-test.json` naming `defects/*.json` and declaring `names` as its assertion error names, or no names when undefined. */
function declaring(names: unknown): DefectsSetup {
  return { settings: { defects: ["defects/*.json"], assertionErrors: names } };
}

/**
 * Writes a case's files under `root` beside an `rt-test.json` declaring `names`, and stores a detection for each of
 * its definitions bound under those names. It gives the function that answers `defects` once `rt-test.json` declares
 * the names handed to it, for the absolute path given or the whole worktree.
 */
async function detectedDeclaring(
  root: string,
  given: EvidenceCase,
  names: unknown,
  inputs: CurrentInputs = A_AT_DIGEST,
): Promise<(declared: unknown, path?: string) => Promise<DefectsAnswer>> {
  answered(
    await defectsOver(
      root,
      given.latest,
      given.files,
      undefined,
      declaring(names),
    ),
  );
  const latest: LatestResults = {
    ...given.latest,
    evidence: await detectionsUnder(root, given.latest),
  };
  return async (declared, path) =>
    answered(
      await defectsOver(root, latest, given.files, path, {
        ...declaring(declared),
        inputs,
      }),
    );
}

/** What an answer's first listed definition reads of its evidence, with the answer's verified count. */
function evidenceRead({ definitions, counts }: DefectsAnswer) {
  return { evidence: definitions[0]?.evidence, verified: counts.verified };
}

describe(
  "the defects answer from the worktree's standings and its declared names",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    const ONE_DEFINITION: EvidenceCase = {
      latest: discoveryOfAAndB("one"),
      files: { "a.json": [defectDefinition("D1", "one")] },
    };
    const ONE_IN_EACH_WORKSPACE: DefinitionFilesTree = {
      "a.json": [
        defectDefinition("D1", "one"),
        defectDefinition("D2", "d", B_MODULE),
      ],
    };

    it("D4021: a problem in the declared names counts in the total and is listed in every scope, and leaves every definition answered", async () => {
      const answers = await inTempDir(async (root) => {
        const over = async (workspace: string) => {
          const answer = answered(
            await defectsOver(
              root,
              ONE_DEFINITION.latest,
              ONE_DEFINITION.files,
              join(root, workspace),
              declaring(["Error"]),
            ),
          );
          return {
            total: answer.counts.total,
            invalidEntries: answer.counts.invalidEntries,
            ids: answer.definitions.map((definition) => definition.id),
            listed: answer.invalidEntries.map(({ kind, path, reason }) => ({
              kind,
              path,
              saysNoNames: /declares no assertion error names/.test(reason),
            })),
          };
        };
        return [await over(WORKSPACE_A), await over(WORKSPACE_B)];
      });
      const namesProblem = {
        kind: "settings-unusable",
        path: "rt-test.json",
        saysNoNames: true,
      };
      expect(answers).toStrictEqual([
        { total: 2, invalidEntries: 1, ids: ["D1"], listed: [namesProblem] },
        { total: 1, invalidEntries: 1, ids: [], listed: [namesProblem] },
      ]);
    });

    it("D4022: a detection stored under the declared names reads current and verified while the same names stand, in another order and with one repeated, and stale as definition-changed and not verified once the list gains or loses a name", async () => {
      const read = await inTempDir(async (root) => {
        const under = await detectedDeclaring(root, ONE_DEFINITION, [
          "TestingLibraryElementError",
          "ZodError",
        ]);
        return [
          evidenceRead(await under(["TestingLibraryElementError", "ZodError"])),
          evidenceRead(
            await under(["ZodError", "TestingLibraryElementError", "ZodError"]),
          ),
          evidenceRead(
            await under([
              "TestingLibraryElementError",
              "ZodError",
              "ConvexError",
            ]),
          ),
          evidenceRead(await under(["TestingLibraryElementError"])),
        ];
      });
      const unchanged = { evidence: { freshness: "current" }, verified: 1 };
      const changed = {
        evidence: { freshness: "stale", staleCauses: ["definition-changed"] },
        verified: 0,
      };
      expect(read).toStrictEqual([unchanged, unchanged, changed, changed]);
    });

    it("D4023: a member that cannot be used is the empty set, so a detection stored while no name was declared still reads current under a list refused for holding Error beside a usable name, and the refusal counts in the total", async () => {
      const read = await inTempDir(async (root) => {
        const under = await detectedDeclaring(root, ONE_DEFINITION, undefined);
        const answer = await under(["TestingLibraryElementError", "Error"]);
        return { ...evidenceRead(answer), total: answer.counts.total };
      });
      expect(read).toStrictEqual({
        evidence: { freshness: "current" },
        verified: 1,
        total: 2,
      });
    });

    it("D4024: a path's counts cover only the definitions in it, so of two verified definitions, one in each workspace, a workspace's answer counts one definition, one detection and one verified, and leaves none unlisted", async () => {
      const read = await inTempDir(async (root) => {
        const under = await detectedDeclaring(
          root,
          { latest: ONE_DEFINITION.latest, files: ONE_IN_EACH_WORKSPACE },
          undefined,
          settled({
            [WORKSPACE_A]: { ok: true, digest: DIGEST.digest },
            [WORKSPACE_B]: { ok: true, digest: DIGEST.digest },
          }),
        );
        const answer = await under(undefined, join(root, WORKSPACE_B));
        return {
          ids: answer.definitions.map((definition) => definition.id),
          total: answer.counts.total,
          states: nonZero(answer.counts.states),
          freshness: nonZero(answer.counts.freshness),
          verified: answer.counts.verified,
          notListed: nonZero(answer.definitionsNotListed),
        };
      });
      expect(read).toStrictEqual({
        ids: ["D2"],
        total: 1,
        states: { detected: 1 },
        freshness: { current: 1 },
        verified: 1,
        notListed: {},
      });
    });

    it("D4025: the worktree's standings give the names rt-test.json declares, the definition file problems, and every definition with its standing, whatever workspace its test lies in", async () => {
      const read = await inTempDir(async (root) => {
        const { latest } = ONE_DEFINITION;
        answered(
          await defectsOver(
            root,
            latest,
            { ...ONE_IN_EACH_WORKSPACE, "broken.json": "not json" },
            undefined,
            declaring(["TestingLibraryElementError"]),
          ),
        );
        const worktree = answered(
          await worktreeStandings({
            consumerRoot: root,
            stateDirectory: join(root, ".rt-test"),
            signal: new AbortController().signal,
            moment: () => ({
              results: latest,
              view: { ...IDLE, consumerRoot: root },
              inputs: UNSETTLED,
            }),
          }),
        );
        return {
          names: worktree.assertionErrors,
          problems: worktree.invalidEntries.map(
            ({ kind, path }) => `${kind} ${path}`,
          ),
          definitions: worktree.definitions.map((definition) => definition.id),
          standings: worktree.standings.map(({ definition, state }) => [
            definition.id,
            state,
          ]),
        };
      });
      expect(read).toStrictEqual({
        names: ["TestingLibraryElementError"],
        problems: ["not-json defects/broken.json"],
        definitions: ["D1", "D2"],
        standings: [
          ["D1", "never-verified"],
          ["D2", "never-verified"],
        ],
      });
    });

    it("D4026: the answer takes the daemon's moment only once each mutation's file is read, so a mutation file rewritten as the moment is taken is not the one its anchor is read from", async () => {
      const state = await inTempDir(async (root) => {
        const answer = answered(
          await defectsOver(
            root,
            () => {
              writeFileSync(
                join(root, A_SOURCE),
                "export function a() {\n  return 3;\n}\n",
              );
              return ONE_DEFINITION.latest;
            },
            ONE_DEFINITION.files,
          ),
        );
        return answer.definitions[0]?.state;
      });
      expect(state).toBe("never-verified");
    });

    it("D4027: with no discovery stored the answer is the no-answer saying so, whatever rt-test.json and the definition files hold", async () => {
      const answer = await inTempDir((root) =>
        defectsOver(
          root,
          results(undefined),
          { ...ONE_DEFINITION.files, "broken.json": "not json" },
          undefined,
          declaring(["Error"]),
        ).catch((error: unknown) => ({ thrown: String(error) })),
      );
      expect(answer).toStrictEqual({
        noAnswer: expect.stringMatching(
          /^the daemon serving .* has stored no discovery for this worktree; /,
        ),
      });
    });

    it("D4029: the worktree's standings digest each definition under the consumer root the caller gave, so a detection bound under that root reads current through the answer", async () => {
      const read = await inTempDir(async (root) => {
        const under = await detectedDeclaring(root, ONE_DEFINITION, undefined);
        return evidenceRead(await under(undefined));
      });
      expect(read).toStrictEqual({
        evidence: { freshness: "current" },
        verified: 1,
      });
    });

    it("D4030: the answer lists the invalid entries in the order the read gives them, so with a problem in each member the defects member's stands first, and a problem in the names stands before a definition file that is not JSON", async () => {
      const listings = await inTempDir(async (root) => {
        const listed = async (
          consumer: string,
          files: DefinitionFilesTree,
          settings: unknown,
        ) => {
          const answer = answered(
            await defectsOver(
              join(root, consumer),
              ONE_DEFINITION.latest,
              files,
              undefined,
              { settings },
            ),
          );
          return {
            counted: answer.counts.invalidEntries,
            listed: answer.invalidEntries.map(({ kind, path, reason }) => ({
              kind,
              path,
              says:
                /names no definition files|declares no assertion error names/.exec(
                  reason,
                )?.[0] ?? null,
            })),
          };
        };
        return [
          await listed(
            "both",
            {},
            { defects: ["/defects/*.json"], assertionErrors: ["Error"] },
          ),
          await listed(
            "names",
            { "broken.json": "not json" },
            { defects: ["defects/*.json"], assertionErrors: ["Error"] },
          ),
        ];
      });
      const namesProblem = {
        kind: "settings-unusable",
        path: "rt-test.json",
        says: "declares no assertion error names",
      };
      expect(listings).toStrictEqual([
        {
          counted: 2,
          listed: [
            {
              kind: "settings-unusable",
              path: "rt-test.json",
              says: "names no definition files",
            },
            namesProblem,
          ],
        },
        {
          counted: 2,
          listed: [
            namesProblem,
            { kind: "not-json", path: "defects/broken.json", says: null },
          ],
        },
      ]);
    });

    it("D4031: definitions of one state are listed file by file, each file's in position order, whatever order the walk read the files in", async () => {
      const answer = answered(
        await inTempDir((root) =>
          defectsOver(
            root,
            discoveryOfAAndB("one", "two", "three", "four"),
            {
              "b.json": [
                defectDefinition("D1", "one"),
                defectDefinition("D2", "two"),
              ],
              "a/x.json": [
                defectDefinition("D3", "three"),
                defectDefinition("D4", "four"),
              ],
            },
            undefined,
            { morePatterns: ["defects/a/*.json"] },
          ),
        ),
      );
      expect(
        answer.definitions.map(
          ({ file, position, state }) => `${state} ${file}#${position}`,
        ),
      ).toStrictEqual([
        "never-verified defects/a/x.json#0",
        "never-verified defects/a/x.json#1",
        "never-verified defects/b.json#0",
        "never-verified defects/b.json#1",
      ]);
    });
  },
);

/** A stored discovery of `entries` bound to `DIGEST`. */
function discoveryAtDigest(
  entries: readonly WorkspaceDiscovery[],
): StoredDiscovery {
  return storedDiscovery(entries, [], VITEST_ADAPTER_VERSION, DIGEST);
}

/** A run of `path` stored under `DIGEST` that ran `tests` in one module, each passed. */
function vouchingRun(
  tests: readonly DiscoveredTest[],
  path = WORKSPACE_A,
): StoredRun {
  return storedRun(
    ranRun(
      [ranModule(tests.map((test) => finished(test, "passed")))],
      {},
      path,
    ),
    VITEST_ADAPTER_VERSION,
    DIGEST,
  );
}

/** Settled inputs under which the discovery's own fingerprint is `DIGEST`, and each workspace's the digest given. */
function discoveryCurrentWith(
  workspaces: Readonly<Record<string, string>>,
): CurrentInputs {
  return settled(
    Object.fromEntries(
      Object.entries(workspaces).map(
        ([path, digest]): [string, FingerprintResult] => [
          path,
          { ok: true, digest },
        ],
      ),
    ),
    digestOf(DIGEST),
  );
}

/** Two tests named `name` in one module of workspace A, told apart only by their position: the first, then the second. */
function sameNamedPair(name: string): [DiscoveredTest, DiscoveredTest] {
  const first = discovered(name, { isDuplicate: true });
  return [first, { ...first, identity: { ...first.identity, occurrence: 1 } }];
}

describe(
  "the discovery's freshness once a stored run must vouch for each list",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4321: a discovery current by its own fingerprint reads stale while a workspace holding a stored run is due, and current once that run is bound to the workspace's current fingerprint", () => {
      const test = discovered("a");
      const freshnessUnder = (workspaceDigest: string): string =>
        summaryOf(
          discoveryAtDigest([discoveredWorkspace(WORKSPACE_A, [test])]),
          [vouchingRun([test])],
          discoveryCurrentWith({ [WORKSPACE_A]: workspaceDigest }),
        ).discovery.freshness;
      expect([
        freshnessUnder(OTHER_DIGEST),
        freshnessUnder(DIGEST.digest),
      ]).toStrictEqual(["stale", "current"]);
    });

    it("D4322: a discovery current by its own fingerprint reads unknown while a workspace's latest run is refused as unreadable", () => {
      const answer = answered(
        summaryAnswer(
          results(
            discoveryAtDigest([
              discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
            ]),
            [],
            undefined,
            [
              {
                workspacePath: WORKSPACE_A,
                reason: "The store holds an unreadable run",
              },
            ],
          ),
          IDLE,
          discoveryCurrentWith({ [WORKSPACE_A]: DIGEST.digest }),
        ),
      );
      expect(answer.discovery.freshness).toBe("unknown");
    });

    it("D4323: a discovery current by its own fingerprint reads unknown while a workspace's current run recorded other tests for a listed module, and current when it recorded exactly the listed ones", () => {
      const listed = discovered("a");
      const freshnessAfter = (recorded: DiscoveredTest): string =>
        summaryOf(
          discoveryAtDigest([discoveredWorkspace(WORKSPACE_A, [listed])]),
          [vouchingRun([recorded])],
          discoveryCurrentWith({ [WORKSPACE_A]: DIGEST.digest }),
        ).discovery.freshness;
      expect([
        freshnessAfter(discovered("renamed")),
        freshnessAfter(listed),
      ]).toStrictEqual(["unknown", "current"]);
    });

    it("D4324: a workspace with no stored run leaves the discovery current, whatever that workspace's fingerprint", () => {
      const inA = discovered("a");
      const summary = summaryOf(
        discoveryAtDigest([
          discoveredWorkspace(WORKSPACE_A, [inA]),
          discoveredWorkspace(WORKSPACE_B, [
            discovered("b", { workspacePath: WORKSPACE_B }),
          ]),
        ]),
        [vouchingRun([inA])],
        discoveryCurrentWith({
          [WORKSPACE_A]: DIGEST.digest,
          [WORKSPACE_B]: OTHER_DIGEST,
        }),
      );
      expect(summary.discovery.freshness).toBe("current");
    });

    it("D4325: two same-named tests of a workspace whose run is current read current while another workspace is due, although the answer's discovery then reads stale", () => {
      const pair = sameNamedPair("same");
      const inB = discovered("b", { workspacePath: WORKSPACE_B });
      const summary = summaryOf(
        discoveryAtDigest([
          discoveredWorkspace(WORKSPACE_A, pair),
          discoveredWorkspace(WORKSPACE_B, [inB]),
        ]),
        [vouchingRun(pair), vouchingRun([inB], WORKSPACE_B)],
        discoveryCurrentWith({
          [WORKSPACE_A]: DIGEST.digest,
          [WORKSPACE_B]: OTHER_DIGEST,
        }),
      );
      expect({
        discovery: summary.discovery.freshness,
        tests: nonZero(summary.counts.freshness),
      }).toStrictEqual({
        discovery: "stale",
        tests: { current: 2, stale: 1 },
      });
    });

    it("D4326: evidence for a test told apart only by its position reads current while another workspace is due, although the answer's discovery then reads stale", async () => {
      const read = await inTempDir(async (root) => {
        const pair = sameNamedPair("one");
        const inB = discovered("b", { workspacePath: WORKSPACE_B });
        const answer = await withDetections(root, {
          latest: results(
            discoveryAtDigest([
              discoveredWorkspace(WORKSPACE_A, pair),
              discoveredWorkspace(WORKSPACE_B, [inB]),
            ]),
            [vouchingRun([inB], WORKSPACE_B)],
          ),
          files: {
            "a.json": [
              {
                ...defectDefinition("D1", "one"),
                test: { module: A_MODULE, name: ["one"], occurrence: 1 },
              },
            ],
          },
        });
        const { discovery, definitions } = await answer(
          discoveryCurrentWith({
            [WORKSPACE_A]: DIGEST.digest,
            [WORKSPACE_B]: OTHER_DIGEST,
          }),
        );
        return {
          discovery: discovery.freshness,
          evidence: definitions[0]?.evidence,
        };
      });
      expect(read).toStrictEqual({
        discovery: "stale",
        evidence: { freshness: "current" },
      });
    });

    it("D4347: a discovery current by its own fingerprint reads unknown while a workspace's latest run recorded exactly the listed tests but is stored not fingerprinted", () => {
      const test = discovered("a");
      const summary = summaryOf(
        discoveryAtDigest([discoveredWorkspace(WORKSPACE_A, [test])]),
        [storedRun(ranRun([ranModule([finished(test, "passed")])]))],
        discoveryCurrentWith({ [WORKSPACE_A]: DIGEST.digest }),
      );
      expect(summary.discovery.freshness).toBe("unknown");
    });

    it("D4348: a discovery reads unknown when an earlier workspace's current run recorded other tests, although a later workspace's run vouches for its list", () => {
      const inB = discovered("b", { workspacePath: WORKSPACE_B });
      const summary = summaryOf(
        discoveryAtDigest([
          discoveredWorkspace(WORKSPACE_A, [discovered("a")]),
          discoveredWorkspace(WORKSPACE_B, [inB]),
        ]),
        [vouchingRun([discovered("renamed")]), vouchingRun([inB], WORKSPACE_B)],
        discoveryCurrentWith({
          [WORKSPACE_A]: DIGEST.digest,
          [WORKSPACE_B]: DIGEST.digest,
        }),
      );
      expect(summary.discovery.freshness).toBe("unknown");
    });

    it("D4351: a not-discovered reason says the discovery is not current while its workspace's stored run is due, although the discovery's own fingerprint reads current, and not once that run is current", async () => {
      const listed = discovered("one");
      const latest = results(
        discoveryAtDigest([discoveredWorkspace(WORKSPACE_A, [listed])]),
        [vouchingRun([listed])],
      );
      const files = { "a.json": [defectDefinition("D1", "missing")] };
      const reasons = await inTempDir(async (root) => {
        const due = answered(
          await defectsOver(join(root, "a"), latest, files, undefined, {
            inputs: discoveryCurrentWith({ [WORKSPACE_A]: OTHER_DIGEST }),
          }),
        );
        const current = answered(
          await defectsOver(join(root, "b"), latest, files, undefined, {
            inputs: discoveryCurrentWith({ [WORKSPACE_A]: DIGEST.digest }),
          }),
        );
        return [due, current].map((answer) =>
          /not current/.test(answer.definitions[0]?.reason?.reason ?? ""),
        );
      });
      expect(reasons).toStrictEqual([true, false]);
    });
  },
);
