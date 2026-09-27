import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  type Dirent,
  type PathLike,
} from "node:fs";
import { basename, delimiter, dirname, join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { clearGitEnvironment } from "../../../../test/scripts/git-environment.js";
import { writeFixtureGitConfig } from "../../../../test/scripts/git-fixture.js";
import {
  PROCESS_SCENARIO,
  PROCESS_SCENARIO_TIMEOUT_MS,
} from "../../../../test/scripts/timeouts.js";
import {
  appEdges,
  appScan,
  appWidenings,
  inspectTree,
  appTree,
  scanApp,
  widenedAt,
} from "./harness.js";

/**
 * A directory named `pad-<n>` lists `<n>` entries in all, the real ones padded with plain files, and a file, directory
 * or link named for its failure cannot be read, listed or resolved, so the walk's bounds and read failures are reached
 * without writing 50,000 files or depending on the host's permission model.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const refused = (path: PathLike, operation: string): Error =>
    Object.assign(
      new Error(`EACCES: permission denied, ${operation} '${String(path)}'`),
      { code: "EACCES" },
    );
  const padded = (
    count: number,
  ): Pick<Dirent, "name" | "isFile" | "isDirectory" | "isSymbolicLink">[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `padding-${index}.txt`,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    }));
  function readdirSync(path: PathLike, options?: unknown): unknown {
    const name = basename(String(path));
    if (name === "unlistable") throw refused(path, "scandir");
    const entries = actual.readdirSync(
      path,
      options as Parameters<typeof actual.readdirSync>[1],
    );
    const total = /^pad-(\d+)$/.exec(name)?.[1];
    return total === undefined
      ? entries
      : [...entries, ...padded(Number(total) - entries.length)];
  }
  function readFileSync(path: PathLike, options?: unknown): unknown {
    if (basename(String(path)) === "unreadable.ts") throw refused(path, "open");
    return actual.readFileSync(
      path,
      options as Parameters<typeof actual.readFileSync>[1],
    );
  }
  function readlinkSync(path: PathLike, options?: unknown): unknown {
    const name = basename(String(path));
    if (name === "unreadable-link") throw refused(path, "readlink");
    const target = actual.readlinkSync(
      path,
      options as Parameters<typeof actual.readlinkSync>[1],
    );
    return name === "relative-link"
      ? relative(dirname(String(path)), String(target))
      : target;
  }
  return { ...actual, readdirSync, readFileSync, readlinkSync };
});

/** Counts every `Visitor` the parser is asked to build, since it keeps each one for the life of the process. */
const visitors = vi.hoisted(() => ({ built: 0 }));
vi.mock("oxc-parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("oxc-parser")>();
  class CountedVisitor extends actual.Visitor {
    constructor(...args: ConstructorParameters<typeof actual.Visitor>) {
      super(...args);
      visitors.built += 1;
    }
  }
  return { ...actual, Visitor: CountedVisitor };
});

const FAILING_HOOK = "#!/bin/sh\nexit 1\n";
const EXECUTABLE = 0o755;
const IGNORED_GEN = "packages/app/gen/\n";
const FIXTURE_AUTHOR = "RT Test fixture <fixture@example.invalid>";
const FSMONITOR_MARKER = "fsmonitor-ran";

/** Git's environment with no inherited `GIT_*`, reading `globalConfig` as the developer's global config. */
function gitEnvironment(globalConfig: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  clearGitEnvironment(env);
  return { ...env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
}

/** Runs git in `cwd` under a global config with a failing hook, signing and no guessed identity. */
function gitUnderHostileConfig(cwd: string): (...args: string[]) => string {
  const outside = dirname(cwd);
  const hooks = join(outside, "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), FAILING_HOOK);
  chmodSync(join(hooks, "pre-commit"), EXECUTABLE);
  const globalConfig = join(outside, "global.gitconfig");
  writeFileSync(
    globalConfig,
    [
      `[core]\n\thooksPath = ${hooks.replaceAll("\\", "/")}`,
      "[commit]\n\tgpgsign = true",
      "[gpg]\n\tprogram = rt-test-no-such-gpg",
      "[user]\n\tuseConfigOnly = true\n",
    ].join("\n"),
  );
  const env = gitEnvironment(globalConfig);
  return (...args) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: "pipe",
      timeout: PROCESS_SCENARIO_TIMEOUT_MS,
      windowsHide: true,
    });
}

/** Commits the written tree as a fixture repository with `ignore` as its `.gitignore`, force-adding `tracked`. */
function commitRepository(
  root: string,
  ignore: string,
  tracked: readonly string[] = [],
): (...args: string[]) => string {
  const git = gitUnderHostileConfig(root);
  writeFileSync(join(root, ".gitignore"), ignore);
  git("init", "-q");
  writeFixtureGitConfig(root);
  git("add", "-A");
  if (tracked.length > 0) git("add", "-f", ...tracked);
  git("commit", "-q", "-m", "fixture");
  return git;
}

/** A tracked file inside an ignored directory, beside an untracked ignored one. */
const TRACKED_IN_IGNORED = {
  "packages/app/gen/keep.ts": 'import "@x/b";\n',
  "packages/app/gen/junk.ts": "",
};

describe("paths the scan cannot read widen", () => {
  it("D1642: a source file that cannot be read widens, naming the file", async () => {
    expect(
      appWidenings(
        await scanApp({ "packages/app/src/unreadable.ts": 'import "@x/b";\n' }),
      ),
    ).toEqual(widenedAt("unreadable-source", "packages/app/src/unreadable.ts"));
  });

  it("D1643: a directory that cannot be listed widens, naming the directory", async () => {
    expect(
      appWidenings(
        await scanApp({ "packages/app/unlistable/x.ts": 'import "@x/b";\n' }),
      ),
    ).toEqual(widenedAt("unreadable-source", "packages/app/unlistable"));
  });

  it("D1644: a link that can be neither resolved nor read widens, naming the link", async () => {
    expect(
      appWidenings(
        await scanApp(
          { "packages/c/gone/keep.txt": "" },
          {
            links: { "packages/app/unreadable-link": "packages/c/gone" },
            prepare: (root) => {
              rmSync(join(root, "packages/c/gone"), { recursive: true });
            },
          },
        ),
      ),
    ).toEqual(widenedAt("unreadable-source", "packages/app/unreadable-link"));
  });
});

// The app's package.json and the pad directory itself are the other two entries its walk visits.
describe("the walk's entry limit", () => {
  it("D1645: a workspace holding 50,001 files and directories widens, naming the workspace", async () => {
    expect(
      appWidenings(await scanApp({ "packages/app/pad-49999/x.txt": "" })),
    ).toEqual(widenedAt("walk-bound-reached", "packages/app"));
  });

  it("D1646: a workspace holding exactly 50,000 files and directories is walked whole", async () => {
    expect(
      appWidenings(await scanApp({ "packages/app/pad-49998/x.txt": "" })),
    ).toEqual([]);
  });
});

describe("gitignored paths inside a git repository", PROCESS_SCENARIO, () => {
  it("D1653: the fixture repository commits under the shared identity despite a failing hook, signing and a config-only identity", async () => {
    const author = await inspectTree(
      {
        ...appTree({ change: "" }),
        prepare: (root) => {
          commitRepository(root, IGNORED_GEN);
        },
      },
      (root) =>
        gitUnderHostileConfig(root)("log", "-1", "--format=%an <%ae>").trim(),
    );
    expect(author).toBe(FIXTURE_AUTHOR);
  });

  it("D1648: a gitignored directory is not scanned, so its unparsable file and its import add neither a widening nor an edge", async () => {
    expect(
      appScan(
        await scanApp(
          {
            "packages/app/gen/bad.ts": 'import { from "x";\n',
            "packages/app/gen/dep.ts": 'import "@x/b";\n',
          },
          { prepare: (root) => void commitRepository(root, IGNORED_GEN) },
        ),
      ),
    ).toEqual({ edges: [], widenings: [] });
  });

  it("D1647: a gitignored directory does not count toward the walk's entry limit", async () => {
    expect(
      appScan(
        await scanApp(
          {
            "packages/app/pad-49998/x.txt": "",
            "packages/app/gen/dep.ts": "",
          },
          { prepare: (root) => void commitRepository(root, IGNORED_GEN) },
        ),
      ),
    ).toEqual({ edges: [], widenings: [] });
  });

  it("D1649: a tracked file inside a gitignored directory is still scanned", async () => {
    expect(
      appEdges(
        await scanApp(TRACKED_IN_IGNORED, {
          prepare: (root) =>
            void commitRepository(root, IGNORED_GEN, [
              "packages/app/gen/keep.ts",
            ]),
        }),
      ),
    ).toEqual(["bare-import packages/b"]);
  });

  it("D1650: an inherited GIT_DIR naming another repository does not change what the walk skips", async () => {
    let information;
    try {
      information = await scanApp(TRACKED_IN_IGNORED, {
        prepare: (root) => {
          commitRepository(root, IGNORED_GEN, ["packages/app/gen/keep.ts"]);
          const other = join(dirname(root), "other");
          mkdirSync(other);
          gitUnderHostileConfig(other)("init", "-q");
          process.env.GIT_DIR = join(other, ".git");
        },
      });
    } finally {
      delete process.env.GIT_DIR;
    }
    expect(appEdges(information)).toEqual(["bare-import packages/b"]);
  });

  it("D1651: a core.fsmonitor program the repository configures never runs", async () => {
    const ran = await inspectTree(
      {
        ...appTree({ change: "" }),
        prepare: (root) => {
          const git = commitRepository(root, IGNORED_GEN);
          const program = join(dirname(root), "fsmonitor.sh");
          const marker = join(dirname(root), FSMONITOR_MARKER);
          writeFileSync(
            program,
            `#!/bin/sh\necho ran > "${marker.replaceAll("\\", "/")}"\n`,
          );
          chmodSync(program, EXECUTABLE);
          git("config", "core.fsmonitor", `"${program.replaceAll("\\", "/")}"`);
        },
      },
      (root) => existsSync(join(dirname(root), FSMONITOR_MARKER)),
    );
    expect(ran).toBe(false);
  });

  it("D1652: outside a git repository a .gitignore is not honored, so every path is walked", async () => {
    expect(
      appEdges(
        await scanApp({
          ".gitignore": IGNORED_GEN,
          "packages/app/gen/dep.ts": 'import "@x/b";\n',
        }),
      ),
    ).toEqual(["bare-import packages/b"]);
  });

  it("D1675: an executable named git at the consumer root never runs in place of git", async () => {
    const path = process.env.PATH;
    let information;
    try {
      information = await scanApp(
        { "packages/app/gen/dep.ts": 'import "@x/b";\n' },
        {
          prepare: (root) => {
            commitRepository(root, IGNORED_GEN);
            const planted = join(
              root,
              process.platform === "win32" ? "git.exe" : "git",
            );
            copyFileSync(process.execPath, planted);
            chmodSync(planted, EXECUTABLE);
            // Linux searches a working directory only through a relative PATH entry; Windows searches it first.
            process.env.PATH = `.${delimiter}${path ?? ""}`;
          },
        },
      );
    } finally {
      process.env.PATH = path;
    }
    expect(appScan(information)).toEqual({ edges: [], widenings: [] });
  });
});

describe("links and labels the scan reports", () => {
  it("D1669: a dangling link's relative text resolves against the link's directory", async () => {
    expect(
      appScan(
        await scanApp(
          { "packages/c/gone/keep.txt": "" },
          {
            links: { "packages/app/relative-link": "packages/c/gone" },
            prepare: (root) => {
              rmSync(join(root, "packages/c/gone"), { recursive: true });
            },
          },
        ),
      ),
    ).toEqual({ edges: ["link packages/c"], widenings: [] });
  });

  it("D1674: a walk-bound widening of the consumer root names the root as .", async () => {
    const information = await scanApp({ "pad-50000/x.txt": "" });
    expect(
      "uncertainties" in information
        ? information.uncertainties
            .filter(({ dependent }) => dependent === ".")
            .map(({ kind, cause }) => ({ kind, cause }))
        : information,
    ).toEqual([
      {
        kind: "walk-bound-reached",
        cause: expect.stringMatching(/^\. holds more than/),
      },
    ]);
  });
});

describe("the parser's visitors", () => {
  it("D1676: a scan builds no Visitor per file, since the parser keeps each one it builds", async () => {
    const before = visitors.built;
    const information = await scanApp({
      "packages/app/src/a.ts": 'import "@x/b";\n',
      "packages/app/src/b.ts": 'import "@x/c";\n',
      "packages/app/src/c.ts": "export {};\n",
    });
    expect({
      built: visitors.built - before,
      edges: appEdges(information),
    }).toEqual({
      built: 0,
      edges: ["bare-import packages/b", "bare-import packages/c"],
    });
  });
});
