import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  patternBase,
  protection,
  type Protection,
} from "../src/inputs/protection.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { SelectionFacts } from "../src/vitest/selection-facts.js";
import {
  discoveredWorkspace,
  HAND_BUILT_ROOT,
  onPlatform,
  projectFacts,
  settle,
  slashed,
  type FactsCase,
} from "./harness.js";

/** Protection relates paths without reading the file system, so the consumer root need not exist. */
const ROOT = HAND_BUILT_ROOT;
const ROOT_PATTERN_PREFIX = ROOT.replaceAll(sep, "/");
/** The consumer root as a project was started through another spelling of it, such as a link or a `subst` drive. */
const STARTED = slashed(resolve(sep, "started"));
/** Another spelling of the consumer root, which a pattern writes for its own directories. */
const LINKED = slashed(resolve(sep, "linked"));
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

  it("D2140: a file an includeSource pattern matches from the pattern directory's real path is protected, whether or not it holds in-source tests", () => {
    expect(
      protects(
        protectionFor({
          vitestDirectory: STARTED,
          includeSource: [`${ROOT_PATTERN_PREFIX}/src/**/*.ts`],
        }),
        ["src/util.ts", "other/util.ts"],
      ),
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

describe("files Vitest's glob finds through another spelling of the pattern directory", () => {
  it("D2802: a file the patterns find from the pattern directory's real path stays protected when Vitest's spelling of that directory finds nothing", () => {
    expect(
      protects(
        protectionFor({
          vitestDirectory: STARTED,
          include: [`${ROOT_PATTERN_PREFIX}/src/**/*.test.ts`],
        }),
        ["src/a.test.ts", "b.test.ts"],
      ),
    ).toStrictEqual({ "src/a.test.ts": true, "b.test.ts": false });
  });

  it("D2803: an absolute include pattern spelled from the root as the project was started protects what it finds there", () => {
    expect(
      protects(
        protectionFor({
          vitestDirectory: STARTED,
          include: [`${STARTED}/src/**/*.test.ts`],
        }),
        ["src/a.test.ts", "lib/b.test.ts"],
      ),
    ).toStrictEqual({ "src/a.test.ts": true, "lib/b.test.ts": false });
  });

  it("D2832: an absolute includeSource pattern spelled from the root as the project was started protects what it finds there", () => {
    expect(
      protects(
        protectionFor({
          vitestDirectory: STARTED,
          includeSource: [`${STARTED}/src/**/*.ts`],
        }),
        ["src/util.ts", "other/util.ts"],
      ),
    ).toStrictEqual({ "src/util.ts": true, "other/util.ts": false });
  });

  it("D2804: an absolute include pattern that spells its own directories through another spelling protects what it finds there", () => {
    expect(
      protects(
        protectionFor({
          patternBases: [{ spelled: `${LINKED}/src`, directory: "src" }],
          include: [`${LINKED}/src/**/*.test.ts`],
        }),
        ["src/a.test.ts", "lib/b.test.ts"],
      ),
    ).toStrictEqual({ "src/a.test.ts": true, "lib/b.test.ts": false });
  });

  it("D2805: an exclude pattern still removes a file found through Vitest's spelling of the pattern directory", () => {
    expect(
      protects(
        protectionFor({
          vitestDirectory: STARTED,
          include: [`${STARTED}/**/*.test.ts`],
          exclude: ["**/fixtures/**"],
        }),
        ["fixtures/a.test.ts", "src/b.test.ts"],
      ),
    ).toStrictEqual({ "fixtures/a.test.ts": false, "src/b.test.ts": true });
  });

  it("D2806: an include pattern with no glob segment, spelled through another spelling, protects the one file it names", () => {
    expect(
      protects(
        protectionFor({
          patternBases: [
            { spelled: `${LINKED}/src/a.test.ts`, directory: "src/a.test.ts" },
          ],
          include: [`${LINKED}/src/a.test.ts`],
        }),
        ["src/a.test.ts", "src/b.test.ts"],
      ),
    ).toStrictEqual({ "src/a.test.ts": true, "src/b.test.ts": false });
  });

  it("D2807: two discoveries that differ only in Vitest's spelling of the pattern directory, or only in a pattern's own spelling, have different pattern keys", () => {
    const keyOf = (facts: FactsCase): string => {
      const value = protectionFor(facts);
      return value.applies ? value.patternKey : value.reason;
    };
    const include = ["src/**/*.test.ts"];
    const base = keyOf({ include });
    expect({
      vitestDirectory: keyOf({ include, vitestDirectory: STARTED }) !== base,
      patternBases:
        keyOf({
          include,
          patternBases: [{ spelled: `${LINKED}/src`, directory: "src" }],
        }) !== base,
    }).toStrictEqual({ vitestDirectory: true, patternBases: true });
  });
});

describe("the directory a test file pattern spells before its first glob segment", () => {
  it("D2808: a doubled separator or a /./ segment in an absolute pattern is normalized away, as Vitest's glob normalizes the pattern", () => {
    expect({
      doubled: patternBase(
        `${ROOT_PATTERN_PREFIX}//src/**/*.test.ts`,
        ROOT_PATTERN_PREFIX,
      ),
      current: patternBase(
        `${ROOT_PATTERN_PREFIX}/./src/**/*.test.ts`,
        ROOT_PATTERN_PREFIX,
      ),
    }).toStrictEqual({
      doubled: `${ROOT_PATTERN_PREFIX}/src`,
      current: `${ROOT_PATTERN_PREFIX}/src`,
    });
  });

  it("D2809: a backslash escaping a glob character in the pattern's directories is dropped, naming the directory on disk", () => {
    expect(
      patternBase(
        `${ROOT_PATTERN_PREFIX}/a\\(1\\)/src/**/*.test.ts`,
        ROOT_PATTERN_PREFIX,
      ),
    ).toBe(`${ROOT_PATTERN_PREFIX}/a(1)/src`);
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
