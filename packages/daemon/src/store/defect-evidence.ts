import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import {
  FALSIFIER_VERSION,
  type FalsificationJob,
} from "../falsify/experiment-record.js";
import { judge, UNCLEAR_REASON, VERDICT } from "../falsify/verdict.js";
import { isRecord } from "../json-guards.js";
import { VITEST_ADAPTER_VERSION } from "../vitest/adapter-version.js";
import { errorText } from "../vitest/error-text.js";
import {
  column,
  integer,
  json,
  jsonMember,
  jsonRecord,
  member,
  optionalText,
  text,
  unreadable,
  UnreadableRecordError,
  type Members,
  type Row,
} from "./columns.js";
import {
  storedFacts,
  invalidReading,
  invalidRunReading,
  type ConfirmingReading,
  type StoredJudgement,
  type Verdict,
  type VerdictReading,
} from "./evidence-facts.js";
import { FINGERPRINT_DIGEST } from "./schema.js";
import {
  fingerprintColumns,
  requireScope,
  type StoreScope,
} from "./stored-records.js";
import { inRecordWrite } from "./transaction.js";

/**
 * The project and worktree, and the digest of the workspace's input fingerprint the job ran at. A job whose inputs
 * the daemon could not vouch for from its start to its end has no such digest, and its reply is never stored.
 */
export interface EvidenceBindings extends StoreScope {
  readonly inputFingerprintDigest: string;
}

/** One defect's falsification verdict, bound to what it was decided from. */
export interface StoredEvidence extends EvidenceBindings {
  /** The identity the store gave the reply this record was stored from. */
  readonly evidenceId: string;
  readonly defectId: string;
  readonly definitionDigest: string;
  readonly mutationFileDigest: string;
  readonly vitestVersion: string;
  readonly falsifierVersion: number;
  readonly adapterVersion: number;
  readonly verdict: Verdict;
  /** Absent on a record stored under another falsifier version, whose reason, detail and facts are not read. */
  readonly judgement?: StoredJudgement;
}

/** A defect whose stored evidence was refused as unreadable, and why. */
export interface EvidenceRefusal {
  readonly defectId: string;
  readonly reason: string;
}

export interface LatestEvidence {
  /** Each defect's one evidence record, less each refused one. */
  readonly evidence: readonly StoredEvidence[];
  /** Each defect whose record was refused as unreadable; it reads as holding no evidence. */
  readonly evidenceRefusals: readonly EvidenceRefusal[];
}

/** What a `ran` reply holds that the store reads; its raw run records are never read. */
interface RanReply {
  readonly vitestVersion: string;
  readonly falsifierVersion: number;
  readonly judgements: readonly unknown[];
  readonly experiments: readonly unknown[];
}

/** A judgement as a row's columns hold it; a NULL reason or detail is one its verdict has none of. */
interface JudgementColumns {
  readonly verdict: Verdict;
  readonly reason: string | null;
  readonly detail: string | null;
  readonly facts: string;
}

/** One verdict of a reply, every refusal already checked, as its row will hold it. */
interface EvidenceRow {
  readonly defectId: string;
  readonly definitionDigest: string;
  readonly mutationFileDigest: string;
  readonly judgement: JudgementColumns;
}

type ReplyMember = Record<string, unknown>;

/** A judgement or an experiment record of a reply, with the defect it names. */
interface NamedMember {
  readonly defectId: string;
  readonly member: ReplyMember;
}

type Unclear = typeof VERDICT.unclear;
type UnclearReading = Extract<VerdictReading, { verdict: Unclear }>;
type UnclearRunReading = Extract<ConfirmingReading, { verdict: Unclear }>;

const RAN = "ran" satisfies FalsificationJob["status"];
const JUDGEMENT = "judgement";
const EXPERIMENT_RECORD = "experiment record";

const CONFIRMING_VERDICTS: Members<ConfirmingReading["verdict"]> = {
  [VERDICT.survived]: true,
  [VERDICT.invalidExperiment]: true,
  [VERDICT.unclear]: true,
};
const VERDICTS: Members<Verdict> = {
  ...CONFIRMING_VERDICTS,
  [VERDICT.detected]: true,
};
const RUN_UNCLEAR_REASONS: Members<UnclearRunReading["reason"]> = {
  [UNCLEAR_REASON.notAnAssertion]: true,
  [UNCLEAR_REASON.unhandledError]: true,
};
const UNCLEAR_REASONS: Members<UnclearReading["reason"]> = {
  ...RUN_UNCLEAR_REASONS,
  [UNCLEAR_REASON.confirmingRunDiffered]: true,
  [UNCLEAR_REASON.nextRunUnclean]: true,
  [UNCLEAR_REASON.jobUnclean]: true,
};

const EVIDENCE_COLUMNS = `project_identity, worktree_identity, defect_id, evidence_id, definition_digest,
  mutation_file_digest, fingerprint_digest, vitest_version, falsifier_version, adapter_version, verdict,
  reason, detail, facts`;
const IN_SCOPE = "project_identity = ? AND worktree_identity = ?";
const ONE_DEFECT = `${IN_SCOPE} AND defect_id = ?`;

const DELETE_EVIDENCE = `DELETE FROM defect_evidence WHERE ${ONE_DEFECT}`;
const INSERT_EVIDENCE = `INSERT INTO defect_evidence (${EVIDENCE_COLUMNS})
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const SELECT_DEFECT_EVIDENCE = `SELECT ${EVIDENCE_COLUMNS} FROM defect_evidence WHERE ${ONE_DEFECT}`;
const SELECT_EVIDENCE = `SELECT ${EVIDENCE_COLUMNS} FROM defect_evidence WHERE ${IN_SCOPE}
  ORDER BY defect_id`;

/**
 * Stores one record for each judgement of the reply that has a verdict, replacing that defect's earlier one, and
 * returns them in the reply's order; or throws and stores nothing.
 */
export function writeEvidence(
  database: DatabaseSync,
  bindings: EvidenceBindings,
  job: FalsificationJob,
  definitionDigests: ReadonlyMap<string, string>,
): StoredEvidence[] {
  requireEvidenceBindings(bindings);
  const reply = ranReply(job);
  const rows = evidenceRows(reply, definitionDigests);
  if (rows.length === 0) return [];
  const evidenceId = randomUUID();
  const scope = [bindings.projectIdentity, bindings.worktreeIdentity];
  return inRecordWrite(database, () => {
    const remove = database.prepare(DELETE_EVIDENCE);
    const insert = database.prepare(INSERT_EVIDENCE);
    const select = database.prepare(SELECT_DEFECT_EVIDENCE);
    return rows.map((row) => {
      const { defectId, judgement } = row;
      remove.run(...scope, defectId);
      insert.run(
        ...scope,
        defectId,
        evidenceId,
        row.definitionDigest,
        row.mutationFileDigest,
        bindings.inputFingerprintDigest,
        reply.vitestVersion,
        reply.falsifierVersion,
        VITEST_ADAPTER_VERSION,
        judgement.verdict,
        judgement.reason,
        judgement.detail,
        judgement.facts,
      );
      return readBack(select.get(...scope, defectId), defectId);
    });
  });
}

/**
 * Every evidence record of the scope by defect id, and each refused as unreadable, by its defect id; reads inside
 * the caller's transaction. A failure of the store itself still throws.
 */
export function selectEvidence(
  database: DatabaseSync,
  scope: StoreScope,
): LatestEvidence {
  const evidence: StoredEvidence[] = [];
  const evidenceRefusals: EvidenceRefusal[] = [];
  const rows = database
    .prepare(SELECT_EVIDENCE)
    .all(scope.projectIdentity, scope.worktreeIdentity);
  for (const row of rows) {
    try {
      evidence.push(storedEvidence(row));
    } catch (error) {
      if (!(error instanceof UnreadableRecordError)) throw error;
      const defectId = text(row, "defect_id");
      evidenceRefusals.push({ defectId, reason: errorText(error) });
    }
  }
  return { evidence, evidenceRefusals };
}

/** Callers outside the type system can pass anything, so every binding is checked at run time. */
function requireEvidenceBindings(bindings: EvidenceBindings): void {
  requireScope(bindings);
  fingerprintColumns({
    kind: FINGERPRINT_DIGEST,
    digest: bindings.inputFingerprintDigest,
  });
}

/** A job of any other status holds no judgements, so the status is checked before any other member is read. */
function ranReply(job: unknown): RanReply {
  const status = isRecord(job) ? job["status"] : undefined;
  if (!isRecord(job) || status !== RAN) {
    throw new Error(
      `The falsification reply must read ${RAN} for its evidence to be stored; got status ${JSON.stringify(status)}`,
    );
  }
  const { vitestVersion, falsifierVersion, judgements, experiments } = job;
  if (!isNonEmptyText(vitestVersion)) {
    throw new Error(
      `The falsification reply carries no Vitest version; got ${JSON.stringify(vitestVersion)}`,
    );
  }
  if (
    typeof falsifierVersion !== "number" ||
    !Number.isInteger(falsifierVersion)
  ) {
    throw new Error(
      `The falsification reply carries no falsifier version; got ${JSON.stringify(falsifierVersion)}`,
    );
  }
  if (!Array.isArray(judgements) || !Array.isArray(experiments)) {
    throw new Error(
      "The falsification reply carries no list of judgements, or no list of experiment records",
    );
  }
  return { vitestVersion, falsifierVersion, judgements, experiments };
}

/** Every member of the reply is checked before any is read for a verdict, so a broken reply stores no part of itself. */
function evidenceRows(
  reply: RanReply,
  definitionDigests: ReadonlyMap<string, string>,
): EvidenceRow[] {
  const judgements = reply.judgements.map((entry, index) =>
    namedMember(entry, index, JUDGEMENT),
  );
  refuseRepeatedJudgements(judgements);
  const records = recordsByDefectId(
    reply.experiments.map((entry, index) =>
      namedMember(entry, index, EXPERIMENT_RECORD),
    ),
  );
  return judgements.filter(hasVerdict).map(({ defectId, member }) => ({
    defectId,
    definitionDigest: definitionDigest(definitionDigests, defectId),
    mutationFileDigest: mutationFileDigest(
      records.get(defectId) ?? [],
      defectId,
    ),
    judgement: storableJudgement(member, defectId),
  }));
}

/** The refusal names the entry by its place alone, since a raw record's own text may hold an error's message. */
function namedMember(entry: unknown, index: number, kind: string): NamedMember {
  const defectId = isRecord(entry) ? entry["defectId"] : undefined;
  if (isRecord(entry) && isNonEmptyText(defectId)) {
    return { defectId, member: entry };
  }
  throw new Error(
    `The falsification reply's ${kind} ${index} is not an object naming a defect id, so none of the reply was stored`,
  );
}

function hasVerdict({ member }: NamedMember): boolean {
  return member["verdict"] !== undefined;
}

/** Two judgements for one defect, with a verdict or without, would leave what is stored to their order in the reply. */
function refuseRepeatedJudgements(judgements: readonly NamedMember[]): void {
  const seen = new Set<string>();
  for (const { defectId } of judgements) {
    if (seen.has(defectId)) {
      throw new Error(
        `More than one judgement of the falsification reply names defect ${defectId}, so none of the reply was stored`,
      );
    }
    seen.add(defectId);
  }
}

function recordsByDefectId(
  experiments: readonly NamedMember[],
): Map<string, ReplyMember[]> {
  const records = new Map<string, ReplyMember[]>();
  for (const { defectId, member } of experiments) {
    const named = records.get(defectId);
    if (named === undefined) records.set(defectId, [member]);
    else named.push(member);
  }
  return records;
}

function definitionDigest(
  definitionDigests: ReadonlyMap<string, string>,
  defectId: string,
): string {
  const digest: unknown = definitionDigests.get(defectId);
  if (isNonEmptyText(digest)) return digest;
  throw new Error(
    `No definition digest was handed in for defect ${defectId}; got ${JSON.stringify(digest)}`,
  );
}

/** The one member of an experiment record the store keeps. */
function mutationFileDigest(
  records: readonly ReplyMember[],
  defectId: string,
): string {
  const [record, ...others] = records;
  if (record === undefined || others.length > 0) {
    throw new Error(
      `The verdict for defect ${defectId} must name one experiment record of the falsification reply; it names ${records.length}`,
    );
  }
  const digest = record["mutationFileDigest"];
  if (isNonEmptyText(digest)) return digest;
  throw new Error(
    `The experiment record for defect ${defectId} carries no mutation file digest; got ${JSON.stringify(digest)}`,
  );
}

function storableJudgement(
  judgement: unknown,
  defectId: string,
): JudgementColumns {
  try {
    return judgementColumns(judgement);
  } catch (error) {
    throw new Error(
      `The falsification reply's judgement for defect ${defectId} cannot be stored: it is not one the store could read back, as the cause says of the row it would make`,
      { cause: error },
    );
  }
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Reading each record back before commit refuses, whole, a reply the readers could not rebuild. */
function readBack(row: Row | undefined, defectId: string): StoredEvidence {
  if (row === undefined) {
    throw new Error(
      `The store could not read back the evidence for defect ${defectId} it just wrote`,
    );
  }
  return storedEvidence(row);
}

/** A row of another falsifier version yields its bindings and its verdict alone. */
function storedEvidence(row: Row): StoredEvidence {
  const falsifierVersion = integer(row, "falsifier_version");
  const bound = {
    projectIdentity: text(row, "project_identity"),
    worktreeIdentity: text(row, "worktree_identity"),
    inputFingerprintDigest: text(row, "fingerprint_digest"),
    evidenceId: text(row, "evidence_id"),
    defectId: text(row, "defect_id"),
    definitionDigest: text(row, "definition_digest"),
    mutationFileDigest: text(row, "mutation_file_digest"),
    vitestVersion: text(row, "vitest_version"),
    falsifierVersion,
    adapterVersion: integer(row, "adapter_version"),
  };
  if (falsifierVersion !== FALSIFIER_VERSION) {
    const verdict = text(row, "verdict");
    return {
      ...bound,
      verdict: member(VERDICTS, verdict, "defect_evidence.verdict"),
    };
  }
  const judgement = judgementFromColumns(row);
  return { ...bound, verdict: judgement.verdict, judgement };
}

function judgementColumns(judgement: unknown): JudgementColumns {
  const stored = storedJudgement(judgement);
  return {
    verdict: stored.verdict,
    reason: "reason" in stored ? stored.reason : null,
    detail: "detail" in stored ? JSON.stringify(stored.detail) : null,
    facts: JSON.stringify(stored.facts),
  };
}

function judgementFromColumns(row: Row): StoredJudgement {
  return storedJudgement({
    verdict: text(row, "verdict"),
    reason: optionalText(row, "reason"),
    detail: column(row, "detail") === null ? undefined : json(row, "detail"),
    facts: json(row, "facts"),
  });
}

/**
 * The one rebuild, run over a reply's judgement on the way in and over a row's parsed columns on the way out. A
 * verdict, reason or detail that is not the one the judge gives the facts beside it is refused, so no record holds a
 * verdict its own facts do not give.
 */
function storedJudgement(value: unknown): StoredJudgement {
  const facts = storedFacts(jsonRecord(value, "facts"));
  const reading = verdictReading(value);
  if (!isDeepStrictEqual(reading, judge(facts))) {
    throw unreadable("judgement that its facts do not give", reading);
  }
  return { ...reading, facts };
}

function verdictReading(value: unknown): VerdictReading {
  const verdict = jsonMember(VERDICTS, value, "verdict");
  switch (verdict) {
    case VERDICT.detected:
    case VERDICT.survived:
      return { verdict };
    case VERDICT.invalidExperiment:
      return invalidReading(value);
    case VERDICT.unclear:
      return unclearReading(value);
  }
}

function unclearReading(value: unknown): UnclearReading {
  const verdict = VERDICT.unclear;
  const reason = jsonMember(UNCLEAR_REASONS, value, "reason");
  switch (reason) {
    case UNCLEAR_REASON.notAnAssertion:
    case UNCLEAR_REASON.unhandledError:
    case UNCLEAR_REASON.nextRunUnclean:
    case UNCLEAR_REASON.jobUnclean:
      return { verdict, reason };
    case UNCLEAR_REASON.confirmingRunDiffered: {
      const detail = jsonRecord(value, "detail");
      const confirming = confirmingReading(jsonRecord(detail, "confirming"));
      return { verdict, reason, detail: { confirming } };
    }
  }
}

function confirmingReading(value: unknown): ConfirmingReading {
  const verdict = jsonMember(CONFIRMING_VERDICTS, value, "verdict");
  switch (verdict) {
    case VERDICT.survived:
      return { verdict };
    case VERDICT.invalidExperiment:
      return invalidRunReading(value);
    case VERDICT.unclear:
      return {
        verdict,
        reason: jsonMember(RUN_UNCLEAR_REASONS, value, "reason"),
      };
  }
}
