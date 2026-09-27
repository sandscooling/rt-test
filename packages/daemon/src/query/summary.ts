import type { StatusResponse } from "../daemon/protocol.js";
import type { FingerprintResult } from "../inputs/fingerprint.js";
import type { CurrentInputs } from "../inputs/input-tracker.js";
import type { LatestResults } from "../store/open-store.js";
import type { StoredDiscovery, StoredRun } from "../store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../vitest/adapter-version.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import {
  activityText,
  CURRENT,
  FAILED_MODULE,
  SOURCE_NOT_READ,
  TYPECHECK_MODULE,
  UNSUPPORTED_PROJECT,
  WORKSPACE_DISCOVERY_FAILED,
  WORKSPACE_NOT_CONFIRMED,
  WORKSPACE_UNSUPPORTED_VITEST,
  type AdapterVersionFacts,
  type AnswerContext,
  type CutReason,
  type LatestRunFacts,
  type NoAnswer,
  type NotDiscoveredEntry,
  type SummaryAnswer,
  type UnfingerprintedWorkspace,
  type WorkspaceFacts,
} from "./answer.js";
import {
  countStandings,
  discoveryFreshness,
  isCurrentAdapterVersion,
  testStandings,
  type TestStanding,
} from "./test-states.js";

/** What the daemon knows of itself that an answer carries. */
export type DaemonView = Pick<
  StatusResponse,
  "consumerRoot" | "activity" | "unstoredJobs"
>;

/** What a query answers from once a discovery is stored. */
export interface QueryBasis {
  readonly discovery: StoredDiscovery;
  /** Each workspace's latest stored run, by workspace path. */
  readonly latestRuns: ReadonlyMap<string, StoredRun>;
  readonly standings: readonly TestStanding[];
  readonly notDiscovered: readonly NotDiscoveredEntry[];
  readonly context: AnswerContext;
}

/** Bounds each entry's reason; the server's size check bounds the whole answer. */
const MAX_REASON_CHARACTERS = 1000;
const REASON_SEPARATOR = "\n";
const TYPECHECK_MODULE_REASON =
  "a typecheck module, whose tests RT Test does not discover or run";

export function summaryAnswer(
  results: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): SummaryAnswer | NoAnswer {
  const basis = queryBasis(results, daemon, inputs);
  if ("noAnswer" in basis) return basis;
  const {
    discovery,
    latestRuns: runs,
    standings,
    notDiscovered,
    context,
  } = basis;
  if (standings.length === 0 && notDiscovered.length === 0) {
    return {
      noAnswer: `the latest discovery stored for ${daemon.consumerRoot} holds no test and nothing RT Test could not discover`,
    };
  }
  return {
    ...context,
    counts: countStandings(standings),
    duplicateTests: standings.filter((standing) => standing.test.isDuplicate)
      .length,
    notDiscovered,
    workspaces: discovery.discovery.workspaces.map((entry): WorkspaceFacts => ({
      workspacePath: entry.workspace.path,
      latestRun: latestRunFacts(runs.get(entry.workspace.path)),
    })),
  };
}

/** The latest discovery's standings and not-discovered entries, or why there is nothing to count. */
export function queryBasis(
  results: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): QueryBasis | NoAnswer {
  const { discovery } = results;
  if (discovery === undefined) {
    return {
      noAnswer: `the daemon serving ${daemon.consumerRoot} has stored no discovery for this worktree; it is ${activityText(daemon.activity)}`,
    };
  }
  const latestRuns = new Map(
    results.latestRuns.map((run) => [run.run.workspace.path, run]),
  );
  const fingerprints = workspaceFingerprints(discovery.discovery, inputs);
  const freshness = discoveryFreshness(
    discovery,
    digestOf(inputs.discoveryFingerprint(discovery.discovery)),
  );
  return {
    discovery,
    latestRuns,
    standings: testStandings(
      discovery,
      latestRuns,
      (path) => digestOf(fingerprints.get(path)),
      freshness === CURRENT,
    ),
    notDiscovered: notDiscoveredEntries(discovery.discovery),
    context: {
      consumerRoot: daemon.consumerRoot,
      currentAdapterVersion: VITEST_ADAPTER_VERSION,
      discovery: {
        discoveryId: discovery.discoveryId,
        ...adapterVersionFacts(discovery.adapterVersion),
        freshness,
      },
      inputs: inputs.facts,
      unfingerprintedWorkspaces:
        inputs.unavailable === undefined ? unfingerprinted(fingerprints) : [],
      ...(inputs.nonInputsUnusable === undefined
        ? {}
        : { nonInputsUnusable: inputs.nonInputsUnusable }),
      activity: daemon.activity,
      unstoredJobs: daemon.unstoredJobs,
    },
  };
}

/** Each discovered workspace's current fingerprint, composed once per answer. */
function workspaceFingerprints(
  discovery: TestDiscovery,
  inputs: CurrentInputs,
): Map<string, FingerprintResult> {
  return new Map(
    discovery.workspaces
      .filter((entry) => entry.status === "discovered")
      .map((entry) => [
        entry.workspace.path,
        inputs.workspaceFingerprint(entry),
      ]),
  );
}

function digestOf(print: FingerprintResult | undefined): string | undefined {
  return print?.ok === true ? print.digest : undefined;
}

function unfingerprinted(
  fingerprints: ReadonlyMap<string, FingerprintResult>,
): UnfingerprintedWorkspace[] {
  return [...fingerprints].flatMap(([workspacePath, print]) =>
    print.ok ? [] : [{ workspacePath, reason: print.reason }],
  );
}

function notDiscoveredEntries(discovery: TestDiscovery): NotDiscoveredEntry[] {
  return [
    ...discovery.workspaces.flatMap(workspaceEntries),
    ...discovery.notRead.map((unread): NotDiscoveredEntry => ({
      kind: SOURCE_NOT_READ,
      source: unread.source,
      ...cutReason(unread.reason),
    })),
  ];
}

function workspaceEntries(entry: WorkspaceDiscovery): NotDiscoveredEntry[] {
  const workspacePath = entry.workspace.path;
  switch (entry.status) {
    case "unsupported":
      return [
        {
          kind: WORKSPACE_UNSUPPORTED_VITEST,
          workspacePath,
          ...cutReason(entry.vitest.reason),
        },
      ];
    case "failed":
      return [
        {
          kind: WORKSPACE_DISCOVERY_FAILED,
          workspacePath,
          ...cutReason(entry.error),
        },
      ];
    case "not-confirmed":
      return [
        {
          kind: WORKSPACE_NOT_CONFIRMED,
          workspacePath,
          ...cutReason(entry.reason),
        },
      ];
    case "discovered":
      return discoveredWorkspaceEntries(entry);
  }
}

function discoveredWorkspaceEntries(
  entry: Extract<WorkspaceDiscovery, { status: "discovered" }>,
): NotDiscoveredEntry[] {
  const workspacePath = entry.workspace.path;
  return [
    ...entry.failedModules.map((module): NotDiscoveredEntry => ({
      kind: FAILED_MODULE,
      workspacePath,
      projectName: module.projectName,
      modulePath: module.modulePath,
      errorCount: module.errors.length,
      ...cutReason(module.errors.join(REASON_SEPARATOR)),
    })),
    ...entry.typecheckModules.map((module): NotDiscoveredEntry => ({
      kind: TYPECHECK_MODULE,
      workspacePath,
      projectName: module.projectName,
      modulePath: module.modulePath,
      ...cutReason(TYPECHECK_MODULE_REASON),
    })),
    ...entry.unsupportedProjects.map((project): NotDiscoveredEntry => ({
      kind: UNSUPPORTED_PROJECT,
      workspacePath,
      projectName: project.projectName,
      ...cutReason(project.reason),
    })),
  ];
}

/** Cuts by code point, so no character is split. */
function cutReason(text: string): CutReason {
  const characters = Array.from(text);
  return {
    reason: characters.slice(0, MAX_REASON_CHARACTERS).join(""),
    omittedCharacters: Math.max(0, characters.length - MAX_REASON_CHARACTERS),
  };
}

function adapterVersionFacts(adapterVersion: number): AdapterVersionFacts {
  return {
    adapterVersion,
    adapterVersionCurrent: isCurrentAdapterVersion(adapterVersion),
  };
}

function latestRunFacts(stored: StoredRun | undefined): LatestRunFacts | null {
  if (stored === undefined) return null;
  const base = {
    runId: stored.runId,
    ...adapterVersionFacts(stored.adapterVersion),
  };
  const run = stored.run;
  if (run.status !== "ran") return { ...base, status: run.status };
  return {
    ...base,
    status: run.status,
    execution: run.execution,
    forceStopped: run.forceStopped,
    nothingRan: run.nothingRan ?? null,
    unhandledErrors: run.unhandledErrors.length,
    moduleErrors: run.modules.reduce(
      (total, module) =>
        total + ("errors" in module ? module.errors.length : 0),
      0,
    ),
  };
}
