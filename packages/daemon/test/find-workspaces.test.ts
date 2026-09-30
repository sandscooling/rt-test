import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceConfig } from "../src/vitest/config-loader.js";
import {
  findVitestWorkspaces,
  type VitestWorkspaceListing,
  type WorkspaceListing,
} from "../src/vitest/find-workspaces.js";
import { copyFixture, inTempDir, settle } from "./harness.js";

const UNPARSEABLE_JSON = "{";
const CONFIG = "export default {};\n";
const ESM_PACKAGE = JSON.stringify({ type: "module" });
const UNTYPED_PACKAGE = JSON.stringify({ name: "untyped" });

type Listing = WorkspaceListing | { thrown: string };

function listFixture(
  fixture: string,
  edits: Readonly<Record<string, string>> = {},
): Promise<Listing> {
  return inTempDir((dir) => {
    copyFixture(fixture, dir);
    for (const [file, text] of Object.entries(edits)) {
      writeFileSync(join(dir, file), text);
    }
    return settle(() => findVitestWorkspaces(dir));
  });
}

function paths(listing: Listing): string[] | Listing {
  return "workspaces" in listing
    ? listing.workspaces.map((workspace) => workspace.path)
    : listing;
}

function unreadSources(listing: Listing): string[] | Listing {
  return "notRead" in listing
    ? listing.notRead.map((entry) => entry.source)
    : listing;
}

/** Writes each file under `dir`, creating its directories. */
function writeTree(dir: string, files: Readonly<Record<string, string>>): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
}

/** The config file `workspaceConfig` picks in `ws/`, relative to the tree, and the loader it picks for it. */
function configChoice(
  files: Readonly<Record<string, string>>,
): Promise<unknown> {
  return inTempDir((dir) => {
    writeTree(dir, files);
    return settle(() => {
      const config = workspaceConfig(join(dir, "ws"));
      return config === undefined
        ? config
        : {
            file: relative(dir, config.file).split(sep).join("/"),
            loader: config.loader,
          };
    });
  });
}

function link(dir: string, target: string, path: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  symlinkSync(join(dir, target), join(dir, path), "junction");
}

/** A consumer root at `root/` beside a sibling workspace, whose `workspaces` patterns reach out by `..` and by links. */
function listEscapingRoot<T>(
  read: (listing: Listing, real: (path: string) => string) => T,
): Promise<T> {
  return inTempDir((dir) => {
    writeTree(dir, {
      "root/package.json": JSON.stringify({
        workspaces: ["../sibling", "links/*", "packages/*"],
      }),
      "root/packages/inside/vitest.config.mjs": CONFIG,
      "root/inner/vitest.config.mjs": CONFIG,
      "sibling/vitest.config.mjs": CONFIG,
    });
    link(dir, "sibling", "root/links/out");
    link(dir, "root/inner", "root/links/in");
    const root = join(dir, "root");
    return read(
      settle(() => findVitestWorkspaces(root)),
      (path) => realpathSync.native(join(dir, path)),
    );
  });
}

/** A consumer root holding a config, whose `workspaces` patterns reach one directory twice and the root again through links. */
function listDuplicates<T>(
  read: (listing: Listing, real: (path: string) => string) => T,
): Promise<T> {
  return inTempDir((dir) => {
    writeTree(dir, {
      "package.json": JSON.stringify({
        workspaces: ["links/*", "tools/real", "packages/*", "packages/a"],
      }),
      "vitest.config.mjs": CONFIG,
      "tools/real/vitest.config.mjs": CONFIG,
      "packages/a/vitest.config.mjs": CONFIG,
    });
    link(dir, "tools/real", "links/in");
    link(dir, ".", "links/root");
    return read(
      settle(() => findVitestWorkspaces(dir)),
      (path) => realpathSync.native(join(dir, path)),
    );
  });
}

describe("finding a consumer's Vitest workspaces", () => {
  it("D1030: a directory holding a vitest.config file is a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain("packages/cfg");
  });

  it("D1031: a vite.config directory whose devDependencies list vitest is a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain(
      "packages/vite-dev",
    );
  });

  it("D1032: a vite.config directory whose dependencies list vitest is a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain(
      "packages/vite-prod",
    );
  });

  it("D1033: a vite.config directory that does not depend on vitest is not a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).not.toContain(
      "packages/vite-nodep",
    );
  });

  it("D1034: a directory depending on vitest with no config file is reported as not read", async () => {
    const listing = await listFixture("workspaces");
    expect(
      "notRead" in listing
        ? listing.notRead.find((entry) => entry.source === "packages/dep-only")
        : listing,
    ).toEqual({
      source: "packages/dep-only",
      reason:
        "depends on Vitest but holds no Vitest or Vite config file, so it is not a Vitest workspace and its tests were not discovered",
    });
  });

  it("D1036: a root pnpm-workspace.yaml is reported as not read", async () => {
    expect(unreadSources(await listFixture("workspaces"))).toContain(
      "pnpm-workspace.yaml",
    );
  });

  it("D1037: a ** pattern and a pattern with * inside a segment are reported as not read", async () => {
    expect(unreadSources(await listFixture("workspaces"))).toEqual(
      expect.arrayContaining(["tools/**", "a*b/*"]),
    );
  });

  it("D1038: a negation pattern is reported as not applied", async () => {
    expect(unreadSources(await listFixture("workspaces"))).toContain(
      "!packages/skip",
    );
  });

  it("D1039: a literal directory pattern is searched for a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain("tools/lit");
  });

  it("D1040: workspaces given as { packages: [...] } are searched", async () => {
    expect(paths(await listFixture("workspaces-object"))).toContain("apps/web");
  });

  it("D1041: a consumer root holding a Vitest config is the workspace '.'", async () => {
    expect(paths(await listFixture("workspaces-object"))).toContain(".");
  });

  it("D1043: an unreadable package.json beside a vite.config is reported as not read", async () => {
    expect(
      unreadSources(
        await listFixture("workspaces", {
          "packages/vite-bad/package.json": UNPARSEABLE_JSON,
        }),
      ),
    ).toContain("packages/vite-bad/package.json");
  });

  it("D1044: an unreadable root package.json is reported as not read when the root holds a Vitest config", async () => {
    expect(
      unreadSources(
        await listFixture("workspaces-object", {
          "package.json": UNPARSEABLE_JSON,
        }),
      ),
    ).toContain("package.json");
  });

  it("D1045: a workspaces field of any other shape is reported as not read", async () => {
    expect(
      unreadSources(
        await listFixture("workspaces", {
          "package.json": JSON.stringify({ workspaces: "packages/*" }),
        }),
      ),
    ).toContain("package.json workspaces");
  });

  it("D1081: a non-string entry in workspaces is reported as not read", async () => {
    const listing = await listFixture("workspaces-object", {
      "package.json": JSON.stringify({ workspaces: ["apps/*", 7] }),
    });
    expect("notRead" in listing ? listing.notRead : listing).toEqual([
      {
        source: "package.json workspaces",
        reason: "pattern 7 is not a string",
      },
    ]);
  });

  it("D1082: a plain file beside the workspaces a parent/* pattern matches is neither a workspace nor reported", async () => {
    const listing = await listFixture("workspaces-object", {
      "apps/notes.txt": "not a workspace",
    });
    expect(listing).toEqual({
      workspaces: [
        expect.objectContaining({ path: "." }),
        expect.objectContaining({ path: "apps/web" }),
      ],
      notRead: [],
      notCovered: [],
    });
  });

  it("D1078: a directory link loop under a parent/* pattern is reported as not read and the other workspaces are still found", async () => {
    const listing = await inTempDir((dir) => {
      copyFixture("workspaces-object", dir);
      symlinkSync(
        join(dir, "apps/loop-b"),
        join(dir, "apps/loop-a"),
        "junction",
      );
      symlinkSync(
        join(dir, "apps/loop-a"),
        join(dir, "apps/loop-b"),
        "junction",
      );
      return settle(() => findVitestWorkspaces(dir));
    });
    expect(
      "workspaces" in listing
        ? {
            paths: listing.workspaces.map((workspace) => workspace.path),
            unread: listing.notRead.map((entry) => entry.source),
          }
        : listing,
    ).toEqual({ paths: [".", "apps/web"], unread: ["apps/*", "apps/*"] });
  });
});

describe("workspaces outside the consumer root", () => {
  it("D1294: a .. pattern's workspace is not listed and is reported under its pattern with the real path it resolves to", async () => {
    const outcome = await listEscapingRoot((listing, real) => ({
      paths: paths(listing),
      parentEntries:
        "notRead" in listing
          ? listing.notRead.filter((entry) => entry.source === "../sibling")
          : listing,
      sibling: real("sibling"),
    }));
    expect(outcome).toEqual({
      paths: ["links/in", "packages/inside"],
      parentEntries: [
        {
          source: "../sibling",
          reason: expect.stringContaining(
            `resolves to ${outcome.sibling}, outside the consumer root`,
          ),
        },
      ],
      sibling: outcome.sibling,
    });
  });

  it("D1295: a link inside the root that leads out is not listed and is reported under its pattern with the real path it resolves to", async () => {
    const outcome = await listEscapingRoot((listing, real) => ({
      paths: paths(listing),
      linkEntries:
        "notRead" in listing
          ? listing.notRead.filter((entry) => entry.source === "links/*")
          : listing,
      sibling: real("sibling"),
    }));
    expect(outcome).toEqual({
      paths: ["links/in", "packages/inside"],
      linkEntries: [
        {
          source: "links/*",
          reason: expect.stringContaining(
            `resolves to ${outcome.sibling}, outside the consumer root`,
          ),
        },
      ],
      sibling: outcome.sibling,
    });
  });

  it("D1296: a link that stays inside the root is still listed", async () => {
    expect(await listEscapingRoot((listing) => paths(listing))).toEqual([
      "links/in",
      "packages/inside",
    ]);
  });

  it("D1330: a pattern that leaves the root through .. and comes back into it is listed", async () => {
    const listing = await inTempDir((dir) => {
      writeTree(dir, {
        "root/package.json": JSON.stringify({
          workspaces: ["../root/inner"],
        }),
        "root/inner/vitest.config.mjs": CONFIG,
      });
      return settle(() => findVitestWorkspaces(join(dir, "root")));
    });
    expect(listing).toEqual({
      workspaces: [expect.objectContaining({ path: "inner" })],
      notRead: [],
      notCovered: [],
    });
  });
});

describe("workspaces reached twice", () => {
  it("D1297: two entries resolving to one directory are listed once", async () => {
    expect(await listDuplicates((listing) => paths(listing))).toEqual([
      ".",
      "links/in",
      "packages/a",
    ]);
  });

  it("D1298: each later entry resolving to a listed directory is reported, naming the workspace listed in its place", async () => {
    const outcome = await listDuplicates((listing, real) => ({
      notRead: "notRead" in listing ? listing.notRead : listing,
      root: real("."),
      tools: real("tools/real"),
    }));
    expect(outcome).toEqual({
      notRead: [
        {
          source: "links/root",
          reason: `resolves to ${outcome.root}, the directory of workspace ., which is listed in its place`,
        },
        {
          source: "tools/real",
          reason: `resolves to ${outcome.tools}, the directory of workspace links/in, which is listed in its place`,
        },
      ],
      root: outcome.root,
      tools: outcome.tools,
    });
  });

  it("D1299: a link back to the consumer root is the duplicate, and the root stays listed as .", async () => {
    const outcome = await listDuplicates((listing) => ({
      listed: paths(listing),
      duplicates: unreadSources(listing),
    }));
    expect(outcome).toEqual({
      listed: [".", "links/in", "packages/a"],
      duplicates: ["links/root", "tools/real"],
    });
  });
});

type CoverageListing = VitestWorkspaceListing | { thrown: string };

const RUN_TESTS_SCRIPT = "node run-tests.js";

/**
 * A consumer root with a test script and no Vitest of its own, whose `packages/*` holds a workspace with a test script and
 * no Vitest, one with a Vitest config whose Vitest the root installs, one depending on Vitest, one with no test script
 * and one whose test script is not a string.
 */
const COVERAGE_TREE: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({
    workspaces: ["packages/*"],
    scripts: { test: "npm run test --workspaces" },
  }),
  "packages/scripted/package.json": JSON.stringify({
    scripts: { test: RUN_TESTS_SCRIPT },
  }),
  "packages/configured/package.json": JSON.stringify({
    scripts: { test: "vitest run" },
  }),
  "packages/configured/vitest.config.mjs": CONFIG,
  "packages/depends/package.json": JSON.stringify({
    scripts: { test: "vitest run" },
    devDependencies: { vitest: "5.0.1" },
  }),
  "packages/depends/vite.config.mjs": CONFIG,
  "packages/unscripted/package.json": JSON.stringify({
    scripts: { build: "tsc" },
  }),
  "packages/numeric/package.json": JSON.stringify({ scripts: { test: 5 } }),
};

function listTree(
  files: Readonly<Record<string, string>>,
): Promise<CoverageListing> {
  return inTempDir((dir) => {
    writeTree(dir, files);
    return settle(() => findVitestWorkspaces(dir));
  });
}

/** Whether the listing names `path` as not covered, or why no listing was made. */
function notCoveredAt(
  listing: CoverageListing,
  path: string,
): boolean | string {
  if ("thrown" in listing) return listing.thrown;
  return listing.notCovered.some((entry) => entry.path === path);
}

function notCoveredPaths(listing: CoverageListing): string[] | string {
  if ("thrown" in listing) return listing.thrown;
  return listing.notCovered.map((entry) => entry.path);
}

describe("package workspaces with a test script that are not Vitest workspaces", () => {
  it("D3337: a listed package workspace with a string test script, no Vitest config file and no Vitest dependency is listed as not covered", async () => {
    expect(
      notCoveredAt(await listTree(COVERAGE_TREE), "packages/scripted"),
    ).toBe(true);
  });

  it("D3338: a not-covered workspace's reason quotes its test script", async () => {
    const listing = await listTree(COVERAGE_TREE);
    expect(
      "thrown" in listing
        ? listing.thrown
        : listing.notCovered.find((entry) => entry.path === "packages/scripted")
            ?.reason,
    ).toContain(JSON.stringify(RUN_TESTS_SCRIPT));
  });

  it("D3339: a workspace holding a Vitest config file is never listed as not covered, though its package does not depend on Vitest", async () => {
    expect(
      notCoveredAt(await listTree(COVERAGE_TREE), "packages/configured"),
    ).toBe(false);
  });

  it("D3340: a workspace depending on Vitest is never listed as not covered", async () => {
    expect(
      notCoveredAt(await listTree(COVERAGE_TREE), "packages/depends"),
    ).toBe(false);
  });

  it("D3341: a workspace with no test script is never listed as not covered", async () => {
    expect(
      notCoveredAt(await listTree(COVERAGE_TREE), "packages/unscripted"),
    ).toBe(false);
  });

  it("D3342: a workspace whose test script is not a string is never listed as not covered", async () => {
    expect(
      notCoveredAt(await listTree(COVERAGE_TREE), "packages/numeric"),
    ).toBe(false);
  });

  it("D3343: the consumer root is never listed as not covered, though it has a test script and no Vitest", async () => {
    expect(notCoveredAt(await listTree(COVERAGE_TREE), ".")).toBe(false);
  });

  it("D3344: a not-covered workspace adds nothing to the sources not read", async () => {
    const listing = await listTree(COVERAGE_TREE);
    expect(
      "thrown" in listing ? listing.thrown : listing.notRead,
    ).toStrictEqual([]);
  });

  it("D3345: a not-covered workspace listed by two patterns is listed once", async () => {
    expect(
      notCoveredPaths(
        await listTree({
          ...COVERAGE_TREE,
          "package.json": JSON.stringify({
            workspaces: ["packages/*", "packages/scripted"],
          }),
        }),
      ),
    ).toStrictEqual(["packages/scripted"]);
  });

  it("D3346: a workspace depending on Vitest with no config file, listed by two patterns, is reported as not read once", async () => {
    expect(
      unreadSources(
        await listTree({
          "package.json": JSON.stringify({
            workspaces: ["packages/*", "packages/dep-only"],
          }),
          "packages/dep-only/package.json": JSON.stringify({
            devDependencies: { vitest: "5.0.1" },
          }),
        }),
      ),
    ).toStrictEqual(["packages/dep-only"]);
  });
});

describe("choosing a workspace's config loader", () => {
  it("D1287: a .mts config loads through the runner, whatever its package says", async () => {
    expect(
      await configChoice({
        "ws/package.json": UNTYPED_PACKAGE,
        "ws/vitest.config.mts": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.mts", loader: "runner" });
  });

  it("D1288: a .cts config loads through the bundle loader, whatever its package says", async () => {
    expect(
      await configChoice({
        "ws/package.json": ESM_PACKAGE,
        "ws/vitest.config.cts": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.cts", loader: "bundle" });
  });

  it("D1289: a .js config in a package of type module loads through the runner", async () => {
    expect(
      await configChoice({
        "ws/package.json": ESM_PACKAGE,
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "runner" });
  });

  it("D1290: a .js config in a package with no type loads through the bundle loader", async () => {
    expect(
      await configChoice({
        "ws/package.json": UNTYPED_PACKAGE,
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "bundle" });
  });

  it("D1291: a package.json that does not parse is passed over for the next one up", async () => {
    expect(
      await configChoice({
        "package.json": ESM_PACKAGE,
        "ws/package.json": UNPARSEABLE_JSON,
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "runner" });
  });

  it("D1292: the nearest package.json decides, even with no type under a parent of type module", async () => {
    expect(
      await configChoice({
        "package.json": ESM_PACKAGE,
        "ws/package.json": UNTYPED_PACKAGE,
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "bundle" });
  });

  it("D1293: a vitest.config file is chosen over a vite.config file", async () => {
    expect(
      await configChoice({
        "ws/package.json": UNTYPED_PACKAGE,
        "ws/vite.config.mjs": CONFIG,
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "bundle" });
  });

  it("D1328: a nearest package.json that starts with a byte order mark is read, as Vite reads it", async () => {
    expect(
      await configChoice({
        "package.json": UNTYPED_PACKAGE,
        "ws/package.json": `﻿${ESM_PACKAGE}`,
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "runner" });
  });

  it("D1329: a nearest package.json holding null is passed over for the next one up, as Vite passes it over", async () => {
    expect(
      await configChoice({
        "package.json": ESM_PACKAGE,
        "ws/package.json": "null",
        "ws/vitest.config.js": CONFIG,
      }),
    ).toEqual({ file: "ws/vitest.config.js", loader: "runner" });
  });
});
