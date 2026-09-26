import type { DatabaseSync } from "node:sqlite";

/** Takes the write lock up front, so a second writer waits on `busy_timeout` instead of failing to upgrade a read. */
export function inWriteTransaction<T>(
  database: DatabaseSync,
  write: () => T,
): T {
  database.exec("BEGIN IMMEDIATE");
  return finishTransaction(database, write);
}

/** Every statement inside reads one snapshot, so a write committed part way through a read is not seen by half of it. */
export function inReadTransaction<T>(database: DatabaseSync, read: () => T): T {
  database.exec("BEGIN");
  return finishTransaction(database, read);
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
