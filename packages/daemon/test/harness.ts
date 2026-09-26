import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RecordedModule,
  RecordedTest,
  TestRunState,
} from "../src/vitest/run-states.js";
import {
  runWorkspace,
  type WorkspaceRun,
} from "../src/vitest/run-workspace.js";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = join(REPO, "test/fixtures/daemon");

/** The repository's own installs: `vitest` is 5.x and `vitest-4` is the aliased 4.1.x. */
export type VitestInstall = "vitest" | "vitest-4";

const repoRequire = createRequire(join(REPO, "package.json"));

export async function inTempDir<T>(
  body: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = realpathSync.native(
    mkdtempSync(join(tmpdir(), "rt-test-daemon-")),
  );
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function copyFixture(name: string, dir: string): void {
  cpSync(join(FIXTURES, name), dir, { recursive: true });
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

export type RunResult = WorkspaceRun | { thrown: string };

export function settledRun(
  directory: string,
  signal: AbortSignal = new AbortController().signal,
  path = ".",
): Promise<RunResult> {
  return runWorkspace({ path, directory }, signal).catch((error: unknown) => ({
    thrown: String(error),
  }));
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
