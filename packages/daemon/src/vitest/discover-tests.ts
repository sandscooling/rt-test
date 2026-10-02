import type { IdentifiedTest } from "@rt-test/core";
import { join, resolve } from "node:path";
import type { TestCase, TestModule, TestSpecification } from "vitest/node";
import { confirmedEntry, type ConfirmedStart } from "./confirmed-start.js";
import { errorText } from "./error-text.js";
import {
  findVitestWorkspaces,
  liesInside,
  type NotCoveredWorkspace,
  type UnreadWorkspaceSource,
  type VitestWorkspace,
} from "./find-workspaces.js";
import {
  moduleReport,
  specificationsWithoutModule,
  wasCollected,
  type FailedModule,
  type ModuleReport,
} from "./module-tests.js";
import { RunInterruption } from "./run-interruption.js";
import { selectionFacts, type SelectionFacts } from "./selection-facts.js";
import {
  collectedTests,
  moduleListKey,
  type ModuleTests,
  type WorkspaceLists,
} from "./test-lists.js";
import {
  inWorkspaceSession,
  queueSessionJob,
  type UnsupportedProject,
  type UnsupportedVitest,
  type WorkspaceSession,
} from "./workspace-session.js";

export interface DiscoveredTest extends IdentifiedTest {
  readonly mode: TestCase["options"]["mode"];
}

export type WorkspaceDiscovery =
  | {
      readonly status: "discovered";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly tests: readonly DiscoveredTest[];
      readonly failedModules: readonly FailedModule[];
      readonly typecheckModules: readonly ModuleReport[];
      readonly unsupportedProjects: readonly UnsupportedProject[];
      readonly unhandledErrors: readonly string[];
      readonly selectionFacts: SelectionFacts;
      readonly closeError?: string;
    }
  | {
      readonly status: "unsupported";
      readonly workspace: VitestWorkspace;
      readonly vitest: UnsupportedVitest;
    }
  | {
      readonly status: "failed";
      readonly workspace: VitestWorkspace;
      readonly vitestVersion: string;
      readonly error: string;
      readonly closeError?: string;
    }
  | {
      /** Not in the confirmed start, or its config file is not the one confirmed, so nothing was loaded. */
      readonly status: "not-confirmed";
      readonly workspace: VitestWorkspace;
      readonly reason: string;
    };

export interface TestDiscovery {
  readonly workspaces: readonly WorkspaceDiscovery[];
  readonly notRead: readonly UnreadWorkspaceSource[];
  /** Absent on a discovery stored before the store kept it, which reads as never reported. */
  readonly notCovered?: readonly NotCoveredWorkspace[];
}

interface CollectedWorkspace {
  readonly tests: DiscoveredTest[];
  readonly failedModules: FailedModule[];
  readonly typecheckModules: readonly ModuleReport[];
  readonly unsupportedProjects: readonly UnsupportedProject[];
  readonly unhandledErrors: readonly string[];
  readonly selectionFacts: SelectionFacts;
}

/** Of the test modules a workspace's discovery listed, how many it collected and how many kept a carried list. */
interface ModuleCounts {
  readonly listed: number;
  readonly collected: number;
  readonly carried: number;
}

/** How the discovery of one workspace the start confirmed went, and how long it took. */
export interface WorkspaceCollection extends ModuleCounts {
  readonly workspacePath: string;
  readonly status: WorkspaceDiscovery["status"];
  readonly wallMs: number;
}

/** A discovery, with how each confirmed workspace's test modules got their lists. */
export interface Rediscovery {
  readonly discovery: TestDiscovery;
  readonly collection: readonly WorkspaceCollection[];
}

const UNCOLLECTED_MODULE_ERROR =
  "Vitest returned no collection result for this module; see the workspace's unhandled errors";
export const NOT_CONFIRMED_REASON = "not confirmed at start";
const NO_MODULES: ModuleCounts = { listed: 0, collected: 0, carried: 0 };

/**
 * Loads the Vitest config and imports the test files of each workspace the start confirmed, and of no other: call
 * only for a started, trusted project. Once the signal aborts it loads no further workspace and rejects with the
 * signal's reason, after the Vitest instance it opened has closed and the host is restored.
 */
export function discoverTests(
  start: ConfirmedStart,
  signal: AbortSignal,
): Promise<TestDiscovery> {
  return rediscoverTests(start, [], signal).then(({ discovery }) => discovery);
}

/**
 * Discovers as `discoverTests` does, importing only the test files `carried` holds no list for: a module it lists
 * for the module's workspace keeps that list, and one no longer found leaves the discovery. The caller vouches that
 * each carried list is still the module's.
 */
export function rediscoverTests(
  start: ConfirmedStart,
  carried: readonly WorkspaceLists[],
  signal: AbortSignal,
): Promise<Rediscovery> {
  return queueSessionJob(() => discoverAll(start, carried, signal));
}

async function discoverAll(
  start: ConfirmedStart,
  carried: readonly WorkspaceLists[],
  signal: AbortSignal,
): Promise<Rediscovery> {
  signal.throwIfAborted();
  const { workspaces, notRead, notCovered } = findVitestWorkspaces(
    start.consumerRoot,
  );
  const discoveries: WorkspaceDiscovery[] = [];
  const collection: WorkspaceCollection[] = [];
  for (const workspace of workspaces) {
    const confirmed = confirmedEntry(start, workspace);
    if (confirmed === undefined) {
      discoveries.push(notConfirmed(workspace));
    } else {
      const began = performance.now();
      const { entry, counts } = await discoverWorkspace(
        workspace,
        confirmed.configFile,
        carriedModules(carried, workspace),
        signal,
      );
      discoveries.push(entry);
      collection.push({
        workspacePath: workspace.path,
        status: entry.status,
        ...counts,
        wallMs: Math.round(performance.now() - began),
      });
    }
    signal.throwIfAborted();
  }
  return {
    discovery: {
      workspaces: discoveries,
      notRead,
      notCovered: withoutDiscoveredModules(
        notCovered,
        start.consumerRoot,
        discoveries,
      ),
    },
    collection,
  };
}

function carriedModules(
  carried: readonly WorkspaceLists[],
  workspace: VitestWorkspace,
): readonly ModuleTests[] {
  return carried
    .filter((lists) => lists.workspacePath === workspace.path)
    .flatMap((lists) => lists.modules);
}

/** A test module discovered inside a candidate means another workspace's config runs its tests, so it is covered. */
function withoutDiscoveredModules(
  candidates: readonly NotCoveredWorkspace[],
  consumerRoot: string,
  discoveries: readonly WorkspaceDiscovery[],
): NotCoveredWorkspace[] {
  const moduleFiles = discoveries.flatMap(discoveredModuleFiles);
  return candidates.filter((candidate) => {
    const directory = join(consumerRoot, candidate.path);
    return !moduleFiles.some((file) => liesInside(directory, file));
  });
}

function discoveredModuleFiles(entry: WorkspaceDiscovery): string[] {
  if (entry.status !== "discovered") return [];
  return [
    ...entry.tests.map((test) => test.identity.modulePath),
    ...entry.failedModules.map((module) => module.modulePath),
  ].map((modulePath) => resolve(entry.workspace.directory, modulePath));
}

function notConfirmed(workspace: VitestWorkspace): WorkspaceDiscovery {
  return { status: "not-confirmed", workspace, reason: NOT_CONFIRMED_REASON };
}

async function discoverWorkspace(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
  carried: readonly ModuleTests[],
  signal: AbortSignal,
): Promise<{ entry: WorkspaceDiscovery; counts: ModuleCounts }> {
  const result = await inWorkspaceSession(
    workspace,
    confirmedConfigFile,
    [],
    (session) =>
      collectWorkspace(session, carried, new RunInterruption(signal)),
  );
  if (result.status === "not-confirmed") {
    return { entry: notConfirmed(workspace), counts: NO_MODULES };
  }
  if (result.status !== "loaded") {
    return { entry: { ...result, workspace }, counts: NO_MODULES };
  }
  const { value, ...loaded } = result;
  const { counts, ...collected } = value;
  return {
    entry: { ...loaded, status: "discovered", workspace, ...collected },
    counts,
  };
}

/** The specifications a carried list answers for, each with that list, and those left to collect. */
function carriedSpecifications(
  session: WorkspaceSession,
  carried: readonly ModuleTests[],
): { kept: ModuleTests[]; uncollected: TestSpecification[] } {
  const lists = new Map(carried.map((list) => [moduleListKey(list), list]));
  const kept: ModuleTests[] = [];
  const uncollected: TestSpecification[] = [];
  for (const specification of session.specifications) {
    const key = moduleListKey(
      moduleReport(
        session.locate(specification.project.name, specification.moduleId),
      ),
    );
    const list = lists.get(key);
    if (list === undefined) {
      uncollected.push(specification);
    } else {
      kept.push(list);
      // A second specification that names the same module, as through another spelling, is collected.
      lists.delete(key);
    }
  }
  return { kept, uncollected };
}

/**
 * An abort before collection starts, or during the walk for each project's crawled links after it, fails the step,
 * and the caller rejects once the session has closed.
 */
async function collectWorkspace(
  session: WorkspaceSession,
  carried: readonly ModuleTests[],
  interruption: RunInterruption,
): Promise<CollectedWorkspace & { readonly counts: ModuleCounts }> {
  const { instance, specifications } = session;
  interruption.signal.throwIfAborted();
  const { kept, uncollected } = carriedSpecifications(session, carried);
  const { testModules, unhandledErrors } =
    uncollected.length === 0
      ? { testModules: [], unhandledErrors: [] }
      : await interruption.duringCollect(instance, () =>
          instance.collectTests(uncollected),
        );
  const report = {
    tests: kept.flatMap((list) => list.tests),
    failedModules: [] as FailedModule[],
    typecheckModules: session.typecheckModules,
    unsupportedProjects: session.unsupportedProjects,
    unhandledErrors: unhandledErrors.map(errorText),
    selectionFacts: await selectionFacts(session, interruption.signal),
    counts: {
      listed: specifications.length,
      collected: uncollected.length,
      carried: kept.length,
    },
  };
  for (const testModule of testModules) {
    sortModule(testModule, session, report);
  }
  report.failedModules.push(
    ...specificationsWithoutModule(uncollected, testModules).map(
      (specification) => ({
        ...moduleReport(
          session.locate(specification.project.name, specification.moduleId),
        ),
        errors: [UNCOLLECTED_MODULE_ERROR],
      }),
    ),
  );
  return report;
}

function sortModule(
  testModule: TestModule,
  session: WorkspaceSession,
  report: { tests: DiscoveredTest[]; failedModules: FailedModule[] },
): void {
  const location = session.locate(testModule.project.name, testModule.moduleId);
  const errors = testModule.errors();
  if (errors.length > 0) {
    report.failedModules.push({
      ...moduleReport(location),
      errors: errors.map(errorText),
    });
    return;
  }
  if (!wasCollected(testModule)) {
    report.failedModules.push({
      ...moduleReport(location),
      errors: [UNCOLLECTED_MODULE_ERROR],
    });
    return;
  }
  report.tests.push(...collectedTests(location, testModule));
}
