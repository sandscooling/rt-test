import { execFileSync } from "node:child_process";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedPaths,
  gitIn,
  trackedPaths,
} from "../../../scripts/lib/git.mjs";
import { authorOf, outcomeOf, writeFixtureGitConfig } from "../git-fixture.js";
import { git, initRepo, withTemp, writeIn } from "../orchestration/harness.js";
import { PROCESS_SCENARIO } from "../timeouts.js";

const NON_ASCII = "café.ts";
const COMMITTED = "committed";
const FAILING_HOOK = "#!/bin/sh\nexit 1\n";
const EXECUTABLE = 0o755;

// The developer's own GIT_* variables and system config would mask the hostile global config.
function envWithGlobalConfig(globalConfig: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );
  return { ...env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: "1" };
}

function commitFixtureUnder(dir: string, globalConfig: string): string {
  const configPath = join(dir, "global.gitconfig");
  writeIn(dir, "global.gitconfig", globalConfig);
  const repo = join(dir, "repo");
  const env = envWithGlobalConfig(configPath);
  const run = (...args: string[]) =>
    execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  writeIn(repo, "a.ts", "");
  run("init", "-q");
  writeFixtureGitConfig(repo);
  run("add", "-A");
  try {
    run("commit", "-q", "-m", "fixture");
    return COMMITTED;
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error);
  }
}

function withFailingHooksDir(dir: string): string {
  const hooks = join(dir, "hooks");
  writeIn(hooks, "pre-commit", FAILING_HOOK);
  chmodSync(join(hooks, "pre-commit"), EXECUTABLE);
  return hooks.replaceAll("\\", "/");
}

describe("reading paths from git", PROCESS_SCENARIO, () => {
  it("D953: an untracked non-ASCII path arrives exactly as named", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { "a.ts": "" });
      writeIn(dir, NON_ASCII, "");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual([NON_ASCII]);
  });

  it("D954: a staged change to a non-ASCII path arrives exactly as named", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { [NON_ASCII]: "one\n" });
      writeIn(dir, NON_ASCII, "two\n");
      git(dir, "add", "-A");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual([NON_ASCII]);
  });

  it("D980: an unstaged edit to a tracked file is in the changeset", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { "a.ts": "one\n" });
      writeIn(dir, "a.ts", "two\n");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual(["a.ts"]);
  });

  it("D955: before the first commit the staged and untracked paths are the changeset", () => {
    const paths = withTemp((dir) => {
      git(dir, "init", "-q");
      writeIn(dir, "staged.ts", "");
      git(dir, "add", "staged.ts");
      writeIn(dir, "untracked.ts", "");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual(["staged.ts", "untracked.ts"]);
  });

  it("D956: a tracked non-ASCII path is listed exactly as named", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { [NON_ASCII]: "" });
      return trackedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual([NON_ASCII]);
  });
});

describe("the fixture git config", PROCESS_SCENARIO, () => {
  it("D1253: a fixture commit runs no hook from the developer's global hooks path", () => {
    const outcome = withTemp((dir) =>
      commitFixtureUnder(
        dir,
        `[core]\n\thooksPath = ${withFailingHooksDir(dir)}\n`,
      ),
    );
    expect(outcome).toBe(COMMITTED);
  });

  it("D1254: a fixture commit is never signed when the developer's global config signs every commit", () => {
    const outcome = withTemp((dir) =>
      commitFixtureUnder(
        dir,
        "[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = rt-test-no-such-gpg\n",
      ),
    );
    expect(outcome).toBe(COMMITTED);
  });

  it("D1255: a fixture commit carries its own identity when the developer's global config forbids a guessed one", () => {
    const outcome = withTemp((dir) =>
      commitFixtureUnder(dir, "[user]\n\tuseConfigOnly = true\n"),
    );
    expect(outcome).toBe(COMMITTED);
  });

  it("D1272: the orchestration fixture repository commits under the shared fixture identity", () => {
    const author = withTemp((dir) =>
      outcomeOf(() => {
        initRepo(dir, { "a.ts": "" });
        return authorOf(dir);
      }),
    );
    expect(author).toBe("RT Test fixture <fixture@example.invalid>");
  });
});
