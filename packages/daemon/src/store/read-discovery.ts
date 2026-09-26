import type { DatabaseSync } from "node:sqlite";
import type {
  DiscoveredTest,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import {
  arrayOf,
  closeError,
  column,
  failedModule,
  identifiedTest,
  integer,
  json,
  member,
  moduleReport,
  rowsBy,
  stringArray,
  text,
  unreadable,
  unreadWorkspaceSource,
  unsupportedProject,
  unsupportedVitest,
  type Members,
  type Row,
} from "./columns.js";
import {
  fingerprintFromColumns,
  requireScope,
  type StoredDiscovery,
  type StoreScope,
} from "./stored-records.js";
import { inReadTransaction } from "./transaction.js";

const DISCOVERY_COLUMNS = `SELECT sequence, discovery_id, project_identity, worktree_identity, fingerprint_kind,
  fingerprint_digest, adapter_version, not_read
  FROM discoveries WHERE project_identity = ? AND worktree_identity = ?`;
const SELECT_LATEST_DISCOVERY = `${DISCOVERY_COLUMNS} ORDER BY sequence DESC LIMIT 1`;
const SELECT_DISCOVERY = `${DISCOVERY_COLUMNS} AND discovery_id = ?`;

const SELECT_WORKSPACES = `SELECT workspace_index, status, workspace_path, workspace_directory, vitest_version,
  unsupported_vitest, error, close_error, failed_modules, typecheck_modules, unsupported_projects, unhandled_errors
  FROM discovery_workspaces WHERE discovery_sequence = ? ORDER BY workspace_index`;

const SELECT_TESTS = `SELECT workspace_index, workspace_path, project_name, module_path, name_path, occurrence,
  is_duplicate, mode
  FROM discovered_tests WHERE discovery_sequence = ? ORDER BY workspace_index, test_index`;

const TEST_MODES: Members<DiscoveredTest["mode"]> = {
  run: true,
  only: true,
  skip: true,
  todo: true,
};

/** The discovery stored last for this project and worktree; undefined when none was stored. */
export function readLatestDiscovery(
  database: DatabaseSync,
  scope: StoreScope,
): StoredDiscovery | undefined {
  requireScope(scope);
  return inReadTransaction(database, () => {
    const row = database
      .prepare(SELECT_LATEST_DISCOVERY)
      .get(scope.projectIdentity, scope.worktreeIdentity);
    return row === undefined ? undefined : storedDiscovery(database, row);
  });
}

/** Reads inside the caller's transaction, so a writer can read back what it has not yet committed. */
export function selectDiscovery(
  database: DatabaseSync,
  scope: StoreScope,
  discoveryId: string,
): StoredDiscovery | undefined {
  const row = database
    .prepare(SELECT_DISCOVERY)
    .get(scope.projectIdentity, scope.worktreeIdentity, discoveryId);
  return row === undefined ? undefined : storedDiscovery(database, row);
}

function storedDiscovery(database: DatabaseSync, row: Row): StoredDiscovery {
  return {
    projectIdentity: text(row, "project_identity"),
    worktreeIdentity: text(row, "worktree_identity"),
    inputFingerprint: fingerprintFromColumns(
      column(row, "fingerprint_kind"),
      column(row, "fingerprint_digest"),
    ),
    adapterVersion: integer(row, "adapter_version"),
    discoveryId: text(row, "discovery_id"),
    discovery: {
      workspaces: readWorkspaces(database, integer(row, "sequence")),
      notRead: arrayOf(json(row, "not_read"), unreadWorkspaceSource),
    },
  };
}

function readWorkspaces(
  database: DatabaseSync,
  sequence: number,
): WorkspaceDiscovery[] {
  const tests = rowsBy(
    database.prepare(SELECT_TESTS).all(sequence),
    "workspace_index",
  );
  const workspaces = database
    .prepare(SELECT_WORKSPACES)
    .all(sequence)
    .map((row) => {
      const workspaceIndex = integer(row, "workspace_index");
      const workspaceTests = tests.get(workspaceIndex) ?? [];
      tests.delete(workspaceIndex);
      return workspaceDiscovery(row, workspaceTests.map(discoveredTest));
    });
  if (tests.size > 0) {
    throw unreadable("discovered_tests.workspace_index", [...tests.keys()]);
  }
  return workspaces;
}

function workspaceDiscovery(
  row: Row,
  tests: readonly DiscoveredTest[],
): WorkspaceDiscovery {
  const status = text(row, "status");
  const workspace: VitestWorkspace = {
    path: text(row, "workspace_path"),
    directory: text(row, "workspace_directory"),
  };
  if (status !== "discovered" && tests.length > 0) {
    throw new Error(
      `The store holds tests under the ${status} workspace ${workspace.path}`,
    );
  }
  switch (status) {
    case "discovered":
      return discoveredWorkspace(row, workspace, tests);
    case "unsupported":
      return {
        status,
        workspace,
        vitest: unsupportedVitest(json(row, "unsupported_vitest")),
      };
    case "failed":
      return {
        status,
        workspace,
        vitestVersion: text(row, "vitest_version"),
        error: text(row, "error"),
        ...closeError(row),
      };
    default:
      throw unreadable("discovery_workspaces.status", status);
  }
}

function discoveredWorkspace(
  row: Row,
  workspace: VitestWorkspace,
  tests: readonly DiscoveredTest[],
): WorkspaceDiscovery {
  return {
    status: "discovered",
    workspace,
    vitestVersion: text(row, "vitest_version"),
    tests,
    failedModules: arrayOf(json(row, "failed_modules"), failedModule),
    typecheckModules: arrayOf(json(row, "typecheck_modules"), moduleReport),
    unsupportedProjects: arrayOf(
      json(row, "unsupported_projects"),
      unsupportedProject,
    ),
    unhandledErrors: stringArray(json(row, "unhandled_errors")),
    ...closeError(row),
  };
}

function discoveredTest(row: Row): DiscoveredTest {
  return {
    ...identifiedTest(row),
    mode: member(TEST_MODES, text(row, "mode"), "discovered_tests.mode"),
  };
}
