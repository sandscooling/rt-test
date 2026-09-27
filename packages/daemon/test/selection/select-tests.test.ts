import { describe, expect, it } from "vitest";
import {
  SELECTION_POLICY_VERSION,
  type Selection,
  type SelectionOutcome,
} from "../../src/selection/selection-types.js";
import {
  manifest,
  rootManifest,
  selectedPaths,
  selectInTree,
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
  async function pathReports(pattern: string, change: readonly string[]) {
    const reports = (outcome: Settled<SelectionOutcome>) =>
      from(outcome, ({ paths }) => paths);
    return {
      declared: reports(
        await select({ ...THREE_APPS, files: declaring(pattern) }, change),
      ),
      undeclared: reports(await select(THREE_APPS, change)),
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

  it("D2014: a selection carries policy version 3", async () => {
    const outcome = await select({ vitest: { app: {} } }, [
      "packages/app/src/x.ts",
    ]);
    expect("policyVersion" in outcome ? outcome.policyVersion : outcome).toBe(
      3,
    );
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
