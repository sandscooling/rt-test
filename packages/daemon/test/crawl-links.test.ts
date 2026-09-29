import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crawledLinks } from "../src/inputs/crawl-links.js";
import { testModuleFile } from "../src/inputs/non-inputs.js";
import { globCwd, protection } from "../src/inputs/protection.js";
import { relativePosixPath, ROOT_PATH } from "../src/vitest/find-workspaces.js";
import type { CrawledLinks } from "../src/vitest/selection-facts.js";
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

/** The walk of the project's crawls, naming a real path relative to the consumer root as discovery names a module. */
function walk(
  root: string,
  patterns: Patterns,
  signal: AbortSignal = new AbortController().signal,
): Promise<CrawledLinks> {
  return crawledLinks(
    {
      projectName: "unit",
      vitestDirectory: globCwd(root),
      globbed: [patterns.include ?? [], patterns.includeSource ?? []],
      exclude: patterns.exclude ?? [],
      rootRelative: (path) =>
        testModuleFile(ROOT_PATH, relativePosixPath(root, path)),
    },
    signal,
  );
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
          projects: [projectFacts({ ...patterns, root, crawledLinks: links })],
        }),
      ],
      notRead: [],
    },
    root,
  );
  if (!value.applies) return value.reason;
  return Object.fromEntries(paths.map((path) => [path, value.protects(path)]));
}

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

  it("D2897: a crawl that follows more than 1000 directory links leaves the project's links not known, with the reason, never known without the links past the bound", async () => {
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
  });
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
