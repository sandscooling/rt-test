import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crawledLinks } from "../src/inputs/crawl-links.js";
import { testModuleFile } from "../src/inputs/non-inputs.js";
import { protection } from "../src/inputs/protection.js";
import { globCwd, patternBase } from "../src/inputs/vitest-glob.js";
import { ROOT_PATH } from "../src/vitest/find-workspaces.js";
import { moduleLocator } from "../src/vitest/module-tests.js";
import type {
  CrawledLinks,
  SpelledDirectory,
} from "../src/vitest/selection-facts.js";
import {
  discoveredWorkspace,
  inTempDir,
  projectFacts,
  slashed,
} from "./harness.js";

/** A junction on Windows, which needs no privilege; Linux ignores the type and makes a symbolic link. */
const JUNCTION = "junction";
/** A directory symbolic link on Windows, which needs the symbolic link privilege or developer mode. */
const DIRECTORY_SYMLINK = "dir";
type LinkKind = typeof JUNCTION | typeof DIRECTORY_SYMLINK;

/** The consumer root, below the test's temp directory so a layout can place a directory outside it. */
const CONSUMER_ROOT = "root";
/** picomatch's input limit is 65536 characters. */
const OVER_PICOMATCH_LIMIT = 70_000;
/** A walk with no cycle test follows a link back to the root until it can go no further, which takes seconds under load. */
const RUNAWAY_WALK_TIMEOUT_MS = 60_000;
/** One more directory link than a crawl's walk follows before its links are not known. */
const OVER_LINK_BOUND = 1_001;
/** Making and walking `OVER_LINK_BOUND` links takes over a quarter of Vitest's default 5 s alone, and past it under a loaded suite. */
const OVER_LINK_BOUND_TIMEOUT_MS = 60_000;
/** Vitest's default exclude. */
const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/.git/**"];

type Glob = (
  patterns: readonly string[],
  options: {
    readonly dot: boolean;
    readonly cwd: string;
    readonly ignore: readonly string[];
    readonly expandDirectories: boolean;
  },
) => Promise<string[]>;

/** The tinyglobby Vitest globs test files with, reached through Vitest's own install, since the daemon does not depend on it. */
const vitestGlob = (
  createRequire(createRequire(import.meta.url).resolve("vitest/package.json"))(
    "tinyglobby",
  ) as { readonly glob: Glob }
).glob;

/** A layout with its patterns, and a file Vitest's glob reaches in it only through directory links. */
interface Differential {
  readonly layout: Layout;
  readonly patterns: Patterns;
  /** Relative to the consumer root, by its real path. */
  readonly reachedThroughLinks: string;
}

const DIFFERENTIALS: Readonly<Record<string, Differential>> = {
  "a link back to the root beside nested links": {
    layout: {
      directories: ["root/src/a", "root/other/deep", "root/third"],
      files: [
        "root/src/a/own.test.ts",
        "root/other/x.test.ts",
        "root/other/deep/y.test.ts",
        "root/third/z.test.ts",
      ],
      links: [
        ["root/src/linked", "root/other"],
        ["root/other/tolink", "root/third"],
        ["root/src/up", "root"],
      ],
    },
    patterns: {
      include: ["src/**/*.test.ts"],
      exclude: [...DEFAULT_EXCLUDE, "**/deep/**"],
    },
    reachedThroughLinks: "third/z.test.ts",
  },
  "mutual sibling links": {
    layout: {
      directories: ["root/a", "root/b"],
      files: ["root/a/a.test.ts", "root/b/b.test.ts"],
      links: [
        ["root/a/l1", "root/b"],
        ["root/b/l2", "root/a"],
      ],
    },
    patterns: { include: ["a/**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "b/b.test.ts",
  },
  "targets whose real paths share a prefix": {
    layout: {
      directories: ["root/src", "root/other/inner", "root/other2"],
      files: [
        "root/other/o.test.ts",
        "root/other2/p.test.ts",
        "root/other/inner/i.test.ts",
      ],
      links: [
        ["root/src/l", "root/other"],
        ["root/other/l2", "root/other2"],
        ["root/other2/l3", "root/other/inner"],
      ],
    },
    patterns: { include: ["src/**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "other/inner/i.test.ts",
  },
  "the default include from the root, with node_modules": {
    layout: {
      directories: ["root/pkg/src", "root/shared", "root/node_modules/dep"],
      files: ["root/shared/s.test.ts", "root/node_modules/dep/n.test.ts"],
      links: [
        ["root/pkg/src/shared", "root/shared"],
        ["root/pkg/src/dep", "root/node_modules/dep"],
        ["root/shared/back", "root/pkg"],
      ],
    },
    patterns: { include: ["**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "node_modules/dep/n.test.ts",
  },
  "a nested link as the only route, through a link that leaves the root": {
    layout: {
      directories: ["root/src", "other", "root/third"],
      files: ["root/third/z.test.ts"],
      links: [
        ["root/src/l1", "other"],
        ["other/l2", "root/third"],
      ],
    },
    patterns: { include: ["src/**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "third/z.test.ts",
  },
  "a dangling link beside a live one": {
    layout: {
      directories: ["root/src", "root/other", "root/gone"],
      files: ["root/other/x.test.ts"],
      links: [
        ["root/src/dead", "root/gone"],
        ["root/src/live", "root/other"],
      ],
      removed: ["root/gone"],
    },
    patterns: { include: ["src/**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "other/x.test.ts",
  },
  "a pattern base that is itself a link, with a link below it": {
    layout: {
      directories: ["root/real/sub", "root/far"],
      files: ["root/far/f.test.ts", "root/real/sub/r.test.ts"],
      links: [
        ["root/via", "root/real"],
        ["root/real/sub/far", "root/far"],
      ],
    },
    patterns: { include: ["via/**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "far/f.test.ts",
  },
  "sibling targets whose names differ only in their last character": {
    layout: {
      directories: ["root/src", "root/a1", "root/a2"],
      files: ["root/a2/z.test.ts"],
      links: [
        ["root/src/l1", "root/a1"],
        ["root/a1/l2", "root/a2"],
      ],
    },
    patterns: { include: ["src/**/*.test.ts"], exclude: DEFAULT_EXCLUDE },
    reachedThroughLinks: "a2/z.test.ts",
  },
};

/** Every path is relative to the test's temp directory. */
interface Layout {
  readonly directories: readonly string[];
  readonly files?: readonly string[];
  readonly links: readonly (readonly [path: string, target: string])[];
  /** Removed once every link is made, which leaves a link to one dangling. */
  readonly removed?: readonly string[];
}

/** A project's patterns, matching from the consumer root. */
interface Patterns {
  readonly include?: readonly string[];
  readonly includeSource?: readonly string[];
  readonly exclude?: readonly string[];
}

/** `count` sibling links in `directory`, each to `target`. */
function siblingLinks(
  directory: string,
  target: string,
  count: number,
): [path: string, target: string][] {
  return Array.from({ length: count }, (_, index) => [
    `${directory}/l${index}`,
    target,
  ]);
}

/** Writes the layout under `dir` and returns the consumer root. */
function writeLayout(dir: string, layout: Layout, kind: LinkKind): string {
  for (const directory of [CONSUMER_ROOT, ...layout.directories]) {
    mkdirSync(join(dir, directory), { recursive: true });
  }
  for (const file of layout.files ?? []) writeFileSync(join(dir, file), "");
  for (const [path, target] of layout.links) {
    symlinkSync(join(dir, target), join(dir, path), kind);
  }
  for (const directory of layout.removed ?? []) {
    rmSync(join(dir, directory), { recursive: true });
  }
  return join(dir, CONSUMER_ROOT);
}

/** Names a path relative to the consumer root by its real path, as discovery names the root workspace's paths. */
function rootRelativeTo(root: string): (path: string) => string {
  const locate = moduleLocator({ path: ROOT_PATH, directory: root });
  return (path) => {
    const location = locate("unit", path);
    return testModuleFile(location.workspacePath, location.modulePath);
  };
}

/** The walk of the project's crawls, naming a real path relative to the consumer root as discovery names a module. */
function walk(
  root: string,
  patterns: Patterns,
  signal: AbortSignal = new AbortController().signal,
): Promise<CrawledLinks> {
  return crawledLinks(
    {
      vitestDirectory: globCwd(root),
      globbed: [patterns.include ?? [], patterns.includeSource ?? []],
      exclude: patterns.exclude ?? [],
      rootRelative: rootRelativeTo(root),
    },
    signal,
  );
}

/** Each pattern's base other than Vitest's directory, named as discovery reports it. */
function reportedPatternBases(
  root: string,
  patterns: Patterns,
): SpelledDirectory[] {
  const cwd = globCwd(root);
  const rootRelative = rootRelativeTo(root);
  const bases = new Set<string>();
  for (const pattern of [
    ...(patterns.include ?? []),
    ...(patterns.includeSource ?? []),
  ]) {
    const base = patternBase(pattern, cwd);
    if (base !== undefined && base !== cwd) bases.add(base);
  }
  return [...bases].map((spelled) => ({
    spelled,
    directory: rootRelative(spelled),
  }));
}

/** The walk with its links in order of their spelling, relative to the crawl's `cwd`, since a directory's entries come in no fixed order. */
function orderedWalk(
  root: string,
  crawled: CrawledLinks,
): CrawledLinks | { readonly complete: true; readonly links: unknown[] } {
  if (!crawled.complete) return crawled;
  const cwd = `${slashed(root)}/`;
  return {
    complete: true,
    links: [...crawled.links]
      .sort((a, b) => a.spelled.localeCompare(b.spelled))
      .map((link) => ({
        below: link.spelled.startsWith(cwd)
          ? link.spelled.slice(cwd.length)
          : link.spelled,
        directory: link.directory,
      })),
  };
}

/** Whether each root-relative path is protected, from the discovery a real walk of the layout reports, or why none is. */
async function protectedThroughWalk(
  root: string,
  patterns: Patterns,
  paths: readonly string[],
): Promise<Record<string, boolean> | string> {
  const links = await walk(root, patterns);
  const value = protection(
    {
      workspaces: [
        discoveredWorkspace({ path: ROOT_PATH, directory: root }, [], {
          reported: true,
          projects: [
            projectFacts({
              ...patterns,
              root,
              patternBases: reportedPatternBases(root, patterns),
              crawledLinks: links,
            }),
          ],
        }),
      ],
      notRead: [],
    },
    root,
  );
  if (!value.applies) return value.reason;
  return Object.fromEntries(paths.map((path) => [path, value.protects(path)]));
}

/**
 * Writes the layout, globs its include patterns as Vitest does, and names each file found by its real path from the
 * consumer root: whether the glob reached the file it reaches only through links, and which files a real walk leaves
 * unprotected, or why no pattern applies.
 */
async function unprotectedVitestFinds(
  dir: string,
  differential: Differential,
): Promise<{ readonly reached: boolean; readonly unprotected: unknown }> {
  const root = writeLayout(dir, differential.layout, JUNCTION);
  const found = await vitestGlob(differential.patterns.include ?? [], {
    dot: true,
    cwd: globCwd(root),
    ignore: differential.patterns.exclude ?? [],
    expandDirectories: false,
  });
  const rootRelative = rootRelativeTo(root);
  const files = found.map((file) => rootRelative(join(root, file)));
  const protectedPaths = await protectedThroughWalk(
    root,
    differential.patterns,
    files,
  );
  return {
    reached: files.includes(differential.reachedThroughLinks),
    unprotected:
      typeof protectedPaths === "string"
        ? protectedPaths
        : files.filter((file) => !protectedPaths[file]),
  };
}

describe("against the glob Vitest uses", () => {
  it("D2901: every file Vitest's own glob finds through directory links is protected through the walk, over layouts where fdir's cycle test decides which links it follows", async () => {
    const outcomes: Record<string, unknown> = {};
    for (const [name, differential] of Object.entries(DIFFERENTIALS)) {
      outcomes[name] = await inTempDir((dir) =>
        unprotectedVitestFinds(dir, differential),
      );
    }
    expect(outcomes).toStrictEqual(
      Object.fromEntries(
        Object.keys(DIFFERENTIALS).map((name) => [
          name,
          { reached: true, unprotected: [] },
        ]),
      ),
    );
  });
});

describe("the directory links Vitest's crawl follows", () => {
  it("D2850: a test file reached only through a link inside a followed link that leaves the consumer root is protected", async () => {
    const protectedPaths = await inTempDir((dir) =>
      protectedThroughWalk(
        writeLayout(
          dir,
          {
            directories: ["root/src", "other", "root/third"],
            files: ["root/third/z.test.ts"],
            links: [
              ["root/src/l1", "other"],
              ["other/l2", "root/third"],
            ],
          },
          JUNCTION,
        ),
        { include: ["src/**/*.test.ts"] },
        ["third/z.test.ts", "elsewhere/w.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({
      "third/z.test.ts": true,
      "elsewhere/w.test.ts": false,
    });
  });

  it(
    "D2852: with directory symbolic links, a crawl through a link back to the consumer root follows it once and stops where fdir stops, so its links are known",
    async () => {
      const walked = await inTempDir(async (dir) => {
        const root = writeLayout(
          dir,
          {
            directories: ["root/src/a", "root/other/deep", "root/third"],
            files: [
              "root/src/a/own.test.ts",
              "root/other/x.test.ts",
              "root/third/z.test.ts",
            ],
            links: [
              ["root/src/linked", "root/other"],
              ["root/other/tolink", "root/third"],
              ["root/src/up", "root"],
            ],
          },
          DIRECTORY_SYMLINK,
        );
        return orderedWalk(
          root,
          await walk(root, { include: ["src/**/*.test.ts"] }),
        );
      });
      expect(walked).toStrictEqual({
        complete: true,
        links: [
          { below: "src/linked", directory: "other" },
          { below: "src/linked/tolink", directory: "third" },
          { below: "src/up", directory: "." },
        ],
      });
    },
    RUNAWAY_WALK_TIMEOUT_MS,
  );

  it("D2861: a link below an includeSource pattern's base is followed, so a source file reached only through it is protected", async () => {
    const protectedPaths = await inTempDir((dir) =>
      protectedThroughWalk(
        writeLayout(
          dir,
          {
            directories: ["root/lib", "root/shared"],
            files: ["root/shared/util.ts"],
            links: [["root/lib/shared", "root/shared"]],
          },
          JUNCTION,
        ),
        { include: ["none/*.test.ts"], includeSource: ["lib/**/*.ts"] },
        ["shared/util.ts", "elsewhere/util.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({
      "shared/util.ts": true,
      "elsewhere/util.ts": false,
    });
  });

  it("D2882: a pattern base whose name only begins with another base's name is walked too, so a test file reached through a link below it is protected", async () => {
    const protectedPaths = await inTempDir((dir) =>
      protectedThroughWalk(
        writeLayout(
          dir,
          {
            directories: ["root/src", "root/src2", "root/other"],
            files: ["root/other/x.test.ts"],
            links: [["root/src2/l", "root/other"]],
          },
          JUNCTION,
        ),
        { include: ["src/**/*.test.ts", "src2/**/*.test.ts"] },
        ["other/x.test.ts", "elsewhere/w.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({
      "other/x.test.ts": true,
      "elsewhere/w.test.ts": false,
    });
  });

  it("D2883: a link below the base of a later include pattern is followed, so a test file reached only through it is protected", async () => {
    const protectedPaths = await inTempDir((dir) =>
      protectedThroughWalk(
        writeLayout(
          dir,
          {
            directories: ["root/a", "root/b", "root/other"],
            files: ["root/other/x.test.ts"],
            links: [["root/b/l", "root/other"]],
          },
          JUNCTION,
        ),
        { include: ["a/**/*.test.ts", "b/**/*.test.ts"] },
        ["other/x.test.ts", "elsewhere/w.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({
      "other/x.test.ts": true,
      "elsewhere/w.test.ts": false,
    });
  });
});

describe("what the crawl passes over, as fdir does with its errors suppressed", () => {
  it("D2853: a dangling link beside a live one is passed over, so the patterns apply and a file reached through the live link is protected", async () => {
    const protectedPaths = await inTempDir((dir) =>
      protectedThroughWalk(
        writeLayout(
          dir,
          {
            directories: ["root/src", "root/other", "root/gone"],
            files: ["root/other/x.test.ts"],
            links: [
              ["root/src/dead", "root/gone"],
              ["root/src/live", "root/other"],
            ],
            removed: ["root/gone"],
          },
          JUNCTION,
        ),
        { include: ["src/**/*.test.ts"] },
        ["other/x.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({ "other/x.test.ts": true });
  });

  it("D2854: a pattern base not on disk yet is passed over, so the patterns apply and protect a test file created there later", async () => {
    const protectedPaths = await inTempDir((dir) =>
      protectedThroughWalk(
        writeLayout(dir, { directories: [], links: [] }, JUNCTION),
        { include: ["src/**/*.test.ts"] },
        ["src/a.test.ts"],
      ),
    );
    expect(protectedPaths).toStrictEqual({ "src/a.test.ts": true });
  });
});

describe("when the crawl's links cannot be known", () => {
  it("D2856: a pattern picomatch refuses leaves the crawled links not known, with the reason, never known and empty", async () => {
    const walked = await inTempDir((dir) =>
      walk(writeLayout(dir, { directories: [], links: [] }, JUNCTION), {
        include: ["a".repeat(OVER_PICOMATCH_LIMIT)],
      }),
    );
    expect(walked).toStrictEqual({
      complete: false,
      reason:
        "picomatch cannot compile a test file pattern, so the crawl was not walked",
    });
  });

  it("D2857: an interrupted discovery's walk throws the discovery's own abort reason rather than walking on", async () => {
    const interrupted = new AbortController();
    const reason = new DOMException(
      "the discovery was interrupted",
      "AbortError",
    );
    interrupted.abort(reason);
    const outcome = await inTempDir((dir) => {
      const root = writeLayout(
        dir,
        {
          directories: ["root/src", "root/other"],
          links: [["root/src/l", "root/other"]],
        },
        JUNCTION,
      );
      return walk(
        root,
        { include: ["src/**/*.test.ts"] },
        interrupted.signal,
      ).then(
        () => "walked",
        (error: unknown) => error,
      );
    });
    expect(outcome).toBe(reason);
  });

  it(
    "D2897: a crawl that follows more than 1000 directory links leaves the project's links not known, with the reason, never known without the links past the bound",
    async () => {
      const outcome = await inTempDir(async (dir) => {
        const root = writeLayout(
          dir,
          {
            directories: ["root/src", "root/other"],
            links: siblingLinks("root/src", "root/other", OVER_LINK_BOUND),
          },
          JUNCTION,
        );
        return {
          walked: await walk(root, { include: ["src/**/*.test.ts"] }),
          base: `${slashed(root)}/src`,
        };
      });
      expect(outcome.walked).toStrictEqual({
        complete: false,
        reason: `the walk below ${outcome.base} follows more than 1000 directory links`,
      });
    },
    OVER_LINK_BOUND_TIMEOUT_MS,
  );
});

describe("what the crawl prunes", () => {
  it("D2898: a directory an exclude pattern matches, though it matches nothing inside, is not read, so more than 1000 links inside an excluded node_modules leave the walk complete", async () => {
    const walked = await inTempDir((dir) =>
      walk(
        writeLayout(
          dir,
          {
            directories: ["root/src/node_modules", "root/other"],
            links: siblingLinks(
              "root/src/node_modules",
              "root/other",
              OVER_LINK_BOUND,
            ),
          },
          JUNCTION,
        ),
        { include: ["src/**/*.test.ts"], exclude: ["**/node_modules"] },
      ),
    );
    expect(walked).toStrictEqual({ complete: true, links: [] });
  });

  it("D2899: a directory link the exclude patterns match is not followed, so more than 1000 links behind a linked node_modules leave the walk complete", async () => {
    const walked = await inTempDir((dir) =>
      walk(
        writeLayout(
          dir,
          {
            directories: ["root/src", "root/deps", "root/other"],
            links: [
              ["root/src/node_modules", "root/deps"],
              ...siblingLinks("root/deps", "root/other", OVER_LINK_BOUND),
            ],
          },
          JUNCTION,
        ),
        { include: ["src/**/*.test.ts"], exclude: ["**/node_modules/**"] },
      ),
    );
    expect(walked).toStrictEqual({ complete: true, links: [] });
  });
});
