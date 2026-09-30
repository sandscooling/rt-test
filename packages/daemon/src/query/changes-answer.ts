import { testIdentityKey, type TestIdentity } from "@rt-test/core";
import type {
  CursorReading,
  NetChange,
  RecordedEntry,
  RecordedStanding,
  RecordedTest,
} from "../daemon/change-journal.js";
import type { ProjectInputs } from "../inputs/fingerprint.js";
import type { CurrentInputs } from "../inputs/input-tracker.js";
import {
  NARROWING,
  type WorkspaceNarrowing,
} from "../inputs/narrowed-inputs.js";
import type { UnreadPath } from "../inputs/queued-reads.js";
import type { StoredRun } from "../store/stored-records.js";
import {
  CURRENT,
  FAILED_MODULE,
  INTERRUPTED,
  MODULE_CRASHED,
  MODULE_FAILED_TO_LOAD,
  MODULE_NOT_RUN,
  NEVER_RUN,
  NOT_IN_LATEST_RUN,
  RUN_CRASHED,
  RUN_FAILED,
  RUN_INTERRUPTED_BEFORE_LOAD,
  RUN_REFUSED,
  RUN_UNSUPPORTED_VITEST,
  SOURCE_NOT_READ,
  TYPECHECK_MODULE,
  UNSUPPORTED_PROJECT,
  WORKSPACE_DISCOVERY_FAILED,
  WORKSPACE_NOT_CONFIRMED,
  WORKSPACE_NOT_VITEST,
  WORKSPACE_UNHANDLED_ERRORS,
  WORKSPACE_UNSUPPORTED_VITEST,
  type AnswerContext,
  type CutReason,
  type NotDiscoveredEntry,
  type TestCounts,
  type TestState,
  type WaitFile,
} from "./answer.js";
import { cutReason, type QueryBasis } from "./summary.js";
import { countStandings, type TestStanding } from "./test-states.js";
import { firstError, firstLineOf, type Coverage } from "./wait-answer.js";

/** How many changes in scope an answer lists; it counts the rest by kind. */
const MAX_LISTED_CHANGES = 20;

export const CHANGE_KIND = {
  failing: "failing",
  recovered: "recovered",
  other: "other",
} as const;

export type ChangeKind = (typeof CHANGE_KIND)[keyof typeof CHANGE_KIND];

const CHANGE_KIND_MEMBERS: Readonly<Record<ChangeKind, true>> = {
  [CHANGE_KIND.failing]: true,
  [CHANGE_KIND.recovered]: true,
  [CHANGE_KIND.other]: true,
};
/** Every kind, in the order an answer lists changes. */
export const CHANGE_KINDS = Object.keys(CHANGE_KIND_MEMBERS) as ChangeKind[];

/** How a changes answer used the cursor it was given. */
export const CURSOR_USE = {
  used: "used",
  noneGiven: "none-given",
  /** The cursor names no moment this daemon life recorded: another life's, or any other string. */
  notIssued: "not-issued",
  expired: "expired",
} as const;

export type CursorUse = (typeof CURSOR_USE)[keyof typeof CURSOR_USE];

/** Why an answer lists no change: no fingerprint can be computed, a named path was not read, or the build has not ended. */
export const NOT_DETERMINED = {
  inputsUnavailable: "inputs-unavailable",
  pathsUnread: "paths-unread",
  buildNotEnded: "build-not-ended",
} as const;

const PASSED = "passed" satisfies TestState;
const NO_SNAPSHOT_REASON = "no snapshot of the inputs is held";

/** The states that say the test, its module or its run broke; each other state says it has no outcome, or passed. */
export const FAILING_STATES: Readonly<Record<TestState, boolean>> = {
  passed: false,
  failed: true,
  skipped: false,
  error: true,
  [INTERRUPTED]: false,
  [MODULE_NOT_RUN]: false,
  [MODULE_CRASHED]: true,
  [MODULE_FAILED_TO_LOAD]: true,
  [RUN_FAILED]: true,
  [RUN_UNSUPPORTED_VITEST]: false,
  [RUN_INTERRUPTED_BEFORE_LOAD]: false,
  [RUN_CRASHED]: true,
  [RUN_REFUSED]: false,
  [NOT_IN_LATEST_RUN]: false,
  [NEVER_RUN]: false,
};

/** The entries that report a break, beside those that say only what RT Test does not discover. */
const FAILING_ENTRY_KINDS: Readonly<
  Record<NotDiscoveredEntry["kind"], boolean>
> = {
  [WORKSPACE_UNSUPPORTED_VITEST]: false,
  [WORKSPACE_DISCOVERY_FAILED]: true,
  [WORKSPACE_NOT_CONFIRMED]: false,
  [WORKSPACE_NOT_VITEST]: false,
  [WORKSPACE_UNHANDLED_ERRORS]: true,
  [FAILED_MODULE]: true,
  [TYPECHECK_MODULE]: false,
  [UNSUPPORTED_PROJECT]: false,
  [SOURCE_NOT_READ]: false,
};

export type ChangeStanding = Pick<RecordedTest, "state" | "freshness">;

/** A change's kind; a failing change carries the first line of the first error recorded for it, null when none was. */
export type ChangeClass =
  | {
      readonly kind: typeof CHANGE_KIND.failing;
      readonly firstError: CutReason | null;
    }
  | {
      readonly kind: typeof CHANGE_KIND.recovered | typeof CHANGE_KIND.other;
    };

/** A test's standing at the cursor and now, each absent when it had or has none. */
export type TestChange = ChangeClass & {
  readonly test: TestIdentity;
  readonly atCursor?: ChangeStanding;
  readonly now?: ChangeStanding;
};

/** An entry listed at the cursor or now, never both, with its reason cut to its first line. */
export type EntryChange = ChangeClass & {
  readonly atCursor?: NotDiscoveredEntry;
  readonly now?: NotDiscoveredEntry;
};

export type ListedChange = TestChange | EntryChange;

export type ChangeCounts = Readonly<Record<ChangeKind, number>>;

export interface UnreadFile {
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
  readonly reason: CutReason;
}

export type NotDeterminedFacts =
  | {
      readonly kind:
        | typeof NOT_DETERMINED.inputsUnavailable
        | typeof NOT_DETERMINED.buildNotEnded;
      readonly reason: CutReason;
    }
  | {
      readonly kind: typeof NOT_DETERMINED.pathsUnread;
      readonly unread: readonly UnreadFile[];
    };

export interface DeterminedChanges {
  readonly determined: true;
  /** Failing, then recovered, then the rest, up to `MAX_LISTED_CHANGES`; empty on a baseline. */
  readonly changes: readonly ListedChange[];
  /** The changes in scope the bound leaves out, by kind. */
  readonly omittedChanges: ChangeCounts;
  readonly coverage: Coverage["facts"];
  readonly files: readonly WaitFile[];
  /** Every test in scope, counted once however many named files it covers. */
  readonly counts: TestCounts;
  readonly outside: {
    readonly counts: TestCounts;
    /** How many tests outside scope changed since the cursor; null when no cursor was used. */
    readonly changed: number | null;
  };
}

export interface NotDeterminedChanges {
  readonly determined: false;
  readonly notDetermined: NotDeterminedFacts;
}

/** The cursor an answer returns and how it used the one it was given, with the input revision it read. */
export interface CursorFacts {
  /** Null when a moment not determined comes before this daemon life recorded any. */
  readonly cursor: string | null;
  readonly cursorUse: CursorUse;
  readonly revision: number;
}

export type ChangesAnswer = AnswerContext &
  CursorFacts &
  (DeterminedChanges | NotDeterminedChanges);

export type Determination =
  | { readonly determined: true; readonly snapshot: ProjectInputs }
  | { readonly determined: false; readonly notDetermined: NotDeterminedFacts };

/**
 * Determined when a fingerprint can be computed now, the named read left no path unread, and the dependency build
 * deciding `inputs`' revision has ended; `narrowing` is the builds' state at that revision the inputs were taken over.
 */
export function determination(
  inputs: CurrentInputs,
  narrowing: WorkspaceNarrowing,
  unread: readonly UnreadPath[],
): Determination {
  const { snapshot } = inputs;
  if (inputs.unavailable !== undefined || snapshot === undefined) {
    return notDetermined({
      kind: NOT_DETERMINED.inputsUnavailable,
      reason: cutReason(inputs.unavailable ?? NO_SNAPSHOT_REASON),
    });
  }
  if (unread.length > 0) {
    return notDetermined({
      kind: NOT_DETERMINED.pathsUnread,
      unread: unread.map(({ path, reason }) => ({
        path,
        reason: cutReason(reason),
      })),
    });
  }
  if (narrowing.kind === NARROWING.building) {
    return notDetermined({
      kind: NOT_DETERMINED.buildNotEnded,
      reason: cutReason(narrowing.reason),
    });
  }
  return { determined: true, snapshot };
}

function notDetermined(facts: NotDeterminedFacts): Determination {
  return { determined: false, notDetermined: facts };
}

export function notDeterminedAnswer(
  basis: QueryBasis,
  cursor: CursorFacts,
  facts: NotDeterminedFacts,
): ChangesAnswer {
  return {
    ...basis.context,
    ...cursor,
    determined: false,
    notDetermined: facts,
  };
}

/** What a determined answer lists from, beside what every answer carries. */
export interface DeterminedState {
  readonly revision: number;
  /** Names the standings the answer read, which the journal recorded first. */
  readonly cursor: string;
  readonly reading: CursorReading;
  /** The coverage of the named files at `revision`. */
  readonly coverage: Coverage;
  /** Root-relative, each once. */
  readonly paths: readonly string[];
}

/**
 * The tests in scope are those of each workspace covering a named file now, a dropped test judged by the workspace it
 * belonged to, and an entry naming no workspace is in scope for every call.
 */
export function changesAnswer(
  basis: QueryBasis,
  state: DeterminedState,
): ChangesAnswer {
  const { coverage } = state;
  const covers = (workspacePath: string): boolean =>
    coverage.workspaces.has(workspacePath);
  const inScope: TestStanding[] = [];
  const outside: TestStanding[] = [];
  for (const standing of basis.standings) {
    const set = covers(standing.test.identity.workspacePath)
      ? inScope
      : outside;
    set.push(standing);
  }
  const listing = listedChanges(state.reading, covers, basis.latestRuns);
  return {
    ...basis.context,
    cursor: state.cursor,
    cursorUse: state.reading.use,
    revision: state.revision,
    determined: true,
    changes: listing.changes,
    omittedChanges: listing.omitted,
    coverage: coverage.facts,
    files: state.paths.map((path) => ({
      path,
      ...coverage.files.get(path),
    })),
    counts: countStandings(inScope),
    outside: {
      counts: countStandings(outside),
      changed: listing.outsideChanged,
    },
  };
}

interface Listing {
  readonly changes: readonly ListedChange[];
  readonly omitted: ChangeCounts;
  readonly outsideChanged: number | null;
}

interface KindedChange {
  readonly change: NetChange;
  readonly kind: ChangeKind;
}

/** Filters to scope before it cuts to `MAX_LISTED_CHANGES`, and makes each listed change's error line only when listed. */
function listedChanges(
  reading: CursorReading,
  covers: (workspacePath: string) => boolean,
  latestRuns: ReadonlyMap<string, StoredRun>,
): Listing {
  const omitted = zeroCounts();
  if (reading.use !== CURSOR_USE.used) {
    return { changes: [], omitted, outsideChanged: null };
  }
  let outsideChanged = 0;
  const kinded: KindedChange[] = [];
  for (const change of reading.changes) {
    const standing = change.now ?? change.atCursor;
    if (standing === undefined) continue;
    if (inScope(standing, covers)) {
      kinded.push({ change, kind: kindOf(change) });
    } else if ("test" in standing) {
      outsideChanged += 1;
    }
  }
  kinded.sort(byKindThenKey);
  for (const { kind } of kinded.slice(MAX_LISTED_CHANGES)) omitted[kind] += 1;
  return {
    changes: kinded
      .slice(0, MAX_LISTED_CHANGES)
      .map(({ change, kind }) => listedChange(change, kind, latestRuns)),
    omitted,
    outsideChanged,
  };
}

function inScope(
  standing: RecordedStanding,
  covers: (workspacePath: string) => boolean,
): boolean {
  if ("test" in standing) return covers(standing.test.workspacePath);
  const { entry } = standing;
  return !("workspacePath" in entry) || covers(entry.workspacePath);
}

const KIND_ORDER = new Map(CHANGE_KINDS.map((kind, index) => [kind, index]));

function byKindThenKey(a: KindedChange, b: KindedChange): number {
  const order = (KIND_ORDER.get(a.kind) ?? 0) - (KIND_ORDER.get(b.kind) ?? 0);
  if (order !== 0) return order;
  if (a.change.key === b.change.key) return 0;
  return a.change.key < b.change.key ? -1 : 1;
}

/**
 * Failing when a test now stands failing and either its state changed or it now reads current, or a breaking entry
 * appeared; recovered when a test now stands a current pass after standing failing at the cursor, or a breaking entry
 * went away; other otherwise.
 */
function kindOf({ atCursor, now }: NetChange): ChangeKind {
  const before = asEntry(atCursor);
  const after = asEntry(now);
  if (before !== undefined || after !== undefined) {
    if (after !== undefined && FAILING_ENTRY_KINDS[after.entry.kind]) {
      return CHANGE_KIND.failing;
    }
    if (before !== undefined && FAILING_ENTRY_KINDS[before.entry.kind]) {
      return CHANGE_KIND.recovered;
    }
    return CHANGE_KIND.other;
  }
  return testKind(asTest(atCursor), asTest(now));
}

function testKind(
  then: RecordedTest | undefined,
  now: RecordedTest | undefined,
): ChangeKind {
  if (now === undefined) return CHANGE_KIND.other;
  const current = now.freshness === CURRENT;
  if (FAILING_STATES[now.state] && (then?.state !== now.state || current)) {
    return CHANGE_KIND.failing;
  }
  const stoodFailing = then !== undefined && FAILING_STATES[then.state];
  if (now.state === PASSED && current && stoodFailing) {
    return CHANGE_KIND.recovered;
  }
  return CHANGE_KIND.other;
}

function listedChange(
  change: NetChange,
  kind: ChangeKind,
  latestRuns: ReadonlyMap<string, StoredRun>,
): ListedChange {
  const then = asTest(change.atCursor);
  const now = asTest(change.now);
  const test = (now ?? then)?.test;
  if (test === undefined) {
    const before = asEntry(change.atCursor)?.entry;
    const after = asEntry(change.now)?.entry;
    return {
      ...classed(kind, () =>
        after === undefined ? null : firstLineOf(after.reason),
      ),
      ...(before === undefined ? {} : { atCursor: withFirstLine(before) }),
      ...(after === undefined ? {} : { now: withFirstLine(after) }),
    };
  }
  return {
    ...classed(kind, () =>
      now === undefined ? null : testFirstError(test, latestRuns),
    ),
    test,
    ...(then === undefined ? {} : { atCursor: standingOf(then) }),
    ...(now === undefined ? {} : { now: standingOf(now) }),
  };
}

function classed(kind: ChangeKind, error: () => CutReason | null): ChangeClass {
  return kind === CHANGE_KIND.failing
    ? { kind, firstError: error() }
    : { kind };
}

function standingOf({ state, freshness }: RecordedTest): ChangeStanding {
  return { state, freshness };
}

/** The entry with its reason cut to its first line, counting every character the cut leaves out. */
function withFirstLine(entry: NotDiscoveredEntry): NotDiscoveredEntry {
  const line = firstLineOf(entry.reason);
  const total = Array.from(entry.reason).length + entry.omittedCharacters;
  return {
    ...entry,
    reason: line.reason,
    omittedCharacters: total - Array.from(line.reason).length,
  };
}

/** From the test's workspace's latest stored run: its own errors, its module's, or its run's. */
function testFirstError(
  test: TestIdentity,
  latestRuns: ReadonlyMap<string, StoredRun>,
): CutReason | null {
  const run = latestRuns.get(test.workspacePath)?.run;
  if (run === undefined) return null;
  if (run.status === "failed" || run.status === "crashed") {
    return firstError([run.error]);
  }
  if (run.status !== "ran") return null;
  const module = run.modules.find(
    (each) =>
      each.projectName === test.projectName &&
      each.modulePath === test.modulePath,
  );
  if (module?.state === "failed") return firstError(module.errors);
  if (module?.state !== "ran") return null;
  const key = testIdentityKey(test);
  const recorded = module.tests.find(
    (each) => testIdentityKey(each.identity) === key,
  );
  return recorded?.execution === "finished"
    ? firstError(recorded.errors)
    : null;
}

function asTest(
  standing: RecordedStanding | undefined,
): RecordedTest | undefined {
  return standing !== undefined && "test" in standing ? standing : undefined;
}

function asEntry(
  standing: RecordedStanding | undefined,
): RecordedEntry | undefined {
  return standing !== undefined && "entry" in standing ? standing : undefined;
}

function zeroCounts(): Record<ChangeKind, number> {
  return Object.fromEntries(CHANGE_KINDS.map((kind) => [kind, 0])) as Record<
    ChangeKind,
    number
  >;
}
