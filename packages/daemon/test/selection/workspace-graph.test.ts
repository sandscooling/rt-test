import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  DependencyInformation,
  ResolvedAlias,
} from "../../src/selection/selection-types.js";
import {
  graphInTree,
  manifest,
  reasonVias,
  rootManifest,
  selectedPaths,
  selectInTree,
  type Settled,
  type TreeWorkspace,
} from "./harness.js";

const APP = "packages/app";
const B_CHANGE = "packages/b/src/index.ts";
const C_CHANGE = "packages/c/src/index.ts";
const UNREAD_PATTERN = "tools/**";

function pkg(name: string, fields: Readonly<Record<string, unknown>> = {}) {
  return manifest({ name, ...fields });
}

/** `packages/<name>/package.json` named `@x/<name>` for each name. */
function plainPackages(...names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => [`packages/${name}/package.json`, pkg(`@x/${name}`)]),
  );
}

interface AppCase {
  readonly app?: Readonly<Record<string, unknown>>;
  readonly root?: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly vitest?: Omit<TreeWorkspace, "path">;
  readonly change: string;
  readonly throughLink?: boolean;
  readonly links?: Readonly<Record<string, string>>;
}

/** A consumer whose only Vitest workspace is `packages/app`, beside plain packages `b` and `c`. */
function appTree({ app = {}, root = {}, files = {}, vitest = {} }: AppCase) {
  return {
    files: {
      "package.json": rootManifest(root),
      "packages/app/package.json": pkg("@x/app", app),
      ...plainPackages("b", "c"),
      ...files,
    },
    workspaces: [{ path: APP, ...vitest }],
  };
}

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

function aliases(
  replacement: (root: string) => string,
): (root: string) => readonly ResolvedAlias[] {
  return (root) => [{ find: "@alias", replacement: replacement(root) }];
}

/** Runs `body` while `process.platform` reads as `platform`, restoring it after. */
async function onPlatform<T>(
  platform: NodeJS.Platform,
  body: () => Promise<T>,
): Promise<T> {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    return await body();
  } finally {
    if (saved !== undefined) Object.defineProperty(process, "platform", saved);
  }
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

describe("local paths through links", () => {
  it("D1515: a local path whose link carries it into another workspace depends on that workspace too", async () => {
    expect(
      await selectedFor({
        app: { dependencies: { linked: "file:../b/l" } },
        files: { "packages/c/deep/index.ts": "" },
        links: { "packages/b/l": "packages/c/deep" },
        change: C_CHANGE,
      }),
    ).toEqual([APP]);
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
