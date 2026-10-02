import { describe, expect, it } from "vitest";
import { listRefresh, listsToCarry } from "../src/daemon/carried-lists.js";
import type { LatestResults } from "../src/store/open-store.js";
import type {
  StoredDiscovery,
  StoredRun,
} from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { WorkspaceDiscovery } from "../src/vitest/discover-tests.js";
import type { RecordedModule } from "../src/vitest/run-states.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import {
  withModuleLists,
  type ModuleTests,
  type WorkspaceLists,
} from "../src/vitest/test-lists.js";
import { memoryLog } from "./daemon-harness.js";
import { crashedRun } from "./round-fixtures.js";
import {
  digestOf,
  discovered,
  discovery,
  DISCOVERED_VITEST_VERSION,
  SCOPE,
  workspace,
} from "./scheduling-harness.js";

type DiscoveredWorkspace = Extract<
  WorkspaceDiscovery,
  { status: "discovered" }
>;

const PROJECT = "unit";
const MODULE = "a.test.ts";
/** Any adapter version but the daemon's current one. */
const OTHER_ADAPTER_VERSION = VITEST_ADAPTER_VERSION + 1;
const STORED_AT = digestOf("sha256:discovery");
const READ_FAILURE = "database is locked";

/** The tests named `names` of `modulePath` in workspace `path`, as a discovery lists a module. */
function listOf(
  path: string,
  modulePath: string,
  names: readonly string[],
): ModuleTests {
  return {
    projectName: PROJECT,
    modulePath,
    tests: names.map((name) => ({
      identity: {
        workspacePath: path,
        projectName: PROJECT,
        modulePath,
        namePath: [name],
        occurrence: 0,
      },
      isDuplicate: false,
      mode: "run",
    })),
  };
}

/** Workspace `path` discovered as listing `lists`. */
function listing(
  path: string,
  lists: readonly ModuleTests[],
  more: Partial<DiscoveredWorkspace> = {},
): DiscoveredWorkspace {
  return {
    ...discovered(path),
    tests: lists.flatMap((list) => list.tests),
    ...more,
  };
}

/** A module a run recorded as ran, with each test of `list` passed. */
function ran(list: ModuleTests): RecordedModule {
  return {
    projectName: list.projectName,
    modulePath: list.modulePath,
    state: "ran",
    tests: list.tests.map(({ identity, isDuplicate }) => ({
      identity,
      isDuplicate,
      execution: "finished",
      outcome: "passed",
      errors: [],
    })),
    errors: [],
  };
}

function runOf(path: string, modules: readonly RecordedModule[]): WorkspaceRun {
  return {
    status: "ran",
    workspace: workspace(path),
    vitestVersion: DISCOVERED_VITEST_VERSION,
    execution: "completed",
    modules,
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
    forceStopped: false,
  };
}

function storedDiscovery(
  entries: readonly WorkspaceDiscovery[],
  adapterVersion: number = VITEST_ADAPTER_VERSION,
): StoredDiscovery {
  return {
    ...SCOPE,
    inputFingerprint: STORED_AT,
    adapterVersion,
    discoveryId: "discovery-1",
    discovery: discovery(...entries),
  };
}

/** What a store holds: `stored` as its latest discovery, and each of `runs` as its workspace's latest run. */
function latestOf(
  stored: StoredDiscovery,
  runs: readonly WorkspaceRun[],
): LatestResults {
  return {
    discovery: stored,
    discoveryRefusal: undefined,
    latestRuns: runs.map((run, index): StoredRun => ({
      ...SCOPE,
      inputFingerprint: digestOf(`sha256:${run.workspace.path}`),
      adapterVersion: VITEST_ADAPTER_VERSION,
      runId: `run-${index}`,
      run,
    })),
    runRefusals: [],
    evidence: [],
    evidenceRefusals: [],
  };
}

function carriedFrom(results: LatestResults): WorkspaceLists[] {
  return listsToCarry(() => results, memoryLog());
}

/** What a rediscovery is handed and what the log holds when the read of the stored results throws, or what escaped. */
function carriedOverFailedRead(): unknown {
  const log = memoryLog();
  try {
    const carried = listsToCarry(() => {
      throw new Error(READ_FAILURE);
    }, log);
    return { carried, logged: log.entries };
  } catch (error) {
    return { escaped: String(error) };
  }
}

describe("the lists a rediscovery is handed in place of collecting their modules", () => {
  it("D4313: a discovery stored under another adapter version hands over no list, while one of the current version hands over the list its run vouches for", () => {
    const list = listOf("a", MODULE, ["t"]);
    const runs = [runOf("a", [ran(list)])];
    const under = (adapterVersion: number): WorkspaceLists[] =>
      carriedFrom(
        latestOf(storedDiscovery([listing("a", [list])], adapterVersion), runs),
      );
    expect([
      under(OTHER_ADAPTER_VERSION),
      under(VITEST_ADAPTER_VERSION),
    ]).toStrictEqual([[], [{ workspacePath: "a", modules: [list] }]]);
  });

  it("D4314: a workspace whose collection raised an unhandled error hands over no list, while a workspace beside it that raised none hands over its own", () => {
    const inA = listOf("a", MODULE, ["t"]);
    const inB = listOf("b", MODULE, ["t"]);
    const carried = carriedFrom(
      latestOf(
        storedDiscovery([
          listing("a", [inA], { unhandledErrors: ["Error: stray boom"] }),
          listing("b", [inB]),
        ]),
        [runOf("a", [ran(inA)]), runOf("b", [ran(inB)])],
      ),
    );
    expect(carried).toStrictEqual([{ workspacePath: "b", modules: [inB] }]);
  });

  it("D4315: only a module its workspace's latest run ran with exactly the listed tests is handed over, and none of a workspace with no stored run or a crashed one", () => {
    const same = listOf("a", "same.test.ts", ["t"]);
    const renamed = listOf("a", "renamed.test.ts", ["before"]);
    const later = listOf("a", "later.test.ts", ["t"]);
    const neverRun = listOf("b", MODULE, ["t"]);
    const crashed = listOf("c", MODULE, ["t"]);
    const carried = carriedFrom(
      latestOf(
        storedDiscovery([
          listing("a", [same, renamed, later]),
          listing("b", [neverRun]),
          listing("c", [crashed]),
        ]),
        [
          runOf("a", [
            ran(same),
            ran(listOf("a", "renamed.test.ts", ["after"])),
            {
              projectName: PROJECT,
              modulePath: "later.test.ts",
              state: "not-run",
            },
          ]),
          crashedRun("c"),
        ],
      ),
    );
    expect(carried).toStrictEqual([{ workspacePath: "a", modules: [same] }]);
  });

  it("D4316: a read of the stored results that throws hands over no list and is logged, and nothing escapes to the discovery", () => {
    expect(carriedOverFailedRead()).toStrictEqual({
      carried: [],
      logged: [
        `error: reading the lists a rediscovery could carry, so it collects every test module: Error: ${READ_FAILURE}`,
      ],
    });
  });
});

describe("the discovery stored again with a run's lists", () => {
  it("D4317: the refreshed record is bound to the project, the worktree and the input fingerprint of the discovery it replaces", () => {
    const refresh = listRefresh(
      storedDiscovery([listing("a", [listOf("a", MODULE, ["t"])])]),
      "a",
      [listOf("a", MODULE, ["t", "added"])],
    );
    expect(refresh?.bindings).toStrictEqual({
      ...SCOPE,
      inputFingerprint: STORED_AT,
    });
  });

  it("D4318: a list replaces the list of a module the workspace already lists, and a list of a module it does not list adds nothing", () => {
    const grown = listOf("a", MODULE, ["t", "added"]);
    const replaced = withModuleLists(
      discovery(listing("a", [listOf("a", MODULE, ["t"])])),
      "a",
      [grown, listOf("a", "unlisted.test.ts", ["n"])],
    );
    expect(replaced).toStrictEqual({
      discovery: discovery(listing("a", [grown])),
      changedModules: 1,
    });
  });

  it("D4319: a list holding no test leaves the module's list as the discovery found it", () => {
    const held = listOf("a", MODULE, ["t"]);
    expect(
      withModuleLists(discovery(listing("a", [held])), "a", [
        { ...held, tests: [] },
      ]),
    ).toBeUndefined();
  });

  it("D4331: a list that differs from the discovery's own only in a test's declared mode replaces it", () => {
    const held = listOf("a", MODULE, ["t"]);
    const skipped: ModuleTests = {
      ...held,
      tests: held.tests.map((test) => ({ ...test, mode: "skip" })),
    };
    expect(
      withModuleLists(discovery(listing("a", [held])), "a", [skipped]),
    ).toStrictEqual({
      discovery: discovery(listing("a", [skipped])),
      changedModules: 1,
    });
  });

  it("D4320: lists equal to the discovery's own refresh nothing, while a list that gained a test does", () => {
    const held = listOf("a", MODULE, ["t"]);
    const stored = storedDiscovery([listing("a", [held])]);
    const refreshes = (list: ModuleTests): boolean =>
      listRefresh(stored, "a", [list]) !== undefined;
    expect([
      refreshes(held),
      refreshes(listOf("a", MODULE, ["t", "added"])),
    ]).toStrictEqual([false, true]);
  });
});
