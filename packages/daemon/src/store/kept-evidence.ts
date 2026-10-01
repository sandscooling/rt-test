import type { DatabaseSync } from "node:sqlite";
import type { FalsificationJob } from "../falsify/experiment-record.js";
import {
  selectEvidence,
  writeEvidence,
  type EvidenceBindings,
  type LatestEvidence,
  type StoredEvidence,
} from "./defect-evidence.js";
import type { StoreScope } from "./stored-records.js";
import { headerNumber } from "./transaction.js";

/** SQLite moves it at a commit through any other connection, and at none of this connection's own. */
const SELECT_DATA_VERSION = "SELECT data_version FROM pragma_data_version";

/** A scope's evidence as one read rebuilt it, with the data version of the snapshot that read saw. */
interface KeptRead extends StoreScope {
  readonly dataVersion: number;
  readonly latest: LatestEvidence;
}

/**
 * One store's reads and writes of evidence. Rebuilding a scope's records costs far more than the rest of a read, so
 * the scope read last is kept and answers until its rows can have changed: this store wrote evidence, or another
 * connection committed.
 */
export class KeptEvidence {
  readonly #database: DatabaseSync;
  #kept: KeptRead | undefined;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  /**
   * Reads inside the caller's transaction, the data version before the rows, so what is kept is never older than the
   * version kept beside it.
   */
  read(scope: StoreScope): LatestEvidence {
    const dataVersion = headerNumber(
      this.#database.prepare(SELECT_DATA_VERSION).get(),
      "data_version",
    );
    const kept = this.#kept;
    if (kept !== undefined && stillAnswers(kept, scope, dataVersion)) {
      return kept.latest;
    }
    const latest = selectEvidence(this.#database, scope);
    const { projectIdentity, worktreeIdentity } = scope;
    this.#kept = { projectIdentity, worktreeIdentity, dataVersion, latest };
    return latest;
  }

  /**
   * Every evidence write through this connection must come through here: its own commit leaves the data version
   * unmoved, so what is kept is forgotten before the write.
   */
  write(
    bindings: EvidenceBindings,
    job: FalsificationJob,
    definitionDigests: ReadonlyMap<string, string>,
  ): StoredEvidence[] {
    this.#kept = undefined;
    return writeEvidence(this.#database, bindings, job, definitionDigests);
  }
}

function stillAnswers(
  kept: KeptRead,
  scope: StoreScope,
  dataVersion: number,
): boolean {
  return (
    kept.dataVersion === dataVersion &&
    kept.projectIdentity === scope.projectIdentity &&
    kept.worktreeIdentity === scope.worktreeIdentity
  );
}
