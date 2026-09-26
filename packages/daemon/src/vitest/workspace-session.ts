import type {
  Reporter,
  TestProject,
  TestSpecification,
  Vitest,
} from "vitest/node";
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
  reporters: readonly Reporter[],
  step: (session: WorkspaceSession) => Promise<T>,
): Promise<SessionResult<T>> {
  const vitest = resolveWorkspaceVitest(workspace.directory);
  if (!vitest.supported) return { status: "unsupported", vitest };
  const restoreHost = captureHostState();
  process.env["NODE_ENV"] ??= TEST_NODE_ENV;
  let instance: Vitest | undefined;
  let result: SessionResult<T>;
  try {
    const { createVitest } = await importVitestNode(vitest);
    instance = await createVitest("test", {
      root: workspace.directory,
      watch: false,
      reporters: [...reporters],
      api: false,
      ui: false,
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

async function openSession(
  instance: Vitest,
  workspace: VitestWorkspace,
): Promise<WorkspaceSession> {
  const locate = moduleLocator(workspace);
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

/** Vitest writes a workspace's env and defines into `process.env` and sets `process.exitCode`. */
function captureHostState(): () => void {
  const exitCode = process.exitCode;
  const env = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(env, key)) delete process.env[key];
    }
    Object.assign(process.env, env);
    process.exitCode = exitCode;
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
