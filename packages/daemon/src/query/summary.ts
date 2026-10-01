import {
  FALSIFICATION_JOB,
  type StatusResponse,
  type UnstoredJob,
} from "../daemon/protocol.js";
import type { ScheduleReader } from "../daemon/workspace-schedule.js";
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
  omittedText,
  roundText,
  FAILED_MODULE,
  SOURCE_NOT_READ,
  TYPECHECK_MODULE,
  UNSUPPORTED_PROJECT,
  WORKSPACE_DISCOVERY_FAILED,
  WORKSPACE_NOT_CONFIRMED,
  WORKSPACE_NOT_VITEST,
  WORKSPACE_UNHANDLED_ERRORS,
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
  fingerprintDigest,
  isCurrentAdapterVersion,
  recordFreshness,
  testStandings,
  type CurrentFingerprints,
  type TestStanding,
} from "./test-states.js";

/** What an answer reads of the daemon: what it knows of itself, and its schedule. */
export type DaemonView = Pick<
  StatusResponse,
  "consumerRoot" | "activity" | "unstoredJobs"
> & { readonly schedule: ScheduleReader };

/** What a query answers from once a discovery is stored. */
export interface QueryBasis {
  readonly discovery: StoredDiscovery;
  /** Each workspace's latest stored run, by workspace path. */
  readonly latestRuns: ReadonlyMap<string, StoredRun>;
  /** Why each workspace's latest stored run was refused as unreadable, by workspace path. */
  readonly refusedRuns: ReadonlyMap<string, string>;
  readonly standings: readonly TestStanding[];
  /** Each discovered workspace's current input fingerprint digest, the one its standings were rated against. */
  readonly currentFingerprint: CurrentFingerprints;
  readonly notDiscovered: readonly NotDiscoveredEntry[];
  readonly context: AnswerContext;
}

/** Bounds each entry's reason; the server's size check bounds the whole answer. */
const MAX_REASON_CHARACTERS = 1000;
const REASON_SEPARATOR = "\n";
/** How many of the jobs that ended with nothing stored a nothing-to-answer reason names. */
const MAX_NAMED_UNSTORED_JOBS = 20;
const JOB_SEPARATOR = "; ";
const TYPECHECK_MODULE_REASON =
  "a typecheck module, whose tests RT Test does not discover or run";

export function summaryAnswer(
  results: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): SummaryAnswer | NoAnswer {
  const basis = queryBasis(results, daemon, inputs);
  if ("noAnswer" in basis) return basis;
  const { discovery, standings, notDiscovered, context } = basis;
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
    workspaces: discovery.discovery.workspaces.map((entry) =>
      workspaceFacts(entry.workspace.path, basis, daemon.schedule),
    ),
  };
}

function workspaceFacts(
  workspacePath: string,
  basis: QueryBasis,
  schedule: ScheduleReader,
): WorkspaceFacts {
  const latestRun = latestRunFacts(
    basis.latestRuns.get(workspacePath),
    schedule,
  );
  if (latestRun !== null) return { workspacePath, latestRun };
  const refusal = basis.refusedRuns.get(workspacePath);
  return {
    workspacePath,
    latestRun,
    ...(refusal === undefined ? {} : { refusedRun: cutReason(refusal) }),
  };
}

/** The latest discovery's standings and not-discovered entries, or why there is nothing to count. */
export function queryBasis(
  results: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): QueryBasis | NoAnswer {
  const { discovery, discoveryRefusal } = results;
  if (discovery === undefined) {
    const doing = daemonClause(daemon, inputs.facts.revision);
    return {
      noAnswer:
        discoveryRefusal === undefined
          ? `the daemon serving ${daemon.consumerRoot} has stored no discovery for this worktree; ${doing}`
          : refusedDiscoveryReason(discoveryRefusal, daemon, doing),
    };
  }
  const latestRuns = new Map(
    results.latestRuns.map((run) => [run.run.workspace.path, run]),
  );
  const refusedRuns = new Map(
    results.runRefusals.map((refusal) => [
      refusal.workspacePath,
      refusal.reason,
    ]),
  );
  const fingerprints = workspaceFingerprints(discovery.discovery, inputs);
  const currentFingerprint: CurrentFingerprints = (path) =>
    fingerprintDigest(fingerprints.get(path));
  const freshness = recordFreshness(
    discovery,
    fingerprintDigest(inputs.discoveryFingerprint(discovery.discovery)),
  );
  const { schedule, latestSelection } = daemon.schedule.read({
    revision: inputs.facts.revision,
    activity: daemon.activity,
    workspaces: discovery.discovery.workspaces,
    latestRuns,
    refusedRuns,
    fingerprint: (entry) =>
      fingerprints.get(entry.workspace.path) ??
      inputs.workspaceFingerprint(entry),
  });
  return {
    discovery,
    latestRuns,
    refusedRuns,
    standings: testStandings(
      discovery,
      latestRuns,
      refusedRuns,
      currentFingerprint,
      freshness === CURRENT,
    ),
    currentFingerprint,
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
      ...(inputs.inputsNotNarrowed === undefined
        ? {}
        : { inputsNotNarrowed: inputs.inputsNotNarrowed }),
      activity: daemon.activity,
      unstoredJobs: daemon.unstoredJobs.map(answeredJob),
      schedule,
      latestSelection,
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
    ...(discovery.notCovered ?? []).map((workspace): NotDiscoveredEntry => ({
      kind: WORKSPACE_NOT_VITEST,
      workspacePath: workspace.path,
      ...cutReason(workspace.reason),
    })),
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
  const { unhandledErrors } = entry;
  return [
    ...(unhandledErrors.length === 0
      ? []
      : [
          {
            kind: WORKSPACE_UNHANDLED_ERRORS,
            workspacePath,
            errorCount: unhandledErrors.length,
            ...cutReason(unhandledErrors.join(REASON_SEPARATOR)),
          } satisfies NotDiscoveredEntry,
        ]),
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

/** The refusal quotes the stored value it could not read, so the answer carries it cut and the daemon log whole. */
function refusedDiscoveryReason(
  refusal: string,
  daemon: DaemonView,
  doing: string,
): string {
  const { reason, omittedCharacters } = cutReason(refusal);
  return `the daemon serving ${daemon.consumerRoot} refused the latest discovery stored for this worktree as unreadable, so it answers once a new discovery replaces it; ${doing}. The refusal: ${reason}${omittedText(omittedCharacters)}`;
}

/** What the daemon is doing about a query it cannot answer: its activity, its round and each job that stored nothing. */
function daemonClause(daemon: DaemonView, revision: number): string {
  const round = roundText(daemon.schedule.round(revision));
  return `it is ${activityText(daemon.activity)}; ${round}${unstoredClause(daemon.unstoredJobs)}`;
}

function answeredJob(job: UnstoredJob): UnstoredJob {
  const { reason, omittedCharacters } = cutReason(job.reason);
  return { ...job, reason: `${reason}${omittedText(omittedCharacters)}` };
}

function unstoredClause(jobs: readonly UnstoredJob[]): string {
  if (jobs.length === 0) return "";
  const named = jobs.slice(0, MAX_NAMED_UNSTORED_JOBS).map((job) => {
    const { reason, omittedCharacters } = cutReason(job.reason);
    return `${jobName(job)}: ${reason}${omittedText(omittedCharacters)}`;
  });
  const more = jobs.length - named.length;
  const rest = more === 0 ? "" : `${JOB_SEPARATOR}and ${more} more`;
  return `; ended with nothing stored: ${named.join(JOB_SEPARATOR)}${rest}`;
}

function jobName({ workspacePath, kind }: UnstoredJob): string {
  if (workspacePath === undefined) return "the discovery";
  return kind === FALSIFICATION_JOB
    ? `the falsification of ${workspacePath}`
    : `the run of ${workspacePath}`;
}

/** Cuts by code point, so no character is split. */
export function cutReason(text: string): CutReason {
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

function latestRunFacts(
  stored: StoredRun | undefined,
  schedule: ScheduleReader,
): LatestRunFacts | null {
  if (stored === undefined) return null;
  const invalidated = schedule.invalidation(stored);
  const base = {
    runId: stored.runId,
    ...(invalidated === undefined ? {} : { invalidated }),
    ...adapterVersionFacts(stored.adapterVersion),
  };
  const run = stored.run;
  if (run.status === "crashed") {
    return { ...base, status: run.status, ...cutReason(run.error) };
  }
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
