import { assessFreshness, testIdentityKey } from "@rt-test/core";
import { FALSIFIER_VERSION } from "../falsify/experiment-record.js";
import { ERROR_KIND, type ErrorFact } from "../falsify/fact-types.js";
import { UNCLEAR_REASON } from "../falsify/verdict.js";
import { wholeDigest } from "../inputs/input-inventory.js";
import {
  CURRENT,
  FRESHNESS_VALUES,
  STALE,
  UNKNOWN,
  type FreshnessCounts,
  type TestState,
} from "../query/answer.js";
import {
  isCurrentAdapterVersion,
  type CurrentFingerprints,
  type TestStanding,
} from "../query/test-states.js";
import type {
  LatestEvidence,
  StoredEvidence,
} from "../store/defect-evidence.js";
import type { StoredJudgement } from "../store/evidence-facts.js";
import type {
  DiscoveredTest,
  TestDiscovery,
} from "../vitest/discover-tests.js";
import { relativePosixPath } from "../vitest/find-workspaces.js";
import {
  DEFECT_STATE,
  DEFECT_STATES,
  type DefectState,
} from "./defect-states.js";
import type { DefinitionMutation } from "./definitions.js";
import type { ResolvedDefinition } from "./resolve-definitions.js";

/** What a record was decided from that no longer holds, each of which alone makes its evidence stale. */
const STALE_CAUSE = {
  definitionChanged: "definition-changed",
  mutationFileChanged: "mutation-file-changed",
  anotherAdapterVersion: "another-adapter-version",
  anotherFalsifierVersion: "another-falsifier-version",
  anotherVitestVersion: "another-vitest-version",
  inputsChanged: "inputs-changed",
} as const;

export type StaleCause = (typeof STALE_CAUSE)[keyof typeof STALE_CAUSE];

const STALE_CAUSES = Object.values(STALE_CAUSE);

/** Why evidence that no cause makes stale still cannot be called current. */
const UNKNOWN_REASON = {
  noCurrentFingerprint: "no-current-fingerprint",
  /** Its test is told apart from same-named tests only by its position, which only a current discovery vouches for. */
  duplicateTest: "duplicate-test-discovery-not-current",
} as const;

export type UnknownReason =
  (typeof UNKNOWN_REASON)[keyof typeof UNKNOWN_REASON];

const UNKNOWN_REASONS = Object.values(UNKNOWN_REASON);

/** A target until measured: how many of a test's errors a standing lists, so a listing of standings stays bounded. */
const MAX_LISTED_ERRORS = 3;
const PASSED = "passed" satisfies TestState;
const UNREADABLE_EVIDENCE =
  "its stored evidence was refused as unreadable, so it reads as none";

type ReasonedJudgement = Extract<StoredJudgement, { readonly reason: string }>;
type DetailOf<J> = J extends unknown ? J[Extract<keyof J, "detail">] : never;

export type VerdictReason = ReasonedJudgement["reason"];
export type VerdictDetail = NonNullable<DetailOf<ReasonedJudgement>>;

/** Whether stored evidence still describes what it was decided from, decided when asked and never stored. */
export type EvidenceFreshness =
  | { readonly freshness: typeof CURRENT }
  | {
      readonly freshness: typeof STALE;
      /** Every cause that holds. */
      readonly staleCauses: readonly StaleCause[];
    }
  | {
      readonly freshness: typeof UNKNOWN;
      /** Every reason that applies; read only when no cause of staleness holds. */
      readonly unknownReasons: readonly UnknownReason[];
    };

export interface ListedErrors {
  /** As the store holds them, those that are not assertions first, up to `MAX_LISTED_ERRORS`. */
  readonly listed: readonly ErrorFact[];
  readonly notListed: number;
}

export type EvidenceStanding = EvidenceFreshness & {
  /** Absent for a detection and a survivor, and on a record of another falsifier version, which is not interpreted. */
  readonly reason?: VerdictReason;
  readonly detail?: VerdictDetail;
  /** The errors the intended test held in the experiment's run, when the reason is that one is not an assertion. */
  readonly errors?: ListedErrors;
};

/** A definition's one state, with what its stored evidence says of it when it reads a verdict. */
export interface DefectStanding {
  readonly definition: ResolvedDefinition;
  readonly state: DefectState;
  /** Why it is invalid, its anchor is missing, or its stored evidence was refused. */
  readonly reason?: string;
  /** Whether `reason` is the refusal of its stored evidence, which then reads as none. */
  readonly evidenceUnreadable: boolean;
  /** Valid, anchored, and its resolved test holds a current pass, so it can be falsified now. */
  readonly eligible: boolean;
  /** Present when the definition is valid and resolved. */
  readonly definitionDigest?: string;
  /** Present only beside a verdict. */
  readonly evidence?: EvidenceStanding;
}

/**
 * What the standings are decided from: facts of one moment of the daemon, beside the consumer root and the declared
 * names, which are as `rt-test.json` was read before it.
 */
export interface StandingFacts {
  readonly consumerRoot: string;
  /** The error names `rt-test.json` declares as assertions, as it writes them. */
  readonly assertionErrors: readonly string[];
  readonly evidence: LatestEvidence;
  /** The latest stored discovery, whose workspaces report the Vitest version each was discovered under. */
  readonly discovery: TestDiscovery;
  readonly discoveryCurrent: boolean;
  readonly currentFingerprint: CurrentFingerprints;
  readonly testStandings: readonly TestStanding[];
}

export interface DefectStandingCounts {
  readonly states: Readonly<Record<DefectState, number>>;
  /** Over the definitions that read a verdict. */
  readonly freshness: FreshnessCounts;
  /** A definition is counted under every cause that holds for it. */
  readonly staleCauses: Readonly<Record<StaleCause, number>>;
  /** A definition is counted under every reason that applies to it. */
  readonly unknownReasons: Readonly<Record<UnknownReason, number>>;
  /** Definitions that read never verified because their stored evidence was refused as unreadable. */
  readonly unreadableEvidence: number;
  readonly eligible: number;
  /** Definitions that read detected with evidence freshness current. */
  readonly verified: number;
}

/** The members of a valid, resolved definition its digest covers. */
interface DigestSubject {
  readonly id: string;
  readonly test: DiscoveredTest;
  readonly mutation: DefinitionMutation;
  readonly mutationPath: string;
}

interface StandingIndex {
  readonly consumerRoot: string;
  /** The declared names as a set: each once, in code unit order. */
  readonly assertionErrors: readonly string[];
  readonly evidence: ReadonlyMap<string, StoredEvidence>;
  readonly refusals: ReadonlyMap<string, string>;
  /** The Vitest version of each discovered workspace, by its path. */
  readonly vitestVersions: ReadonlyMap<string, string>;
  /** The identity key of each test holding a current pass. */
  readonly currentPasses: ReadonlySet<string>;
  readonly currentFingerprint: CurrentFingerprints;
  readonly discoveryCurrent: boolean;
}

type Tally<K extends string> = Record<K, number>;

/**
 * Each definition's standing. A definition that is invalid or whose anchor is missing reads that, whatever evidence is
 * stored for its id; every other reads its stored verdict, or never verified when the store holds none it can read.
 */
export function defectStandings(
  definitions: readonly ResolvedDefinition[],
  facts: StandingFacts,
): DefectStanding[] {
  const index = standingIndex(facts);
  return definitions.map((definition) => standingOf(definition, index));
}

/**
 * The order a listing of standings takes: by state in `DEFECT_STATES` order, within a state evidence that is not
 * current before current, then by file and position.
 */
export function compareStandings(
  left: DefectStanding,
  right: DefectStanding,
): number {
  return (
    DEFECT_STATES.indexOf(left.state) - DEFECT_STATES.indexOf(right.state) ||
    currentRank(left) - currentRank(right) ||
    compareFiles(left.definition.file, right.definition.file) ||
    left.definition.position - right.definition.position
  );
}

/** Evidence that is not current sorts before current evidence; a state that reads no evidence has one rank. */
function currentRank(standing: DefectStanding): number {
  return standing.evidence?.freshness === CURRENT ? 1 : 0;
}

function compareFiles(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Every count is over all the standings given, whatever an answer goes on to list of them. */
export function countDefectStandings(
  standings: readonly DefectStanding[],
): DefectStandingCounts {
  const states = zeroTally(DEFECT_STATES);
  const freshness = zeroTally(FRESHNESS_VALUES);
  const staleCauses = zeroTally(STALE_CAUSES);
  const unknownReasons = zeroTally(UNKNOWN_REASONS);
  for (const standing of standings) {
    states[standing.state] += 1;
    const { evidence } = standing;
    if (evidence === undefined) continue;
    freshness[evidence.freshness] += 1;
    for (const cause of staleCausesOf(evidence)) staleCauses[cause] += 1;
    for (const reason of unknownReasonsOf(evidence)) {
      unknownReasons[reason] += 1;
    }
  }
  return {
    states,
    freshness,
    staleCauses,
    unknownReasons,
    unreadableEvidence: standings.filter(
      (standing) => standing.evidenceUnreadable,
    ).length,
    eligible: standings.filter((standing) => standing.eligible).length,
    verified: standings.filter(isVerified).length,
  };
}

function isVerified(standing: DefectStanding): boolean {
  return (
    standing.state === DEFECT_STATE.detected &&
    standing.evidence?.freshness === CURRENT
  );
}

function staleCausesOf(evidence: EvidenceFreshness): readonly StaleCause[] {
  return evidence.freshness === STALE ? evidence.staleCauses : [];
}

function unknownReasonsOf(
  evidence: EvidenceFreshness,
): readonly UnknownReason[] {
  return evidence.freshness === UNKNOWN ? evidence.unknownReasons : [];
}

function zeroTally<K extends string>(keys: readonly K[]): Tally<K> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Tally<K>;
}

function standingIndex(facts: StandingFacts): StandingIndex {
  return {
    consumerRoot: facts.consumerRoot,
    assertionErrors: [...new Set(facts.assertionErrors)].sort(),
    evidence: new Map(
      facts.evidence.evidence.map((record) => [record.defectId, record]),
    ),
    refusals: new Map(
      facts.evidence.evidenceRefusals.map((refusal) => [
        refusal.defectId,
        refusal.reason,
      ]),
    ),
    vitestVersions: new Map(
      facts.discovery.workspaces.flatMap((entry) =>
        entry.status === "discovered"
          ? [[entry.workspace.path, entry.vitestVersion] as const]
          : [],
      ),
    ),
    currentPasses: new Set(
      facts.testStandings
        .filter(
          (standing) =>
            standing.state === PASSED && standing.freshness === CURRENT,
        )
        .map((standing) => testIdentityKey(standing.test.identity)),
    ),
    currentFingerprint: facts.currentFingerprint,
    discoveryCurrent: facts.discoveryCurrent,
  };
}

function standingOf(
  definition: ResolvedDefinition,
  index: StandingIndex,
): DefectStanding {
  const subject = digestSubject(definition);
  if (
    subject === undefined ||
    definition.state !== DEFECT_STATE.neverVerified
  ) {
    return notRunnable(definition, subject, index);
  }
  const digest = definitionDigest(subject, index);
  const shared = {
    definition,
    eligible: index.currentPasses.has(testIdentityKey(subject.test.identity)),
    definitionDigest: digest,
  };
  const record = index.evidence.get(subject.id);
  if (record === undefined) {
    return { ...shared, ...neverVerified(index.refusals.get(subject.id)) };
  }
  return {
    ...shared,
    state: record.verdict,
    evidenceUnreadable: false,
    evidence: {
      ...evidenceFreshness(record, digest, subject.test, definition, index),
      ...judgementParts(record.judgement),
    },
  };
}

/** Invalid or anchor missing: it reads no stored evidence and cannot be falsified now. */
function notRunnable(
  definition: ResolvedDefinition,
  subject: DigestSubject | undefined,
  index: StandingIndex,
): DefectStanding {
  const { reason } = definition;
  return {
    definition,
    state: definition.state,
    ...(reason === undefined ? {} : { reason }),
    evidenceUnreadable: false,
    eligible: false,
    ...(subject === undefined
      ? {}
      : { definitionDigest: definitionDigest(subject, index) }),
  };
}

/** A refused record is never a verdict: the definition reads as holding none, and says why. */
function neverVerified(
  refusal: string | undefined,
): Pick<DefectStanding, "state" | "reason" | "evidenceUnreadable"> {
  return refusal === undefined
    ? { state: DEFECT_STATE.neverVerified, evidenceUnreadable: false }
    : {
        state: DEFECT_STATE.neverVerified,
        reason: `${UNREADABLE_EVIDENCE}: ${refusal}`,
        evidenceUnreadable: true,
      };
}

function digestSubject(
  definition: ResolvedDefinition,
): DigestSubject | undefined {
  const { id, resolved, mutation, mutationPath } = definition;
  if (
    definition.state === DEFECT_STATE.invalidDefinition ||
    id === undefined ||
    resolved === undefined ||
    mutation === undefined ||
    mutationPath === undefined
  ) {
    return undefined;
  }
  return { id, test: resolved, mutation, mutationPath };
}

/**
 * Covers the definition's id, its resolved test's whole identity and its mutation, the file named relative to the
 * consumer root so that every spelling of one path digests alike, and the declared assertion error names as a set,
 * since they decide which of the test's errors a verdict counts as an assertion. It holds none of the text it digests.
 */
function definitionDigest(
  subject: DigestSubject,
  index: Pick<StandingIndex, "consumerRoot" | "assertionErrors">,
): string {
  const { id, test, mutation, mutationPath } = subject;
  return wholeDigest(
    JSON.stringify([
      id,
      testIdentityKey(test.identity),
      relativePosixPath(index.consumerRoot, mutationPath),
      mutation.old,
      mutation.new,
      index.assertionErrors,
    ]),
  );
}

/**
 * Stale under every cause that holds, the fingerprint's among them only when a current one can be computed and
 * differs. Unknown only when no cause holds, so a fingerprint that cannot be computed never hides a certain cause.
 */
function evidenceFreshness(
  record: StoredEvidence,
  digest: string,
  test: DiscoveredTest,
  definition: ResolvedDefinition,
  index: StandingIndex,
): EvidenceFreshness {
  const { workspacePath } = test.identity;
  const fingerprint = assessFreshness(
    record.inputFingerprintDigest,
    index.currentFingerprint(workspacePath),
  );
  const holding: Record<StaleCause, boolean> = {
    [STALE_CAUSE.definitionChanged]: record.definitionDigest !== digest,
    [STALE_CAUSE.mutationFileChanged]:
      record.mutationFileDigest !== definition.mutationFileDigest,
    [STALE_CAUSE.anotherAdapterVersion]: !isCurrentAdapterVersion(
      record.adapterVersion,
    ),
    [STALE_CAUSE.anotherFalsifierVersion]:
      record.falsifierVersion !== FALSIFIER_VERSION,
    [STALE_CAUSE.anotherVitestVersion]:
      record.vitestVersion !== index.vitestVersions.get(workspacePath),
    [STALE_CAUSE.inputsChanged]: fingerprint === STALE,
  };
  const staleCauses = STALE_CAUSES.filter((cause) => holding[cause]);
  if (staleCauses.length > 0) return { freshness: STALE, staleCauses };
  const unknownReasons = [
    ...(fingerprint === UNKNOWN ? [UNKNOWN_REASON.noCurrentFingerprint] : []),
    ...(test.isDuplicate && !index.discoveryCurrent
      ? [UNKNOWN_REASON.duplicateTest]
      : []),
  ];
  return unknownReasons.length > 0
    ? { freshness: UNKNOWN, unknownReasons }
    : { freshness: CURRENT };
}

function judgementParts(
  judgement: StoredJudgement | undefined,
): Pick<EvidenceStanding, "reason" | "detail" | "errors"> {
  if (judgement === undefined || !("reason" in judgement)) return {};
  const detail = "detail" in judgement ? judgement.detail : undefined;
  const errors = notAssertionErrors(judgement);
  return {
    reason: judgement.reason,
    ...(detail === undefined ? {} : { detail }),
    ...(errors === undefined ? {} : { errors }),
  };
}

/** The errors that are not assertions come first, since they are what made the verdict and what a consumer must name. */
function notAssertionErrors(
  judgement: ReasonedJudgement,
): ListedErrors | undefined {
  if (judgement.reason !== UNCLEAR_REASON.notAnAssertion) return undefined;
  const { facts } = judgement;
  const errors = "run" in facts ? (facts.run.test?.errors ?? []) : [];
  const ordered = [
    ...errors.filter((error) => error.kind !== ERROR_KIND.assertion),
    ...errors.filter((error) => error.kind === ERROR_KIND.assertion),
  ];
  return {
    listed: ordered.slice(0, MAX_LISTED_ERRORS),
    notListed: Math.max(0, ordered.length - MAX_LISTED_ERRORS),
  };
}
