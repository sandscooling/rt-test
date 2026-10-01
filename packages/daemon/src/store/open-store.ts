import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { FalsificationJob } from "../falsify/experiment-record.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import { UnreadableRecordError } from "./columns.js";
import type {
  EvidenceBindings,
  LatestEvidence,
  StoredEvidence,
} from "./defect-evidence.js";
import { KeptEvidence } from "./kept-evidence.js";
import {
  readLatestDiscovery,
  selectLatestDiscovery,
} from "./read-discovery.js";
import {
  readRun,
  readRuns,
  selectLatestRuns,
  type LatestRuns,
} from "./read-runs.js";
import {
  BUSY_TIMEOUT_MS,
  STORE_APPLICATION_ID,
  STORE_FILE_NAME,
  STORE_MIGRATIONS,
  STORE_SCHEMA,
  STORE_SCHEMA_VERSION,
} from "./schema.js";
import {
  requireScope,
  type StoreBindings,
  type StoredDiscovery,
  type StoredRun,
  type StoreScope,
} from "./stored-records.js";
import {
  headerNumber,
  inRecordRead,
  inWriteTransaction,
  isNewerSchema,
} from "./transaction.js";
import { writeDiscovery } from "./write-discovery.js";
import { writeRun } from "./write-run.js";

/** What a query counts from, as one snapshot of the store holds it. */
export interface LatestResults extends LatestRuns, LatestEvidence {
  /** Undefined when none was stored, or when the one stored last was refused. */
  readonly discovery: StoredDiscovery | undefined;
  /** Why the discovery stored last was refused as unreadable. */
  readonly discoveryRefusal: string | undefined;
}

export interface RtTestStore {
  readonly file: string;
  writeRun(bindings: StoreBindings, run: WorkspaceRun): StoredRun;
  writeDiscovery(
    bindings: StoreBindings,
    discovery: TestDiscovery,
  ): StoredDiscovery;
  /** The records stored, in the order of the reply's judgements; none when no judgement has a verdict. */
  writeEvidence(
    bindings: EvidenceBindings,
    job: FalsificationJob,
    definitionDigests: ReadonlyMap<string, string>,
  ): StoredEvidence[];
  /** In the order they were stored. */
  readRuns(scope: StoreScope): StoredRun[];
  readRun(scope: StoreScope, runId: string): StoredRun | undefined;
  readLatestDiscovery(scope: StoreScope): StoredDiscovery | undefined;
  readLatestResults(scope: StoreScope): LatestResults;
  close(): void;
}

interface StoreHeader {
  readonly applicationId: number;
  readonly userVersion: number;
  readonly schemaObjects: number;
}

const SQLITE_NOT_A_DATABASE = 26;
/** What SQLite reads for an application id or user version nothing has set. */
const UNSET_HEADER_VALUE = 0;
const EXPECTED = `expected application id ${STORE_APPLICATION_ID} and schema version ${STORE_SCHEMA_VERSION}`;
/** One statement reads one snapshot, so a schema another opener commits meanwhile is seen whole or not at all. */
const SELECT_HEADER = `SELECT
  (SELECT application_id FROM pragma_application_id) AS application_id,
  (SELECT user_version FROM pragma_user_version) AS user_version,
  (SELECT count(*) FROM sqlite_schema) AS schema_objects`;

/** Creates the state directory and a new store in it when none exists, and migrates a store of an older schema version in `STORE_MIGRATIONS`; refuses, unchanged, a file it cannot read as one. */
export function openStore(stateDirectory: string): RtTestStore {
  mkdirSync(stateDirectory, { recursive: true });
  const file = join(stateDirectory, STORE_FILE_NAME);
  const database = new DatabaseSync(file);
  try {
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const header = checkedHeader(database, file);
    database.exec("PRAGMA journal_mode = WAL");
    if (isNew(header)) createSchema(database, file);
    if (isMigratable(header)) migrateSchema(database, file);
  } catch (error) {
    database.close();
    throw error;
  }
  return storeHandle(database, file);
}

/** Re-reads the header under the write lock, so of two openers of one new file only the first creates the schema. */
function createSchema(database: DatabaseSync, file: string): void {
  inWriteTransaction(database, () => {
    if (!isNew(checkedHeader(database, file))) return;
    database.exec(STORE_SCHEMA);
    database.exec(`PRAGMA application_id = ${STORE_APPLICATION_ID}`);
    database.exec(`PRAGMA user_version = ${STORE_SCHEMA_VERSION}`);
  });
}

/** Re-reads the header under the write lock, so of two openers of one old store only the first migrates it, every step in one transaction. */
function migrateSchema(database: DatabaseSync, file: string): void {
  inWriteTransaction(database, () => {
    const migration = STORE_MIGRATIONS.get(
      checkedHeader(database, file).userVersion,
    );
    if (migration === undefined) return;
    database.exec(migration);
  });
}

function checkedHeader(database: DatabaseSync, file: string): StoreHeader {
  const header = readHeader(database, file);
  const refusal = refusalReason(header);
  if (refusal !== undefined) {
    throw new Error(
      `Cannot open the RT Test store ${file}: ${refusal}; found application id ${header.applicationId} and schema version ${header.userVersion}, ${EXPECTED}. The file was left unchanged.`,
    );
  }
  return header;
}

function readHeader(database: DatabaseSync, file: string): StoreHeader {
  let row: Record<string, SQLOutputValue> | undefined;
  try {
    row = database.prepare(SELECT_HEADER).get();
  } catch (error) {
    if (!isNotADatabase(error)) throw error;
    throw new Error(
      `Cannot open the RT Test store ${file}: it is not an SQLite database, so no application id or schema version could be read; ${EXPECTED}. The file was left unchanged.`,
      { cause: error },
    );
  }
  return {
    applicationId: headerNumber(row, "application_id"),
    userVersion: headerNumber(row, "user_version"),
    schemaObjects: headerNumber(row, "schema_objects"),
  };
}

function refusalReason(header: StoreHeader): string | undefined {
  if (isNew(header)) return undefined;
  if (header.applicationId !== STORE_APPLICATION_ID) {
    return "it is not an RT Test store";
  }
  if (isNewerSchema(header.userVersion)) {
    return "it was written by a newer RT Test";
  }
  if (isMigratable(header)) return undefined;
  if (header.userVersion < STORE_SCHEMA_VERSION) {
    return "its schema version is not one this RT Test reads";
  }
  return undefined;
}

/** Called only once the application id is known to be RT Test's. */
function isMigratable(header: StoreHeader): boolean {
  return STORE_MIGRATIONS.has(header.userVersion);
}

function isNew(header: StoreHeader): boolean {
  return (
    header.schemaObjects === 0 &&
    header.applicationId === UNSET_HEADER_VALUE &&
    header.userVersion === UNSET_HEADER_VALUE
  );
}

function isNotADatabase(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errcode" in error &&
    error.errcode === SQLITE_NOT_A_DATABASE
  );
}

function storeHandle(database: DatabaseSync, file: string): RtTestStore {
  const evidence = new KeptEvidence(database);
  return {
    file,
    writeRun: (bindings, run) => writeRun(database, bindings, run),
    writeDiscovery: (bindings, discovery) =>
      writeDiscovery(database, bindings, discovery),
    writeEvidence: (bindings, job, definitionDigests) =>
      evidence.write(bindings, job, definitionDigests),
    readRuns: (scope) => readRuns(database, scope),
    readRun: (scope, runId) => readRun(database, scope, runId),
    readLatestDiscovery: (scope) => readLatestDiscovery(database, scope),
    readLatestResults: (scope) => readLatestResults(database, evidence, scope),
    close: () => database.close(),
  };
}

function readLatestResults(
  database: DatabaseSync,
  evidence: KeptEvidence,
  scope: StoreScope,
): LatestResults {
  requireScope(scope);
  return inRecordRead(database, () => ({
    ...latestDiscovery(database, scope),
    ...selectLatestRuns(database, scope),
    ...evidence.read(scope),
  }));
}

/** A refused discovery reads as none, beside why, so the daemon discovers again rather than never planning. */
function latestDiscovery(
  database: DatabaseSync,
  scope: StoreScope,
): Pick<LatestResults, "discovery" | "discoveryRefusal"> {
  try {
    return {
      discovery: selectLatestDiscovery(database, scope),
      discoveryRefusal: undefined,
    };
  } catch (error) {
    if (!(error instanceof UnreadableRecordError)) throw error;
    return { discovery: undefined, discoveryRefusal: errorText(error) };
  }
}
