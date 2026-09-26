import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import { readLatestDiscovery } from "./read-discovery.js";
import { readRun, readRuns } from "./read-runs.js";
import {
  STORE_APPLICATION_ID,
  STORE_FILE_NAME,
  STORE_SCHEMA,
  STORE_SCHEMA_VERSION,
} from "./schema.js";
import type {
  StoreBindings,
  StoredDiscovery,
  StoredRun,
  StoreScope,
} from "./stored-records.js";
import { inWriteTransaction } from "./transaction.js";
import { writeDiscovery } from "./write-discovery.js";
import { writeRun } from "./write-run.js";

export interface RtTestStore {
  readonly file: string;
  writeRun(bindings: StoreBindings, run: WorkspaceRun): StoredRun;
  writeDiscovery(
    bindings: StoreBindings,
    discovery: TestDiscovery,
  ): StoredDiscovery;
  /** In the order they were stored. */
  readRuns(scope: StoreScope): StoredRun[];
  readRun(scope: StoreScope, runId: string): StoredRun | undefined;
  readLatestDiscovery(scope: StoreScope): StoredDiscovery | undefined;
  close(): void;
}

interface StoreHeader {
  readonly applicationId: number;
  readonly userVersion: number;
  readonly schemaObjects: number;
}

/** How long a write waits for another process's write on the same file before it fails whole. */
const BUSY_TIMEOUT_MS = 5000;
const SQLITE_NOT_A_DATABASE = 26;
/** What SQLite reads for an application id or user version nothing has set. */
const UNSET_HEADER_VALUE = 0;
const EXPECTED = `expected application id ${STORE_APPLICATION_ID} and schema version ${STORE_SCHEMA_VERSION}`;
/** One statement reads one snapshot, so a schema another opener commits meanwhile is seen whole or not at all. */
const SELECT_HEADER = `SELECT
  (SELECT application_id FROM pragma_application_id) AS application_id,
  (SELECT user_version FROM pragma_user_version) AS user_version,
  (SELECT count(*) FROM sqlite_schema) AS schema_objects`;

/** Creates the state directory and a new store in it when none exists; refuses, unchanged, a file it cannot read as one. */
export function openStore(stateDirectory: string): RtTestStore {
  mkdirSync(stateDirectory, { recursive: true });
  const file = join(stateDirectory, STORE_FILE_NAME);
  const database = new DatabaseSync(file);
  try {
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const header = checkedHeader(database, file);
    database.exec("PRAGMA journal_mode = WAL");
    if (isNew(header)) createSchema(database, file);
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
  if (header.userVersion > STORE_SCHEMA_VERSION) {
    return "it was written by a newer RT Test";
  }
  if (header.userVersion < STORE_SCHEMA_VERSION) {
    return "its schema version is not one this RT Test reads";
  }
  return undefined;
}

function isNew(header: StoreHeader): boolean {
  return (
    header.schemaObjects === 0 &&
    header.applicationId === UNSET_HEADER_VALUE &&
    header.userVersion === UNSET_HEADER_VALUE
  );
}

function headerNumber(
  row: Record<string, SQLOutputValue> | undefined,
  column: string,
): number {
  const value = row?.[column];
  if (typeof value !== "number") {
    throw new Error(
      `The store header's ${column} read as ${String(value)}, not a number`,
    );
  }
  return value;
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
  return {
    file,
    writeRun: (bindings, run) => writeRun(database, bindings, run),
    writeDiscovery: (bindings, discovery) =>
      writeDiscovery(database, bindings, discovery),
    readRuns: (scope) => readRuns(database, scope),
    readRun: (scope, runId) => readRun(database, scope, runId),
    readLatestDiscovery: (scope) => readLatestDiscovery(database, scope),
    close: () => database.close(),
  };
}
