/** Written to `PRAGMA application_id`, so a file RT Test did not create is never read as its store. */
export const STORE_APPLICATION_ID = 1381258324;
/** Written to `PRAGMA user_version`. A change to the tables below raises it and ships the opener a migration from the previous version, since the opener refuses every other version. */
export const STORE_SCHEMA_VERSION = 2;
/** The one older schema version the opener migrates to `STORE_SCHEMA_VERSION` through `STORE_MIGRATION`. */
export const MIGRATED_SCHEMA_VERSION = 1;
export const STORE_FILE_NAME = "store.sqlite";
/** How long a write waits for another process's write on the same file before it fails whole. */
export const BUSY_TIMEOUT_MS = 5000;

export const FINGERPRINT_DIGEST = "digest";
export const NOT_FINGERPRINTED = "not-fingerprinted";

export const FORCE_STOPPED = 1;
export const NOT_FORCE_STOPPED = 0;
/** Last in `runs`, so a new store and a migrated one hold the same columns in the same order. */
const FORCE_STOPPED_COLUMN = `force_stopped INTEGER CHECK (force_stopped IN (${NOT_FORCE_STOPPED}, ${FORCE_STOPPED}))`;

/** A NULL column is a value the record never held. JSON columns hold arrays and objects the record carries whole. */
export const STORE_SCHEMA = `
CREATE TABLE runs (
  sequence INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  project_identity TEXT NOT NULL CHECK (project_identity <> ''),
  worktree_identity TEXT NOT NULL CHECK (worktree_identity <> ''),
  fingerprint_kind TEXT NOT NULL CHECK (fingerprint_kind IN ('${FINGERPRINT_DIGEST}', '${NOT_FINGERPRINTED}')),
  fingerprint_digest TEXT,
  adapter_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  workspace_directory TEXT NOT NULL,
  vitest_version TEXT,
  unsupported_vitest TEXT,
  error TEXT,
  execution TEXT,
  nothing_ran TEXT,
  cancel_error TEXT,
  close_error TEXT,
  unhandled_errors TEXT,
  typecheck_modules TEXT,
  unsupported_projects TEXT,
  ${FORCE_STOPPED_COLUMN},
  CHECK ((fingerprint_kind = '${FINGERPRINT_DIGEST}') = (fingerprint_digest IS NOT NULL AND fingerprint_digest <> ''))
) STRICT;
CREATE INDEX runs_by_worktree ON runs (project_identity, worktree_identity, sequence);

CREATE TABLE run_modules (
  run_sequence INTEGER NOT NULL REFERENCES runs (sequence),
  module_index INTEGER NOT NULL,
  project_name TEXT NOT NULL,
  module_path TEXT NOT NULL,
  state TEXT NOT NULL,
  errors TEXT,
  PRIMARY KEY (run_sequence, module_index)
) STRICT;

CREATE TABLE run_tests (
  run_sequence INTEGER NOT NULL,
  module_index INTEGER NOT NULL,
  test_index INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  module_path TEXT NOT NULL,
  name_path TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  is_duplicate INTEGER NOT NULL CHECK (is_duplicate IN (0, 1)),
  execution TEXT NOT NULL,
  outcome TEXT,
  errors TEXT,
  PRIMARY KEY (run_sequence, module_index, test_index),
  FOREIGN KEY (run_sequence, module_index) REFERENCES run_modules (run_sequence, module_index)
) STRICT;

CREATE TABLE discoveries (
  sequence INTEGER PRIMARY KEY,
  discovery_id TEXT NOT NULL UNIQUE,
  project_identity TEXT NOT NULL CHECK (project_identity <> ''),
  worktree_identity TEXT NOT NULL CHECK (worktree_identity <> ''),
  fingerprint_kind TEXT NOT NULL CHECK (fingerprint_kind IN ('${FINGERPRINT_DIGEST}', '${NOT_FINGERPRINTED}')),
  fingerprint_digest TEXT,
  adapter_version INTEGER NOT NULL,
  not_read TEXT NOT NULL,
  CHECK ((fingerprint_kind = '${FINGERPRINT_DIGEST}') = (fingerprint_digest IS NOT NULL AND fingerprint_digest <> ''))
) STRICT;
CREATE INDEX discoveries_by_worktree ON discoveries (project_identity, worktree_identity, sequence);

CREATE TABLE discovery_workspaces (
  discovery_sequence INTEGER NOT NULL REFERENCES discoveries (sequence),
  workspace_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  workspace_directory TEXT NOT NULL,
  vitest_version TEXT,
  unsupported_vitest TEXT,
  error TEXT,
  close_error TEXT,
  failed_modules TEXT,
  typecheck_modules TEXT,
  unsupported_projects TEXT,
  unhandled_errors TEXT,
  PRIMARY KEY (discovery_sequence, workspace_index)
) STRICT;

CREATE TABLE discovered_tests (
  discovery_sequence INTEGER NOT NULL,
  workspace_index INTEGER NOT NULL,
  test_index INTEGER NOT NULL,
  workspace_path TEXT NOT NULL,
  project_name TEXT NOT NULL,
  module_path TEXT NOT NULL,
  name_path TEXT NOT NULL,
  occurrence INTEGER NOT NULL,
  is_duplicate INTEGER NOT NULL CHECK (is_duplicate IN (0, 1)),
  mode TEXT NOT NULL,
  PRIMARY KEY (discovery_sequence, workspace_index, test_index),
  FOREIGN KEY (discovery_sequence, workspace_index) REFERENCES discovery_workspaces (discovery_sequence, workspace_index)
) STRICT;
`;

/** Brings a store at `MIGRATED_SCHEMA_VERSION` to `STORE_SCHEMA_VERSION`. That version's code never force-stopped a run, so each of its `ran` runs was not force-stopped. */
export const STORE_MIGRATION = `
ALTER TABLE runs ADD COLUMN ${FORCE_STOPPED_COLUMN};
UPDATE runs SET force_stopped = ${NOT_FORCE_STOPPED} WHERE status = 'ran';
PRAGMA user_version = ${STORE_SCHEMA_VERSION};
`;
