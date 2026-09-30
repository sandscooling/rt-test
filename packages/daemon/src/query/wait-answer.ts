import {
  testIdentityKey,
  type Freshness,
  type TestOutcome,
} from "@rt-test/core";
import { posix } from "node:path";
import {
  boundedList,
  explainedPath,
  MAX_EXPLAINED,
} from "../daemon/workspace-schedule.js";
import { workspaceEnvFilesKnown } from "../inputs/env-files.js";
import type { ProjectInputs } from "../inputs/fingerprint.js";
import type { UnreadPath } from "../inputs/queued-reads.js";
import {
  NARROWING,
  type Narrowing,
  type WorkspaceNarrowing,
} from "../inputs/narrowed-inputs.js";
import {
  caseComparable,
  listedPaths,
  workspaceListing,
} from "../inputs/protection.js";
import { normalizeRelativePath } from "../selection/graph-state.js";
import {
  SELECTION_STATE,
  type Selection,
} from "../selection/selection-types.js";
import type { StoredDiscovery, StoredRun } from "../store/stored-records.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import type { RecordedModule } from "../vitest/run-states.js";
import {
  COVERAGE,
  EXECUTION_STATE,
  LISTED_AS,
  MODULE_CRASHED,
  MODULE_FAILED_TO_LOAD,
  ROUND,
  SELECTION_REFUSED,
  UNKNOWN,
  type CutReason,
  type InputsNotNarrowed,
  type ListedCoverage,
  type NamedFailure,
  type NamedList,
  type ScheduleFacts,
  type WaitAnswer,
  type WaitCoverage,
  type WaitFile,
  type WaitOutcomeFacts,
} from "./answer.js";
import { cutReason, type QueryBasis } from "./summary.js";
import { countStandings } from "./test-states.js";

/** How many covering tests and modules that failed an answer names. */
const MAX_NAMED_FAILURES = 20;

const ENV_FILE_NAME = ".env";
const ENV_MODE_PREFIX = `${ENV_FILE_NAME}.`;
const ERROR_LINE_BREAK = /\r?\n/;

type SelectedFile = Required<Pick<WaitFile, "selection" | "listed">>;
type KnownCoverage = Exclude<
  WaitCoverage,
  { state: typeof COVERAGE.notYetKnown }
>;
type ListedAs = ListedCoverage["listedAs"];

/** The workspaces covering a wait's files at one revision whose dependency build has ended, and their inputs there. */
export interface Coverage {
  readonly revision: number;
  readonly discoveryId: string;
  readonly facts: KnownCoverage;
  /** By named path; empty while the coverage is widened. */
  readonly files: ReadonlyMap<string, SelectedFile>;
  readonly workspaces: ReadonlySet<string>;
  /** The paths of the workspace's inputs at the revision, as its fingerprint takes them, with the files it lists. */
  inputPaths(workspacePath: string): ReadonlySet<string>;
}

/**
 * The workspaces covering each of `paths`, root-relative, at `revision`: those selection selects for a change of it
 * and those whose fingerprints list it, or every discovered workspace while there is no dependency information.
 * Undefined while the revision's dependency build has not ended. `snapshot` is the inputs at `revision`.
 */
export function coverageAt(
  discovery: StoredDiscovery,
  narrowing: WorkspaceNarrowing,
  snapshot: ProjectInputs,
  revision: number,
  paths: readonly string[],
): Coverage | undefined {
  if (narrowing.kind === NARROWING.building) return undefined;
  const base = { revision, discoveryId: discovery.discoveryId };
  const entries = discovery.discovery.workspaces;
  const widened = (notNarrowed: InputsNotNarrowed): Coverage => ({
    ...base,
    facts: {
      state: COVERAGE.widened,
      revision,
      widenedBy: notNarrowed.kind,
      reason: cutReason(notNarrowed.reason),
    },
    files: new Map(),
    workspaces: new Set(
      entries.filter(isSelectable).map((entry) => entry.workspace.path),
    ),
    inputPaths: () => new Set(snapshot.comparedDigests.keys()),
  });
  if (narrowing.kind === NARROWING.widened) {
    return widened(narrowing.notNarrowed);
  }
  const built = narrowing.narrowing;
  const refused = built.refusal(snapshot);
  if (refused !== undefined) {
    return widened({ kind: SELECTION_REFUSED, reason: refused });
  }
  const outcome = built.select(paths);
  if (outcome.state === SELECTION_STATE.refused) {
    return widened({ kind: SELECTION_REFUSED, reason: outcome.reason });
  }
  const selected = selectedFiles(outcome, entries, paths);
  return {
    ...base,
    facts: { state: COVERAGE.selected, revision },
    files: selected.files,
    workspaces: selected.workspaces,
    inputPaths: narrowedInputs(built, snapshot, entries),
  };
}

/** A workspace selection can select: one discovered, or one whose discovery failed, whose tests are not known. */
function isSelectable(entry: WorkspaceDiscovery): boolean {
  return entry.status === "discovered" || entry.status === "failed";
}

function selectedFiles(
  selection: Selection,
  entries: readonly WorkspaceDiscovery[],
  paths: readonly string[],
): {
  readonly files: Map<string, SelectedFile>;
  readonly workspaces: Set<string>;
} {
  const reports = new Map(
    selection.paths.map((report) => [report.path, report]),
  );
  const listings = entries.flatMap(listingOf);
  const files = new Map<string, SelectedFile>();
  const workspaces = new Set<string>();
  for (const path of paths) {
    const report = reports.get(normalizeRelativePath(path));
    if (report === undefined) continue;
    const listed = listings.flatMap((covers) => covers(path) ?? []);
    for (const { workspace } of report.selected) workspaces.add(workspace);
    for (const { workspacePath } of listed) workspaces.add(workspacePath);
    files.set(path, {
      selection: explainedPath(report),
      listed: boundedList(listed, MAX_EXPLAINED),
    });
  }
  return { files, workspaces };
}

type ListingCovers = (path: string) => ListedCoverage | undefined;

/**
 * Whether a discovered workspace's fingerprint lists a path, and, while its env files are not known, every `.env` or
 * `.env.*` file, since its listing cannot rule one out. Compared as the listing is protected, in any case on Windows.
 */
function listingOf(entry: WorkspaceDiscovery): ListingCovers[] {
  if (entry.status !== "discovered") return [];
  const workspacePath = entry.workspace.path;
  const listing = workspaceListing(entry);
  const listedAs = new Map<string, ListedAs>();
  const sets: [readonly string[], ListedAs][] = [
    [listing.envFiles, LISTED_AS.envFile],
    [listing.setupFiles, LISTED_AS.setupFile],
    [listing.testModules, LISTED_AS.testModule],
  ];
  for (const [paths, kind] of sets) {
    for (const path of paths) listedAs.set(caseComparable(path), kind);
  }
  const envFilesKnown = workspaceEnvFilesKnown(entry).known;
  return [
    (path) => {
      const kind =
        listedAs.get(caseComparable(path)) ??
        (!envFilesKnown && isEnvFileName(path)
          ? LISTED_AS.envFilesNotKnown
          : undefined);
      return kind === undefined ? undefined : { workspacePath, listedAs: kind };
    },
  ];
}

function isEnvFileName(path: string): boolean {
  const name = caseComparable(posix.basename(path));
  return name === ENV_FILE_NAME || name.startsWith(ENV_MODE_PREFIX);
}

/** Each workspace's narrowed inputs with the files it lists, read once per workspace. */
function narrowedInputs(
  narrowing: Narrowing,
  snapshot: ProjectInputs,
  entries: readonly WorkspaceDiscovery[],
): (workspacePath: string) => ReadonlySet<string> {
  const read = new Map<string, ReadonlySet<string>>();
  return (workspacePath) => {
    const known = read.get(workspacePath);
    if (known !== undefined) return known;
    const entry = entries.find((each) => each.workspace.path === workspacePath);
    const paths = new Set([
      ...narrowing.workspaceInputs(snapshot, workspacePath).digests.keys(),
      ...(entry === undefined ? [] : listedPaths(workspaceListing(entry))),
    ]);
    read.set(workspacePath, paths);
    return paths;
  };
}

/**
 * Whether every covering workspace holds results that read current or has nothing coming: no round is pending and
 * each one the daemon runs is idle, which the schedule gives only once it reads current, or says why no run comes.
 */
export function settles(
  schedule: ScheduleFacts,
  covering: ReadonlySet<string>,
): boolean {
  if (schedule.round.state === ROUND.pending) return false;
  return schedule.workspaces.every(
    (workspace) =>
      !covering.has(workspace.workspacePath) ||
      workspace.state === EXECUTION_STATE.idle,
  );
}

/** What a wait answers with, beside what every answer carries. */
export interface WaitState {
  readonly outcome: WaitOutcomeFacts;
  /** Undefined while the wait has not bound. */
  readonly boundRevision: number | undefined;
  /** Root-relative, as the wait named them. */
  readonly paths: readonly string[];
  readonly unread: readonly UnreadPath[];
  /** Undefined while no revision's coverage is known, when every test counts as covering. */
  readonly coverage: Coverage | undefined;
}

export function waitAnswer(basis: QueryBasis, state: WaitState): WaitAnswer {
  const { coverage } = state;
  const covers = (workspacePath: string): boolean =>
    coverage === undefined || coverage.workspaces.has(workspacePath);
  const unread = new Map(
    state.unread.map(({ path, reason }) => [path, reason]),
  );
  const standings = basis.standings.filter((standing) =>
    covers(standing.test.identity.workspacePath),
  );
  return {
    ...basis.context,
    ...state.outcome,
    boundRevision: state.boundRevision ?? null,
    coverage: coverage?.facts ?? { state: COVERAGE.notYetKnown },
    files: state.paths.map((path) => {
      const reason = unread.get(path);
      return {
        path,
        ...(reason === undefined ? {} : { unread: cutReason(reason) }),
        ...coverage?.files.get(path),
      };
    }),
    counts: countStandings(standings),
    notDiscovered: basis.notDiscovered.filter(
      (entry) => !("workspacePath" in entry) || covers(entry.workspacePath),
    ),
    workspaces: basis.context.schedule.workspaces.filter((workspace) =>
      covers(workspace.workspacePath),
    ),
    namedFailures: namedFailures(
      basis.discovery.discovery.workspaces
        .map((entry) => basis.latestRuns.get(entry.workspace.path))
        .filter(
          (run): run is StoredRun =>
            run !== undefined && covers(run.run.workspace.path),
        ),
      new Map(
        standings.map(({ test, freshness }) => [
          testIdentityKey(test.identity),
          freshness,
        ]),
      ),
    ),
  };
}

/**
 * Names the first `MAX_NAMED_FAILURES` in run order, cutting only their errors, and counts the rest. A failed test
 * takes its standing's freshness, and any other failure, having no finished result, is unknown.
 */
function namedFailures(
  runs: readonly StoredRun[],
  freshness: ReadonlyMap<string, Freshness>,
): NamedList<NamedFailure> {
  const named: NamedFailure[] = [];
  let more = 0;
  for (const failure of failuresOf(runs, freshness)) {
    if (named.length < MAX_NAMED_FAILURES) named.push(failure());
    else more += 1;
  }
  return { named, more };
}

/** Each failure of the runs, made only when named. */
function* failuresOf(
  runs: readonly StoredRun[],
  freshness: ReadonlyMap<string, Freshness>,
): Generator<() => NamedFailure> {
  for (const { run } of runs) {
    if (run.status !== "ran") continue;
    for (const module of run.modules) {
      yield* moduleFailures(run.workspace.path, module, freshness);
    }
  }
}

function* moduleFailures(
  workspacePath: string,
  module: RecordedModule,
  freshness: ReadonlyMap<string, Freshness>,
): Generator<() => NamedFailure> {
  const location = {
    workspacePath,
    projectName: module.projectName,
    modulePath: module.modulePath,
  };
  if (module.state === "failed") {
    yield () => ({
      ...location,
      state: MODULE_FAILED_TO_LOAD,
      freshness: UNKNOWN,
      firstError: firstError(module.errors),
    });
    return;
  }
  if (module.state === "crashed") {
    yield () => ({
      ...location,
      state: MODULE_CRASHED,
      freshness: UNKNOWN,
      firstError: null,
    });
    return;
  }
  if (module.state !== "ran") return;
  for (const test of module.tests) {
    if (test.execution !== "finished" || !failed(test.outcome)) continue;
    const state = test.outcome;
    yield () => ({
      ...location,
      testName: test.identity.namePath,
      state,
      freshness: freshness.get(testIdentityKey(test.identity)) ?? UNKNOWN,
      firstError: firstError(test.errors),
    });
  }
}

function failed(outcome: TestOutcome): outcome is "failed" | "error" {
  return outcome === "failed" || outcome === "error";
}

/** The first line of the first error, cut; null when none was recorded. */
export function firstError(
  errors: readonly string[],
): NamedFailure["firstError"] {
  const [first] = errors;
  return first === undefined ? null : firstLineOf(first);
}

/** The first line of `text`, cut as an answer cuts a reason. */
export function firstLineOf(text: string): CutReason {
  const [line = ""] = text.split(ERROR_LINE_BREAK);
  return cutReason(line);
}
