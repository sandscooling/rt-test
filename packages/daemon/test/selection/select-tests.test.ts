import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NON_INPUTS_ABSENT,
  NON_INPUTS_FILE,
  type NonInputsDeclaration,
} from "../../src/inputs/non-inputs.js";
import {
  buildSelectionInput,
  type SelectionInputBuild,
} from "../../src/selection/selection-input.js";
import {
  SELECTION_POLICY_VERSION,
  type Selection,
  type SelectionOutcome,
} from "../../src/selection/selection-types.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../../src/vitest/discover-tests.js";
import type { VitestWorkspace } from "../../src/vitest/find-workspaces.js";
import {
  STRING_FIND,
  type ProjectSelectionFacts,
  type ReportedAlias,
} from "../../src/vitest/selection-facts.js";
import {
  DISCOVERED_VITEST_VERSION,
  discoveredWorkspace,
  onPlatform,
  projectFacts,
} from "../harness.js";
import {
  manifest,
  narrowedInTree,
  placedInTree,
  rootManifest,
  selectedByNarrowing,
  selectedPaths,
  selectFromDiscovery,
  selectInTree,
  type NotBuilt,
  type Settled,
  type TreeCase,
  type TreeWorkspace,
} from "./harness.js";

const CONFIG = "export default {};\n";
const NOT_CONFIRMED = "not confirmed at start";
const DISCOVERY_FAILED = "discovery failed";
const UNREAD_SOURCE = { source: "packages/unlisted", reason: "cannot list" };

interface Consumer {
  /** Vitest workspaces `packages/<name>`, in listing order. */
  readonly vitest: Readonly<Record<string, Omit<TreeWorkspace, "path">>>;
  readonly plain?: readonly string[];
  /** Each package's dependencies, by name. */
  readonly deps?: Readonly<Record<string, readonly string[]>>;
  /** Packages whose directory holds no package.json. */
  readonly noManifest?: readonly string[];
  readonly root?: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, string>>;
}

function packageFiles(
  name: string,
  isVitest: boolean,
  { deps = {}, noManifest = [] }: Consumer,
): Record<string, string> {
  const directory = `packages/${name}`;
  const files: Record<string, string> = isVitest
    ? { [`${directory}/vitest.config.ts`]: CONFIG }
    : { [`${directory}/src/index.ts`]: "" };
  if (!noManifest.includes(name)) {
    const dependencies = Object.fromEntries(
      (deps[name] ?? []).map((dependency) => [
        `@x/${dependency}`,
        "workspace:*",
      ]),
    );
    files[`${directory}/package.json`] = manifest({
      name: `@x/${name}`,
      dependencies,
    });
  }
  return files;
}

function consumer(shape: Consumer): Omit<TreeCase, "change"> {
  const vitestNames = Object.keys(shape.vitest);
  return {
    files: {
      "package.json": rootManifest(shape.root),
      ...Object.assign(
        {},
        ...vitestNames.map((name) => packageFiles(name, true, shape)),
        ...(shape.plain ?? []).map((name) => packageFiles(name, false, shape)),
      ),
      ...shape.files,
    },
    workspaces: vitestNames.map((name) => ({
      path: `packages/${name}`,
      ...shape.vitest[name],
    })),
  };
}

function select(
  shape: Consumer,
  change: readonly string[],
  extra: Partial<TreeCase> = {},
): Promise<Settled<SelectionOutcome>> {
  return selectInTree({ ...consumer(shape), change, ...extra });
}

function from<T>(
  outcome: Settled<SelectionOutcome>,
  read: (selection: Selection) => T,
): T | Settled<SelectionOutcome> {
  return "workspaces" in outcome ? read(outcome) : outcome;
}

function reasonTriggers(
  outcome: Settled<SelectionOutcome>,
  workspace: string,
): string[] | Settled<SelectionOutcome> {
  return from(
    outcome,
    ({ workspaces }) =>
      workspaces
        .find(({ path }) => path === workspace)
        ?.reasons.map(({ trigger }) => trigger) ?? [],
  );
}

const THREE_APPS: Consumer = {
  vitest: { app1: {}, app2: {}, app3: {} },
  plain: ["lib"],
};

describe("the workspace a changed path belongs to", () => {
  it("D1384: packages/ab/x belongs to packages/ab, never to packages/a", async () => {
    expect(
      await select({ vitest: { a: {}, ab: {} } }, [
        "packages/ab/src/x.ts",
      ]).then(selectedPaths),
    ).toEqual(["packages/ab"]);
  });

  it("D1385: a path belongs to the deepest package workspace holding it", async () => {
    const nested = "packages/a/nested";
    expect(
      await selectInTree({
        files: {
          "package.json": rootManifest({ workspaces: ["packages/*", nested] }),
          "packages/a/package.json": manifest({ name: "@x/a" }),
          "packages/a/vitest.config.ts": CONFIG,
          [`${nested}/package.json`]: manifest({ name: "@x/nested" }),
          [`${nested}/vitest.config.ts`]: CONFIG,
        },
        workspaces: [{ path: "packages/a" }, { path: nested }],
        change: [`${nested}/src/x.ts`],
      }).then(selectedPaths),
    ).toEqual([nested]);
  });

  it("D1386: each selected test carries a reason naming the changed path", async () => {
    const outcome = await select({ vitest: { app: {} } }, [
      "packages/app/src/x.ts",
    ]);
    expect(
      from(outcome, ({ tests }) =>
        tests.map(({ reasons }) =>
          reasons.map(({ path, trigger }) => [path, trigger]),
        ),
      ),
    ).toEqual([[["packages/app/src/x.ts", "changed-path"]]]);
  });
});

describe("the dependents a change reaches", () => {
  const chain: Consumer = {
    vitest: { app: {} },
    plain: ["a", "b"],
    deps: { app: ["b"], b: ["a"] },
  };

  it("D1387: a change selects a Vitest workspace depending on its workspace through a chain of plain packages", async () => {
    expect(
      await select(chain, ["packages/a/src/x.ts"]).then(selectedPaths),
    ).toEqual(["packages/app"]);
  });

  it("D1388: the reason names the changed path's workspace and each workspace along the chain", async () => {
    const outcome = await select(chain, ["packages/a/src/x.ts"]);
    expect(from(outcome, ({ workspaces }) => workspaces[0]?.reasons)).toEqual([
      {
        path: "packages/a/src/x.ts",
        trigger: "changed-path",
        from: "packages/a",
        steps: [
          {
            workspace: "packages/b",
            via: "manifest",
            detail: expect.any(String),
          },
          {
            workspace: "packages/app",
            via: "manifest",
            detail: expect.any(String),
          },
        ],
      },
    ]);
  });

  it("D1389: a reason carries one shortest chain when a longer one also reaches the workspace", async () => {
    const outcome = await select(
      {
        vitest: { app: {} },
        plain: ["a", "b"],
        deps: { app: ["a", "b"], b: ["a"] },
      },
      ["packages/a/src/x.ts"],
    );
    expect(
      from(outcome, ({ workspaces }) =>
        workspaces[0]?.reasons.map(({ steps }) =>
          steps.map(({ workspace }) => workspace),
        ),
      ),
    ).toEqual([["packages/app"]]);
  });
});

describe("every reason a test was selected for", () => {
  it("D1390: a workspace two changed paths select carries a reason for each", async () => {
    const outcome = await select(
      { vitest: { app: {} }, plain: ["lib"], deps: { app: ["lib"] } },
      ["packages/app/src/x.ts", "packages/lib/src/y.ts"],
    );
    expect(
      from(outcome, ({ tests }) => tests[0]?.reasons.map(({ path }) => path)),
    ).toEqual(["packages/app/src/x.ts", "packages/lib/src/y.ts"]);
  });

  it("D1391: a path selecting a workspace by two triggers carries a reason for each", async () => {
    expect(
      reasonTriggers(
        await select({ vitest: { app: {} } }, [
          "packages/app/vitest.config.ts",
        ]),
        "packages/app",
      ),
    ).toEqual(["workspace-config", "changed-path"]);
  });

  it("D1392: a path that selected nothing is reported with why", async () => {
    const outcome = await select(THREE_APPS, ["packages/lib/src/x.ts"]);
    expect(from(outcome, ({ paths }) => paths[0])).toMatchObject({
      selected: [],
      nothingSelected: { kind: "no-dependent-vitest-workspace" },
    });
  });
});

describe("project-wide broad fallbacks", () => {
  it("D1393: every supported lockfile name is a lockfile trigger in any directory", async () => {
    const lockfiles = [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "pnpm-lock.yaml",
      "yarn.lock",
    ].map((name) => `packages/lib/${name}`);
    const outcome = await select(THREE_APPS, lockfiles);
    expect(
      from(outcome, ({ paths }) =>
        paths.map(({ triggers }) => triggers.includes("lockfile")),
      ),
    ).toEqual(lockfiles.map(() => true));
  });

  it("D1394: a project-wide fallback selects every Vitest workspace, not only its path's dependents", async () => {
    expect(
      await select(THREE_APPS, ["packages/lib/pnpm-lock.yaml"]).then(
        selectedPaths,
      ),
    ).toEqual(["packages/app1", "packages/app2", "packages/app3"]);
  });

  it("D1395: any package.json is a project-wide manifest fallback naming the path", async () => {
    const outcome = await select(THREE_APPS, ["packages/lib/package.json"]);
    expect(from(outcome, ({ fallbacks }) => fallbacks)).toEqual([
      {
        path: "packages/lib/package.json",
        trigger: "manifest",
        scope: "project",
        workspaces: ["packages/app1", "packages/app2", "packages/app3"],
      },
    ]);
  });

  it("D1396: a path the consumer root owns selects every Vitest workspace while another package workspace is listed", async () => {
    expect(await select(THREE_APPS, ["README.md"]).then(selectedPaths)).toEqual(
      ["packages/app1", "packages/app2", "packages/app3"],
    );
  });

  it("D1397: a path in a consumer root that is the only package workspace is a plain change", async () => {
    const outcome = await selectInTree({
      files: {
        "package.json": manifest({ name: "solo" }),
        "vitest.config.ts": CONFIG,
      },
      workspaces: [{ path: "." }],
      change: ["README.md"],
    });
    expect(from(outcome, ({ paths }) => paths[0]?.triggers)).toEqual([
      "changed-path",
    ]);
  });

  it("D1398: a path in a listed directory with no package.json that is not a Vitest workspace selects every Vitest workspace", async () => {
    expect(
      await select({ ...THREE_APPS, plain: ["bare"], noManifest: ["bare"] }, [
        "packages/bare/src/x.ts",
      ]).then(selectedPaths),
    ).toEqual(["packages/app1", "packages/app2", "packages/app3"]);
  });

  it("D1399: a path in a Vitest workspace with no package.json is a plain change, not a missing-manifest fallback", async () => {
    const outcome = await select(
      { vitest: { app1: {}, app2: {} }, noManifest: ["app1"] },
      ["packages/app1/src/x.ts"],
    );
    expect(from(outcome, ({ paths }) => paths[0]?.triggers)).toEqual([
      "changed-path",
    ]);
  });

  it("D1400: a Vitest config file name in a directory that is not a Vitest workspace selects every Vitest workspace", async () => {
    expect(
      await select(THREE_APPS, ["packages/lib/vitest.config.ts"]).then(
        selectedPaths,
      ),
    ).toEqual(["packages/app1", "packages/app2", "packages/app3"]);
  });

  it("D1401: a config file name in a subdirectory of a Vitest workspace selects every Vitest workspace", async () => {
    expect(
      await select(THREE_APPS, ["packages/app1/sub/vite.config.ts"]).then(
        selectedPaths,
      ),
    ).toEqual(["packages/app1", "packages/app2", "packages/app3"]);
  });
});

describe("workspace-scoped broad fallbacks", () => {
  const dependent: Consumer = {
    ...THREE_APPS,
    deps: { app2: ["app1"] },
  };

  it("D1402: a config file in a Vitest workspace's directory selects that workspace and its dependents only", async () => {
    expect(
      await select(dependent, ["packages/app1/vitest.config.ts"]).then(
        selectedPaths,
      ),
    ).toEqual(["packages/app1", "packages/app2"]);
  });

  it("D1403: a config file in a Vitest workspace's directory is a workspace-config fallback naming the path", async () => {
    const outcome = await select(dependent, ["packages/app1/vitest.config.ts"]);
    expect(from(outcome, ({ fallbacks }) => fallbacks)).toEqual([
      {
        path: "packages/app1/vitest.config.ts",
        trigger: "workspace-config",
        scope: "workspace",
        workspaces: ["packages/app1"],
      },
    ]);
  });

  it("D1404: a Vite config file in a Vitest workspace's directory is a workspace-config fallback", async () => {
    const outcome = await select(dependent, ["packages/app1/vite.config.mts"]);
    expect(
      from(outcome, ({ fallbacks }) => fallbacks.map(({ trigger }) => trigger)),
    ).toEqual(["workspace-config"]);
  });

  const sharedSetup: Consumer = {
    vitest: {
      app1: { setupFiles: ["packages/lib/setup.ts"] },
      app2: { setupFiles: ["packages/lib/setup.ts"] },
      app3: {},
    },
    plain: ["lib"],
  };

  it("D1405: a setup file is a fallback starting from every Vitest workspace naming it", async () => {
    const outcome = await select(sharedSetup, ["packages/lib/setup.ts"]);
    expect(from(outcome, ({ fallbacks }) => fallbacks)).toEqual([
      {
        path: "packages/lib/setup.ts",
        trigger: "setup-file",
        scope: "workspace",
        workspaces: ["packages/app1", "packages/app2"],
      },
    ]);
  });

  it("D1406: a setup file fallback also selects the dependents of each workspace naming it", async () => {
    const outcome = await select(
      {
        vitest: {
          app1: { setupFiles: ["packages/lib/setup.ts"] },
          app2: {},
          app3: {},
        },
        plain: ["lib"],
        deps: { app3: ["app1"] },
      },
      ["packages/lib/setup.ts"],
    );
    expect(reasonTriggers(outcome, "packages/app3")).toEqual([
      "setup-file",
      "changed-path",
    ]);
  });

  it("D1407: a global setup file is a fallback starting from every Vitest workspace naming it", async () => {
    const outcome = await select(
      {
        vitest: {
          app1: { globalSetupFiles: ["packages/lib/global.ts"] },
          app2: {},
        },
        plain: ["lib"],
      },
      ["packages/lib/global.ts"],
    );
    expect(
      from(outcome, ({ fallbacks }) => fallbacks.map(({ trigger }) => trigger)),
    ).toEqual(["global-setup-file"]);
  });

  it("D1408: a setup file named unnormalized still matches the changed path", async () => {
    const outcome = await select(
      {
        vitest: { app1: { setupFiles: ["./packages/lib/setup.ts"] } },
        plain: ["lib"],
      },
      ["packages/lib/setup.ts"],
    );
    expect(
      from(outcome, ({ fallbacks }) => fallbacks.map(({ trigger }) => trigger)),
    ).toEqual(["setup-file"]);
  });
});

describe("selected and total counts", () => {
  const counted: Consumer = {
    vitest: {
      app1: { tests: ["a.test.ts", "b.test.ts", "c.test.ts"] },
      app2: { tests: ["d.test.ts", "e.test.ts"] },
    },
  };

  it("D1409: a selection reports its selected and total test and Vitest workspace counts", async () => {
    const outcome = await select(counted, ["packages/app1/src/x.ts"]);
    expect(from(outcome, ({ counts }) => counts)).toEqual({
      selectedTests: { count: 3, complete: true },
      totalTests: { count: 5, complete: true },
      selectedWorkspaces: 1,
      totalWorkspaces: { count: 2, complete: true },
      notRunnableWorkspaces: 0,
    });
  });

  it("D1410: the total test count counts every runnable workspace's tests, not only the selected ones", async () => {
    const outcome = await select(counted, ["packages/app1/src/x.ts"]);
    expect(from(outcome, ({ counts }) => counts.totalTests)).toEqual({
      count: 5,
      complete: true,
    });
  });

  it("D1411: a selected workspace whose tests are not known reports an unknown count and makes the selected count incomplete", async () => {
    const outcome = await select(
      { vitest: { app1: { tests: DISCOVERY_FAILED } } },
      ["packages/app1/src/x.ts"],
    );
    expect(
      from(outcome, ({ workspaces, counts }) => ({
        tests: workspaces[0]?.tests,
        selected: counts.selectedTests,
      })),
    ).toEqual({
      tests: { known: false, reason: DISCOVERY_FAILED },
      selected: { count: 0, complete: false },
    });
  });

  it("D1412: any workspace whose tests are not known makes the total test count incomplete", async () => {
    const outcome = await select(
      { vitest: { app1: {}, app2: { tests: DISCOVERY_FAILED } } },
      ["packages/app1/src/x.ts"],
    );
    expect(from(outcome, ({ counts }) => counts.totalTests)).toEqual({
      count: 1,
      complete: false,
    });
  });

  it("D1413: the total test count is incomplete while the Vitest workspace listing reports a source not read", async () => {
    const outcome = await select(counted, ["packages/app1/src/x.ts"], {
      vitestListingNotRead: [UNREAD_SOURCE],
    });
    expect(from(outcome, ({ counts }) => counts.totalTests)).toEqual({
      count: 5,
      complete: false,
    });
  });

  it("D1414: the total workspace count is incomplete while the Vitest workspace listing reports a source not read", async () => {
    const outcome = await select(counted, ["packages/app1/src/x.ts"], {
      vitestListingNotRead: [UNREAD_SOURCE],
    });
    expect(from(outcome, ({ counts }) => counts.totalWorkspaces)).toEqual({
      count: 2,
      complete: false,
    });
  });

  it("D1415: the total workspace count is incomplete while the package workspace listing reports a source not read", async () => {
    const outcome = await select(
      { ...counted, root: { workspaces: ["packages/*", "tools/**"] } },
      ["packages/app1/src/x.ts"],
    );
    expect(from(outcome, ({ counts }) => counts.totalWorkspaces)).toEqual({
      count: 2,
      complete: false,
    });
  });

  it("D1416: a selection names each source either listing did not read", async () => {
    const outcome = await select(
      { ...counted, root: { workspaces: ["packages/*", "tools/**"] } },
      ["packages/app1/src/x.ts"],
      { vitestListingNotRead: [UNREAD_SOURCE] },
    );
    expect(
      from(outcome, ({ notRead }) => notRead.map(({ source }) => source)),
    ).toEqual(["tools/**", UNREAD_SOURCE.source]);
  });
});

describe("Vitest workspaces the caller will not run", () => {
  const withLegacy: Consumer = {
    vitest: { app: {}, legacy: { notRunnable: NOT_CONFIRMED } },
    plain: ["lib"],
    deps: { app: ["lib"], legacy: ["lib"] },
  };

  it("D1417: a not-runnable workspace a change reaches is never among the path's selected workspaces", async () => {
    const outcome = await select(withLegacy, ["packages/lib/src/x.ts"]);
    expect(
      from(outcome, ({ paths }) =>
        paths[0]?.selected.map(({ workspace }) => workspace),
      ),
    ).toEqual(["packages/app"]);
  });

  it("D1418: a changed path that reaches a not-runnable workspace reports it with its reason", async () => {
    const outcome = await select(withLegacy, ["packages/lib/src/x.ts"]);
    expect(
      from(outcome, ({ paths }) =>
        paths[0]?.notRunnable.map(({ workspace, reason }) => [
          workspace.path,
          reason,
        ]),
      ),
    ).toEqual([["packages/legacy", NOT_CONFIRMED]]);
  });

  it("D1419: the counts report not-runnable workspaces apart from the runnable total", async () => {
    const outcome = await select(withLegacy, ["packages/lib/src/x.ts"]);
    expect(
      from(outcome, ({ counts }) => ({
        runnable: counts.totalWorkspaces.count,
        notRunnable: counts.notRunnableWorkspaces,
      })),
    ).toEqual({ runnable: 1, notRunnable: 1 });
  });

  it("D1420: a path reaching only not-runnable workspaces says nothing was selected because they will not run", async () => {
    const outcome = await select({ ...withLegacy, deps: { legacy: ["lib"] } }, [
      "packages/lib/src/x.ts",
    ]);
    expect(
      from(outcome, ({ paths }) => paths[0]?.nothingSelected?.kind),
    ).toEqual("only-not-runnable");
  });

  it("D1421: a widening reached only through a not-runnable workspace is not reported as used", async () => {
    const outcome = await select(
      {
        ...withLegacy,
        files: { "packages/legacy/package.json": "{" },
      },
      ["packages/lib/src/x.ts"],
    );
    expect(from(outcome, ({ widenings }) => widenings)).toEqual([]);
  });

  it("D1422: a widening that selected a workspace is reported as used", async () => {
    const outcome = await select(
      { vitest: { app: { tests: DISCOVERY_FAILED } }, plain: ["lib"] },
      ["packages/lib/src/x.ts"],
    );
    expect(
      from(outcome, ({ widenings }) => widenings.map(({ kind }) => kind)),
    ).toEqual(["tests-not-known"]);
  });
});

describe("a selection that selected nothing", () => {
  it("D1423: a change selecting no test states that nothing was selected", async () => {
    expect(
      from(
        await select(THREE_APPS, ["packages/lib/src/x.ts"]),
        ({ state }) => state,
      ),
    ).toBe("nothing-selected");
  });

  it("D1424: a selected workspace whose tests are not known is a selection, not nothing selected", async () => {
    const outcome = await select(
      { vitest: { app: { tests: DISCOVERY_FAILED } } },
      ["packages/app/src/x.ts"],
    );
    expect(from(outcome, ({ state }) => state)).toBe("selected");
  });

  it("D1425: a selected workspace with no known tests still selects nothing", async () => {
    const outcome = await select({ vitest: { app: { tests: [] } } }, [
      "packages/app/src/x.ts",
    ]);
    expect(from(outcome, ({ state }) => state)).toBe("nothing-selected");
  });
});

describe("the selection policy version", () => {
  it("D1426: a selection carries the selection policy version", async () => {
    const outcome = await select({ vitest: { app: {} } }, [
      "packages/app/src/x.ts",
    ]);
    expect("policyVersion" in outcome ? outcome.policyVersion : outcome).toBe(
      SELECTION_POLICY_VERSION,
    );
  });

  it("D1427: a refused change carries the selection policy version", async () => {
    const outcome = await select({ vitest: { app: {} } }, ["../x.ts"]);
    expect("policyVersion" in outcome ? outcome.policyVersion : outcome).toBe(
      SELECTION_POLICY_VERSION,
    );
  });
});

describe("declared non-inputs", () => {
  const DECLARATION = "rt-test.json";

  function declaring(...patterns: string[]): Record<string, string> {
    return { [DECLARATION]: JSON.stringify({ nonInputs: patterns }) };
  }

  /** The path reports for `change` with `pattern` declared, and with no `rt-test.json`. */
  async function pathReports(
    pattern: string,
    change: readonly string[],
    shape: Consumer = THREE_APPS,
  ) {
    const reports = (outcome: Settled<SelectionOutcome>) =>
      from(outcome, ({ paths }) => paths);
    return {
      declared: reports(
        await select({ ...shape, files: declaring(pattern) }, change),
      ),
      undeclared: reports(await select(shape, change)),
    };
  }

  /** The project-wide fallbacks a change to `rt-test.json` raised. */
  function declarationFallbacks(outcome: Settled<SelectionOutcome>) {
    return from(outcome, ({ fallbacks }) =>
      fallbacks.filter(({ trigger }) => trigger === "non-inputs-file"),
    );
  }

  const DECLARATION_FALLBACK = [
    {
      path: DECLARATION,
      trigger: "non-inputs-file",
      scope: "project",
      workspaces: ["packages/app1", "packages/app2", "packages/app3"],
    },
  ];

  it("D2009: a changed path a declared pattern matches selects nothing, raises no trigger, and says rt-test.json declares it through that pattern", async () => {
    const outcome = await select({ ...THREE_APPS, files: declaring("*.md") }, [
      "README.md",
    ]);
    expect(
      from(outcome, ({ paths, workspaces }) => ({
        selected: workspaces.map(({ path }) => path),
        triggers: paths[0]?.triggers,
        kind: paths[0]?.nothingSelected?.kind,
        namesFile: paths[0]?.nothingSelected?.detail.includes(DECLARATION),
        namesPattern: paths[0]?.nothingSelected?.detail.includes("*.md"),
      })),
    ).toEqual({
      selected: [],
      triggers: [],
      kind: "declared-non-input",
      namesFile: true,
      namesPattern: true,
    });
  });

  it("D2010: a test module the discovery lists selects its workspace though a declared pattern matches it, and an unlisted file beside it selects nothing", async () => {
    const outcome = await select(
      { vitest: { app: {} }, files: declaring("packages/app/**") },
      ["packages/app/unit.test.ts", "packages/app/src/x.ts"],
    );
    expect(
      from(outcome, ({ paths }) =>
        paths.map(({ selected }) => selected.map(({ workspace }) => workspace)),
      ),
    ).toEqual([["packages/app"], []]);
  });

  it("D2011: a manifest, a lockfile and a Vitest config file select as they do with no rt-test.json, though a declared pattern matches each", async () => {
    const change = [
      "packages/lib/package.json",
      "packages/lib/yarn.lock",
      "packages/lib/vitest.config.ts",
    ];
    const { declared, undeclared } = await pathReports("**", change);
    expect(declared).toEqual(undeclared);
  });

  it("D2045: a Vite config file selects as it does with no rt-test.json, though a declared pattern matches it", async () => {
    const { declared, undeclared } = await pathReports("**", [
      "packages/lib/vite.config.ts",
    ]);
    expect(declared).toEqual(undeclared);
  });

  it("D2046: pnpm-workspace.yaml selects as it does with no rt-test.json, though a declared pattern matches it", async () => {
    const { declared, undeclared } = await pathReports("*.yaml", [
      "pnpm-workspace.yaml",
    ]);
    expect(declared).toEqual(undeclared);
  });

  it("D2012: a change to rt-test.json is a project-wide fallback with its own trigger", async () => {
    expect(
      declarationFallbacks(
        await select({ ...THREE_APPS, files: declaring("docs/**") }, [
          DECLARATION,
        ]),
      ),
    ).toEqual(DECLARATION_FALLBACK);
  });

  it("D2013: a change to rt-test.json is still that fallback when a declared pattern matches its name", async () => {
    expect(
      declarationFallbacks(
        await select({ ...THREE_APPS, files: declaring("**") }, [DECLARATION]),
      ),
    ).toEqual(DECLARATION_FALLBACK);
  });

  it("D2014: a selection carries policy version 9", async () => {
    const outcome = await select({ vitest: { app: {} } }, [
      "packages/app/src/x.ts",
    ]);
    expect("policyVersion" in outcome ? outcome.policyVersion : outcome).toBe(
      9,
    );
  });

  /** The non-inputs-file fallback a change to `path` raises over the three apps, as `DECLARATION_FALLBACK` for that path. */
  function declarationFallbackAt(path: string) {
    return [{ ...DECLARATION_FALLBACK[0], path }];
  }

  it("D2206: with process.platform read as win32, a change to RT-Test.json is the non-inputs-file fallback", async () => {
    const outcome = await onPlatform("win32", () =>
      select({ ...THREE_APPS, files: declaring("docs/**") }, ["RT-Test.json"]),
    );
    expect(declarationFallbacks(outcome)).toEqual(
      declarationFallbackAt("RT-Test.json"),
    );
  });

  it("D2207: with process.platform read as win32, RT-Test.json is still that fallback when a declared pattern matches its name", async () => {
    const outcome = await onPlatform("win32", () =>
      select({ ...THREE_APPS, files: declaring("**") }, ["RT-Test.json"]),
    );
    expect(declarationFallbacks(outcome)).toEqual(
      declarationFallbackAt("RT-Test.json"),
    );
  });

  it("D2208: a change to a path under rt-test.json is the non-inputs-file fallback", async () => {
    expect(
      declarationFallbacks(
        await select({ ...THREE_APPS, files: declaring("docs/**") }, [
          "rt-test.json/x",
        ]),
      ),
    ).toEqual(declarationFallbackAt("rt-test.json/x"));
  });

  it("D2209: with process.platform read as linux, RT-Test.json is an ordinary path a declared pattern makes a declared non-input", async () => {
    const outcome = await onPlatform("linux", () =>
      select({ ...THREE_APPS, files: declaring("*.json") }, ["RT-Test.json"]),
    );
    expect(from(outcome, ({ paths }) => paths[0]?.nothingSelected?.kind)).toBe(
      "declared-non-input",
    );
  });

  it("D2210: a change to an rt-test.json inside a workspace selects only that workspace", async () => {
    expect(
      await select(THREE_APPS, ["packages/app1/rt-test.json"]).then(
        selectedPaths,
      ),
    ).toEqual(["packages/app1"]);
  });

  it("D2128: a setup file selects as it does with no rt-test.json, though a declared pattern matches it", async () => {
    const { declared, undeclared } = await pathReports(
      "docs/**",
      ["docs/setup.ts"],
      { vitest: { app1: { setupFiles: ["docs/setup.ts"] }, app2: {} } },
    );
    expect(declared).toEqual(undeclared);
  });

  it("D2129: a global setup file selects as it does with no rt-test.json, though a declared pattern matches it", async () => {
    const { declared, undeclared } = await pathReports(
      "docs/**",
      ["docs/global.ts"],
      { vitest: { app1: { globalSetupFiles: ["docs/global.ts"] }, app2: {} } },
    );
    expect(declared).toEqual(undeclared);
  });

  it("D2130: a test module no discovery lists, which a workspace's include pattern matches, selects as it does with no rt-test.json, though a declared pattern matches it", async () => {
    const { declared, undeclared } = await pathReports(
      "packages/app/e2e/**",
      ["packages/app/e2e/new.test.ts"],
      { vitest: { app: { patterns: { include: ["**/*.test.ts"] } } } },
    );
    expect(declared).toEqual(undeclared);
  });

  it("D2131: while a discovered workspace does not report its selection facts, a path a declared pattern matches selects as it does with no rt-test.json", async () => {
    const { declared, undeclared } = await pathReports("*.md", ["README.md"], {
      vitest: { app1: { factsUnreported: true }, app2: {} },
    });
    expect(declared).toEqual(undeclared);
  });
});

describe("changed paths outside the consumer root", () => {
  function refusal(outcome: Settled<SelectionOutcome>) {
    return "reason" in outcome
      ? {
          state: outcome.state,
          path: outcome.path,
          namesPath: outcome.reason.includes(outcome.path),
        }
      : outcome;
  }

  async function refused(path: string) {
    return refusal(await select({ vitest: { app: {} } }, [path]));
  }

  it("D1428: an absolute POSIX path is refused, naming the path", async () => {
    expect(await refused("/etc/passwd")).toEqual({
      state: "refused",
      path: "/etc/passwd",
      namesPath: true,
    });
  });

  it("D1429: a drive-relative path is refused", async () => {
    expect(await refused("C:foo")).toEqual({
      state: "refused",
      path: "C:foo",
      namesPath: true,
    });
  });

  it("D1430: a path that leaves the root after normalization is refused", async () => {
    expect(await refused("packages/../../x.ts")).toEqual({
      state: "refused",
      path: "packages/../../x.ts",
      namesPath: true,
    });
  });

  it("D1431: a path leaving the root through a backslash is refused", async () => {
    expect(await refused("..\\x.ts")).toEqual({
      state: "refused",
      path: "..\\x.ts",
      namesPath: true,
    });
  });

  it("D1432: a change holding one refused path returns no selection, even after a valid path", async () => {
    const outcome = await select({ vitest: { app: {} } }, [
      "packages/app/src/x.ts",
      "/abs.ts",
    ]);
    expect(refusal(outcome)).toEqual({
      state: "refused",
      path: "/abs.ts",
      namesPath: true,
    });
  });
});

describe("each changed path on its own", () => {
  it("D1516: two changed paths in unrelated workspaces each select their own dependents", async () => {
    const outcome = await select(
      {
        vitest: { app1: {}, app2: {} },
        plain: ["a", "b"],
        deps: { app1: ["a"], app2: ["b"] },
      },
      ["packages/a/src/x.ts", "packages/b/src/y.ts"],
    );
    expect(
      from(outcome, ({ paths }) =>
        paths.map(({ selected }) => selected.map(({ workspace }) => workspace)),
      ),
    ).toEqual([["packages/app1"], ["packages/app2"]]);
  });

  it("D1517: while a listing reports a source not read, a path that selected nothing names that source", async () => {
    const outcome = await select(
      { ...THREE_APPS, files: { "pnpm-workspace.yaml": "packages: []\n" } },
      ["packages/lib/src/x.ts"],
    );
    expect(
      from(outcome, ({ paths }) => paths[0]?.nothingSelected?.detail),
    ).toEqual(expect.stringContaining("pnpm-workspace.yaml"));
  });

  it("D1518: a changed path normalizing to .. is refused", async () => {
    const outcome = await select({ vitest: { app: {} } }, ["a/../.."]);
    expect("state" in outcome ? outcome.state : outcome).toBe("refused");
  });

  it("D1519: a changed path given unnormalized and again normalized is one path with one reason", async () => {
    const outcome = await select({ vitest: { app: {} } }, [
      "./packages/app/x.ts",
      "packages/app/x.ts",
    ]);
    expect(
      from(outcome, ({ paths }) =>
        paths.map(({ path, selected }) => [
          path,
          selected.map(({ reasons }) => reasons.length),
        ]),
      ),
    ).toEqual([["packages/app/x.ts", [1]]]);
  });

  it("D1520: a widening reached only by a plain package workspace is not reported as used", async () => {
    const outcome = await select(
      {
        vitest: { app: {} },
        plain: ["lib", "broken"],
        files: { "packages/broken/package.json": "{" },
      },
      ["packages/lib/src/x.ts"],
    );
    expect(from(outcome, ({ widenings }) => widenings)).toEqual([]);
  });

  it("D1521: a selection lists each not-runnable workspace with its reason", async () => {
    const outcome = await select(
      { vitest: { app: {}, legacy: { notRunnable: NOT_CONFIRMED } } },
      ["packages/app/src/x.ts"],
    );
    expect(
      from(outcome, ({ notRunnable }) =>
        notRunnable.map(({ workspace, reason }) => [workspace.path, reason]),
      ),
    ).toEqual([["packages/legacy", NOT_CONFIRMED]]);
  });
});

const INPUT_ROOT = join("/", "consumer");
/** The input root as an absolute path on this host, which on Windows carries the current drive. */
const ABSOLUTE_INPUT_ROOT = resolve(INPUT_ROOT);
const APP_PATH = "packages/app";
const LIB_ALIAS: ReportedAlias = {
  find: "@lib",
  findKind: STRING_FIND,
  flags: "",
  replacement: "/src",
  hasCustomResolver: false,
};
const NO_DECLARATION: NonInputsDeclaration = {
  file: NON_INPUTS_FILE,
  state: NON_INPUTS_ABSENT,
};
const LOAD_ERROR = "Cannot find module './missing.js'";
const UNSUPPORTED_VITEST = "no Vitest resolves: Cannot find module 'vitest'";
const APP_FILES = {
  "package.json": rootManifest(),
  "packages/app/package.json": manifest({ name: "@x/app" }),
  "packages/app/vitest.config.ts": CONFIG,
};

type Discovered = Extract<WorkspaceDiscovery, { status: "discovered" }>;

function vitestWorkspace(root: string, path: string): VitestWorkspace {
  return { path, directory: join(root, path) };
}

/** `packages/app` as discovery reports it: one test in `unit.test.ts`, its projects' facts, then `fields` over that. */
function appDiscovered(
  fields: Partial<Discovered> = {},
  projects: readonly ProjectSelectionFacts[] = [projectFacts()],
  root = INPUT_ROOT,
): Discovered {
  const base = discoveredWorkspace(
    vitestWorkspace(root, APP_PATH),
    ["unit.test.ts"],
    { reported: true, projects },
  ) as Discovered;
  return { ...base, ...fields };
}

function inputFrom(...workspaces: WorkspaceDiscovery[]): SelectionInputBuild {
  return buildSelectionInput(
    { workspaces, notRead: [] },
    INPUT_ROOT,
    NO_DECLARATION,
  );
}

/** Each selectable workspace's `field`, or why no input was built. */
function selectableField<
  K extends "tests" | "setupFiles" | "globalSetupFiles" | "aliases",
>(build: SelectionInputBuild, field: K): unknown {
  return build.built
    ? build.input.workspaces.map((workspace) => workspace[field])
    : build.reason;
}

/** The selectable and not-runnable workspace paths, the latter with their reasons, or why no input was built. */
function runnability(build: SelectionInputBuild): unknown {
  return build.built
    ? {
        selectable: build.input.workspaces.map(
          ({ workspace }) => workspace.path,
        ),
        notRunnable: build.input.notRunnable.map(({ workspace, reason }) => [
          workspace.path,
          reason,
        ]),
      }
    : build.reason;
}

/** Selects a change in `packages/app` over the input built from the discovery `discover` gives. */
function selectAppFrom(
  discover: (root: string) => TestDiscovery,
): Promise<Settled<SelectionOutcome | NotBuilt>> {
  return selectFromDiscovery(
    { files: APP_FILES, change: ["packages/app/src/x.ts"] },
    discover,
  );
}

function fromBuilt<T>(
  outcome: Settled<SelectionOutcome | NotBuilt>,
  read: (selection: Selection) => T,
): T | Settled<SelectionOutcome | NotBuilt> {
  return "workspaces" in outcome ? read(outcome) : outcome;
}

describe("selection's input, built from the discovery in effect", () => {
  it("D2220: a discovered workspace's tests are the ones discovery found, so a selection counts each as known", async () => {
    const outcome = await selectAppFrom((root) => ({
      workspaces: [
        discoveredWorkspace(
          vitestWorkspace(root, APP_PATH),
          ["a.test.ts", "b.test.ts"],
          { reported: true, projects: [projectFacts({ directory: APP_PATH })] },
        ),
      ],
      notRead: [],
    }));
    expect(
      fromBuilt(outcome, ({ counts }) => counts.selectedTests),
    ).toStrictEqual({ count: 2, complete: true });
  });

  it("D2221: a workspace's setup files are those of every project, in project order, each once", () => {
    const build = inputFrom(
      appDiscovered({}, [
        projectFacts({
          projectName: "unit",
          setupFiles: ["packages/app/a.ts", "packages/app/b.ts"],
        }),
        projectFacts({
          projectName: "e2e",
          setupFiles: ["packages/app/b.ts", "packages/app/c.ts"],
        }),
      ]),
    );
    expect(selectableField(build, "setupFiles")).toStrictEqual([
      ["packages/app/a.ts", "packages/app/b.ts", "packages/app/c.ts"],
    ]);
  });

  it("D2222: a workspace's global setup files are those of every project, in project order, each once", () => {
    const build = inputFrom(
      appDiscovered({}, [
        projectFacts({
          projectName: "unit",
          globalSetupFiles: ["packages/app/g1.ts", "global.ts"],
        }),
        projectFacts({
          projectName: "e2e",
          globalSetupFiles: ["packages/app/g2.ts", "global.ts"],
        }),
      ]),
    );
    expect(selectableField(build, "globalSetupFiles")).toStrictEqual([
      ["packages/app/g1.ts", "global.ts", "packages/app/g2.ts"],
    ]);
  });

  it("D2223: two projects' aliases that differ only in replacement both reach the workspace, and an identical one is kept once", () => {
    const alias: ReportedAlias = {
      find: "@lib",
      findKind: STRING_FIND,
      flags: "",
      replacement: "/consumer/packages/lib/src",
      hasCustomResolver: false,
    };
    const elsewhere = { ...alias, replacement: "/consumer/packages/lib/dist" };
    const build = inputFrom(
      appDiscovered({}, [
        { ...projectFacts({ projectName: "unit" }), aliases: [alias] },
        {
          ...projectFacts({ projectName: "e2e" }),
          aliases: [alias, elsewhere],
        },
      ]),
    );
    expect(selectableField(build, "aliases")).toStrictEqual([
      [
        { ...alias, viteRoot: ABSOLUTE_INPUT_ROOT },
        { ...elsewhere, viteRoot: ABSOLUTE_INPUT_ROOT },
      ],
    ]);
  });

  it("D2287: each alias carries its own project's Vite root as an absolute path", () => {
    const build = inputFrom(
      appDiscovered({}, [
        projectFacts({
          viteRoot: "packages/app/web",
          aliases: [LIB_ALIAS],
        }),
      ]),
    );
    expect(selectableField(build, "aliases")).toStrictEqual([
      [
        {
          ...LIB_ALIAS,
          viteRoot: join(ABSOLUTE_INPUT_ROOT, "packages", "app", "web"),
        },
      ],
    ]);
  });

  it("D2262: two projects' identical aliases under different Vite roots both reach the workspace, each with its own root", () => {
    const build = inputFrom(
      appDiscovered({}, [
        projectFacts({
          projectName: "unit",
          viteRoot: "packages/app",
          aliases: [LIB_ALIAS],
        }),
        projectFacts({
          projectName: "e2e",
          viteRoot: "packages/app/e2e",
          aliases: [LIB_ALIAS],
        }),
      ]),
    );
    expect(selectableField(build, "aliases")).toStrictEqual([
      [
        {
          ...LIB_ALIAS,
          viteRoot: join(ABSOLUTE_INPUT_ROOT, "packages", "app"),
        },
        {
          ...LIB_ALIAS,
          viteRoot: join(ABSOLUTE_INPUT_ROOT, "packages", "app", "e2e"),
        },
      ],
    ]);
  });

  it("D2224: one module that failed to collect leaves the workspace's tests not known, the reason naming it", () => {
    const build = inputFrom(
      appDiscovered({
        failedModules: [
          {
            projectName: "unit",
            modulePath: "broken.test.ts",
            errors: ["SyntaxError: Unexpected token"],
          },
        ],
      }),
    );
    expect(selectableField(build, "tests")).toStrictEqual([
      { known: false, reason: expect.stringContaining("broken.test.ts") },
    ]);
  });

  it("D2225: one unhandled error during collection leaves the workspace's tests not known, the reason saying so", () => {
    const build = inputFrom(
      appDiscovered({ unhandledErrors: ["Error: a timer threw"] }),
    );
    expect(selectableField(build, "tests")).toStrictEqual([
      { known: false, reason: expect.stringContaining("unhandled error") },
    ]);
  });

  it("D2226: a browser-mode project leaves the workspace's tests known", () => {
    const build = inputFrom(
      appDiscovered({
        unsupportedProjects: [
          { projectName: "browser", reason: "browser mode is not supported" },
        ],
      }),
    );
    expect(selectableField(build, "tests")).toStrictEqual([
      {
        known: true,
        tests: [expect.objectContaining({ modulePath: "unit.test.ts" })],
      },
    ]);
  });

  it("D2227: a workspace whose config failed to load is selected with its tests not known, its load error the reason", async () => {
    const outcome = await selectAppFrom((root) => ({
      workspaces: [
        {
          status: "failed",
          workspace: vitestWorkspace(root, APP_PATH),
          vitestVersion: DISCOVERED_VITEST_VERSION,
          error: LOAD_ERROR,
        },
      ],
      notRead: [],
    }));
    expect(
      fromBuilt(outcome, ({ workspaces }) =>
        workspaces.map(({ path, tests }) => ({ path, tests })),
      ),
    ).toStrictEqual([
      { path: APP_PATH, tests: { known: false, reason: LOAD_ERROR } },
    ]);
  });

  it("D2228: an unsupported workspace is not runnable, with its reason", () => {
    const build = inputFrom({
      status: "unsupported",
      workspace: vitestWorkspace(INPUT_ROOT, APP_PATH),
      vitest: {
        supported: false,
        supportedRange: ">=4.1.0 <6",
        reason: UNSUPPORTED_VITEST,
      },
    });
    expect(runnability(build)).toStrictEqual({
      selectable: [],
      notRunnable: [[APP_PATH, UNSUPPORTED_VITEST]],
    });
  });

  it("D2229: a workspace not confirmed at start is not runnable, with its reason", () => {
    const build = inputFrom({
      status: "not-confirmed",
      workspace: vitestWorkspace(INPUT_ROOT, APP_PATH),
      reason: NOT_CONFIRMED,
    });
    expect(runnability(build)).toStrictEqual({
      selectable: [],
      notRunnable: [[APP_PATH, NOT_CONFIRMED]],
    });
  });

  it("D2230: a source the Vitest listing did not read leaves a selection's workspace total incomplete", async () => {
    const outcome = await selectAppFrom((root) => ({
      workspaces: [
        appDiscovered({}, [projectFacts({ directory: APP_PATH })], root),
      ],
      notRead: [UNREAD_SOURCE],
    }));
    expect(
      fromBuilt(outcome, ({ counts }) => counts.totalWorkspaces),
    ).toStrictEqual({ count: 1, complete: false });
  });

  it("D2231: the non-inputs protect the test modules of the same discovery", () => {
    const build = inputFrom(appDiscovered());
    const { protection } = build.built
      ? build.input.nonInputs
      : { protection: build };
    expect(
      "files" in protection ? [...protection.files] : protection,
    ).toStrictEqual(["packages/app/unit.test.ts"]);
  });

  it("D2232: with no discovery in effect, no input is built, and the answer says so", () => {
    expect(
      buildSelectionInput(undefined, INPUT_ROOT, NO_DECLARATION),
    ).toStrictEqual({
      built: false,
      reason: expect.stringContaining("no discovery"),
    });
  });

  it("D2233: a discovered workspace whose selection facts are not reported stops the build, naming it", () => {
    const build = inputFrom(
      appDiscovered({ selectionFacts: { reported: false } }),
      discoveredWorkspace(
        vitestWorkspace(INPUT_ROOT, "packages/web"),
        ["unit.test.ts"],
        { reported: true, projects: [projectFacts()] },
      ),
    );
    expect(build).toStrictEqual({
      built: false,
      reason: expect.stringContaining(APP_PATH),
    });
  });

  it("D2234: the root workspace whose selection facts are not reported is named as the one at the consumer root", () => {
    const build = inputFrom(
      discoveredWorkspace(vitestWorkspace(INPUT_ROOT, "."), ["unit.test.ts"], {
        reported: false,
      }),
    );
    expect(build).toStrictEqual({
      built: false,
      reason: expect.stringContaining("at the consumer root"),
    });
  });
});

const GUIDE = "docs/guide.md";
/** Two Vitest workspaces that depend on nothing, and a declaration that makes `docs/**` non-inputs. */
const TWO_APART: TreeCase = {
  files: {
    "package.json": rootManifest(),
    [NON_INPUTS_FILE]: JSON.stringify({ nonInputs: ["docs/**"] }),
    "packages/a/package.json": manifest({ name: "a" }),
    "packages/a/src/a.ts": "export const a = 1;\n",
    "packages/a/unit.test.ts": CONFIG,
    "packages/b/package.json": manifest({ name: "b" }),
    "packages/b/src/b.ts": "export const b = 1;\n",
    "packages/b/unit.test.ts": CONFIG,
    [GUIDE]: "# Guide\n",
  },
  workspaces: [{ path: "packages/a" }, { path: "packages/b" }],
};
/**
 * The inputs the narrowing is given: every file but the declaration itself. The declared guide stands for a path the
 * tracker holds while selection calls it declared, as when the two read the declaration at different moments.
 */
const TWO_APART_INPUTS = Object.keys(TWO_APART.files).filter(
  (path) => path !== NON_INPUTS_FILE,
);

describe("each Vitest workspace's inputs, as Narrowing narrows them to what its selection includes", () => {
  // Any package.json can move a dependency edge, so selection reaches every workspace from each one.
  it("D2532: each workspace's inputs hold its own files and every package.json, and none of another workspace's sources or tests", async () => {
    expect(await narrowedInTree(TWO_APART, TWO_APART_INPUTS)).toStrictEqual({
      "packages/a": [
        GUIDE,
        "package.json",
        "packages/a/package.json",
        "packages/a/src/a.ts",
        "packages/a/unit.test.ts",
        "packages/b/package.json",
      ],
      "packages/b": [
        GUIDE,
        "package.json",
        "packages/a/package.json",
        "packages/b/package.json",
        "packages/b/src/b.ts",
        "packages/b/unit.test.ts",
      ],
    });
  });

  it("D2689: a narrowing selects, over its own build's dependency information, the workspaces a change reaches, and only those", async () => {
    expect(
      await selectedByNarrowing(TWO_APART, ["packages/b/src/b.ts"]),
    ).toStrictEqual(["packages/b"]);
  });

  it("D2551: a dependency's source lies in its dependent's inputs, and a dependent's source never in its dependency's", async () => {
    const tree = consumer({
      vitest: { a: {}, b: {} },
      deps: { a: ["b"] },
      files: {
        "packages/a/src/a.ts": "export const a = 1;\n",
        "packages/b/src/b.ts": "export const b = 1;\n",
      },
    });
    const sets = await narrowedInTree(tree, Object.keys(tree.files));
    expect(
      "refused" in sets || "thrown" in sets
        ? sets
        : {
            bSourceInA: sets["packages/a"]?.includes("packages/b/src/b.ts"),
            aSourceInB: sets["packages/b"]?.includes("packages/a/src/a.ts"),
          },
    ).toStrictEqual({ bSourceInA: true, aSourceInB: false });
  });

  it("D2552: a discovered workspace selection will not run covers every input of the project", async () => {
    const tree = consumer({
      vitest: { a: {}, c: { notRunnable: NOT_CONFIRMED } },
      files: { "packages/c/src/c.ts": "export const c = 1;\n" },
    });
    const inputs = Object.keys(tree.files);
    const sets = await narrowedInTree(tree, inputs);
    expect(
      "refused" in sets || "thrown" in sets ? sets : sets["packages/c"],
    ).toStrictEqual([...inputs].sort());
  });

  it("D2553: an input path selection refuses is named as the refusal, so no workspace's inputs narrow", async () => {
    // A legal Linux file name that Windows' path rules read as drive-relative.
    const refused = "a:b.txt";
    expect(
      await narrowedInTree(TWO_APART, [...TWO_APART_INPUTS, refused]),
    ).toStrictEqual({ refused: expect.stringContaining(refused) });
  });

  it("D2533: an input the tracker holds that selection calls a declared non-input lies in every workspace's inputs", async () => {
    const sets = await narrowedInTree(TWO_APART, TWO_APART_INPUTS);
    expect(
      "refused" in sets || "thrown" in sets
        ? sets
        : Object.values(sets).map((paths) => paths.includes(GUIDE)),
    ).toStrictEqual([true, true]);
  });
});

describe("where a build places a run's changed paths", () => {
  it("D2880: a workspace selection will not run, as an unsupported one, has each changed path placed inside its inputs by widening", async () => {
    const tree = consumer({
      vitest: { a: {}, c: { notRunnable: NOT_CONFIRMED } },
      files: { "packages/c/src/c.ts": "export const c = 1;\n" },
    });
    expect(
      await placedInTree(tree, ["packages/c/src/c.ts"], "packages/c"),
    ).toStrictEqual({ inside: [], widened: ["packages/c/src/c.ts"] });
  });

  it("D2902: a build asked again, with a path it has not placed beside one it has, places the new path by its own selection", async () => {
    expect(
      await placedInTree(
        TWO_APART,
        ["packages/a/src/a.ts", "packages/b/src/b.ts"],
        "packages/a",
        [["packages/b/src/b.ts"]],
      ),
    ).toStrictEqual({ inside: ["packages/a/src/a.ts"], widened: [] });
  });

  it("D2881: a changed path selection refuses is placed by widening, and the paths beside it are still placed", async () => {
    // A legal Linux file name that Windows' path rules read as drive-relative.
    const refused = "a:b.txt";
    expect(
      await placedInTree(
        TWO_APART,
        [refused, "packages/a/src/a.ts", "packages/b/src/b.ts"],
        "packages/a",
      ),
    ).toStrictEqual({ inside: ["packages/a/src/a.ts"], widened: [refused] });
  });
});
