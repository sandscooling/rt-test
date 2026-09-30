import {
  assessEvidence,
  assessFreshness,
  testIdentityKey,
  type Freshness,
  type TestIdentity,
  type TestOutcome,
} from "@rt-test/core";
import type { FingerprintResult } from "../inputs/fingerprint.js";
import { NOT_FINGERPRINTED } from "../store/schema.js";
import type { StoredDiscovery, StoredRun } from "../store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../vitest/adapter-version.js";
import type { DiscoveredTest } from "../vitest/discover-tests.js";
import type { RecordedModule, RecordedTest } from "../vitest/run-states.js";
import {
  FRESHNESS_VALUES,
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
  STALE,
  TEST_STATES,
  UNKNOWN,
  type TestCounts,
  type TestState,
} from "./answer.js";

/** A discovered test with its one state and its freshness. */
export interface TestStanding {
  readonly test: DiscoveredTest;
  readonly state: TestState;
  readonly freshness: Freshness;
}

/** What a run holds for one test: a finished outcome, or the state that stands in for one. */
type RunAnswer =
  | {
      readonly outcome: TestOutcome;
      /** Whether the run told the test apart from same-named ones only by its position. */
      readonly positional: boolean;
    }
  | { readonly state: Exclude<TestState, TestOutcome> };

/** The digest of an unfingerprinted record, which rates unknown. */
const NO_FINGERPRINT = "";

/** A workspace's current input fingerprint by its path; undefined when none can be computed now. */
export type CurrentFingerprints = (workspacePath: string) => string | undefined;

/** A stored run or discovery: what it was produced from. */
type StoredBasis = Pick<StoredRun, "adapterVersion" | "inputFingerprint">;

const RUN_STATES = {
  failed: RUN_FAILED,
  unsupported: RUN_UNSUPPORTED_VITEST,
  "interrupted-before-load": RUN_INTERRUPTED_BEFORE_LOAD,
  crashed: RUN_CRASHED,
} as const;
const MODULE_STATES = {
  "not-run": MODULE_NOT_RUN,
  crashed: MODULE_CRASHED,
  failed: MODULE_FAILED_TO_LOAD,
} as const;

/**
 * Every test of every discovered workspace of the discovery, each answered only by its workspace's latest run, or
 * `run-refused` when `refusedRuns` holds that workspace's path. A test the discovery or the run marks duplicate is
 * matched to its result by its position, which only a current discovery vouches for.
 */
export function testStandings(
  discovery: StoredDiscovery,
  latestRuns: ReadonlyMap<string, StoredRun>,
  refusedRuns: ReadonlyMap<string, string>,
  current: CurrentFingerprints,
  discoveryIsCurrent: boolean,
): TestStanding[] {
  return discovery.discovery.workspaces.flatMap((entry) => {
    if (entry.status !== "discovered") return [];
    const path = entry.workspace.path;
    if (refusedRuns.has(path)) return unanswered(entry.tests, RUN_REFUSED);
    return workspaceStandings(
      entry.tests,
      latestRuns.get(path),
      current(path),
      discoveryIsCurrent,
    );
  });
}

/** Tests no stored run answers, each in the one state that says why. */
function unanswered(
  tests: readonly DiscoveredTest[],
  state: typeof NEVER_RUN | typeof RUN_REFUSED,
): TestStanding[] {
  return tests.map((test) => ({ test, state, freshness: UNKNOWN }));
}

function workspaceStandings(
  tests: readonly DiscoveredTest[],
  stored: StoredRun | undefined,
  currentFingerprint: string | undefined,
  discoveryIsCurrent: boolean,
): TestStanding[] {
  if (stored === undefined) return unanswered(tests, NEVER_RUN);
  const answer = runAnswerer(stored);
  return tests.map((test) => {
    const found = answer(test.identity);
    return "outcome" in found
      ? {
          test,
          state: found.outcome,
          freshness: storedFreshness(stored, (digest) =>
            positionUnvouched(test, found.positional, discoveryIsCurrent)
              ? UNKNOWN
              : assessEvidence(
                  { fingerprint: digest, outcome: found.outcome },
                  currentFingerprint,
                ).freshness,
          ),
        }
      : { test, state: found.state, freshness: UNKNOWN };
  });
}

/**
 * A test marked duplicate by the discovery or by the run that answers it is told apart only by its position, which
 * only a current discovery vouches for.
 */
function positionUnvouched(
  test: DiscoveredTest,
  recordedPositional: boolean,
  discoveryIsCurrent: boolean,
): boolean {
  return (test.isDuplicate || recordedPositional) && !discoveryIsCurrent;
}

/** The digest of a computed fingerprint; undefined when none could be computed. */
export function fingerprintDigest(
  print: FingerprintResult | undefined,
): string | undefined {
  return print?.ok === true ? print.digest : undefined;
}

/** A stored run's or discovery's freshness against a current fingerprint, decided as a finished result's is. */
export function recordFreshness(
  stored: StoredBasis,
  currentFingerprint: string | undefined,
): Freshness {
  return storedFreshness(stored, (digest) =>
    assessFreshness(digest, currentFingerprint),
  );
}

/**
 * Stale when stored under another adapter version, whatever the inputs; otherwise `assess` rates the stored digest
 * against the current fingerprint, and a record stored not fingerprinted has none, so it is unknown.
 */
function storedFreshness(
  stored: StoredBasis,
  assess: (digest: string) => Freshness,
): Freshness {
  if (!isCurrentAdapterVersion(stored.adapterVersion)) return STALE;
  const fingerprint = stored.inputFingerprint;
  return assess(
    fingerprint.kind === NOT_FINGERPRINTED
      ? NO_FINGERPRINT
      : fingerprint.digest,
  );
}

/** A record stored under another adapter version was recorded under another meaning. */
export function isCurrentAdapterVersion(adapterVersion: number): boolean {
  return adapterVersion === VITEST_ADAPTER_VERSION;
}

function runAnswerer(stored: StoredRun): (identity: TestIdentity) => RunAnswer {
  const run = stored.run;
  if (run.status !== "ran") {
    const state = RUN_STATES[run.status];
    return () => ({ state });
  }
  const modules = new Map(
    run.modules.map((module) => [moduleKey(module), module]),
  );
  const tests = new Map(
    run.modules
      .flatMap((module) => (module.state === "ran" ? module.tests : []))
      .map((test) => [testIdentityKey(test.identity), test]),
  );
  return (identity) => {
    const test = tests.get(testIdentityKey(identity));
    if (test !== undefined) return recordedAnswer(test);
    const module = modules.get(moduleKey(identity));
    if (module !== undefined && module.state !== "ran") {
      return { state: MODULE_STATES[module.state] };
    }
    return { state: NOT_IN_LATEST_RUN };
  };
}

function recordedAnswer(test: RecordedTest): RunAnswer {
  return test.execution === "finished"
    ? { outcome: test.outcome, positional: test.isDuplicate }
    : { state: INTERRUPTED };
}

function moduleKey(
  module: Pick<RecordedModule, "projectName" | "modulePath">,
): string {
  return JSON.stringify([module.projectName, module.modulePath]);
}

/** Counts each standing once by state and once by freshness, listing every state and freshness, zero or not. */
export function countStandings(standings: readonly TestStanding[]): TestCounts {
  const states = zeroCounts(TEST_STATES);
  const freshness = zeroCounts(FRESHNESS_VALUES);
  for (const standing of standings) {
    states[standing.state] += 1;
    freshness[standing.freshness] += 1;
  }
  return { tests: standings.length, states, freshness };
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}
