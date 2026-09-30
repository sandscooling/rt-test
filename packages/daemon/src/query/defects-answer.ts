import { testIdentityKey, type TestIdentity } from "@rt-test/core";
import {
  readDefinitionFiles,
  type InvalidEntryKind,
} from "../defects/definition-files.js";
import {
  checkDefinitions,
  type DefinitionTest,
} from "../defects/definitions.js";
import {
  DEFECT_STATES,
  resolveDefinitions,
  type DefectState,
  type ResolvedDefinition,
} from "../defects/resolve-definitions.js";
import type { CurrentInputs } from "../inputs/input-tracker.js";
import type { LatestResults } from "../store/open-store.js";
import { ROOT_PATH } from "../vitest/find-workspaces.js";
import {
  CURRENT,
  type AnswerContext,
  type CutReason,
  type NoAnswer,
} from "./answer.js";
import { resolveCallerPath, type CallerPath } from "./caller-paths.js";
import { liesAtOrUnder, testFile } from "./path-status.js";
import { cutReason, queryBasis, type DaemonView } from "./summary.js";
import type { TestStanding } from "./test-states.js";

/**
 * A target until measured: how many definitions an answer lists, so the part of an answer that grows with a
 * consumer's catalog stays well under the protocol's line limit.
 */
export const MAX_LISTED_DEFINITIONS = 500;
/** A target until measured: how many gap tests an answer lists, so the part that grows with a consumer's tests does too. */
export const MAX_LISTED_GAP_TESTS = 1_000;

/** A discovered test as an answer names it. */
export interface NamedTest {
  readonly identity: TestIdentity;
  /** Whether the discovery marks it duplicate, told apart from same-named tests only by its position. */
  readonly duplicate: boolean;
}

export interface ListedDefinition {
  /** Null when it has no usable id; its file and position name it. */
  readonly id: string | null;
  /** Relative to the consumer root, `/`-separated. */
  readonly file: string;
  /** Its index in its file's `defects` array. */
  readonly position: number;
  /** As the definition writes it; null when it is not well-formed. */
  readonly test: DefinitionTest | null;
  /** The discovered test it resolves to; null when it resolves to none. */
  readonly resolvedTest: NamedTest | null;
  /** As the definition writes it; null when its mutation is not well-formed. */
  readonly mutationFile: string | null;
  readonly state: DefectState;
  /** Present when it is invalid or its anchor is missing. */
  readonly reason?: CutReason;
}

/** A definition file problem, which lies in every scope. */
export type ListedInvalidEntry = CutReason & {
  readonly kind: InvalidEntryKind;
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
};

export type DefectStateCounts = Readonly<Record<DefectState, number>>;

export interface DefectCounts {
  /** Every definition in scope and every definition file problem. */
  readonly total: number;
  readonly states: DefectStateCounts;
  readonly invalidEntries: number;
}

export interface GapModule {
  /** Relative to the consumer root, `/`-separated. */
  readonly module: string;
  readonly gaps: number;
}

export interface ListedGapModule {
  readonly module: string;
  readonly tests: readonly NamedTest[];
}

export interface DefectsAnswer extends AnswerContext {
  /** The scope, relative to the consumer root; `ROOT_PATH` for the whole worktree. */
  readonly path: string;
  readonly counts: DefectCounts;
  readonly invalidEntries: readonly ListedInvalidEntry[];
  /** Invalid first, then anchor missing, then never verified, up to `MAX_LISTED_DEFINITIONS`. */
  readonly definitions: readonly ListedDefinition[];
  readonly definitionsNotListed: DefectStateCounts;
  /** Discovered tests whose module lies in scope. */
  readonly testsInScope: number;
  /** Tests in scope that no definition's test resolves to. */
  readonly gaps: number;
  /** Every module in scope holding a gap. */
  readonly gapModules: readonly GapModule[];
  /** By module, up to `MAX_LISTED_GAP_TESTS` tests. */
  readonly gapTests: readonly ListedGapModule[];
  readonly gapTestsNotListed: number;
}

export interface DefectsQuery {
  /** Absolute; the whole worktree when undefined. */
  readonly path: string | undefined;
  readonly results: LatestResults;
  readonly daemon: DaemonView;
  readonly inputs: CurrentInputs;
  readonly stateDirectory: string;
  readonly signal: AbortSignal;
}

/**
 * Reads the definition files as they are now, resolves each definition against the latest stored discovery, and
 * answers for the definitions and tests at or under the path; it starts no job.
 */
export async function defectsAnswer(
  query: DefectsQuery,
): Promise<DefectsAnswer | NoAnswer> {
  const { daemon } = query;
  const scope = scopeOf(query.path, daemon.consumerRoot);
  if (!scope.ok) return { noAnswer: scope.reason };
  const basis = queryBasis(query.results, daemon, query.inputs);
  if ("noAnswer" in basis) return basis;
  const files = await readDefinitionFiles(
    daemon.consumerRoot,
    query.stateDirectory,
    query.signal,
  );
  const resolved = await resolveDefinitions(
    checkDefinitions(files.definitions, daemon.consumerRoot),
    basis.discovery.discovery,
    basis.context.discovery.freshness === CURRENT,
    query.signal,
  );
  const definitions = resolved.filter((definition) =>
    inScope(definition, scope.path),
  );
  const tests = basis.standings.filter((standing) =>
    liesAtOrUnder(testFile(standing), scope.path),
  );
  const { invalidEntries } = files;
  if (
    definitions.length === 0 &&
    tests.length === 0 &&
    invalidEntries.length === 0
  ) {
    return {
      noAnswer: `no discovered test, no defect definition and no problem reading the definition files lies at or under ${scope.given}`,
    };
  }
  const covered = new Set(
    resolved.flatMap((definition) =>
      definition.resolved === undefined
        ? []
        : [testIdentityKey(definition.resolved.identity)],
    ),
  );
  const gaps = tests.filter(
    (standing) => !covered.has(testIdentityKey(standing.test.identity)),
  );
  const states = stateCounts(definitions);
  return {
    ...basis.context,
    path: scope.path,
    counts: {
      total: definitions.length + invalidEntries.length,
      states,
      invalidEntries: invalidEntries.length,
    },
    invalidEntries: invalidEntries.map(({ kind, path, reason }) => ({
      kind,
      path,
      ...cutReason(reason),
    })),
    ...listedDefinitions(definitions, states),
    testsInScope: tests.length,
    gaps: gaps.length,
    ...gapLists(gaps),
  };
}

function scopeOf(
  path: string | undefined,
  consumerRoot: string,
): ({ readonly ok: true } & CallerPath) | { ok: false; reason: string } {
  if (path === undefined) {
    return { ok: true, given: consumerRoot, path: ROOT_PATH };
  }
  return resolveCallerPath(path, consumerRoot);
}

/** A definition naming no usable module lies in every scope, since the test it means is unknown. */
function inScope(definition: ResolvedDefinition, scope: string): boolean {
  return (
    definition.modulePath === undefined ||
    liesAtOrUnder(definition.modulePath, scope)
  );
}

function stateCounts(
  definitions: readonly ResolvedDefinition[],
): Record<DefectState, number> {
  const counts = zeroStateCounts();
  for (const definition of definitions) counts[definition.state] += 1;
  return counts;
}

function zeroStateCounts(): Record<DefectState, number> {
  return Object.fromEntries(DEFECT_STATES.map((state) => [state, 0])) as Record<
    DefectState,
    number
  >;
}

/** The first `MAX_LISTED_DEFINITIONS` in state order, then by file and position, and how many of each state were left out. */
function listedDefinitions(
  definitions: readonly ResolvedDefinition[],
  states: DefectStateCounts,
): Pick<DefectsAnswer, "definitions" | "definitionsNotListed"> {
  const ordered = [...definitions].sort(
    (left, right) =>
      DEFECT_STATES.indexOf(left.state) - DEFECT_STATES.indexOf(right.state) ||
      (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) ||
      left.position - right.position,
  );
  const listed = ordered.slice(0, MAX_LISTED_DEFINITIONS);
  const notListed = zeroStateCounts();
  for (const state of DEFECT_STATES) {
    notListed[state] =
      states[state] -
      listed.filter((definition) => definition.state === state).length;
  }
  return {
    definitions: listed.map(listedDefinition),
    definitionsNotListed: notListed,
  };
}

function listedDefinition(definition: ResolvedDefinition): ListedDefinition {
  const { resolved, reason } = definition;
  return {
    id: definition.id ?? null,
    file: definition.file,
    position: definition.position,
    test: definition.test ?? null,
    resolvedTest:
      resolved === undefined
        ? null
        : { identity: resolved.identity, duplicate: resolved.isDuplicate },
    mutationFile: definition.mutation?.file ?? null,
    state: definition.state,
    ...(reason === undefined ? {} : { reason: cutReason(reason) }),
  };
}

/** Every module holding a gap with its count, and the gap tests by module up to `MAX_LISTED_GAP_TESTS`. */
function gapLists(
  gaps: readonly TestStanding[],
): Pick<DefectsAnswer, "gapModules" | "gapTests" | "gapTestsNotListed"> {
  const byModule = new Map<string, TestStanding[]>();
  for (const gap of gaps) {
    const module = testFile(gap);
    const group = byModule.get(module);
    if (group === undefined) byModule.set(module, [gap]);
    else group.push(gap);
  }
  const modules = [...byModule.keys()].sort();
  const gapTests: ListedGapModule[] = [];
  let room = MAX_LISTED_GAP_TESTS;
  for (const module of modules) {
    if (room === 0) break;
    const listed = (byModule.get(module) ?? []).slice(0, room);
    room -= listed.length;
    gapTests.push({
      module,
      tests: listed.map(({ test }) => ({
        identity: test.identity,
        duplicate: test.isDuplicate,
      })),
    });
  }
  return {
    gapModules: modules.map((module) => ({
      module,
      gaps: byModule.get(module)?.length ?? 0,
    })),
    gapTests,
    gapTestsNotListed: gaps.length - (MAX_LISTED_GAP_TESTS - room),
  };
}
