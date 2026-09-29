/** Written to `PRAGMA application_id`, so a file RT Test did not create is never read as its store. */
export const STORE_APPLICATION_ID = 1381258324;
/** Written to `PRAGMA user_version`. A change to the tables below, or a stored value an older version's code cannot read, raises it and gives each older version in `STORE_MIGRATIONS` a path to it, since the opener refuses every version it cannot migrate. */
export const STORE_SCHEMA_VERSION = 7;
/** Its code never force-stopped a run and never kept a workspace's selection facts. */
const FORCE_STOP_UNAWARE_SCHEMA_VERSION = 1;
/** Its code never kept a workspace's selection facts. */
const SELECTION_FACTS_UNAWARE_SCHEMA_VERSION = 2;
/** Its code kept a workspace's selection facts without each project's Vite root. */
const VITE_ROOT_UNAWARE_SCHEMA_VERSION = 3;
/** Its code never stored a crashed run, and fails reading one, so a store holding one must be refused by it. */
const CRASH_UNAWARE_SCHEMA_VERSION = 4;
/** Its code kept a workspace's selection facts without Vitest's own spelling of each pattern directory. */
const VITEST_SPELLING_UNAWARE_SCHEMA_VERSION = 5;
/** Its code kept a workspace's selection facts without the directory links Vitest's crawl follows. */
const CRAWLED_LINKS_UNAWARE_SCHEMA_VERSION = 6;
export const STORE_FILE_NAME = "store.sqlite";
/** How long a write waits for another process's write on the same file before it fails whole. */
export const BUSY_TIMEOUT_MS = 5000;

export const FINGERPRINT_DIGEST = "digest";
export const NOT_FINGERPRINTED = "not-fingerprinted";

export const FORCE_STOPPED = 1;
export const NOT_FORCE_STOPPED = 0;
/** Last in `runs`, so a new store and a migrated one hold the same columns in the same order. */
const FORCE_STOPPED_COLUMN = `force_stopped INTEGER CHECK (force_stopped IN (${NOT_FORCE_STOPPED}, ${FORCE_STOPPED}))`;
/** Last in `discovery_workspaces`, so a new store and a migrated one hold the same columns in the same order. NULL on a discovered workspace is a report never made. */
const SELECTION_FACTS_COLUMN = "selection_facts TEXT";

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
  ${SELECTION_FACTS_COLUMN},
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

/** Version 1's code never force-stopped a run, so each of its `ran` runs was not force-stopped. */
const ADD_FORCE_STOPPED = `
ALTER TABLE runs ADD COLUMN ${FORCE_STOPPED_COLUMN};
UPDATE runs SET force_stopped = ${NOT_FORCE_STOPPED} WHERE status = 'ran';`;
/** Each workspace stored before keeps a NULL report, so it reads as not reporting its selection facts. */
const ADD_SELECTION_FACTS = `
ALTER TABLE discovery_workspaces ADD COLUMN ${SELECTION_FACTS_COLUMN};`;
/** A report missing a fact this version reads is dropped rather than given a guessed one, so it reads as never made. */
const DROP_INCOMPLETE_FACTS = `
UPDATE discovery_workspaces SET selection_facts = NULL;`;
const SET_SCHEMA_VERSION = `
PRAGMA user_version = ${STORE_SCHEMA_VERSION};`;

/** Keyed by each older schema version the opener reads: the statements that bring a store at it to `STORE_SCHEMA_VERSION`. */
export const STORE_MIGRATIONS: ReadonlyMap<number, string> = new Map([
  [
    FORCE_STOP_UNAWARE_SCHEMA_VERSION,
    `${ADD_FORCE_STOPPED}${ADD_SELECTION_FACTS}${SET_SCHEMA_VERSION}`,
  ],
  [
    SELECTION_FACTS_UNAWARE_SCHEMA_VERSION,
    `${ADD_SELECTION_FACTS}${SET_SCHEMA_VERSION}`,
  ],
  [
    VITE_ROOT_UNAWARE_SCHEMA_VERSION,
    `${DROP_INCOMPLETE_FACTS}${SET_SCHEMA_VERSION}`,
  ],
  [
    CRASH_UNAWARE_SCHEMA_VERSION,
    `${DROP_INCOMPLETE_FACTS}${SET_SCHEMA_VERSION}`,
  ],
  [
    VITEST_SPELLING_UNAWARE_SCHEMA_VERSION,
    `${DROP_INCOMPLETE_FACTS}${SET_SCHEMA_VERSION}`,
  ],
  [
    CRAWLED_LINKS_UNAWARE_SCHEMA_VERSION,
    `${DROP_INCOMPLETE_FACTS}${SET_SCHEMA_VERSION}`,
  ],
]);
