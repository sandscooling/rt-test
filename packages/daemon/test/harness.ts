import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, inject } from "vitest";
import { writeFixtureGitConfig } from "../../../test/scripts/git-fixture.js";
import { PROCESS_SCENARIO_TIMEOUT_MS } from "../../../test/scripts/timeouts.js";
import {
  HELD_DIRECTORIES_FILE,
  HELD_RECORD_SEPARATOR,
  removeDirectory,
} from "./temp-root.js";
import type {
  RecordedModule,
  RecordedTest,
  TestRunState,
} from "../src/vitest/run-states.js";
import {
  chosenConfigFile,
  type ConfirmedStart,
} from "../src/vitest/confirmed-start.js";
import { findVitestWorkspaces } from "../src/vitest/find-workspaces.js";
import {
  runWorkspace,
  type NotConfirmedRun,
  type WorkspaceRun,
} from "../src/vitest/run-workspace.js";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = join(REPO, "test/fixtures/daemon");

/** The repository's own installs: `vitest` is 5.x and `vitest-4` is the aliased 4.1.x. */
export type VitestInstall = "vitest" | "vitest-4";

const repoRequire = createRequire(join(REPO, "package.json"));

const CASE_PREFIX = "case-";

/** The run's temp parent, which the global teardown removes and where the run records what it starts. */
export function runTempRoot(): string {
  const root = inject("rtTestDaemonTempRoot");
  if (root === undefined) {
    throw new Error(
      "No global setup provided a temp root; run daemon tests through a Vitest project whose global setup is packages/daemon/test/temp-root.ts.",
    );
  }
  return root;
}

/**
 * Hands `body` a fresh directory and removes it after. A directory a live process still holds on Windows is recorded
 * for the global teardown, which warns when it is free by the end of the run and fails the run when it is not, so the
 * test's own assertion still decides the test. A failing body keeps its own error.
 */
export async function inTempDir<T>(
  body: (dir: string) => T | Promise<T>,
): Promise<T> {
  const root = runTempRoot();
  const test = expect.getState().currentTestName ?? "outside a test";
  const dir = realpathSync.native(mkdtempSync(join(root, CASE_PREFIX)));
  let result: T;
  try {
    result = await body(dir);
  } catch (error) {
    await removeTempDir(root, dir, test, false);
    throw error;
  }
  await removeTempDir(root, dir, test, true);
  return result;
}

async function removeTempDir(
  root: string,
  dir: string,
  test: string,
  rethrow: boolean,
): Promise<void> {
  let removed: boolean;
  try {
    removed = await removeDirectory(dir);
  } catch (error) {
    if (rethrow) throw error;
    removed = false;
  }
  if (removed) return;
  appendFileSync(
    join(root, HELD_DIRECTORIES_FILE),
    `${dir}${HELD_RECORD_SEPARATOR}${test}\n`,
  );
}

export function copyFixture(name: string, dir: string): void {
  cpSync(join(FIXTURES, name), dir, { recursive: true });
}

/** A main checkout of a git repository, as far as identity reads it: a directory holding `.git`. */
export function mainCheckout(dir: string): string {
  const main = join(dir, "main");
  mkdirSync(join(main, ".git"), { recursive: true });
  return main;
}

/** A worktree the way `git worktree add` lays it out, its `.git` file naming its git directory as `gitdir` spells it. */
export function linkedWorktree(
  main: string,
  name: string,
  gitdir: (worktreeGitDirectory: string) => string,
): string {
  const worktreeGitDirectory = join(main, ".git", "worktrees", name);
  mkdirSync(worktreeGitDirectory, { recursive: true });
  writeFileSync(join(worktreeGitDirectory, "commondir"), "../..\n");
  const root = join(dirname(main), name);
  mkdirSync(root);
  writeFileSync(
    join(root, ".git"),
    `gitdir: ${gitdir(worktreeGitDirectory)}\n`,
  );
  return root;
}

/** Makes `vitest` resolve from `dir` to one of the repository's installs, through a directory link. */
export function linkVitest(dir: string, install: VitestInstall): void {
  const target = realpathSync(
    dirname(repoRequire.resolve(`${install}/package.json`)),
  );
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(target, join(dir, "node_modules/vitest"), "junction");
}

/** A stand-in Vitest install that resolves `vitest/package.json` and `vitest/node` but holds no runner. */
export function fakeVitest(dir: string, version: string): void {
  writeFakeVitest(
    dir,
    JSON.stringify({
      name: "vitest",
      version,
      exports: { "./package.json": "./package.json", "./node": "./node.js" },
    }),
  );
}

/** A stand-in Vitest install whose manifest is exactly `manifest`, with no `vitest/node` unless the manifest exports it. */
export function writeFakeVitest(dir: string, manifest: string): void {
  const root = join(dir, "node_modules/vitest");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), manifest);
  writeFileSync(join(root, "node.js"), "export {};\n");
}

/** Copies the fixture into `real/` of a temp dir with the install linked, and hands `body` the root, or a link to it. */
export function inConsumerCopy<T>(
  fixture: string,
  install: VitestInstall,
  body: (root: string) => Promise<T>,
  throughLink = false,
): Promise<T> {
  return inTempDir(async (dir) => {
    const real = join(dir, "real");
    mkdirSync(real);
    copyFixture(fixture, real);
    linkVitest(real, install);
    const root = throughLink ? join(dir, "link") : real;
    if (throughLink) symlinkSync(real, root, "junction");
    return body(root);
  });
}

/** Polls until `ready` holds or `settled` resolves, whichever comes first. */
export async function waitUntil(
  ready: () => boolean,
  settled: Promise<unknown>,
): Promise<void> {
  let done = false;
  void settled.then(() => {
    done = true;
  });
  while (!ready() && !done) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** Runs `body` while `process.platform` reads as `platform`, restoring it after. */
export async function onPlatform<T>(
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

export const WAITING = "waiting";

/** Resolves with what `work` resolves to, or with `WAITING` if it has not ended within `boundMs`. */
export function within<T>(
  work: Promise<T>,
  boundMs: number,
): Promise<T | typeof WAITING> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<typeof WAITING>((resolve) => {
    timer = setTimeout(() => resolve(WAITING), boundMs);
  });
  return Promise.race([work, bound]).finally(() => clearTimeout(timer));
}

/**
 * Makes `root` a git repository under the fixture git settings, so no global hook, signing or identity of the
 * developer's reaches it, and returns a runner of git there, free of the caller's GIT_* variables.
 */
export function fixtureRepository(root: string): (...args: string[]) => string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith("GIT_"),
    ),
  );
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: "pipe",
      timeout: PROCESS_SCENARIO_TIMEOUT_MS,
      windowsHide: true,
    });
  git("init", "-q");
  writeFixtureGitConfig(root);
  return git;
}

export type Pool = "forks" | "threads";

/** Read by the configs of the fixtures that run on either pool. */
const POOL_ENV = "RT_FIXTURE_POOL";

/** Runs `body` with the fixture's pool chosen through the environment its config reads at load. */
export async function withPool<T>(
  pool: Pool,
  body: () => Promise<T>,
): Promise<T> {
  const saved = process.env[POOL_ENV];
  process.env[POOL_ENV] = pool;
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env[POOL_ENV];
    else process.env[POOL_ENV] = saved;
  }
}

/** A promise returned for a fixture's `configure`, `running:<test>` or `global-setup` holds that fixture until it settles. */
export type RunHook = (event: string) => Promise<void> | undefined;

/** The run-interrupt, run-unqueued and force-stop fixtures report their run events to this global. */
export const RUN_HOOK = Symbol.for("rt-test.fixture.run-hook");

export function runHooks(): Record<symbol, RunHook | undefined> {
  return globalThis as unknown as Record<symbol, RunHook | undefined>;
}

/** The start a user makes after confirming every workspace listed under `consumerRoot`, each with its config file. */
export function confirmEvery(consumerRoot: string): ConfirmedStart {
  return {
    consumerRoot,
    workspaces: findVitestWorkspaces(consumerRoot).workspaces.map(
      (workspace) => ({
        path: workspace.path,
        configFile: chosenConfigFile(workspace) ?? "",
      }),
    ),
  };
}

export type RunResult = WorkspaceRun | NotConfirmedRun | { thrown: string };

/** Runs the workspace through the config file it holds now, as a start confirmed just before the run would. */
export function settledRun(
  directory: string,
  signal: AbortSignal = new AbortController().signal,
  path = ".",
): Promise<RunResult> {
  const workspace = { path, directory };
  return runWorkspace(
    workspace,
    chosenConfigFile(workspace) ?? "",
    signal,
  ).catch((error: unknown) => ({ thrown: String(error) }));
}

export function ranRun(
  run: RunResult,
): Extract<WorkspaceRun, { status: "ran" }> | undefined {
  return "status" in run && run.status === "ran" ? run : undefined;
}

export function finished(
  outcome: string,
  errors: readonly unknown[] = [],
): unknown {
  return { execution: "finished", outcome, errors };
}

export const INTERRUPTED = { execution: "interrupted" };

export function runState(test: RecordedTest): TestRunState {
  return test.execution === "finished"
    ? { execution: test.execution, outcome: test.outcome, errors: test.errors }
    : { execution: test.execution };
}

/** A ran module as its tests' states by name; any other module as its state. */
function moduleSummary(module: RecordedModule): unknown {
  return module.state === "ran"
    ? Object.fromEntries(
        module.tests.map((test) => [
          test.identity.namePath.at(-1),
          runState(test),
        ]),
      )
    : module.state;
}

export function runSummary(run: RunResult): unknown {
  const recorded = ranRun(run);
  if (recorded === undefined) return run;
  return {
    execution: recorded.execution,
    modules: Object.fromEntries(
      recorded.modules.map((module) => [
        module.modulePath,
        moduleSummary(module),
      ]),
    ),
  };
}

export function settle<T>(run: () => T): T | { thrown: string } {
  try {
    return run();
  } catch (error) {
    return { thrown: String(error) };
  }
}
