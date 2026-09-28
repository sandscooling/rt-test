import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { protection, type Protection } from "../src/inputs/protection.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { SelectionFacts } from "../src/vitest/selection-facts.js";
import {
  discoveredWorkspace,
  onPlatform,
  projectFacts,
  settle,
  type FactsCase,
} from "./harness.js";

/** Protection relates paths without reading the file system, so the consumer root need not exist. */
const ROOT = resolve(sep, "consumer");
const ROOT_PATTERN_PREFIX = ROOT.replaceAll(sep, "/");
/** Vitest's default `include`, as discovery reports it for a project that sets none. */
const VITEST_DEFAULT_INCLUDE = "**/*.{test,spec}.?(c|m)[jt]s?(x)";
const PATTERNS_DO_NOT_APPLY =
  "rt-test.json's patterns do not apply, so every file stays an input: ";
/** picomatch's input limit is 65536 characters. */
const OVER_PICOMATCH_LIMIT = 70_000;
/** How much of a refused pattern a reason quotes. */
const QUOTED_LENGTH = 200;

function rootWorkspace(facts: SelectionFacts): WorkspaceDiscovery {
  return discoveredWorkspace({ path: ".", directory: ROOT }, [], facts);
}

function discoveryOf(...workspaces: WorkspaceDiscovery[]): TestDiscovery {
  return { workspaces, notRead: [] };
}

/** The protection from a discovery whose one workspace, the root, reports one project with `facts`. */
function protectionFor(facts: FactsCase): Protection {
  return protection(
    discoveryOf(
      rootWorkspace({ reported: true, projects: [projectFacts(facts)] }),
    ),
    ROOT,
  );
}

/** Whether each root-relative path is protected, or why no pattern applies. */
function protects(
  value: Protection,
  paths: readonly string[],
): Record<string, boolean> | string {
  if (!value.applies) return value.reason;
  return Object.fromEntries(paths.map((path) => [path, value.protects(path)]));
}

describe("which files the test file patterns protect", () => {
  it("D2132: a test file under a directory whose name begins with a dot is protected, as Vitest's glob finds it", () => {
    expect(
      protects(protectionFor({ include: [VITEST_DEFAULT_INCLUDE] }), [
        ".storybook/a.test.ts",
        "src/b.test.ts",
      ]),
    ).toStrictEqual({ ".storybook/a.test.ts": true, "src/b.test.ts": true });
  });

  it("D2133: a file name that matches an include pattern only in another case is not protected", () => {
    expect(
      protects(protectionFor({ include: ["src/**/*.test.ts"] }), [
        "src/A.Test.ts",
        "src/b.test.ts",
      ]),
    ).toStrictEqual({ "src/A.Test.ts": false, "src/b.test.ts": true });
  });

  it("D2134: a file an exclude pattern matches is not protected, though an include pattern matches it", () => {
    expect(
      protects(
        protectionFor({
          include: ["**/*.test.ts"],
          exclude: ["**/*.skip.test.ts"],
        }),
        ["src/a.skip.test.ts", "src/b.test.ts"],
      ),
    ).toStrictEqual({ "src/a.skip.test.ts": false, "src/b.test.ts": true });
  });

  it("D2135: a file inside a directory an exclude pattern matches is not protected, since the glob never crawls into it", () => {
    expect(
      protects(
        protectionFor({ include: ["**/*.test.ts"], exclude: ["**/fixtures"] }),
        ["fixtures/a.test.ts", "src/b.test.ts"],
      ),
    ).toStrictEqual({ "fixtures/a.test.ts": false, "src/b.test.ts": true });
  });

  it("D2136: an excluded directory name prunes only below the directory the glob starts its crawl from", () => {
    expect(
      protects(
        protectionFor({ include: ["e2e/**/*.spec.ts"], exclude: ["**/e2e"] }),
        ["e2e/deep/a.spec.ts", "e2e/deep/e2e/b.spec.ts"],
      ),
    ).toStrictEqual({
      "e2e/deep/a.spec.ts": true,
      "e2e/deep/e2e/b.spec.ts": false,
    });
  });

  it("D2137: an absolute include pattern is taken relative to the pattern directory", () => {
    expect(
      protects(
        protectionFor({ include: [`${ROOT_PATTERN_PREFIX}/src/**/*.test.ts`] }),
        ["src/a.test.ts", "b.test.ts"],
      ),
    ).toStrictEqual({ "src/a.test.ts": true, "b.test.ts": false });
  });

  it("D2138: an include pattern that climbs out and back into its own directory by name protects the files in that directory", () => {
    expect(
      protects(
        protectionFor({ directory: "packages/a", include: ["../a/*.test.ts"] }),
        ["packages/a/x.test.ts", "packages/b/y.test.ts"],
      ),
    ).toStrictEqual({
      "packages/a/x.test.ts": true,
      "packages/b/y.test.ts": false,
    });
  });

  it("D2139: an excluded directory outside the pattern directory, crawled to reach a file through .., prunes that file", () => {
    expect(
      protects(
        protectionFor({
          directory: "packages/a",
          include: ["../**/*.test.ts"],
          exclude: ["../b"],
        }),
        [
          "packages/a/x.test.ts",
          "packages/b/y.test.ts",
          "packages/c/z.test.ts",
        ],
      ),
    ).toStrictEqual({
      "packages/a/x.test.ts": false,
      "packages/b/y.test.ts": false,
      "packages/c/z.test.ts": true,
    });
  });

  it("D2140: a file an includeSource pattern matches is protected, whether or not it holds in-source tests", () => {
    expect(
      protects(protectionFor({ includeSource: ["src/**/*.ts"] }), [
        "src/util.ts",
        "other/util.ts",
      ]),
    ).toStrictEqual({ "src/util.ts": true, "other/util.ts": false });
  });

  it("D2141: an include pattern beginning with ! excludes what it matches", () => {
    expect(
      protects(protectionFor({ include: ["**/*.test.ts", "!**/skip/**"] }), [
        "skip/a.test.ts",
        "b.test.ts",
      ]),
    ).toStrictEqual({ "skip/a.test.ts": false, "b.test.ts": true });
  });

  it("D2142: an exclude pattern beginning with ! is dropped, excluding nothing", () => {
    expect(
      protects(
        protectionFor({ include: ["**/*.test.ts"], exclude: ["!**/skip/**"] }),
        ["skip/a.test.ts", "b.test.ts"],
      ),
    ).toStrictEqual({ "skip/a.test.ts": true, "b.test.ts": true });
  });

  it("D2143: an empty include pattern is skipped, so it neither moves the glob's crawl start nor lets an excluded name prune the directory the other patterns start from", () => {
    expect(
      protects(
        protectionFor({
          include: ["", "e2e/**/*.spec.ts"],
          exclude: ["**/e2e"],
        }),
        ["e2e/deep/a.spec.ts"],
      ),
    ).toStrictEqual({ "e2e/deep/a.spec.ts": true });
  });

  it("D2144: with process.platform read as linux, a climb back into a pattern directory whose name holds * is not collapsed, as Vitest's glob escapes the name there", async () => {
    const protectedPaths = await onPlatform("linux", async () =>
      protects(
        protectionFor({
          directory: "packages/a*b",
          include: ["../a*b/*.test.ts"],
        }),
        ["packages/a*b/x.test.ts", "packages/aXb/y.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({
      "packages/a*b/x.test.ts": false,
      "packages/aXb/y.test.ts": true,
    });
  });
});

describe("patterns Vitest's glob reads specially", () => {
  it("D2166: an include pattern opening with the extglob !( protects what it matches, and is not taken for a negation", () => {
    expect(
      protects(protectionFor({ include: ["!(skip)/*.test.ts"] }), [
        "src/a.test.ts",
        "skip/a.test.ts",
      ]),
    ).toStrictEqual({ "src/a.test.ts": true, "skip/a.test.ts": false });
  });

  it("D2167: a trailing ** starts the glob's crawl above its directory, so an exclude naming that directory prunes it", () => {
    expect(
      protects(protectionFor({ include: ["e2e/**"], exclude: ["**/e2e"] }), [
        "e2e/a.ts",
        "e2e/deep/b.ts",
      ]),
    ).toStrictEqual({ "e2e/a.ts": false, "e2e/deep/b.ts": false });
  });
});

describe("the case of a path's leading directories", () => {
  it("D2158: with process.platform read as win32, the directories the glob's crawl starts from match in any case, and a directory below them only in its own", async () => {
    const protectedPaths = await onPlatform("win32", async () =>
      protects(
        protectionFor({
          include: ["src/a/**/*.test.ts", "src/b/**/*.test.ts"],
        }),
        ["Src/a/x.test.ts", "Src/A/y.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({
      "Src/a/x.test.ts": true,
      "Src/A/y.test.ts": false,
    });
  });

  it("D2169: with process.platform read as win32 and the consumer root at a drive's root, the directories the glob's crawl starts from still match in any case", async () => {
    const driveRoot = "C:\\";
    const protectedPaths = await onPlatform("win32", async () => {
      const value = protection(
        discoveryOf(
          discoveredWorkspace({ path: ".", directory: driveRoot }, [], {
            reported: true,
            projects: [projectFacts({ include: ["src/**/*.test.ts"] })],
          }),
        ),
        driveRoot,
      );
      return protects(value, ["Src/a.test.ts"]);
    });
    expect(protectedPaths).toStrictEqual({ "Src/a.test.ts": true });
  });

  it("D2161: with process.platform read as linux, a directory the glob's crawl starts from matches only in its own case", async () => {
    const protectedPaths = await onPlatform("linux", async () =>
      protects(protectionFor({ include: ["src/**/*.test.ts"] }), [
        "Src/y.test.ts",
        "src/z.test.ts",
      ]),
    );
    expect(protectedPaths).toStrictEqual({
      "Src/y.test.ts": false,
      "src/z.test.ts": true,
    });
  });
});

describe("when no declared pattern applies", () => {
  it("D2145: a pattern picomatch refuses stops patterns applying, with a reason naming the project and quoting the pattern's start", () => {
    const pattern = "a".repeat(OVER_PICOMATCH_LIMIT);
    const value = settle(() => protectionFor({ include: [pattern] }));
    const reason = "applies" in value && !value.applies ? value.reason : value;
    expect(
      typeof reason === "string" && {
        starts: reason.startsWith(
          `${PATTERNS_DO_NOT_APPLY}picomatch cannot compile the test file pattern "${"a".repeat(QUOTED_LENGTH)}"... of the project "unit", so the files it finds are not known: `,
        ),
        namesLimit: reason.includes("65536"),
      },
    ).toStrictEqual({ starts: true, namesLimit: true });
  });

  it("D2146: a refused pattern is quoted only up to its first 200 characters", () => {
    const value = protectionFor({
      include: ["b".repeat(OVER_PICOMATCH_LIMIT)],
    });
    const reason = value.applies ? "" : value.reason;
    expect(reason.includes("b".repeat(QUOTED_LENGTH + 1))).toBe(false);
  });

  it("D2147: a root workspace whose discovery does not report its selection facts stops patterns applying, and the reason names it as the one at the consumer root", () => {
    expect(
      protects(
        protection(discoveryOf(rootWorkspace({ reported: false })), ROOT),
        [],
      ),
    ).toBe(
      `${PATTERNS_DO_NOT_APPLY}the discovery in effect does not report which files they may not remove for the workspace at the consumer root`,
    );
  });

  it("D2168: a workspace below the root whose discovery does not report its selection facts is named by its path in the reason", () => {
    expect(
      protects(
        protection(
          discoveryOf(
            rootWorkspace({ reported: true, projects: [] }),
            discoveredWorkspace(
              { path: "packages/b", directory: `${ROOT}${sep}packages${sep}b` },
              [],
              { reported: false },
            ),
          ),
          ROOT,
        ),
        [],
      ),
    ).toBe(
      `${PATTERNS_DO_NOT_APPLY}the discovery in effect does not report which files they may not remove for the workspace packages/b`,
    );
  });

  it("D2148: a workspace that failed, is unsupported or was not confirmed leaves patterns applying", () => {
    const place = (path: string) => ({
      path,
      directory: `${ROOT}${sep}${path}`,
    });
    const value = protection(
      discoveryOf(
        rootWorkspace({
          reported: true,
          projects: [projectFacts({ include: ["**/*.test.ts"] })],
        }),
        {
          status: "failed",
          workspace: place("packages/failed"),
          vitestVersion: "5.0.1",
          error: "the config threw",
        },
        {
          status: "unsupported",
          workspace: place("packages/old"),
          vitest: {
            supported: false,
            version: "3.2.4",
            supportedRange: ">=4.1.0",
            reason: "Vitest 3.2.4 is older than 4.1",
          },
        },
        {
          status: "not-confirmed",
          workspace: place("packages/new"),
          reason: "not confirmed at start",
        },
      ),
      ROOT,
    );
    expect(protects(value, ["a.test.ts"])).toStrictEqual({ "a.test.ts": true });
  });
});
