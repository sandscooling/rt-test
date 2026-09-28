import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join, parse, posix, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { DependencyInformation } from "../../src/selection/selection-types.js";
import { errorText } from "../../src/vitest/error-text.js";
import { POSIX_SEPARATOR } from "../../src/vitest/find-workspaces.js";
import {
  REGEXP_FIND,
  STRING_FIND,
  type ReportedAlias,
} from "../../src/vitest/selection-facts.js";
import { onPlatform } from "../harness.js";
import {
  APP,
  appEdges,
  appScan,
  appTree,
  appWidenings,
  graphInTree,
  inspectTree,
  manifest,
  parsesInTree,
  pkg,
  plainPackages,
  reasonVias,
  rootManifest,
  scanApp,
  selectedPaths,
  selectInTree,
  widenedAt,
  type AppCase,
  type Settled,
  type TreeAlias,
} from "./harness.js";

/** Converts a `file:` URL as the platform `process.platform` reads as, so a Windows drive form converts on either host. */
vi.mock("node:url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:url")>();
  return {
    ...actual,
    fileURLToPath: (
      url: Parameters<typeof actual.fileURLToPath>[0],
      options?: Parameters<typeof actual.fileURLToPath>[1],
    ) =>
      actual.fileURLToPath(url, {
        windows: process.platform === "win32",
        ...options,
      }),
  };
});

const B_CHANGE = "packages/b/src/index.ts";
const C_CHANGE = "packages/c/src/index.ts";
const UNREAD_PATTERN = "tools/**";

function selectedFor(scenario: AppCase) {
  return selectInTree({
    ...appTree(scenario),
    change: [scenario.change],
    throughLink: scenario.throughLink,
    links: scenario.links ?? {},
  }).then(selectedPaths);
}

function viasFor(scenario: AppCase) {
  return selectInTree({
    ...appTree(scenario),
    change: [scenario.change],
  }).then(reasonVias);
}

function appDependencies(
  information: Settled<DependencyInformation>,
): string[] | Settled<DependencyInformation> {
  return "edges" in information
    ? information.edges
        .filter(({ dependent }) => dependent === APP)
        .map(({ dependency }) => dependency)
        .sort()
    : information;
}

/** A string alias as discovery reports one Vite analyzes by its replacement alone. */
const STRING_ALIAS = {
  find: "@alias",
  findKind: STRING_FIND,
  flags: "",
  hasCustomResolver: false,
} as const;

function aliases(
  replacement: (root: string) => string,
): (root: string) => readonly ReportedAlias[] {
  return (root) => [{ ...STRING_ALIAS, replacement: replacement(root) }];
}

/** One alias over `STRING_ALIAS`, whose replacement reaches into `packages/b` unless `fields` says otherwise. */
function alias(
  fields: Partial<ReportedAlias>,
): (root: string) => readonly ReportedAlias[] {
  return (root) => [
    {
      ...STRING_ALIAS,
      replacement: join(root, "packages/b/src"),
      ...fields,
    },
  ];
}

const WINDOWS_DRIVE = /^[A-Za-z]:/;
const ALIAS_WIDENING = "unresolvable-alias";

/** The path `/`-separated, as Vite spells a path in an id. */
function slashed(path: string): string {
  return path.split(sep).join(POSIX_SEPARATOR);
}

/** The path `/`-separated with no Windows drive, so it begins with `/` on either host. */
function driveless(path: string): string {
  return slashed(path.replace(WINDOWS_DRIVE, ""));
}

/** The app's alias edges and widening kinds under `aliasList`, over the app tree with `files` added. */
function aliasScan(
  aliasList: (root: string) => readonly TreeAlias[],
  files: Readonly<Record<string, string>> = {},
) {
  return graphInTree(
    appTree({ vitest: { aliases: aliasList }, files, change: "" }),
  ).then(appScan);
}

/** One alias over `STRING_ALIAS` for each replacement. */
function replacedBy(
  ...replacements: string[]
): (root: string) => readonly ReportedAlias[] {
  return () =>
    replacements.map((replacement) => ({ ...STRING_ALIAS, replacement }));
}

/** One RegExp alias for each flag set, whose replacement reaches into `packages/b`. */
function regexpAlias(
  find: string,
  ...flagSets: string[]
): (root: string) => readonly ReportedAlias[] {
  return (root) =>
    (flagSets.length === 0 ? [""] : flagSets).map((flags) => ({
      ...STRING_ALIAS,
      find,
      findKind: REGEXP_FIND,
      flags,
      replacement: join(root, "packages/b/src"),
    }));
}

const REACHES_B = { edges: ["alias packages/b"], widenings: [] };

/** The steps of the first reason the app was selected for when `change` changed, under `aliasList`. */
function aliasReasonSteps(
  aliasList: (root: string) => readonly ReportedAlias[],
  change: string,
) {
  return selectInTree({
    ...appTree({ vitest: { aliases: aliasList }, change }),
    change: [change],
  }).then((outcome) =>
    "workspaces" in outcome
      ? outcome.workspaces[0]?.reasons[0]?.steps
      : outcome,
  );
}

describe("listing a consumer's package workspaces", () => {
  it("D1346: lists the consumer root first, then every workspaces directory whether or not it holds a Vitest config", async () => {
    const information = await graphInTree({
      files: {
        "package.json": rootManifest(),
        "packages/a/vitest.config.ts": "export default {};\n",
        ...plainPackages("a", "b"),
      },
      workspaces: [],
    });
    expect(
      "packageWorkspaces" in information
        ? information.packageWorkspaces.map(({ path }) => path)
        : information,
    ).toEqual([".", "packages/a", "packages/b"]);
  });
});

describe("dependencies a package manifest declares", () => {
  it("D1347: each of dependencies, devDependencies, peerDependencies and optionalDependencies names a dependency", async () => {
    const information = await graphInTree({
      ...appTree({
        app: {
          dependencies: { "@x/b1": "^1.0.0" },
          devDependencies: { "@x/b2": "^1.0.0" },
          peerDependencies: { "@x/b3": "^1.0.0" },
          optionalDependencies: { "@x/b4": "^1.0.0" },
        },
        files: plainPackages("b1", "b2", "b3", "b4"),
        change: "",
      }),
    });
    expect(appDependencies(information)).toEqual([
      "packages/b1",
      "packages/b2",
      "packages/b3",
      "packages/b4",
    ]);
  });

  it("D1348: an npm: alias installs the workspace its target names, whatever the dependency's key", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { "local-b": "npm:@x/b@^1.0.0" } },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1349: file:, link:, portal:, workspace: and bare relative paths each point into the workspace they name", async () => {
    const information = await graphInTree({
      ...appTree({
        app: {
          dependencies: {
            one: "file:../b1",
            two: "link:../b2",
            three: "portal:../b3",
            four: "workspace:../b4",
            five: "../b5",
          },
        },
        files: plainPackages("b1", "b2", "b3", "b4", "b5"),
        change: "",
      }),
    });
    expect(appDependencies(information)).toEqual([
      "packages/b1",
      "packages/b2",
      "packages/b3",
      "packages/b4",
      "packages/b5",
    ]);
  });

  it("D1350: a dependency named by its key and by its workspace:* spec is one edge", async () => {
    const information = await graphInTree({
      ...appTree({
        app: { dependencies: { "@x/b": "workspace:*" } },
        change: "",
      }),
    });
    expect(appDependencies(information)).toEqual(["packages/b"]);
  });

  it("D1351: a selection reason quotes the manifest field and key that produced its edge", async () => {
    const outcome = await selectInTree({
      ...appTree({
        app: { devDependencies: { "@x/b": "^1.0.0" } },
        change: B_CHANGE,
      }),
      change: [B_CHANGE],
    });
    expect(
      "workspaces" in outcome ? outcome.workspaces[0]?.reasons[0] : outcome,
    ).toMatchObject({
      steps: [
        {
          workspace: APP,
          via: "manifest",
          detail: expect.stringContaining('devDependencies "@x/b"'),
        },
      ],
    });
  });
});

describe("root overrides and resolutions", () => {
  it("D1352: overrides, resolutions and pnpm.overrides each make every workspace depend on the workspace they point into", async () => {
    const information = await graphInTree({
      ...appTree({
        root: {
          overrides: { q1: "file:./packages/b1" },
          resolutions: { q2: "file:./packages/b2" },
          pnpm: { overrides: { q3: "link:./packages/b3" } },
        },
        files: plainPackages("b1", "b2", "b3"),
        change: "",
      }),
    });
    expect(appDependencies(information)).toEqual([
      "packages/b1",
      "packages/b2",
      "packages/b3",
    ]);
  });

  it("D1353: a nested override entry makes every workspace depend on the workspace it points into", async () => {
    expect(
      await viasFor({
        root: { overrides: { parent: { child: "file:./packages/b" } } },
        change: B_CHANGE,
      }),
    ).toEqual({ [APP]: [["override"]] });
  });

  it("D1354: a $name override resolves through the root dependency it references, not through its own key", async () => {
    expect(
      await viasFor({
        root: {
          devDependencies: { "@x/b": "workspace:*" },
          overrides: { "other-package": "$@x/b" },
        },
        change: B_CHANGE,
      }),
    ).toEqual({ [APP]: [["override"]] });
  });

  it("D1433: a workspace:* override keyed through a parent replaces the package its key names last", async () => {
    expect(
      await viasFor({
        root: { overrides: { "parent>@x/b": "workspace:*" } },
        change: B_CHANGE,
      }),
    ).toEqual({ [APP]: [["override"]] });
  });

  it("D1355: an override pointing into no listed workspace makes every workspace depend on every workspace", async () => {
    expect(
      await selectedFor({
        root: { overrides: { anything: "file:../outside" } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });
});

describe("dependencies a Vitest workspace's inputs imply", () => {
  it("D1356: a test module lying in another package workspace makes the Vitest workspace depend on it", async () => {
    expect(
      await selectedFor({
        vitest: { tests: ["../b/b.test.ts"] },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1357: a test module in another workspace still yields its edge when the consumer root is reached through a link", async () => {
    expect(
      await selectedFor({
        vitest: { tests: ["../b/b.test.ts"] },
        change: B_CHANGE,
        throughLink: true,
      }),
    ).toEqual([APP]);
  });

  it("D1358: a setup file in another package workspace makes the Vitest workspace depend on it", async () => {
    expect(
      await viasFor({
        vitest: { setupFiles: ["packages/b/setup.ts"] },
        change: B_CHANGE,
      }),
    ).toEqual({ [APP]: [["setup-file"]] });
  });

  it("D1359: a global setup file in another package workspace makes the Vitest workspace depend on it", async () => {
    expect(
      await viasFor({
        vitest: { globalSetupFiles: ["packages/b/global.ts"] },
        change: B_CHANGE,
      }),
    ).toEqual({ [APP]: [["setup-file"]] });
  });

  it("D1360: a setup file given unnormalized as ./packages/b/setup.ts still makes the workspace depend on packages/b", async () => {
    expect(
      await selectedFor({
        vitest: { setupFiles: ["./packages/b/setup.ts"] },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1361: a config alias replaced by an absolute path into another workspace makes the Vitest workspace depend on it", async () => {
    expect(
      await viasFor({
        vitest: {
          aliases: aliases((root) => join(root, "packages/b/src")),
        },
        change: B_CHANGE,
      }),
    ).toEqual({ [APP]: [["alias"]] });
  });

  it("D1362: a config alias replaced by a bare subpath of a listed package makes the Vitest workspace depend on that package", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases(() => "@x/b/src/index.ts") },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1363: a capture alias whose path before $1 is a parent of workspaces depends on every workspace below it", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases((root) => `${join(root, "packages")}/$1`) },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1364: a capture alias whose name before $1 begins a listed package's name depends on that package", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases(() => "@x/$1") },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1365: on Windows a capture alias matches a workspace directory spelled in another case", async () => {
    const selected = await onPlatform("win32", () =>
      selectedFor({
        vitest: {
          aliases: aliases((root) =>
            `${join(root, "packages")}/$1`.toUpperCase(),
          ),
        },
        change: B_CHANGE,
      }),
    );
    expect(selected).toEqual([APP]);
  });
});

describe("uncertain dependency information widens", () => {
  it("D1366: a Vitest workspace with no package.json depends on every package workspace", async () => {
    expect(
      await selectInTree({
        files: {
          "package.json": rootManifest(),
          "packages/app/vitest.config.ts": "export default {};\n",
          ...plainPackages("b", "c"),
        },
        workspaces: [{ path: APP }],
        change: [C_CHANGE],
      }).then(selectedPaths),
    ).toEqual([APP]);
  });

  it("D1367: a package.json that cannot be parsed makes its workspace depend on every package workspace", async () => {
    expect(
      await selectedFor({
        files: { "packages/app/package.json": "{" },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1368: a package.json that is not a JSON object makes its workspace depend on every package workspace", async () => {
    expect(
      await selectedFor({
        files: { "packages/app/package.json": "[]" },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1369: a dependency field that is not an object makes its workspace depend on every package workspace", async () => {
    expect(
      await selectedFor({
        app: { dependencies: ["@x/b"] },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1370: a dependency spec that is not a string makes its workspace depend on every package workspace", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { "left-pad": 1 } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1371: a local path dependency resolving outside every listed workspace widens", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { outside: "file:../../../outside" } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1372: a home-relative ~/ path dependency widens, since it lies in no listed workspace", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { home: "file:~/lib" } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1373: workspace:other@* naming no listed workspace widens while the listing is complete", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { "@x/b": "workspace:ghost@*" } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1374: a Vitest workspace whose tests are not known depends on every package workspace", async () => {
    expect(
      await selectedFor({
        vitest: { tests: "discovery failed" },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1375: the reason a widening adds quotes its cause", async () => {
    const outcome = await selectInTree({
      ...appTree({ vitest: { tests: "discovery failed" }, change: C_CHANGE }),
      change: [C_CHANGE],
    });
    expect(
      "workspaces" in outcome ? outcome.workspaces[0]?.reasons[0] : outcome,
    ).toMatchObject({
      steps: [
        {
          workspace: APP,
          via: "tests-not-known",
          detail: expect.stringContaining("discovery failed"),
        },
      ],
    });
  });

  it("D1376: a config alias replaced by a relative path widens", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases(() => "./src") },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1377: a config alias replaced by an empty string widens, naming the unresolvable alias", async () => {
    expect(
      await viasFor({
        vitest: { aliases: aliases(() => "") },
        change: C_CHANGE,
      }),
    ).toEqual({ [APP]: [["unresolvable-alias"]] });
  });

  it("D1378: a config alias replaced by a bare $1 widens", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases(() => "$1") },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1379: while the listing is incomplete, a dependency naming no listed workspace widens", async () => {
    expect(
      await selectedFor({
        root: { workspaces: ["packages/*", UNREAD_PATTERN] },
        app: { dependencies: { "left-pad": "^1.0.0" } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1380: while the listing is complete, a dependency naming no listed workspace is external and adds nothing", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { "left-pad": "^1.0.0" } },
        change: C_CHANGE,
      }),
    ).toEqual([]);
  });

  it("D1381: a listed workspace whose package.json cannot be read leaves another's dependency on its name uncertain", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { "@x/b": "^1.0.0" } },
        files: { "packages/b/package.json": "{" },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1382: while the listing is incomplete, a config alias naming no listed package widens", async () => {
    expect(
      await selectedFor({
        root: { workspaces: ["packages/*", UNREAD_PATTERN] },
        vitest: { aliases: aliases(() => "left-pad") },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1383: while the listing is incomplete, an override naming no listed package widens every workspace", async () => {
    expect(
      await selectedFor({
        root: {
          workspaces: ["packages/*", UNREAD_PATTERN],
          overrides: { lodash: "npm:left-pad@1.0.0" },
        },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });
});

describe("config aliases reach every workspace their fixed prefix begins", () => {
  it("D1511: an alias replaced by a directory holding several workspaces depends on each of them", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases((root) => join(root, "packages")) },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1512: an alias replaced by a partial bare name depends on every package that name begins", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: aliases(() => "@x") },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1513: a $<name> reference ends an alias's fixed prefix", async () => {
    expect(
      await selectedFor({
        vitest: {
          aliases: aliases((root) => `${join(root, "packages")}/$<pkg>/src`),
        },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1514: an alias path prefix holding .. reaches the workspaces below the directory it names", async () => {
    expect(
      await selectedFor({
        vitest: {
          aliases: aliases((root) => `${join(root, "app")}/../packages/$1`),
        },
        change: B_CHANGE,
      }),
    ).toEqual([APP]);
  });
});

describe("an alias whose replacement does not bound where an import ends up widens", () => {
  it("D2192: an alias with a customResolver makes the workspace depend on every package workspace, whatever its replacement", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: alias({ hasCustomResolver: true }) },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D2193: an alias whose string find is empty makes the workspace depend on every package workspace, whatever its replacement", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: alias({ find: "" }) },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D2194: an alias whose string find is / makes the workspace depend on every package workspace, whatever its replacement", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: alias({ find: "/" }) },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D2195: a RegExp alias with no customResolver reaches only the workspaces its replacement reaches", async () => {
    expect(
      await selectedFor({
        vitest: {
          aliases: alias({ find: "^@b\\/(.*)$", findKind: REGEXP_FIND }),
        },
        change: C_CHANGE,
      }),
    ).toEqual([]);
  });

  it("D2196: a RegExp alias with a customResolver makes the workspace depend on every package workspace", async () => {
    expect(
      await selectedFor({
        vitest: {
          aliases: alias({
            find: "^@b\\/(.*)$",
            findKind: REGEXP_FIND,
            hasCustomResolver: true,
          }),
        },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D2197: a string find that begins with / but is not / reaches only the workspaces its replacement reaches", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: alias({ find: "/src" }) },
        change: C_CHANGE,
      }),
    ).toEqual([]);
  });

  it("D2198: the reason a customResolver alias adds names its customResolver", async () => {
    expect(
      await aliasReasonSteps(alias({ hasCustomResolver: true }), C_CHANGE),
    ).toEqual([
      {
        workspace: APP,
        via: "unresolvable-alias",
        detail: expect.stringContaining("customResolver"),
      },
    ]);
  });

  it("D2199: the reason an empty-find alias adds names its empty find", async () => {
    expect(await aliasReasonSteps(alias({ find: "" }), C_CHANGE)).toEqual([
      {
        workspace: APP,
        via: "unresolvable-alias",
        detail: expect.stringContaining("empty find"),
      },
    ]);
  });

  it("D2200: the reason a / find alias adds says it maps /", async () => {
    expect(await aliasReasonSteps(alias({ find: "/" }), C_CHANGE)).toEqual([
      {
        workspace: APP,
        via: "unresolvable-alias",
        detail: expect.stringContaining("maps /"),
      },
    ]);
  });

  it("D2201: the reason a customResolver alias adds quotes the alias's find and replacement", async () => {
    expect(
      await aliasReasonSteps(
        alias({ hasCustomResolver: true, replacement: "@x/b/src" }),
        C_CHANGE,
      ),
    ).toEqual([
      {
        workspace: APP,
        via: "unresolvable-alias",
        detail: expect.stringContaining('config alias "@alias" to "@x/b/src"'),
      },
    ]);
  });
});

describe("an explanation quotes an alias's find as the kind of find it is", () => {
  it("D2202: an alias edge quotes a RegExp find as a regular expression literal", async () => {
    expect(
      await aliasReasonSteps(
        alias({
          find: "^@b\\/(.*)$",
          findKind: REGEXP_FIND,
          replacement: "@x/b/$1",
        }),
        B_CHANGE,
      ),
    ).toEqual([
      {
        workspace: APP,
        via: "alias",
        detail: expect.stringContaining(
          'config alias /^@b\\/(.*)$/ to "@x/b/$1"',
        ),
      },
    ]);
  });

  it("D2203: an alias edge quotes a RegExp find's flags after the literal", async () => {
    expect(
      await aliasReasonSteps(
        alias({
          find: "^@b\\/(.*)$",
          findKind: REGEXP_FIND,
          flags: "i",
          replacement: "@x/b/$1",
        }),
        B_CHANGE,
      ),
    ).toEqual([
      {
        workspace: APP,
        via: "alias",
        detail: expect.stringContaining("config alias /^@b\\/(.*)$/i to "),
      },
    ]);
  });

  it("D2204: an alias edge quotes a string find as a JSON string", async () => {
    expect(
      await aliasReasonSteps(
        alias({ find: "@b", replacement: "@x/b" }),
        B_CHANGE,
      ),
    ).toEqual([
      {
        workspace: APP,
        via: "alias",
        detail: expect.stringContaining('config alias "@b" to "@x/b"'),
      },
    ]);
  });

  it("D2205: the widening for a relative replacement quotes a RegExp find as a regular expression literal", async () => {
    expect(
      await aliasReasonSteps(
        alias({
          find: "^~\\/(.*)$",
          findKind: REGEXP_FIND,
          replacement: "./src/$1",
        }),
        C_CHANGE,
      ),
    ).toEqual([
      {
        workspace: APP,
        via: "unresolvable-alias",
        detail: expect.stringContaining(
          'config alias /^~\\/(.*)$/ to "./src/$1"',
        ),
      },
    ]);
  });

  it("D2212: the widening for a customResolver alias quotes a RegExp find as a regular expression literal", async () => {
    expect(
      await aliasReasonSteps(
        alias({
          find: "^@b\\/(.*)$",
          findKind: REGEXP_FIND,
          hasCustomResolver: true,
        }),
        C_CHANGE,
      ),
    ).toEqual([
      {
        workspace: APP,
        via: "unresolvable-alias",
        detail: expect.stringContaining("config alias /^@b\\/(.*)$/ to "),
      },
    ]);
  });
});

describe("an alias replaced by a path beginning with / reaches it under the Vite root and on the file system", () => {
  it("D2263: a root-relative replacement reaches the workspace it names under the project's Vite root", async () => {
    expect(
      await aliasScan((root) => [
        { ...STRING_ALIAS, replacement: "/packages/b/src", viteRoot: root },
      ]),
    ).toEqual(REACHES_B);
  });

  it("D2264: a replacement beginning with / that names a file-system path outside the Vite root reaches the workspace there, with no drive on Windows", async () => {
    expect(
      await aliasScan((root) =>
        replacedBy(driveless(join(root, "packages/b/src")))(root),
      ),
    ).toEqual(REACHES_B);
  });

  it("D2265: Vite's own client alias, a /@fs/ replacement, reaches the workspace holding its file and never widens", async () => {
    expect(
      await aliasScan((root) => [
        {
          ...STRING_ALIAS,
          find: "^\\/?@vite\\/client",
          findKind: REGEXP_FIND,
          replacement: posix.join(
            "/@fs/",
            slashed(join(root, "packages/b/dist/client.mjs")),
          ),
        },
      ]),
    ).toEqual(REACHES_B);
  });

  it("D2266: after /@fs/, a path naming no volume gets back the / Vite strips from it", async () => {
    expect(
      await aliasScan((root) =>
        replacedBy(`/@fs/${driveless(join(root, "packages/b/src")).slice(1)}`)(
          root,
        ),
      ),
    ).toEqual(REACHES_B);
  });

  it("D2267: /@fs/ with nothing after it, or only a drive with or without its colon, widens", async () => {
    expect(await aliasScan(replacedBy("/@fs/", "/@fs/C:", "/@fs/c"))).toEqual({
      edges: [],
      widenings: [ALIAS_WIDENING, ALIAS_WIDENING, ALIAS_WIDENING],
    });
  });

  it("D2268: a replacement of exactly / widens, naming what it fixes", async () => {
    expect(
      await graphInTree(
        appTree({ vitest: { aliases: replacedBy("/") }, change: "" }),
      ).then(appWidenings),
    ).toEqual(widenedAt(ALIAS_WIDENING, "fixes only / before"));
  });

  it("D2269: a replacement beginning with // or /@id/ widens rather than being read as a path", async () => {
    expect(
      await aliasScan(replacedBy("//cdn.example/lib", "/@id/lib")),
    ).toEqual({ edges: [], widenings: [ALIAS_WIDENING, ALIAS_WIDENING] });
  });

  it("D2291: $$ ends an alias's fixed prefix, so the replacement reaches the directory whose name holds the $ it inserts", async () => {
    expect(
      await aliasScan(
        (root) => replacedBy(`${join(root, "packages")}/pay$$/src`)(root),
        { "packages/pay$/package.json": pkg("@x/pay") },
      ),
    ).toEqual({ edges: ["alias .", "alias packages/pay$"], widenings: [] });
  });

  it("D2292: a prefix ending in a separator does not reach a sibling directory whose name it begins", async () => {
    expect(
      await aliasScan(
        (root) => replacedBy(`${join(root, "packages", "b")}/$1`)(root),
        plainPackages("bb"),
      ),
    ).toEqual(REACHES_B);
  });
});

describe("a RegExp alias is analyzed by its replacement only when every match begins at the import's start", () => {
  it("D2270: a RegExp find not anchored with ^ widens, naming the text it keeps", async () => {
    expect(
      await graphInTree(
        appTree({
          vitest: { aliases: regexpAlias("@b\\/(.*)$") },
          change: "",
        }),
      ).then(appWidenings),
    ).toEqual(widenedAt(ALIAS_WIDENING, "can match after the import's start"));
  });

  it("D2271: a RegExp find with a top-level alternative widens, though it begins with ^", async () => {
    expect(await aliasScan(regexpAlias("^@b\\/(.*)$|@c"))).toEqual({
      edges: [],
      widenings: [ALIAS_WIDENING],
    });
  });

  it("D2293: an escaped ( opens no group, so the top-level alternative after it widens", async () => {
    expect(await aliasScan(regexpAlias("^\\(@b|@c"))).toEqual({
      edges: [],
      widenings: [ALIAS_WIDENING],
    });
  });

  it("D2272: an alternative inside a group leaves the RegExp find analyzed", async () => {
    expect(await aliasScan(regexpAlias("^(@b|@c)\\/(.*)$"))).toEqual(REACHES_B);
  });

  it("D2288: a | inside a character class leaves the RegExp find analyzed", async () => {
    expect(await aliasScan(regexpAlias("^[|@]b\\/(.*)$"))).toEqual(REACHES_B);
  });

  it("D2289: without the v flag, a [ inside a character class opens no nested class, so the | after the class is top-level and widens", async () => {
    expect(await aliasScan(regexpAlias("^[[]b|@c"))).toEqual({
      edges: [],
      widenings: [ALIAS_WIDENING],
    });
  });

  it("D2290: the m or the y flag widens an anchored RegExp find", async () => {
    expect(await aliasScan(regexpAlias("^@b\\/(.*)$", "m", "y"))).toEqual({
      edges: [],
      widenings: [ALIAS_WIDENING, ALIAS_WIDENING],
    });
  });
});

/** Quoted by every edge and widening a rewritten import gives, and by none the replacement alone gives. */
const REWRITES = " rewrites to ";
const CLIMB_TO_B = 'import { x } from "@/../../b/src/x";\n';

/** An alias `@` to the app's own `src`, which the replacement alone gives no edge, since the app holds it. */
function intoAppSource(
  fields: Partial<TreeAlias> = {},
): (root: string) => readonly TreeAlias[] {
  return (root) => [
    {
      ...STRING_ALIAS,
      find: "@",
      replacement: join(root, APP, "src"),
      ...fields,
    },
  ];
}

/** A RegExp alias `~` whose replacement is the rest of the import, so the import spells the rewrite. */
const PASS_THROUGH: (root: string) => readonly ReportedAlias[] = () => [
  {
    ...STRING_ALIAS,
    find: "^~(.*)$",
    findKind: REGEXP_FIND,
    replacement: "$1",
  },
];

/** A RegExp alias `~/<name>` to `packages/<name>/src`, carrying `flags`. */
function namedPackage(flags = ""): (root: string) => readonly ReportedAlias[] {
  return (root) => [
    {
      ...STRING_ALIAS,
      find: "^~\\/(.*)$",
      findKind: REGEXP_FIND,
      flags,
      replacement: `${join(root, "packages")}/$1/src`,
    },
  ];
}

/** The app's edges and widenings that a rewritten import gave, apart from what the alias's replacement alone gives. */
function rewrites(information: Settled<DependencyInformation>) {
  return "edges" in information
    ? {
        edges: information.edges
          .filter(
            ({ dependent, detail }) =>
              dependent === APP && detail.includes(REWRITES),
          )
          .map(({ producer, dependency }) => `${producer} ${dependency}`)
          .sort(),
        widenings: information.uncertainties
          .filter(
            ({ dependent, cause }) =>
              dependent === APP && cause.includes(REWRITES),
          )
          .map(({ kind, cause }) => ({ kind, cause })),
      }
    : information;
}

/** What rewriting `source`, the app's source file, under `aliasList` gives the app. */
function rewritesOf(
  aliasList: (root: string) => readonly TreeAlias[],
  source: string,
  files: Readonly<Record<string, string>> = {},
) {
  return graphInTree(
    appTree({
      vitest: { aliases: aliasList },
      files: { [APP_SOURCE]: source, ...files },
      change: "",
    }),
  ).then(rewrites);
}

/** The one widening the pass-through alias gives for `specifier`, quoting the file, the import, the alias and the rewrite. */
function passThroughWidening(specifier: string) {
  return {
    edges: [],
    widenings: [
      {
        kind: ALIAS_WIDENING,
        cause: expect.stringContaining(
          `${APP_SOURCE} imports ${JSON.stringify(specifier)}, which config alias /^~(.*)$/ to "$1" rewrites to ${JSON.stringify(specifier.slice(1))}`,
        ),
      },
    ],
  };
}

/** What the engine says when `find` does not compile, as an error is quoted. */
function compileError(find: string): string {
  try {
    return `${String(new RegExp(find))} compiled`;
  } catch (error) {
    return errorText(error);
  }
}

const LIBS_W = "packages/libs (w)";
const GLOB_UNDER_ALIAS = 'export const all = import.meta.glob("@/*.ts");\n';

describe("an alias rewrites each import the source scan reads", () => {
  it("D2382: a change to a file an aliased import climbs to with .. selects the importing Vitest workspace", async () => {
    expect(
      await selectedFor({
        vitest: { aliases: intoAppSource() },
        files: { [APP_SOURCE]: CLIMB_TO_B },
        change: "packages/b/src/x.ts",
      }),
    ).toEqual([APP]);
  });

  it("D2383: the edge an aliased import gives is produced by alias", async () => {
    expect(
      await aliasScan(intoAppSource(), { [APP_SOURCE]: CLIMB_TO_B }),
    ).toEqual(REACHES_B);
  });

  it("D2384: an aliased import in a plain package workspace's file gives the alias's Vitest workspace the edge", async () => {
    expect(
      await aliasScan(intoAppSource(), {
        "packages/c/src/index.ts": CLIMB_TO_B,
      }),
    ).toEqual(REACHES_B);
  });

  it("D2385: a string find does not match an import that only begins with its text", async () => {
    expect(
      await rewritesOf(
        (root) => [
          { ...STRING_ALIAS, find: "@", replacement: join(root, "packages/c") },
        ],
        'import { b } from "@x/b";\n',
      ),
    ).toEqual({ edges: [], widenings: [] });
  });

  it("D2386: a $1 in a RegExp alias's replacement inserts the capture", async () => {
    expect(
      await rewritesOf(namedPackage(), 'import { b } from "~/b";\n'),
    ).toEqual({ edges: ["alias packages/b"], widenings: [] });
  });

  it("D2387: a y-flag RegExp find matches each import from its start, whatever the last import's match left", async () => {
    expect(
      await rewritesOf(
        namedPackage("y"),
        'import { b } from "~/b";\nimport { c } from "~/c";\n',
      ),
    ).toEqual({
      edges: ["alias packages/b", "alias packages/c"],
      widenings: [],
    });
  });

  it("D2388: a y-flag RegExp find replaces from the import's start after testing it", async () => {
    expect(
      await rewritesOf(namedPackage("y"), 'import { b } from "~/b";\n'),
    ).toEqual({ edges: ["alias packages/b"], widenings: [] });
  });

  it("D2389: a rewrite beginning with / reaches the workspace it names under the alias's Vite root", async () => {
    expect(
      await aliasScan(intoAppSource({ replacement: "/src" }), {
        [APP_SOURCE]: CLIMB_TO_B,
      }),
    ).toEqual(REACHES_B);
  });

  it("D2390: a rewrite beginning with / also reaches the workspace it names as a file-system path", async () => {
    expect(
      await aliasScan(
        (root) =>
          intoAppSource({ replacement: driveless(join(root, APP, "src")) })(
            root,
          ),
        { [APP_SOURCE]: CLIMB_TO_B },
      ),
    ).toEqual(REACHES_B);
  });

  it("D2391: a rewrite beginning with /@fs/ reaches the workspace holding the path that follows", async () => {
    expect(
      await aliasScan(
        (root) =>
          intoAppSource({
            replacement: posix.join("/@fs/", slashed(join(root, APP, "src"))),
          })(root),
        { [APP_SOURCE]: CLIMB_TO_B },
      ),
    ).toEqual(REACHES_B);
  });

  it("D2392: a relative rewrite resolves from the importing file's directory", async () => {
    expect(
      await rewritesOf(
        intoAppSource({ replacement: "../.." }),
        'import { x } from "@/b/src/x";\n',
      ),
    ).toEqual({ edges: ["alias packages/b"], widenings: [] });
  });

  it("D2393: a bare rewrite reaches the workspace its package name names, produced by alias", async () => {
    expect(
      await rewritesOf(
        () => [{ ...STRING_ALIAS, find: "~", replacement: "@x/b" }],
        'import { b } from "~";\n',
      ),
    ).toEqual({ edges: ["alias packages/b"], widenings: [] });
  });

  it("D2394: an aliased glob reaches every workspace under the directory before its first wildcard", async () => {
    expect(
      await rewritesOf(
        intoAppSource(),
        'export const all = import.meta.glob("@/../../*/src/*.ts");\n',
      ),
    ).toEqual({
      edges: ["alias .", "alias packages/b", "alias packages/c"],
      widenings: [],
    });
  });

  it("D2395: a rewrite beginning with // widens, quoting the file, the import, the alias and the rewrite", async () => {
    expect(
      await rewritesOf(PASS_THROUGH, 'import "~//cdn.example/lib";\n'),
    ).toEqual(passThroughWidening("~//cdn.example/lib"));
  });

  it("D2396: a rewrite beginning with /@ other than /@fs/ widens, quoting the file, the import, the alias and the rewrite", async () => {
    expect(await rewritesOf(PASS_THROUGH, 'import "~/@id/lib";\n')).toEqual(
      passThroughWidening("~/@id/lib"),
    );
  });

  it("D2397: a rewrite of /@fs/ followed by only a drive widens", async () => {
    expect(await rewritesOf(PASS_THROUGH, 'import "~/@fs/C:";\n')).toEqual(
      passThroughWidening("~/@fs/C:"),
    );
  });

  it("D2398: a rewrite of /@fs/ with nothing after it widens", async () => {
    expect(await rewritesOf(PASS_THROUGH, 'import "~/@fs/";\n')).toEqual(
      passThroughWidening("~/@fs/"),
    );
  });

  it("D2399: a RegExp find that does not compile widens its Vitest workspace, naming the compile error", async () => {
    expect(
      await graphInTree(
        appTree({
          vitest: {
            aliases: intoAppSource({ find: "^(", findKind: REGEXP_FIND }),
          },
          change: "",
        }),
      ).then(appWidenings),
    ).toContainEqual({
      kind: ALIAS_WIDENING,
      cause: expect.stringContaining(compileError("^(")),
    });
  });

  it("D2400: every alias that matches an import rewrites it, not only the first", async () => {
    expect(
      await rewritesOf(
        (root) => [
          ...intoAppSource()(root),
          {
            ...STRING_ALIAS,
            find: "@",
            replacement: join(root, "packages/c/src/x"),
          },
        ],
        'import "@/../../b";\n',
      ),
    ).toEqual({
      edges: ["alias packages/b", "alias packages/c"],
      widenings: [],
    });
  });

  it("D2401: an alias with a customResolver rewrites no import", async () => {
    expect(
      await rewritesOf(intoAppSource({ hasCustomResolver: true }), CLIMB_TO_B),
    ).toEqual({ edges: [], widenings: [] });
  });

  it("D2404: an aliased glob under a Vite root whose name holds ( reaches the directory the rewrite names under it", async () => {
    expect(
      await rewritesOf(
        (root) =>
          intoAppSource({
            replacement: "/src",
            viteRoot: slashed(join(root, LIBS_W)),
          })(root),
        GLOB_UNDER_ALIAS,
        { [`${LIBS_W}/package.json`]: pkg("@x/libs-w") },
      ),
    ).toEqual({ edges: [`alias ${LIBS_W}`], widenings: [] });
  });

  it("D2405: on Windows an aliased glob whose /-rooted replacement holds ( after a \\ widens to the directory before that \\", async () => {
    const information = await onPlatform("win32", () =>
      graphInTree(
        appTree({
          root: { workspaces: ["packages/*", "tools/*"] },
          vitest: {
            aliases: (root) =>
              intoAppSource({
                replacement: `${driveless(join(root, "packages"))}\\libs (w)/src`,
              })(root),
          },
          files: {
            [APP_SOURCE]: GLOB_UNDER_ALIAS,
            [`${LIBS_W}/package.json`]: pkg("@x/libs-w"),
            "tools/t/package.json": pkg("@x/t"),
          },
          change: "",
        }),
      ),
    );
    expect(rewrites(information)).toEqual({
      edges: [
        "alias .",
        "alias packages/b",
        "alias packages/c",
        `alias ${LIBS_W}`,
      ],
      widenings: [],
    });
  });

  it("D2406: a plain import and an aliased import of the same file each keep their own edge", async () => {
    expect(
      await aliasScan(intoAppSource(), {
        [APP_SOURCE]: `import { y } from "../../b/src/x";\n${CLIMB_TO_B}`,
      }),
    ).toEqual({
      edges: ["alias packages/b", "relative-import packages/b"],
      widenings: [],
    });
  });

  it("D2417: on Windows a plain glob's \\ escapes the character after it, so the glob still reaches the workspace whose name holds that character", async () => {
    const information = await onPlatform("win32", () =>
      scanApp({
        [APP_SOURCE]: `${String.raw`export const all = import.meta.glob("../../libs\\(w)/*.ts");`}\n`,
        "packages/libs(w)/package.json": pkg("@x/libs-paren"),
      }),
    );
    expect(appEdges(information)).toEqual([
      "relative-import .",
      "relative-import packages/b",
      "relative-import packages/c",
      "relative-import packages/libs(w)",
    ]);
  });

  it("D2422: on Windows a plain glob beginning with none of /, ./ and ../ reads its \\ as a separator, so it reaches the workspace before the name holding (", async () => {
    const information = await onPlatform("win32", () =>
      scanApp({
        [APP_SOURCE]: `${String.raw`export const all = import.meta.glob("..\\..\\b\\(x)\\*.ts");`}\n`,
      }),
    );
    expect(appEdges(information)).toEqual(["relative-import packages/b"]);
  });

  it("D2426: a glob beginning with ** reaches every package workspace, since Vite globs it from the file-system root", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]: 'export const all = import.meta.glob("**/*.ts");\n',
        }),
      ),
    ).toEqual([
      "relative-import .",
      "relative-import packages/b",
      "relative-import packages/c",
    ]);
  });

  it("D2427: a glob's literal directory ends before an escaping \\, so the glob reaches the workspace whose name the escape spells", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]: `${String.raw`export const all = import.meta.glob("../../a\\b/(x)/*.ts");`}\n`,
          "packages/ab/package.json": pkg("@x/ab"),
        }),
      ),
    ).toEqual([
      "relative-import .",
      "relative-import packages/ab",
      "relative-import packages/b",
      "relative-import packages/c",
    ]);
  });

  it("D2418: off Windows an aliased glob's \\ stays a character of a name, so the glob widens to the directory before that name", async () => {
    const information = await onPlatform("linux", () =>
      graphInTree(
        appTree({
          vitest: {
            aliases: (root) =>
              intoAppSource({
                replacement: `${slashed(join(root, "packages"))}/q\\z (w)/src`,
              })(root),
          },
          files: { [APP_SOURCE]: GLOB_UNDER_ALIAS },
          change: "",
        }),
      ),
    );
    expect(rewrites(information)).toEqual({
      edges: ["alias .", "alias packages/b", "alias packages/c"],
      widenings: [],
    });
  });

  it("D2419: a file importing one widened specifier twice widens its Vitest workspace once", async () => {
    expect(
      await rewritesOf(
        PASS_THROUGH,
        'import "~//cdn.example/lib";\nexport const lazy = () => import("~//cdn.example/lib");\n',
      ),
    ).toEqual(passThroughWidening("~//cdn.example/lib"));
  });
});

/** A malformed escape, which no host converts to a path. */
const UNCONVERTIBLE_URL = "file:///C:/x/a%2";

/** The alias `@` to the app's own `src`, spelled as a `file:` URL. */
function intoAppSourceByUrl(root: string): readonly TreeAlias[] {
  return intoAppSource({
    replacement: pathToFileURL(join(root, APP, "src")).href,
  })(root);
}

describe("an alias whose replacement is a file: URL reaches the path it converts to", () => {
  it("D2458: a file: URL prefix reaches the workspace holding the path it converts to", async () => {
    expect(
      await aliasScan((root) =>
        replacedBy(pathToFileURL(join(root, "packages/b/src")).href)(root),
      ),
    ).toEqual(REACHES_B);
  });

  it("D2459: a file: URL prefix that converts to no path widens", async () => {
    expect(await aliasScan(replacedBy(UNCONVERTIBLE_URL))).toEqual({
      edges: [],
      widenings: [ALIAS_WIDENING],
    });
  });

  it("D2460: a file: URL prefix converting to the file-system root widens, since the rest can name any file", async () => {
    expect(
      await aliasScan((root) =>
        replacedBy(pathToFileURL(parse(root).root).href)(root),
      ),
    ).toEqual({ edges: [], widenings: [ALIAS_WIDENING] });
  });

  it("D2461: a file: URL prefix converting to a bare Windows drive widens, since the rest can name any file", async () => {
    expect(
      await onPlatform("win32", () => aliasScan(replacedBy("file:///C:"))),
    ).toEqual({ edges: [], widenings: [ALIAS_WIDENING] });
  });

  it("D2462: an import the alias rewrites to a file: URL depends on the workspace its converted path climbs to with ..", async () => {
    expect(await rewritesOf(intoAppSourceByUrl, CLIMB_TO_B)).toEqual({
      edges: ["alias packages/b"],
      widenings: [],
    });
  });

  it("D2463: an import the alias rewrites to a file: URL that converts to no path widens, naming the conversion", async () => {
    expect(
      await rewritesOf(intoAppSourceByUrl, 'import { x } from "@/%2";\n'),
    ).toEqual({
      edges: [],
      widenings: [
        {
          kind: ALIAS_WIDENING,
          cause: expect.stringContaining("converts to no path"),
        },
      ],
    });
  });

  it("D2464: a glob the alias rewrites to a file: URL reaches the workspaces its converted pattern reaches", async () => {
    expect(
      await rewritesOf(
        intoAppSourceByUrl,
        'export const all = import.meta.glob("@/../../*/src/*.ts");\n',
      ),
    ).toEqual({
      edges: ["alias .", "alias packages/b", "alias packages/c"],
      widenings: [],
    });
  });

  it("D2483: a glob the alias rewrites to a file: URL holding # widens, since the conversion would cut the pattern at it", async () => {
    expect(
      await rewritesOf(
        intoAppSourceByUrl,
        'export const all = import.meta.glob("@/../../#/src/*.ts");\n',
      ),
    ).toEqual({
      edges: [],
      widenings: [
        {
          kind: ALIAS_WIDENING,
          cause: expect.stringContaining("pattern is not known"),
        },
      ],
    });
  });
});

describe("a file: URL written in source reaches the path it converts to", () => {
  it("D2465: a file: URL import depends on the workspace holding the path it converts to", async () => {
    expect(
      appEdges(
        await scanApp(
          {},
          {
            prepare: (root) =>
              writeFileSync(
                join(root, "packages/app/url.ts"),
                `import "${pathToFileURL(join(root, "packages/b/src/x.ts")).href}";\n`,
              ),
          },
        ),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D2468: a file: URL import whose scheme is upper case depends on the workspace holding its path, as a URL scheme ignores case", async () => {
    expect(
      appEdges(
        await scanApp(
          {},
          {
            prepare: (root) =>
              writeFileSync(
                join(root, "packages/app/url.ts"),
                `import "${pathToFileURL(join(root, "packages/b/src/x.ts")).href.replace("file:", "FILE:")}";\n`,
              ),
          },
        ),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D2482: a file: URL glob holding ? widens its workspace, since the conversion would cut the pattern at it", async () => {
    expect(
      appWidenings(
        await scanApp(
          {},
          {
            prepare: (root) =>
              writeFileSync(
                join(root, "packages/app/url.ts"),
                `export const all = import.meta.glob("${pathToFileURL(join(root, "packages")).href}/?/src/*.ts");\n`,
              ),
          },
        ),
      ),
    ).toEqual(widenedAt("unresolvable-specifier", "packages/app/url.ts"));
  });

  it("D2484: two distinct unconvertible file: URLs in one file each widen", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_SOURCE]: `import "${UNCONVERTIBLE_URL}";\nimport "file:///C:/y/b%2";\n`,
        }),
      ),
    ).toEqual([
      {
        kind: "unresolvable-specifier",
        cause: expect.stringContaining(UNCONVERTIBLE_URL),
      },
      {
        kind: "unresolvable-specifier",
        cause: expect.stringContaining("file:///C:/y/b%2"),
      },
    ]);
  });

  it("D2466: a file: URL import that converts to no path widens its workspace as unresolvable-specifier", async () => {
    expect(
      appWidenings(
        await scanApp({ [APP_SOURCE]: `import "${UNCONVERTIBLE_URL}";\n` }),
      ),
    ).toEqual(widenedAt("unresolvable-specifier", APP_SOURCE));
  });

  it("D2467: a file quoting one unconvertible file: URL twice widens once", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_SOURCE]: `import "${UNCONVERTIBLE_URL}";\nimport "${UNCONVERTIBLE_URL}";\n`,
        }),
      ),
    ).toEqual(widenedAt("unresolvable-specifier", APP_SOURCE));
  });
});

describe("local paths through links", () => {
  it("D1515: a local path whose link carries it into another workspace depends on that workspace too", async () => {
    // The walk's link edge from b to c would select the app through b, so the app's own edges are what is observed.
    expect(
      appEdges(
        await scanApp(
          { "packages/c/deep/index.ts": "" },
          {
            app: { dependencies: { linked: "file:../b/l" } },
            links: { "packages/b/l": "packages/c/deep" },
          },
        ),
      ),
    ).toEqual(["manifest packages/b", "manifest packages/c"]);
  });

  it("D1524: a bare .. dependency points into the parent workspace", async () => {
    const sub = "packages/app/sub";
    expect(
      await selectInTree({
        files: {
          "package.json": rootManifest({ workspaces: ["packages/*", sub] }),
          "packages/app/package.json": pkg("@x/app"),
          [`${sub}/package.json`]: pkg("@x/sub", {
            dependencies: { parent: ".." },
          }),
        },
        workspaces: [{ path: sub }],
        change: ["packages/app/src/index.ts"],
      }).then(selectedPaths),
    ).toEqual([sub]);
  });
});

describe("root overrides that cannot be resolved widen", () => {
  it("D1522: a $name override referencing a root dependency the root does not declare widens every workspace", async () => {
    expect(
      await selectedFor({
        root: { overrides: { "@x/b": "$missing" } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });

  it("D1523: an override value that is neither a string nor an object widens every workspace", async () => {
    expect(
      await selectedFor({
        root: { overrides: { "@x/b": 1 } },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
  });
});

const APP_SOURCE = "packages/app/src/a.ts";
const APP_TSCONFIG = "packages/app/tsconfig.json";
const INCOMPLETE_LISTING = { workspaces: ["packages/*", UNREAD_PATTERN] };

describe("relative module specifiers in source files", () => {
  it("D1581: a static import resolving into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({ [APP_SOURCE]: 'import { x } from "../../b/src/x";\n' }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1582: a re-export from another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({ [APP_SOURCE]: 'export { y } from "../../b/src/y";\n' }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1583: a literal dynamic import() into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const lazy = () => import("../../b/src/lazy");\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1584: a template literal with no substitution is read as a specifier", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            "export const lazy = () => import(`../../b/src/tpl`);\n",
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1585: a require() call into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/src/r.cjs":
            'module.exports = require("../../b/src/r");\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1586: a require.resolve() call into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/src/r.cjs":
            'module.exports = require.resolve("../../b/src/r");\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1587: each of vi.mock, vi.doMock, vi.importActual, vi.importMock, vi.unmock and vi.doUnmock names a dependency", async () => {
    expect(
      appEdges(
        await scanApp({
          ...plainPackages("b1", "b2", "b3", "b4", "b5", "b6"),
          "packages/app/src/a.test.ts": [
            'vi.mock("../../b1/m");',
            'vi.doMock("../../b2/m");',
            'await vi.importActual("../../b3/m");',
            'await vi.importMock("../../b4/m");',
            'vi.unmock("../../b5/m");',
            'vi.doUnmock("../../b6/m");',
            "",
          ].join("\n"),
        }),
      ),
    ).toEqual([
      "relative-import packages/b1",
      "relative-import packages/b2",
      "relative-import packages/b3",
      "relative-import packages/b4",
      "relative-import packages/b5",
      "relative-import packages/b6",
    ]);
  });

  it("D1588: an import.meta.resolve() call into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const url = import.meta.resolve("../../b/src/r");\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1589: a TypeScript import x = require() declaration names a dependency", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/src/eq.cts":
            'import m = require("../../b/src/eq");\nexport const n = m;\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1590: a /// <reference path> directive into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            '/// <reference path="../../b/types.d.ts" />\nexport {};\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1591: a reference path and a new URL specifier without ./ resolve beside the file, never as a package name that widens", async () => {
    expect(
      appWidenings(
        await scanApp(
          {
            [APP_SOURCE]: [
              '/// <reference path="types/env.d.ts" />',
              'export const f = new URL("assets/f.json", import.meta.url);',
              "",
            ].join("\n"),
          },
          { root: INCOMPLETE_LISTING },
        ),
      ),
    ).toEqual([]);
  });

  it("D1592: an import.meta.glob pattern depends on every workspace nested under the directory before its first wildcard", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const all = import.meta.glob("../../*/src/*.ts");\n',
        }),
      ),
    ).toEqual([
      "relative-import .",
      "relative-import packages/b",
      "relative-import packages/c",
    ]);
  });

  it("D1593: an import.meta.glob pattern depends on the workspace owning the directory before its first wildcard", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const lib = import.meta.glob("../../b/lib/*.ts");\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1594: each pattern of an import.meta.glob array names a dependency", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const both = import.meta.glob(["../../b/*.ts", "../../c/*.ts"]);\n',
        }),
      ),
    ).toEqual(["relative-import packages/b", "relative-import packages/c"]);
  });

  it("D1595: a negated import.meta.glob pattern still depends on the workspace it names", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const not = import.meta.glob("!../../c/*.ts");\n',
        }),
      ),
    ).toEqual(["relative-import packages/c"]);
  });

  it("D1596: a new URL(specifier, import.meta.url) into another workspace makes the file's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const f = new URL("../../b/assets/f.json", import.meta.url);\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1597: a query suffix on a relative specifier does not change the workspace it resolves into", async () => {
    expect(
      appEdges(
        await scanApp({ [APP_SOURCE]: 'import raw from "../../b?raw";\n' }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1598: a relative specifier resolving outside the consumer root adds no edge", async () => {
    expect(
      appEdges(
        await scanApp({ [APP_SOURCE]: 'import "../../../../outside/x";\n' }),
      ),
    ).toEqual([]);
  });

  it("D1654: an absolute specifier inside the consumer root depends on the workspace holding it", async () => {
    expect(
      appEdges(
        await scanApp(
          {},
          {
            prepare: (root) => {
              const target = join(root, "packages/b/src/x").replaceAll(
                "\\",
                "/",
              );
              writeFileSync(
                join(root, "packages/app/abs.ts"),
                `import "${target}";\n`,
              );
            },
          },
        ),
      ),
    ).toEqual(["relative-import packages/b"]);
  });

  it("D1599: a selection reason names the relative import, the file and the specifier that chose it", async () => {
    const outcome = await selectInTree({
      ...appTree({
        files: { [APP_SOURCE]: 'import { x } from "../../b/src/x";\n' },
        change: B_CHANGE,
      }),
      change: [B_CHANGE],
    });
    expect(
      "workspaces" in outcome ? outcome.workspaces[0]?.reasons[0] : outcome,
    ).toMatchObject({
      steps: [
        {
          workspace: APP,
          via: "relative-import",
          detail: expect.stringMatching(
            /packages\/app\/src\/a\.ts.*"\.\.\/\.\.\/b\/src\/x"/,
          ),
        },
      ],
    });
  });
});

describe("bare module specifiers in source files", () => {
  it("D1600: a bare specifier naming a listed workspace no manifest declares makes the file's workspace depend on it", async () => {
    expect(
      appEdges(await scanApp({ [APP_SOURCE]: 'import "@x/b";\n' })),
    ).toEqual(["bare-import packages/b"]);
  });

  it("D1601: a scoped bare specifier's package name is its first two segments", async () => {
    expect(
      appEdges(await scanApp({ [APP_SOURCE]: 'import "@x/b/sub/deep";\n' })),
    ).toEqual(["bare-import packages/b"]);
  });

  it("D1605: a query suffix on a bare specifier does not change the package it names", async () => {
    expect(
      appEdges(
        await scanApp({ [APP_SOURCE]: 'import worker from "@x/b?worker";\n' }),
      ),
    ).toEqual(["bare-import packages/b"]);
  });

  it("D1602: while the listing is incomplete, a bare specifier naming no listed workspace widens, naming the file", async () => {
    expect(
      appWidenings(
        await scanApp(
          { [APP_SOURCE]: 'import "left-pad";\n' },
          { root: INCOMPLETE_LISTING },
        ),
      ),
    ).toEqual(widenedAt("unlisted-package", APP_SOURCE));
  });

  it("D1603: a URL-scheme specifier is not bare, so it neither adds an edge nor widens while the listing is incomplete", async () => {
    expect(
      appScan(
        await scanApp(
          { [APP_SOURCE]: 'import "node:fs";\nimport "virtual:mod";\n' },
          { root: INCOMPLETE_LISTING },
        ),
      ),
    ).toEqual({ edges: [], widenings: [] });
  });

  it("D1604: a # subpath import is not bare, so it does not widen while the listing is incomplete", async () => {
    expect(
      appWidenings(
        await scanApp(
          { [APP_SOURCE]: 'import "#internal/x";\n' },
          { root: INCOMPLETE_LISTING },
        ),
      ),
    ).toEqual([]);
  });
});

describe("tsconfig and jsconfig files", () => {
  it("D1606: an extends path into another workspace makes the config's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: "../b/tsconfig.base.json" }),
        }),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D1607: each entry of an extends array names a dependency", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: ["../b/t.json", "../c/t.json"] }),
        }),
      ),
    ).toEqual(["tsconfig packages/b", "tsconfig packages/c"]);
  });

  it("D1608: an extends naming a listed workspace's package makes the config's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: "@x/b/tsconfig.base.json" }),
        }),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D1609: a references entry's path into another workspace makes the config's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ references: [{ path: "../c" }] }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1617: a jsconfig.json is read like a tsconfig", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/jsconfig.json": manifest({
            references: [{ path: "../c" }],
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1610: with no baseUrl, a paths target resolves against the config's own directory", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            compilerOptions: { paths: { "@b/*": ["../b/src/*"] } },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D1611: a paths target resolves against the config's own baseUrl", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            compilerOptions: {
              baseUrl: "..",
              paths: { "@c": ["c/src/index.ts"] },
            },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1612: a paths target resolves against a baseUrl inherited through extends", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            extends: "./tsconfig.base.json",
            compilerOptions: { paths: { "@c": ["c/src/index.ts"] } },
          }),
          "packages/app/tsconfig.base.json": manifest({
            compilerOptions: { baseUrl: ".." },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1613: the baseUrl of a later extends entry overrides an earlier one's", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            extends: ["./one.json", "./two.json"],
            compilerOptions: { paths: { "@c": ["c/src"] } },
          }),
          "packages/app/one.json": manifest({
            compilerOptions: { baseUrl: "../b" },
          }),
          "packages/app/two.json": manifest({
            compilerOptions: { baseUrl: ".." },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1614: two extends entries sharing one base config are not a cycle, so paths still yields its edge", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            extends: ["./one.json", "./two.json"],
            compilerOptions: { paths: { "@c": ["../c/src"] } },
          }),
          "packages/app/one.json": manifest({ extends: "./base.json" }),
          "packages/app/two.json": manifest({ extends: "./base.json" }),
          "packages/app/base.json": manifest({}),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1615: a config with paths whose extends chain cannot be followed widens, naming the config", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            extends: "./missing.json",
            compilerOptions: { paths: { "@c": ["../c/src"] } },
          }),
        }),
      ),
    ).toEqual(widenedAt("extends-unfollowed", APP_TSCONFIG));
  });

  it("D1616: a paths target holding a wildcard depends on every workspace nested under the directory before it", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            compilerOptions: { paths: { "@all/*": ["../*/src"] } },
          }),
        }),
      ),
    ).toEqual(["tsconfig .", "tsconfig packages/b", "tsconfig packages/c"]);
  });

  it("D1622: a references field that is not an array of { path } objects widens, naming the config", async () => {
    expect(
      appWidenings(
        await scanApp({ [APP_TSCONFIG]: manifest({ references: "../c" }) }),
      ),
    ).toEqual(widenedAt("malformed-config", APP_TSCONFIG));
  });

  it("D1623: a config with comments, trailing commas and a closing line comment parses and yields its edge", async () => {
    expect(
      appScan(
        await scanApp({
          [APP_TSCONFIG]: [
            "{",
            "  // project references",
            '  "references": [{ "path": "../c" },], /* block */',
            "} // end",
          ].join("\n"),
        }),
      ),
    ).toEqual({ edges: ["tsconfig packages/c"], widenings: [] });
  });

  it("D1624: a tsconfig that does not parse widens, naming the file", async () => {
    expect(
      appWidenings(await scanApp({ [APP_TSCONFIG]: '{ "references": [ }' })),
    ).toEqual(widenedAt("unparsed-source", APP_TSCONFIG));
  });
});

describe("package.json imports targets", () => {
  it("D1618: a relative imports target in another workspace makes the manifest's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({}, { app: { imports: { "#b": "../b/src/index.js" } } }),
      ),
    ).toEqual(["manifest-imports packages/b"]);
  });

  it("D1619: an imports target nested under conditions or in an array names a dependency", async () => {
    expect(
      appEdges(
        await scanApp(
          {},
          {
            app: {
              imports: {
                "#c": { node: ["../c/a.js"], default: { import: "../c/b.js" } },
              },
            },
          },
        ),
      ),
    ).toEqual(["manifest-imports packages/c"]);
  });

  it("D1620: a bare imports target naming a listed workspace makes the manifest's workspace depend on it", async () => {
    expect(
      appEdges(
        await scanApp({}, { app: { imports: { "#b": "@x/b/src/index.js" } } }),
      ),
    ).toEqual(["manifest-imports packages/b"]);
  });

  it("D1621: a URL-scheme imports target does not widen while the listing is incomplete", async () => {
    expect(
      appWidenings(
        await scanApp(
          {},
          { app: { imports: { "#fs": "node:fs" } }, root: INCOMPLETE_LISTING },
        ),
      ),
    ).toEqual([]);
  });
});

describe("source files the scan cannot read widen", () => {
  it("D1625: a source file that does not parse widens, naming the file", async () => {
    expect(
      appWidenings(await scanApp({ [APP_SOURCE]: 'import { from "../x";\n' })),
    ).toEqual(widenedAt("unparsed-source", APP_SOURCE));
  });

  it("D1626: each .vue, .svelte, .astro and .mdx file widens", async () => {
    expect(
      appScan(
        await scanApp({
          "packages/app/src/App.vue": "<template />\n",
          "packages/app/src/S.svelte": "<script></script>\n",
          "packages/app/src/P.astro": "---\n---\n",
          "packages/app/src/D.mdx": "# doc\n",
        }),
      ),
    ).toEqual({
      edges: [],
      widenings: [
        "plugin-format-file",
        "plugin-format-file",
        "plugin-format-file",
        "plugin-format-file",
      ],
    });
  });

  it("D1629: a source file nesting brackets 1,001 deep widens before it reaches the parser", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_SOURCE]: `export const x = ${"(".repeat(1001)}0${")".repeat(1001)};\n`,
        }),
      ),
    ).toEqual(widenedAt("unparsed-source", APP_SOURCE));
  });

  it("D1630: a source file nesting brackets 1,000 deep is parsed and yields its edge", async () => {
    expect(
      appScan(
        await scanApp({
          [APP_SOURCE]: `import "@x/b";\nexport const x = ${"(".repeat(1000)}0${")".repeat(1000)};\n`,
        }),
      ),
    ).toEqual({ edges: ["bare-import packages/b"], widenings: [] });
  });

  it("D1631: a source file too deep for the syntax tree walk widens instead of throwing", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_SOURCE]: `export const x = ${"a+".repeat(10_000)}a;\n`,
        }),
      ),
    ).toEqual(widenedAt("unparsed-source", APP_SOURCE));
  });

  it("D1627: a directory more than 40 levels below its workspace widens, naming the directory", async () => {
    expect(
      appWidenings(
        await scanApp({ [`packages/app/${"d/".repeat(41)}x.ts`]: "" }),
      ),
    ).toEqual(
      widenedAt("walk-bound-reached", `packages/app/${"d/".repeat(40)}d`),
    );
  });

  it("D1628: a directory exactly 40 levels below its workspace is walked and yields its edge", async () => {
    expect(
      appScan(
        await scanApp({
          [`packages/app/${"d/".repeat(40)}x.ts`]: 'import "@x/b";\n',
        }),
      ),
    ).toEqual({ edges: ["bare-import packages/b"], widenings: [] });
  });
});

describe("the source files the walk scans", () => {
  it("D1632: files ending .js, .mjs, .cjs, .jsx, .ts, .mts, .cts, .tsx and .d.ts are each scanned", async () => {
    expect(
      appEdges(
        await scanApp({
          ...plainPackages(
            "b1",
            "b2",
            "b3",
            "b4",
            "b5",
            "b6",
            "b7",
            "b8",
            "b9",
          ),
          "packages/app/src/a.js": 'import "@x/b1";\n',
          "packages/app/src/a.mjs": 'import "@x/b2";\n',
          "packages/app/src/a.cjs": 'require("@x/b3");\n',
          "packages/app/src/a.jsx":
            'import "@x/b4";\nexport const v = <div />;\n',
          "packages/app/src/a.ts": 'import "@x/b5";\n',
          "packages/app/src/a.mts": 'import "@x/b6";\n',
          "packages/app/src/a.cts": 'import m = require("@x/b7");\n',
          "packages/app/src/a.tsx":
            'import "@x/b8";\nexport const v = <div />;\n',
          "packages/app/src/types.d.ts": 'export type { T } from "@x/b9";\n',
        }),
      ),
    ).toEqual([
      "bare-import packages/b1",
      "bare-import packages/b2",
      "bare-import packages/b3",
      "bare-import packages/b4",
      "bare-import packages/b5",
      "bare-import packages/b6",
      "bare-import packages/b7",
      "bare-import packages/b8",
      "bare-import packages/b9",
    ]);
  });

  it("D1633: JSX in a .js file parses, so it yields its edge rather than widening", async () => {
    expect(
      appScan(
        await scanApp({
          "packages/app/src/view.js":
            'import "@x/b";\nexport const v = <div />;\n',
        }),
      ),
    ).toEqual({ edges: ["bare-import packages/b"], widenings: [] });
  });

  it("D1634: a top-level return in a .cjs file parses, so it yields its edge rather than widening", async () => {
    expect(
      appScan(
        await scanApp({
          "packages/app/src/c.cjs":
            'const b = require("@x/b");\nif (!b) return;\nmodule.exports = b;\n',
        }),
      ),
    ).toEqual({ edges: ["bare-import packages/b"], widenings: [] });
  });

  it("D1635: a file under node_modules is not scanned", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/node_modules/dep/index.js": 'import "@x/c";\n',
        }),
      ),
    ).toEqual([]);
  });

  it("D1655: a file under .git is not scanned", async () => {
    expect(
      appEdges(
        await scanApp({ "packages/app/.git/hooks/h.js": 'import "@x/c";\n' }),
      ),
    ).toEqual([]);
  });

  it("D1636: a nested package workspace's files are scanned as its own, not its parent's", async () => {
    const sub = "packages/app/sub";
    expect(
      appEdges(
        await scanApp(
          {
            [`${sub}/package.json`]: pkg("@x/sub"),
            [`${sub}/src/a.ts`]: 'import "@x/c";\n',
          },
          { root: { workspaces: ["packages/*", sub] } },
        ),
      ),
    ).toEqual([]);
  });
});

describe("links the walk meets", () => {
  it("D1637: a directory link is never walked into, so it yields only its link edge", async () => {
    expect(
      appEdges(
        await scanApp(
          { "packages/c/src/i.ts": 'import "@x/b";\n' },
          { links: { "packages/app/l": "packages/c/src" } },
        ),
      ),
    ).toEqual(["link packages/c"]);
  });

  it("D1638: a selection reason names the link that chose it", async () => {
    const outcome = await selectInTree({
      ...appTree({ files: { "packages/c/src/i.ts": "" }, change: C_CHANGE }),
      links: { "packages/app/l": "packages/c/src" },
      change: [C_CHANGE],
    });
    expect(
      "workspaces" in outcome ? outcome.workspaces[0]?.reasons[0] : outcome,
    ).toMatchObject({
      steps: [
        {
          workspace: APP,
          via: "link",
          detail: expect.stringContaining("packages/app/l"),
        },
      ],
    });
  });

  it("D1639: a dangling link depends on the workspace its text names, without widening", async () => {
    expect(
      appScan(
        await scanApp(
          { "packages/c/gone/keep.txt": "" },
          {
            links: { "packages/app/l": "packages/c/gone" },
            prepare: (root) => {
              rmSync(join(root, "packages/c/gone"), { recursive: true });
            },
          },
        ),
      ),
    ).toEqual({ edges: ["link packages/c"], widenings: [] });
  });

  it("D1640: a link target reached through a linked consumer root is labelled relative to the root", async () => {
    const information = await scanApp(
      { "packages/c/deep/index.ts": "" },
      { links: { "packages/app/l": "packages/c/deep" }, throughLink: true },
    );
    expect(
      "edges" in information
        ? information.edges
            .filter(({ dependent }) => dependent === APP)
            .map(({ detail }) => detail)
        : information,
    ).toEqual([expect.stringMatching(/ to packages\/c\/deep$/)]);
  });
});

describe("finding dependencies executes nothing", () => {
  it("D1641: a scan leaves no marker from a source file, a Vitest config or a tsconfig extends target that each write one when run", async () => {
    const markers = ["marker-source", "marker-config", "marker-extends"];
    const writer = (marker: string, up: string) =>
      `require("node:fs").writeFileSync(require("node:path").join(__dirname, "${up}${marker}"), "ran");\n`;
    const left = await inspectTree(
      {
        ...appTree({
          files: {
            "packages/app/src/run.cjs": writer("marker-source", "../../../"),
            "packages/app/vitest.config.cjs": writer("marker-config", "../../"),
            "packages/app/evil.cjs": writer("marker-extends", "../../"),
            [APP_TSCONFIG]: manifest({
              extends: "./evil.cjs",
              compilerOptions: { paths: { "@c": ["../c/src"] } },
            }),
          },
          change: "",
        }),
      },
      (root) => markers.filter((marker) => existsSync(join(root, marker))),
    );
    expect(left).toEqual([]);
  });
});

describe("suffixes on specifiers", () => {
  it("D1666: a hash suffix, like a query suffix, does not change where a bare or relative specifier resolves", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'import a from "@x/b#frag";\nimport c from "../../c#x";\n',
        }),
      ),
    ).toEqual(["bare-import packages/b", "relative-import packages/c"]);
  });

  it("D1667: a query suffix on a new URL specifier does not change the workspace it resolves into", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_SOURCE]:
            'export const u = new URL("../../b?url", import.meta.url);\n',
        }),
      ),
    ).toEqual(["relative-import packages/b"]);
  });
});

describe("configs a tsconfig inherits", () => {
  it("D1668: a tsconfig.build.json is read like a tsconfig", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/tsconfig.build.json": manifest({
            references: [{ path: "../c" }],
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1670: a config with no paths of its own takes the paths of a base config it extends", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
          "packages/app/configs/base.json": manifest({
            compilerOptions: { paths: { "@c": ["../../c/src"] } },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1671: inherited paths with no baseUrl resolve against the directory of the config that sets them", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
          "packages/app/configs/base.json": manifest({
            compilerOptions: { paths: { "@b/*": ["../../b/src/*"] } },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2346: two configs in different directories that extend the same relative target each inherit the paths of their own base", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: "./base.json" }),
          "packages/app/base.json": manifest({
            compilerOptions: { paths: { "@b": ["../b/src"] } },
          }),
          "packages/app/web/tsconfig.json": manifest({
            extends: "./base.json",
          }),
          "packages/app/web/base.json": manifest({
            compilerOptions: { paths: { "@c": ["../../c/src"] } },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/b", "tsconfig packages/c"]);
  });

  it("D2380: two configs extending one unreadable base each widen, naming themselves", async () => {
    const widenings = appWidenings(
      await scanApp({
        [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
        "packages/app/tsconfig.web.json": manifest({
          extends: "./configs/base.json",
        }),
        "packages/app/configs/base.json": "{",
      }),
    );
    expect(
      Array.isArray(widenings)
        ? widenings.toSorted((a, b) => a.cause.localeCompare(b.cause))
        : widenings,
    ).toEqual([
      {
        kind: "extends-unfollowed",
        cause: expect.stringMatching(/^packages\/app\/tsconfig\.json /),
      },
      {
        kind: "extends-unfollowed",
        cause: expect.stringMatching(/^packages\/app\/tsconfig\.web\.json /),
      },
    ]);
  });

  it("D2381: a base reached through a directory link resolves its relative baseUrl from the link's directory", async () => {
    expect(
      appEdges(
        await scanApp(
          {
            [APP_TSCONFIG]: manifest({ extends: "./linked/base.json" }),
            "packages/app/configs/deep/base.json": manifest({
              compilerOptions: { baseUrl: "..", paths: { "@c": ["../c/src"] } },
            }),
          },
          { links: { "packages/app/linked": "packages/app/configs/deep" } },
        ),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D1672: a config with no paths of its own whose extends cannot be read widens, naming the config", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_TSCONFIG]: manifest({ extends: "./missing.json" }),
        }),
      ),
    ).toEqual(widenedAt("extends-unfollowed", APP_TSCONFIG));
  });

  it("D1673: a baseUrl that is not a string widens a config with paths, naming the config", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            compilerOptions: { baseUrl: 1, paths: { "@c": ["../c/src"] } },
          }),
        }),
      ),
    ).toEqual(widenedAt("extends-unfollowed", APP_TSCONFIG));
  });

  it("D1677: a regular-expression literal the engine cannot build is refused rather than read as null", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_TSCONFIG]: '{ "references": [{ "path": "../c" }], "x": /(/ }',
        }),
      ),
    ).toEqual(widenedAt("unparsed-source", APP_TSCONFIG));
  });
});

const EXTENDS_WIDENING = "extends-unfollowed";

/** A config at `path` whose inherited `paths` reach `packages/<name>`, so the edge names which config was read. */
function reaching(path: string, name: string): Record<string, string> {
  const up = "../".repeat(path.split(POSIX_SEPARATOR).length - 1);
  return {
    [path]: manifest({
      compilerOptions: {
        paths: { [`@${name}`]: [`${up}packages/${name}/src`] },
      },
    }),
  };
}

/** The app's tsconfig extending `target` and nothing more, beside `files`. */
function extending(
  target: string,
  files: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return { [APP_TSCONFIG]: manifest({ extends: target }), ...files };
}

/** `target` under `levels` nested `default` conditions, the outermost being the exports field itself. */
function nestedDefault(levels: number, target: string): unknown {
  let value: unknown = target;
  for (let level = 0; level < levels; level += 1) value = { default: value };
  return value;
}

describe("a bare extends is located as TypeScript locates it", () => {
  it("D2428: a base in a linked package is read at its real path, so its relative baseUrl and paths reach the workspace TypeScript resolves them to", async () => {
    expect(
      appEdges(
        await scanApp(
          {
            ...extending("@x/base/tsconfig.json"),
            "packages/base/package.json": pkg("@x/base"),
            "packages/base/tsconfig.json": manifest({
              compilerOptions: {
                baseUrl: ".",
                paths: { "@c/*": ["../c/src/*"] },
              },
            }),
          },
          { links: { "node_modules/@x/base": "packages/base" } },
        ),
      ),
    ).toEqual(["tsconfig packages/base", "tsconfig packages/c"]);
  });

  it("D2429: a package's exports decide the config, not a file of the named path beside them", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("cfg/base", {
            "node_modules/cfg/package.json": pkg("cfg", {
              exports: { "./base": "./configs/base.json" },
            }),
            ...reaching("node_modules/cfg/configs/base.json", "b"),
            ...reaching("node_modules/cfg/base.json", "c"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2430: an exports pattern resolves under the require condition before default", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("cfg/star/x", {
            "node_modules/cfg/package.json": pkg("cfg", {
              exports: {
                "./star/*": {
                  require: "./star/*.json",
                  default: "./nope.json",
                },
              },
            }),
            ...reaching("node_modules/cfg/star/x.json", "b"),
            ...reaching("node_modules/cfg/nope.json", "c"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2431: a package without exports is read through its package.json tsconfig field before its index tsconfig.json", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("fld", {
            "node_modules/fld/package.json": pkg("fld", {
              tsconfig: "./lib/cfg.json",
            }),
            ...reaching("node_modules/fld/lib/cfg.json", "b"),
            ...reaching("node_modules/fld/tsconfig.json", "c"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2432: a tsconfig field ending in a separator names a directory, so its tsconfig.json is read, not a .json file of its name", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("dir", {
            "node_modules/dir/package.json": pkg("dir", { tsconfig: "./lib/" }),
            ...reaching("node_modules/dir/lib/tsconfig.json", "b"),
            ...reaching("node_modules/dir/lib.json", "c"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2433: a package's own name, extended from inside it, resolves through its own exports", async () => {
    expect(
      appScan(
        await scanApp(
          extending("@x/app/tsconfig.base.json", {
            ...reaching("packages/app/configs/own.json", "b"),
          }),
          {
            app: {
              exports: { "./tsconfig.base.json": "./configs/own.json" },
            },
          },
        ),
      ),
    ).toEqual({ edges: ["tsconfig packages/b"], widenings: [] });
  });

  it("D2434: a self-name's first look reads no .json target, so a later condition's .ts target swapped to .json wins", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("@x/app", {
            ...reaching("packages/app/configs/req.json", "c"),
            ...reaching("packages/app/configs/base.json", "b"),
          }),
          {
            app: {
              exports: {
                ".": {
                  require: "./configs/req.json",
                  default: "./configs/base.ts",
                },
              },
            },
          },
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2435: a null target in a self-name's first look stands, so the second look's .json target is never read", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("@x/app/nul", {
            ...reaching("packages/app/configs/req.json", "c"),
          }),
          {
            app: {
              exports: {
                "./nul": { require: "./configs/req.json", default: null },
              },
            },
          },
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, APP_TSCONFIG));
  });

  it("D2436: .. names the directory above, whose tsconfig.json is read rather than a .json file of the directory's name", async () => {
    expect(
      appEdges(
        await scanApp({
          [APP_TSCONFIG]: manifest({ compilerOptions: { baseUrl: "../c" } }),
          "packages/app/web/tsconfig.json": manifest({
            extends: "..",
            compilerOptions: { paths: { "@x": ["src"] } },
          }),
          "packages/app.json": manifest({ compilerOptions: { baseUrl: "b" } }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });

  it("D2437: a subpath climbing out with a backslash .. is refused by the package's exports pattern", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("bs/..\\outside.json", {
            "node_modules/bs/package.json": pkg("bs", {
              exports: { "./*": "./inner/*" },
            }),
            ...reaching("node_modules/bs/outside.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, APP_TSCONFIG));
  });

  it("D2438: a nested copy of a package that lacks the config does not end the walk, so a higher copy's config is read", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("nest/sub", {
            "packages/app/node_modules/nest/package.json": pkg("nest"),
            "packages/app/node_modules/nest/sub/package.json": pkg("nest-sub"),
            ...reaching("node_modules/nest/sub/tsconfig.json", "b"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2469: a scoped package's subpath is sought in the scoped package, not in a package named by its scope", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("@s/cfg/base", {
            "node_modules/@s/cfg/package.json": pkg("@s/cfg", {
              exports: { "./base": "./configs/base.json" },
            }),
            ...reaching("node_modules/@s/cfg/configs/base.json", "b"),
            ...reaching("node_modules/@s/cfg/base.json", "c"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2470: in a package without exports, a named .ts file is read as the .json file beside it", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("sw/base.ts", {
            "node_modules/sw/package.json": pkg("sw"),
            ...reaching("node_modules/sw/base.json", "b"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2485: the exports pattern key with the longer fixed prefix is tried first, whatever the keys' order", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("pat/star/base", {
            "node_modules/pat/package.json": pkg("pat", {
              exports: { "./*": "./a/*.json", "./star/*": "./s/*.json" },
            }),
            ...reaching("node_modules/pat/s/base.json", "b"),
            ...reaching("node_modules/pat/a/star/base.json", "c"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2486: a pattern key's trailer must end the subpath, so a subpath without it takes the next key", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("trl/base", {
            "node_modules/trl/package.json": pkg("trl", {
              exports: { "./*.json": "./c/*.json", "./*": "./d/*.json" },
            }),
            ...reaching("node_modules/trl/d/base.json", "b"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2487: a folder key ending in a separator maps every subpath under it", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("fdr/cfg/base.json", {
            "node_modules/fdr/package.json": pkg("fdr", {
              exports: { "./cfg/": "./configs/" },
            }),
            ...reaching("node_modules/fdr/configs/base.json", "b"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2488: an array export target takes its first entry that resolves", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("arr", {
            "node_modules/arr/package.json": pkg("arr", {
              exports: { ".": ["./missing.json", "./tsconfig.json"] },
            }),
            ...reaching("node_modules/arr/tsconfig.json", "b"),
          }),
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });

  it("D2489: an export target holding a .. segment is refused", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("up", {
            "node_modules/up/package.json": pkg("up", {
              exports: { ".": "./../up.json" },
            }),
            ...reaching("node_modules/up.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, APP_TSCONFIG));
  });

  it("D2490: an export target not beginning with ./ is refused", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("bare", {
            "node_modules/bare/package.json": pkg("bare", {
              exports: { ".": "x.json" },
            }),
            ...reaching("node_modules/bare/x.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, APP_TSCONFIG));
  });

  it("D2491: a package with exports extending another package's name reads that package, not its own exports", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("other/base", {
            ...reaching("packages/app/configs/own.json", "c"),
            "packages/app/node_modules/other/package.json": pkg("other"),
            ...reaching("packages/app/node_modules/other/base.json", "b"),
          }),
          { app: { exports: { ".": "./configs/own.json" } } },
        ),
      ),
    ).toEqual(["tsconfig packages/b"]);
  });
});

describe("an extends depends on the workspace holding the config it locates", () => {
  it("D2471: an extends of . that the package's tsconfig field redirects into another workspace depends on it", async () => {
    expect(
      appEdges(
        await scanApp(
          extending(".", {
            "packages/shared/package.json": pkg("@x/shared"),
            "packages/shared/tsconfig.json": manifest({}),
          }),
          { app: { tsconfig: "../shared/tsconfig.json" } },
        ),
      ),
    ).toEqual(["tsconfig packages/shared"]);
  });

  it("D2476: a bare extends reaching a link installed under a name no workspace has depends on the linked workspace", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("cfg", {
            "packages/base/package.json": pkg("@x/base"),
            "packages/base/tsconfig.json": manifest({}),
          }),
          { links: { "node_modules/cfg": "packages/base" } },
        ),
      ),
    ).toEqual(["tsconfig packages/base"]);
  });

  it("D2477: a base found in an installed package adds no edge to the root workspace", async () => {
    expect(
      appEdges(
        await scanApp(
          extending("@tsconfig/x", {
            "node_modules/@tsconfig/x/package.json": pkg("@tsconfig/x"),
            "node_modules/@tsconfig/x/tsconfig.json": manifest({}),
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("D2481: an empty tsconfig field is ignored, so . reads the directory's tsconfig.json, not a .json file of its name", async () => {
    expect(
      appEdges(
        await scanApp({
          "packages/app/web/package.json": pkg("web", { tsconfig: "" }),
          "packages/app/web/tsconfig.web.json": manifest({
            extends: ".",
            compilerOptions: { paths: { "@x": ["src"] } },
          }),
          "packages/app/web/tsconfig.json": manifest({
            compilerOptions: { baseUrl: "../../c" },
          }),
          "packages/app/web.json": manifest({
            compilerOptions: { baseUrl: "../b" },
          }),
        }),
      ),
    ).toEqual(["tsconfig packages/c"]);
  });
});

/** The app's tsconfig setting its own `paths` and `baseUrl`, so no chain is walked for them, and extending `target`. */
function extendingWithOwnPaths(
  target: string,
  files: Readonly<Record<string, string>>,
): Record<string, string> {
  return {
    [APP_TSCONFIG]: manifest({
      extends: target,
      compilerOptions: { baseUrl: ".", paths: { "@b": ["../b/src"] } },
    }),
    ...files,
  };
}

const TYPES_VERSIONS_PACKAGE = {
  "node_modules/tv/package.json": pkg("tv", {
    typesVersions: { "*": { "*": ["types/*"] } },
  }),
  ...reaching("node_modules/tv/tsconfig.json", "c"),
};

describe("an extends the lookup cannot follow widens at its edge", () => {
  it("D2478: a leaf setting its own paths and baseUrl widens when its extends cannot be followed", async () => {
    expect(
      appWidenings(
        await scanApp(extendingWithOwnPaths("tv", TYPES_VERSIONS_PACKAGE)),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "typesVersions"));
  });

  it("D2479: a leaf setting its own paths and baseUrl does not widen at its edge when its extends is only missing", async () => {
    expect(
      appWidenings(
        await scanApp(
          extendingWithOwnPaths("nocfg", {
            "node_modules/nocfg/package.json": pkg("nocfg"),
          }),
        ),
      ),
    ).toEqual([]);
  });

  it("D2480: a leaf with no paths widened at its extends edge is not widened again by its chain", async () => {
    expect(
      appWidenings(await scanApp(extending("tv", TYPES_VERSIONS_PACKAGE))),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "typesVersions"));
  });

  it("D2492: a typesVersions field widens a subpath extends into a package without exports", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("tv/base", {
            ...TYPES_VERSIONS_PACKAGE,
            ...reaching("node_modules/tv/base.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "typesVersions"));
  });
});

describe("an extends the lookup cannot follow widens, naming the cause", () => {
  it("D2439: a # subpath import as a walked config's extends widens once, at the edge it would give", async () => {
    expect(
      appWidenings(
        await scanApp({
          [APP_TSCONFIG]: manifest({
            extends: "#cfg",
            compilerOptions: { baseUrl: ".", paths: {} },
          }),
        }),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, '"#" subpath import'));
  });

  it("D2452: a # subpath import along an extends chain widens, naming the subpath import", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("./configs/base.json", {
            "packages/app/configs/base.json": manifest({ extends: "#cfg" }),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, '"#" subpath import'));
  });

  it("D2453: a typesVersions field on the package the lookup reads widens, naming the field", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("tv", {
            "node_modules/tv/package.json": pkg("tv", {
              typesVersions: { "*": { "*": ["types/*"] } },
            }),
            ...reaching("node_modules/tv/tsconfig.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "typesVersions"));
  });

  it("D2454: a types@<range> export condition the lookup reaches widens, naming the condition", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("tr", {
            "node_modules/tr/package.json": pkg("tr", {
              exports: {
                ".": { "types@>=5.0": "./a.json", default: "./tsconfig.json" },
              },
            }),
            ...reaching("node_modules/tr/tsconfig.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "types@>=5.0"));
  });

  it("D2455: a package manifest the lookup reads that does not parse widens, naming the manifest", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("bad", {
            "node_modules/bad/package.json": "{",
            ...reaching("node_modules/bad/tsconfig.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "node_modules/bad/package.json"));
  });

  it("D2456: exports nested past the 64-level JSON bound widen, naming the nesting", async () => {
    expect(
      appWidenings(
        await scanApp(
          extending("deep", {
            "node_modules/deep/package.json": manifest({
              name: "deep",
              exports: nestedDefault(64, "./tsconfig.json"),
            }),
            ...reaching("node_modules/deep/tsconfig.json", "c"),
          }),
        ),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "nests deeper than 64 levels"));
  });

  it("D2457: an extends cycle through a directory link is reported as returning to a config", async () => {
    expect(
      appWidenings(
        await scanApp(extending("./link/tsconfig.json"), {
          links: { "packages/app/link": "packages/app" },
        }),
      ),
    ).toEqual(widenedAt(EXTENDS_WIDENING, "its extends chain returns to"));
  });
});

describe("the build tells its observer of each parse", () => {
  it("D2235: a source file's parse is reported by its root-relative path before it starts, and its end once it returns", async () => {
    expect(
      await parsesInTree(
        appTree({ files: { "packages/app/src/x.ts": "" }, change: "" }),
      ),
    ).toStrictEqual(["parsing packages/app/src/x.ts", "parsed"]);
  });

  it("D2236: a walked tsconfig's parse is reported like a source file's", async () => {
    expect(
      await parsesInTree(
        appTree({ files: { [APP_TSCONFIG]: manifest({}) }, change: "" }),
      ),
    ).toStrictEqual([`parsing ${APP_TSCONFIG}`, "parsed"]);
  });

  it("D2237: the parse of a config a tsconfig extends is reported like the tsconfig's own", async () => {
    expect(
      await parsesInTree(
        appTree({
          files: {
            [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
            "packages/app/configs/base.json": manifest({}),
          },
          change: "",
        }),
      ),
    ).toStrictEqual([
      `parsing ${APP_TSCONFIG}`,
      "parsed",
      "parsing packages/app/configs/base.json",
      "parsed",
    ]);
  });

  it("D2247: a source file in a plain package is reported before its parse, like a Vitest workspace's", async () => {
    const events = await parsesInTree(
      appTree({ files: { "packages/b/src/y.ts": "" }, change: "" }),
    );
    expect(
      Array.isArray(events)
        ? events.filter((event) => event.startsWith("parsing"))
        : events,
    ).toStrictEqual(["parsing packages/b/src/y.ts"]);
  });

  it("D2248: the observer the build is given hears of every parse, source files and tsconfigs alike", async () => {
    const events = await parsesInTree(
      appTree({
        files: {
          "packages/app/src/x.ts": "",
          "packages/c/tsconfig.json": manifest({}),
        },
        change: "",
      }),
    );
    expect(
      Array.isArray(events)
        ? events.filter((event) => event.startsWith("parsing")).sort()
        : events,
    ).toStrictEqual([
      "parsing packages/app/src/x.ts",
      "parsing packages/c/tsconfig.json",
    ]);
  });

  it("D2377: a base config sought once for its paths and again for its baseUrl is parsed once", async () => {
    expect(
      await parsesInTree(
        appTree({
          files: {
            [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
            "packages/app/configs/base.json": manifest({
              compilerOptions: { paths: { "@c": ["../../c/src"] } },
            }),
          },
          change: "",
        }),
      ),
    ).toStrictEqual([
      `parsing ${APP_TSCONFIG}`,
      "parsed",
      "parsing packages/app/configs/base.json",
      "parsed",
    ]);
  });

  it("D2378: a base config two tsconfigs reach through different links to one directory is parsed once", async () => {
    const events = await parsesInTree({
      ...appTree({
        files: {
          [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
          "packages/app/tsconfig.web.json": manifest({
            extends: "./linked/base.json",
          }),
          "packages/app/configs/base.json": manifest({}),
        },
        change: "",
      }),
      links: { "packages/app/linked": "packages/app/configs" },
    });
    expect(
      Array.isArray(events)
        ? events.filter((event) => event.endsWith("/base.json")).length
        : events,
    ).toBe(1);
  });

  it("D2379: a base config two tsconfigs extend that cannot be read is parsed once", async () => {
    const events = await parsesInTree(
      appTree({
        files: {
          [APP_TSCONFIG]: manifest({ extends: "./configs/base.json" }),
          "packages/app/tsconfig.web.json": manifest({
            extends: "./configs/base.json",
          }),
          "packages/app/configs/base.json": "{",
        },
        change: "",
      }),
    );
    expect(
      Array.isArray(events)
        ? events.filter((event) => event.endsWith("/base.json"))
        : events,
    ).toStrictEqual(["parsing packages/app/configs/base.json"]);
  });
});
