import type {
  CliOptions,
  Reporter,
  TestProject,
  TestSpecification,
  Vitest,
} from "vitest/node";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { confirmedConfig } from "./confirmed-start.js";
import { errorText } from "./error-text.js";
import type { VitestWorkspace } from "./find-workspaces.js";
import {
  importVitestNode,
  resolveWorkspaceVitest,
  type ResolvedVitest,
} from "./load-vitest.js";
import {
  moduleLocator,
  moduleReport,
  type ModuleLocator,
  type ModuleReport,
} from "./module-tests.js";

export interface UnsupportedProject {
  readonly projectName: string;
  readonly reason: string;
}

export type UnsupportedVitest = Extract<ResolvedVitest, { supported: false }>;

/** A loaded workspace's Vitest and the specifications its step may collect or run. */
export interface WorkspaceSession {
  readonly instance: Vitest;
  readonly locate: ModuleLocator;
  /** Every specification Vitest resolved, less those of browser-mode projects and typecheck modules. */
  readonly specifications: TestSpecification[];
  readonly typecheckModules: readonly ModuleReport[];
  readonly unsupportedProjects: readonly UnsupportedProject[];
}

type SessionResult<T> =
  | {
      readonly status: "loaded";
      readonly vitestVersion: string;
      readonly value: T;
      readonly closeError?: string;
    }
  | { readonly status: "unsupported"; readonly vitest: UnsupportedVitest }
  /** The workspace's config file is no longer the one confirmed at start, so nothing was loaded. */
  | { readonly status: "not-confirmed" }
  | {
      readonly status: "failed";
      readonly vitestVersion: string;
      readonly error: string;
      readonly closeError?: string;
    };

const BROWSER_MODE_REASON = "browser mode is not supported";
/** The Vitest CLI sets this before loading a config and `createVitest` does not, so collection would see Vite's `development`. */
const TEST_NODE_ENV = "test";
const TYPECHECK_POOL = "typescript";

/** Each forced over the workspace's root config. On 4.1 a project config that sets the module cache itself keeps it. */
const COVERAGE_OFF = { enabled: false };
const SNAPSHOT_UPDATE_NONE = "none";
const RESULTS_CACHE_OFF = false;
const MODULE_CACHE_OFF = false;
/** From this major Vitest reads the module cache flag at the top level and deprecates the `experimental` spelling 4.1 reads. */
const TOP_LEVEL_MODULE_CACHE_MAJOR = 5;
/** Built beside this module, so it shares its extension: `.ts` run from source, `.js` from `dist`. */
const SNAPSHOT_GUARD_FILE = fileURLToPath(
  new URL(
    `./snapshot-guard${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);

let sessionQueue: Promise<unknown> = Promise.resolve();

/** Restoring the host env and exit code after each session is only sound while one job holds Vitest at a time. */
export function queueSessionJob<T>(job: () => Promise<T>): Promise<T> {
  const queued = sessionQueue.then(job);
  sessionQueue = queued.catch(() => undefined);
  return queued;
}

/** Loads the workspace's Vitest config and imports its test files: call only for a started, trusted project. */
export async function inWorkspaceSession<T>(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  reporters: readonly Reporter[],
  step: (session: WorkspaceSession) => Promise<T>,
): Promise<SessionResult<T>> {
  const config = confirmedConfig(workspace, confirmedConfigFile);
  if (config === undefined) return { status: "not-confirmed" };
  const vitest = resolveWorkspaceVitest(workspace.directory);
  if (!vitest.supported) return { status: "unsupported", vitest };
  const restoreHost = captureHostState();
  process.env["NODE_ENV"] ??= TEST_NODE_ENV;
  let instance: Vitest | undefined;
  let result: SessionResult<T>;
  try {
    process.chdir(workspace.directory);
    const { createVitest } = await importVitestNode(vitest);
    instance = await createVitest("test", {
      root: workspace.directory,
      watch: false,
      reporters: [...reporters],
      api: false,
      ui: false,
      ...noWriteOptions(vitest.major),
      config: config.file,
      configLoader: config.loader,
    });
    const session = await openSession(instance, workspace);
    result = {
      status: "loaded",
      vitestVersion: vitest.version,
      value: await step(session),
    };
  } catch (error) {
    result = {
      status: "failed",
      vitestVersion: vitest.version,
      error: errorText(error),
    };
  }
  const closeError = await closeInstance(instance);
  restoreHost();
  return closeError === undefined ? result : { ...result, closeError };
}

function noWriteOptions(vitestMajor: number): CliOptions {
  return {
    coverage: COVERAGE_OFF,
    update: SNAPSHOT_UPDATE_NONE,
    cache: RESULTS_CACHE_OFF,
    ...(vitestMajor >= TOP_LEVEL_MODULE_CACHE_MAJOR
      ? { fsModuleCache: MODULE_CACHE_OFF }
      : {
          experimental: {
            fsModuleCache: MODULE_CACHE_OFF,
          } as NonNullable<CliOptions["experimental"]>,
        }),
  };
}

async function openSession(
  instance: Vitest,
  workspace: VitestWorkspace,
): Promise<WorkspaceSession> {
  const locate = moduleLocator(workspace);
  guardSnapshots(instance);
  const resolved = (await instance.getRelevantTestSpecifications()).filter(
    (specification: TestSpecification) =>
      !usesBrowserMode(specification.project),
  );
  return {
    instance,
    locate,
    specifications: resolved.filter(
      (specification) => !isTypecheck(specification),
    ),
    typecheckModules: resolved
      .filter(isTypecheck)
      .map((specification) =>
        moduleReport(
          locate(specification.project.name, specification.moduleId),
        ),
      ),
    unsupportedProjects: instance.projects
      .filter(usesBrowserMode)
      .map((project) => ({
        projectName: project.name,
        reason: BROWSER_MODE_REASON,
      })),
  };
}

/** Setup files are per project and no option overrides them, so each resolved project gets the guard first. */
function guardSnapshots(instance: Vitest): void {
  for (const project of instance.projects) {
    project.config.setupFiles.unshift(SNAPSHOT_GUARD_FILE);
  }
}

/**
 * Vitest writes a workspace's env and defines into `process.env` and sets `process.exitCode`, and the session runs
 * in the workspace's directory, as the workspace's own `vitest` does.
 */
function captureHostState(): () => void {
  const exitCode = process.exitCode;
  const env = { ...process.env };
  const cwd = process.cwd();
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(env, key)) delete process.env[key];
    }
    Object.assign(process.env, env);
    process.exitCode = exitCode;
    process.chdir(cwd);
  };
}

async function closeInstance(
  instance: Vitest | undefined,
): Promise<string | undefined> {
  try {
    await instance?.close();
    return undefined;
  } catch (error) {
    return errorText(error);
  }
}

function isTypecheck(specification: TestSpecification): boolean {
  return specification.pool === TYPECHECK_POOL;
}

function usesBrowserMode(project: TestProject): boolean {
  return project.config.browser.enabled;
}
