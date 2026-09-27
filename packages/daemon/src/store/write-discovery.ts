import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import type {
  DiscoveredTest,
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { VITEST_ADAPTER_VERSION } from "../vitest/adapter-version.js";
import { identifiedTestColumns } from "./columns.js";
import { selectDiscovery } from "./read-discovery.js";
import {
  fingerprintColumns,
  requireBindings,
  type StoreBindings,
  type StoredDiscovery,
} from "./stored-records.js";
import { inWriteTransaction } from "./transaction.js";

interface WorkspaceColumns {
  readonly vitestVersion: string | null;
  readonly unsupportedVitest: string | null;
  readonly error: string | null;
  readonly closeError: string | null;
  readonly failedModules: string | null;
  readonly typecheckModules: string | null;
  readonly unsupportedProjects: string | null;
  readonly unhandledErrors: string | null;
}

interface DiscoveryStatements {
  readonly workspace: StatementSync;
  readonly test: StatementSync;
}

const INSERT_DISCOVERY = `INSERT INTO discoveries
  (discovery_id, project_identity, worktree_identity, fingerprint_kind, fingerprint_digest, adapter_version, not_read)
  VALUES (?, ?, ?, ?, ?, ?, ?)`;

const INSERT_WORKSPACE = `INSERT INTO discovery_workspaces
  (discovery_sequence, workspace_index, status, workspace_path, workspace_directory, vitest_version, unsupported_vitest,
   error, close_error, failed_modules, typecheck_modules, unsupported_projects, unhandled_errors)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_TEST = `INSERT INTO discovered_tests
  (discovery_sequence, workspace_index, test_index, workspace_path, project_name, module_path, name_path, occurrence,
   is_duplicate, mode)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const NO_WORKSPACE_COLUMNS: WorkspaceColumns = {
  vitestVersion: null,
  unsupportedVitest: null,
  error: null,
  closeError: null,
  failedModules: null,
  typecheckModules: null,
  unsupportedProjects: null,
  unhandledErrors: null,
};

/** Stores one discovery whole, or nothing of it; the store assigns its identity and stamps the adapter version. */
export function writeDiscovery(
  database: DatabaseSync,
  bindings: StoreBindings,
  discovery: TestDiscovery,
): StoredDiscovery {
  requireBindings(bindings);
  const { projectIdentity, worktreeIdentity, inputFingerprint } = bindings;
  const { fingerprintKind, fingerprintDigest } =
    fingerprintColumns(inputFingerprint);
  const discoveryId = randomUUID();
  return inWriteTransaction(database, () => {
    const { lastInsertRowid } = database
      .prepare(INSERT_DISCOVERY)
      .run(
        discoveryId,
        projectIdentity,
        worktreeIdentity,
        fingerprintKind,
        fingerprintDigest,
        VITEST_ADAPTER_VERSION,
        JSON.stringify(discovery.notRead),
      );
    writeWorkspaces(database, lastInsertRowid, discovery.workspaces);
    return readBack(
      selectDiscovery(database, bindings, discoveryId),
      discoveryId,
    );
  });
}

/** Reading the discovery back before commit refuses, whole, a record the reader could not rebuild. */
function readBack(
  stored: StoredDiscovery | undefined,
  discoveryId: string,
): StoredDiscovery {
  if (stored === undefined) {
    throw new Error(
      `The store could not read back discovery ${discoveryId} it just wrote`,
    );
  }
  return stored;
}

function writeWorkspaces(
  database: DatabaseSync,
  discoverySequence: number | bigint,
  workspaces: readonly WorkspaceDiscovery[],
): void {
  const statements: DiscoveryStatements = {
    workspace: database.prepare(INSERT_WORKSPACE),
    test: database.prepare(INSERT_TEST),
  };
  workspaces.forEach((entry, workspaceIndex) => {
    writeWorkspace(statements, [discoverySequence, workspaceIndex], entry);
  });
}

function writeWorkspace(
  statements: DiscoveryStatements,
  key: readonly [discoverySequence: number | bigint, workspaceIndex: number],
  entry: WorkspaceDiscovery,
): void {
  const columns = workspaceColumns(entry);
  statements.workspace.run(
    ...key,
    entry.status,
    entry.workspace.path,
    entry.workspace.directory,
    columns.vitestVersion,
    columns.unsupportedVitest,
    columns.error,
    columns.closeError,
    columns.failedModules,
    columns.typecheckModules,
    columns.unsupportedProjects,
    columns.unhandledErrors,
  );
  if (entry.status !== "discovered") return;
  entry.tests.forEach((test, testIndex) => {
    statements.test.run(...key, ...testColumns(test, testIndex));
  });
}

function workspaceColumns(entry: WorkspaceDiscovery): WorkspaceColumns {
  switch (entry.status) {
    case "discovered":
      return {
        ...NO_WORKSPACE_COLUMNS,
        vitestVersion: entry.vitestVersion,
        closeError: entry.closeError ?? null,
        failedModules: JSON.stringify(entry.failedModules),
        typecheckModules: JSON.stringify(entry.typecheckModules),
        unsupportedProjects: JSON.stringify(entry.unsupportedProjects),
        unhandledErrors: JSON.stringify(entry.unhandledErrors),
      };
    case "unsupported":
      return {
        ...NO_WORKSPACE_COLUMNS,
        unsupportedVitest: JSON.stringify(entry.vitest),
      };
    case "failed":
      return {
        ...NO_WORKSPACE_COLUMNS,
        vitestVersion: entry.vitestVersion,
        error: entry.error,
        closeError: entry.closeError ?? null,
      };
    case "not-confirmed":
      return { ...NO_WORKSPACE_COLUMNS, error: entry.reason };
  }
}

function testColumns(test: DiscoveredTest, testIndex: number): SQLInputValue[] {
  return [testIndex, ...identifiedTestColumns(test), test.mode];
}
