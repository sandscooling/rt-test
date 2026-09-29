import { describe, expect, it, vi } from "vitest";
import { patternBase, protection } from "../src/inputs/protection.js";
import type { TestDiscovery } from "../src/vitest/discover-tests.js";
import type { TestFilePatterns } from "../src/vitest/selection-facts.js";
import { onPlatform } from "./on-platform.js";

/**
 * Windows' path rules on either host, so drive-letter spellings are absolute wherever this runs. The daemon harness
 * resolves the repository's paths as it loads, so this file builds its discovery itself.
 */
vi.mock("node:path", async (importActual) => {
  const actual = await importActual<typeof import("node:path")>();
  return { ...actual.win32, default: actual.win32 };
});

/** The consumer root's real path, which a `subst` drive `S:` names. */
const REAL_ROOT = "C:\\consumer";
/** The root as Vitest's glob spells it once the project was started from `S:\`. */
const STARTED = "S:/";
/** An include pattern that writes the same drive in lower case, so the glob's crawl reaches it only from that spelling. */
const LOWER_DRIVE_INCLUDE = "s:/src/**/*.test.ts";

/** The root workspace's discovery, listing no module, whose one project matches by `include` from the root. */
function discoveryIncluding(include: readonly string[]): TestDiscovery {
  const testFilePatterns: TestFilePatterns = {
    directory: ".",
    vitestDirectory: STARTED,
    patternBases: [{ spelled: "s:/src", directory: "src" }],
    crawledLinks: { complete: true, links: [] },
    include,
    exclude: [],
    includeSource: [],
  };
  return {
    workspaces: [
      {
        status: "discovered",
        workspace: { path: ".", directory: REAL_ROOT },
        vitestVersion: "5.0.1",
        tests: [],
        failedModules: [],
        typecheckModules: [],
        unsupportedProjects: [],
        unhandledErrors: [],
        selectionFacts: {
          reported: true,
          projects: [
            {
              projectName: "unit",
              viteRoot: ".",
              setupFiles: [],
              globalSetupFiles: [],
              aliases: [],
              testFilePatterns,
            },
          ],
        },
      },
    ],
    notRead: [],
  };
}

/** Whether each root-relative path is protected, with process.platform read as win32. */
function protectsOnWindows(
  include: readonly string[],
  paths: readonly string[],
): Promise<Record<string, boolean> | string> {
  return onPlatform("win32", async () => {
    const value = protection(discoveryIncluding(include), REAL_ROOT);
    if (!value.applies) return value.reason;
    return Object.fromEntries(
      paths.map((path) => [path, value.protects(path)]),
    );
  });
}

describe("a spelling Vitest's crawl does not reach", () => {
  it("D2810: a file a pattern spells through another drive spelling is protected only while the glob's crawl starts at that spelling", async () => {
    const alone = await protectsOnWindows(
      [LOWER_DRIVE_INCLUDE],
      ["src/a.test.ts"],
    );
    const beside = await protectsOnWindows(
      [LOWER_DRIVE_INCLUDE, "lib/**/*.test.ts"],
      ["src/a.test.ts", "lib/b.test.ts"],
    );
    expect({ alone, beside }).toStrictEqual({
      alone: { "src/a.test.ts": true },
      beside: { "src/a.test.ts": false, "lib/b.test.ts": true },
    });
  });
});

describe("a pattern whose directories are a drive's root", () => {
  it("D2833: the base of a pattern whose first segment is a drive, such as S:/**/*.test.ts, is that drive's root, where Vitest's glob starts its crawl", () => {
    expect(patternBase("S:/**/*.test.ts", "C:/consumer")).toBe("S:/");
  });
});

describe("a pattern directory on a network share", () => {
  it("D2895: with process.platform read as win32, the base of a pattern below a UNC pattern directory keeps the // that names the server, where the walk for crawled links starts", async () => {
    const base = await onPlatform("win32", async () =>
      patternBase("src/**/*.test.ts", "//localhost/C$/consumer"),
    );
    expect(base).toBe("//localhost/C$/consumer/src");
  });
});
