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
  countDefectStandings,
  defectStandings,
  type DefectStanding,
  type DefectStandingCounts,
  type EvidenceFreshness,
  type EvidenceStanding,
  type VerdictDetail,
  type VerdictReason,
} from "../defects/defect-standings.js";
import { DEFECT_STATES, type DefectState } from "../defects/defect-states.js";
import {
  readAnchors,
  resolveDefinitions,
  type ResolvedDefinition,
} from "../defects/resolve-definitions.js";
import type { WaitMoment } from "../daemon/waits.js";
import type { ErrorFact } from "../falsify/fact-types.js";
import { ROOT_PATH } from "../vitest/find-workspaces.js";
import {
  CURRENT,
  type AnswerContext,
  type CutReason,
  type NoAnswer,
} from "./answer.js";
import {
  resolveCallerPath,
  type CallerPathResolution,
} from "./caller-paths.js";
import { liesAtOrUnder, testFile } from "./path-status.js";
import { cutReason, queryBasis } from "./summary.js";
import type { TestStanding } from "./test-states.js";

/**
 * A target until measured: how many definitions an answer lists, so the part of an answer that grows with a
 * consumer's catalog stays well under the protocol's line limit.
 */
const MAX_LISTED_DEFINITIONS = 500;
/** A target until measured: how many gap tests an answer lists, so the part that grows with a consumer's tests does too. */
const MAX_LISTED_GAP_TESTS = 1_000;

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
  /** Whether it is valid, its anchor matches and its test holds a current pass, so it can be falsified now. */
  readonly eligible: boolean;
  /** Present when it is invalid, its anchor is missing, or its stored evidence was refused as unreadable. */
  readonly reason?: CutReason;
  /** Present only beside a verdict. */
  readonly evidence?: ListedEvidence;
}

/** An error of the intended test, by its kind and the name Vitest serialized, cut; no name when it serialized none. */
export type ListedError = Pick<ErrorFact, "kind" | "name">;

/** What a listed definition's stored evidence says beside its verdict, every text in it cut. */
export type ListedEvidence = EvidenceFreshness & {
  /** Absent for a detection and a survivor, and on evidence stored under another falsifier version. */
  readonly reason?: VerdictReason;
  readonly detail?: VerdictDetail;
  /** Present when the reason is that an error is not an assertion, up to the standings' bound. */
  readonly errors?: readonly ListedError[];
  readonly errorsNotListed?: number;
  /** Present beside a detail or errors: how many characters were cut from their texts, which the store holds whole. */
  readonly omittedCharacters?: number;
};

/** A definition file problem, which lies in every scope. */
export type ListedInvalidEntry = CutReason & {
  readonly kind: InvalidEntryKind;
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
};

export type DefectStateCounts = Readonly<Record<DefectState, number>>;

/** Counts over every definition in scope, whatever the listing leaves out. */
export interface DefectCounts extends DefectStandingCounts {
  /** Every definition in scope and every definition file problem: what `verified` is read against. */
  readonly total: number;
  readonly invalidEntries: number;
}

export interface GapModule {
  /** Relative to the consumer root, `/`-separated. */
  readonly module: string;
  readonly gaps: number;
}

/** A value with its texts cut, and how many characters the cuts left out in all. */
interface Cut<T> {
  readonly value: T;
  readonly omittedCharacters: number;
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
  /**
   * In `DEFECT_STATES` order, within a state evidence that is not current before current, then by file and position,
   * up to `MAX_LISTED_DEFINITIONS`.
   */
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
  readonly consumerRoot: string;
  readonly stateDirectory: string;
  readonly signal: AbortSignal;
  /** The latest stored results, the daemon's view and the inputs, read when it is called. */
  readonly moment: () => WaitMoment;
}

/**
 * Reads the definition files and each mutation's file as they are now, then takes the daemon's moment and resolves
 * each definition against the latest stored discovery without awaiting again, so the facts the answer carries are
 * those that hold when it answers. It answers for the definitions and tests at or under the path, and starts no job.
 * Once the signal aborts nobody waits for the answer and a stop may have closed the store, so it reads no moment.
 */
export async function defectsAnswer(
  query: DefectsQuery,
): Promise<DefectsAnswer | NoAnswer> {
  const { consumerRoot, signal } = query;
  const scope = scopeOf(query.path, consumerRoot);
  if (!scope.ok) return { noAnswer: scope.reason };
  const files = await readDefinitionFiles(
    consumerRoot,
    query.stateDirectory,
    signal,
  );
  const checked = checkDefinitions(files.definitions, consumerRoot);
  const anchors = await readAnchors(checked, signal);
  signal.throwIfAborted();
  const { results, view, inputs } = query.moment();
  const basis = queryBasis(results, view, inputs);
  if ("noAnswer" in basis) return basis;
  const discoveryCurrent = basis.context.discovery.freshness === CURRENT;
  const resolved = resolveDefinitions(
    checked,
    anchors,
    basis.discovery.discovery,
    discoveryCurrent,
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
  const standings = defectStandings(definitions, {
    consumerRoot,
    evidence: results,
    discovery: basis.discovery.discovery,
    discoveryCurrent,
    currentFingerprint: basis.currentFingerprint,
    testStandings: basis.standings,
  });
  const counts = countDefectStandings(standings);
  return {
    ...basis.context,
    path: scope.path,
    counts: {
      total: definitions.length + invalidEntries.length,
      ...counts,
      invalidEntries: invalidEntries.length,
    },
    invalidEntries: invalidEntries.map(({ kind, path, reason }) => ({
      kind,
      path,
      ...cutReason(reason),
    })),
    ...listedDefinitions(standings, counts.states),
    testsInScope: tests.length,
    gaps: gaps.length,
    ...gapLists(gaps),
  };
}

function scopeOf(
  path: string | undefined,
  consumerRoot: string,
): CallerPathResolution {
  if (path === undefined) {
    return { ok: true, given: consumerRoot, path: ROOT_PATH };
  }
  return resolveCallerPath(path, consumerRoot);
}

/**
 * A definition whose module the latest discovery does not list, or that names no usable one, lies in every scope:
 * a misspelled module path places it nowhere, so no scope could otherwise count it.
 */
function inScope(definition: ResolvedDefinition, scope: string): boolean {
  return (
    definition.discoveredModule === undefined ||
    liesAtOrUnder(definition.discoveredModule, scope)
  );
}

/**
 * The first `MAX_LISTED_DEFINITIONS` in state order, within a state those whose evidence is not current first, then
 * by file and position, and how many of each state were left out.
 */
function listedDefinitions(
  standings: readonly DefectStanding[],
  states: DefectStateCounts,
): Pick<DefectsAnswer, "definitions" | "definitionsNotListed"> {
  const ordered = [...standings].sort(
    (left, right) =>
      DEFECT_STATES.indexOf(left.state) - DEFECT_STATES.indexOf(right.state) ||
      currentRank(left) - currentRank(right) ||
      compareFiles(left.definition.file, right.definition.file) ||
      left.definition.position - right.definition.position,
  );
  const listed = ordered.slice(0, MAX_LISTED_DEFINITIONS);
  return {
    definitions: listed.map(listedDefinition),
    definitionsNotListed: Object.fromEntries(
      DEFECT_STATES.map((state) => [
        state,
        states[state] -
          listed.filter((standing) => standing.state === state).length,
      ]),
    ) as Record<DefectState, number>,
  };
}

/** Evidence that is not current sorts before current evidence; a state that reads no evidence has one rank. */
function currentRank(standing: DefectStanding): number {
  return standing.evidence?.freshness === CURRENT ? 1 : 0;
}

function compareFiles(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function listedDefinition(standing: DefectStanding): ListedDefinition {
  const { definition, reason, evidence } = standing;
  const { resolved } = definition;
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
    state: standing.state,
    eligible: standing.eligible,
    ...(reason === undefined ? {} : { reason: cutReason(reason) }),
    ...(evidence === undefined ? {} : { evidence: listedEvidence(evidence) }),
  };
}

function listedEvidence(evidence: EvidenceStanding): ListedEvidence {
  const { reason, detail, errors, ...freshness } = evidence;
  const texts = cutTexts({
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors: errors.listed.map(listedError) }),
  });
  return {
    ...freshness,
    ...(reason === undefined ? {} : { reason }),
    ...texts.value,
    ...(errors === undefined ? {} : { errorsNotListed: errors.notListed }),
    ...(detail === undefined && errors === undefined
      ? {}
      : { omittedCharacters: texts.omittedCharacters }),
  };
}

function listedError({ kind, name }: ErrorFact): ListedError {
  return { kind, ...(name === undefined ? {} : { name }) };
}

/**
 * The value with every text in it cut as a reason is, at any depth, so no suite or error name in a listed
 * definition's evidence is carried whole past the cut. A value of a closed set is shorter than the cut and comes
 * back whole.
 */
function cutTexts<T>(value: T): Cut<T> {
  if (typeof value === "string") {
    const { reason, omittedCharacters } = cutReason(value);
    return { value: reason as T, omittedCharacters };
  }
  if (Array.isArray(value)) {
    const items = value.map((item: unknown) => cutTexts(item));
    return {
      value: items.map((item) => item.value) as T,
      omittedCharacters: omittedIn(items),
    };
  }
  if (typeof value !== "object" || value === null) {
    return { value, omittedCharacters: 0 };
  }
  const members = Object.entries(value).map(
    ([key, member]) => [key, cutTexts(member as unknown)] as const,
  );
  return {
    value: Object.fromEntries(
      members.map(([key, member]) => [key, member.value]),
    ) as T,
    omittedCharacters: omittedIn(members.map(([, member]) => member)),
  };
}

function omittedIn(cuts: readonly Cut<unknown>[]): number {
  return cuts.reduce((total, cut) => total + cut.omittedCharacters, 0);
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
