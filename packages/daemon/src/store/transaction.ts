import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { STORE_SCHEMA_VERSION } from "./schema.js";

const SELECT_SCHEMA_VERSION = "SELECT user_version FROM pragma_user_version";
const NOTHING_READ = "nothing was read";
const NOTHING_STORED = "nothing was stored";

/** A store a newer RT Test migrated after this one opened it, whose records this one may misread or write in an older shape. */
export class NewerStoreSchemaError extends Error {}

/** Takes the write lock up front, so a second writer waits on `busy_timeout` instead of failing to upgrade a read. */
export function inWriteTransaction<T>(
  database: DatabaseSync,
  write: () => T,
): T {
  database.exec("BEGIN IMMEDIATE");
  return finishTransaction(database, write);
}

/** Writes records under the write lock, refused whole in a store whose schema is newer than this RT Test's. */
export function inRecordWrite<T>(database: DatabaseSync, write: () => T): T {
  return inWriteTransaction(database, () => {
    refuseNewerSchema(database, NOTHING_STORED);
    return write();
  });
}

/**
 * Every statement inside, the schema version's read among them, reads one snapshot, so a write committed part way
 * through a read is not seen by half of it; refused in a store whose schema is newer than this RT Test's.
 */
export function inRecordRead<T>(database: DatabaseSync, read: () => T): T {
  database.exec("BEGIN");
  return finishTransaction(database, () => {
    refuseNewerSchema(database, NOTHING_READ);
    return read();
  });
}

/** The opener checks the version once, so this catches a newer RT Test migrating the store while it is open. */
function refuseNewerSchema(database: DatabaseSync, outcome: string): void {
  const version = headerNumber(
    database.prepare(SELECT_SCHEMA_VERSION).get(),
    "user_version",
  );
  if (!isNewerSchema(version)) return;
  throw new NewerStoreSchemaError(
    `The RT Test store is at schema version ${version}, newer than the version ${STORE_SCHEMA_VERSION} this RT Test reads and writes: a newer RT Test migrated it after this daemon opened it, so ${outcome}. Restart the daemon with the newer RT Test.`,
  );
}

export function headerNumber(
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

/** Written by a newer RT Test, whose records this one may misread or write in an older shape. */
export function isNewerSchema(userVersion: number): boolean {
  return userVersion > STORE_SCHEMA_VERSION;
}

function finishTransaction<T>(database: DatabaseSync, work: () => T): T {
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "The store transaction failed, and its ROLLBACK threw too, as it does when SQLite has already rolled the transaction back itself",
      );
    }
    throw error;
  }
}
