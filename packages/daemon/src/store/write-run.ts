import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import { VITEST_ADAPTER_VERSION } from "../vitest/adapter-version.js";
import type {
  RecordedModule,
  RecordedTest,
  TestRunState,
} from "../vitest/run-states.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import { identifiedTestColumns } from "./columns.js";
import { selectRun } from "./read-runs.js";
import { FORCE_STOPPED, NOT_FORCE_STOPPED } from "./schema.js";
import {
  fingerprintColumns,
  requireBindings,
  type StoreBindings,
  type StoredRun,
} from "./stored-records.js";
import { inRecordWrite } from "./transaction.js";

type RanRun = Extract<WorkspaceRun, { status: "ran" }>;
type RunSequence = number | bigint;

/** The run columns one status fills; the rest stay NULL. */
interface RunColumns {
  readonly vitestVersion: string | null;
  readonly unsupportedVitest: string | null;
  readonly error: string | null;
  readonly execution: string | null;
  readonly nothingRan: string | null;
  readonly cancelError: string | null;
  readonly closeError: string | null;
  readonly unhandledErrors: string | null;
  readonly typecheckModules: string | null;
  readonly unsupportedProjects: string | null;
  readonly forceStopped: number | null;
}

interface ChildStatements {
  readonly insertModule: StatementSync;
  readonly insertTest: StatementSync;
}

const NO_RUN_COLUMNS: RunColumns = {
  vitestVersion: null,
  unsupportedVitest: null,
  error: null,
  execution: null,
  nothingRan: null,
  cancelError: null,
  closeError: null,
  unhandledErrors: null,
  typecheckModules: null,
  unsupportedProjects: null,
  forceStopped: null,
};

const INSERT_RUN = `INSERT INTO runs (
  run_id, project_identity, worktree_identity, fingerprint_kind, fingerprint_digest, adapter_version,
  status, workspace_path, workspace_directory, vitest_version, unsupported_vitest, error, execution,
  nothing_ran, cancel_error, close_error, unhandled_errors, typecheck_modules, unsupported_projects,
  force_stopped
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_MODULE = `INSERT INTO run_modules (
  run_sequence, module_index, project_name, module_path, state, errors
) VALUES (?, ?, ?, ?, ?, ?)`;
const INSERT_TEST = `INSERT INTO run_tests (
  run_sequence, module_index, test_index, workspace_path, project_name, module_path, name_path,
  occurrence, is_duplicate, execution, outcome, errors
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Stores the run whole under a new run identity, or throws and stores nothing. */
export function writeRun(
  database: DatabaseSync,
  bindings: StoreBindings,
  run: WorkspaceRun,
): StoredRun {
  requireBindings(bindings);
  const stored: StoredRun = {
    projectIdentity: bindings.projectIdentity,
    worktreeIdentity: bindings.worktreeIdentity,
    inputFingerprint: bindings.inputFingerprint,
    adapterVersion: VITEST_ADAPTER_VERSION,
    runId: randomUUID(),
    run,
  };
  return inRecordWrite(database, () => {
    insertRun(database, stored);
    return readBack(selectRun(database, stored, stored.runId), stored.runId);
  });
}

/** Reading the run back before commit refuses, whole, a record the readers could not rebuild. */
function readBack(stored: StoredRun | undefined, runId: string): StoredRun {
  if (stored === undefined) {
    throw new Error(`The store could not read back run ${runId} it just wrote`);
  }
  return stored;
}

function insertRun(database: DatabaseSync, stored: StoredRun): void {
  const { run } = stored;
  const { fingerprintKind, fingerprintDigest } = fingerprintColumns(
    stored.inputFingerprint,
  );
  const columns = runColumns(run);
  const { lastInsertRowid } = database
    .prepare(INSERT_RUN)
    .run(
      stored.runId,
      stored.projectIdentity,
      stored.worktreeIdentity,
      fingerprintKind,
      fingerprintDigest,
      stored.adapterVersion,
      run.status,
      run.workspace.path,
      run.workspace.directory,
      columns.vitestVersion,
      columns.unsupportedVitest,
      columns.error,
      columns.execution,
      columns.nothingRan,
      columns.cancelError,
      columns.closeError,
      columns.unhandledErrors,
      columns.typecheckModules,
      columns.unsupportedProjects,
      columns.forceStopped,
    );
  if (run.status !== "ran") return;
  insertModules(
    {
      insertModule: database.prepare(INSERT_MODULE),
      insertTest: database.prepare(INSERT_TEST),
    },
    lastInsertRowid,
    run.modules,
  );
}

function runColumns(run: WorkspaceRun): RunColumns {
  switch (run.status) {
    case "ran":
      return ranColumns(run);
    case "unsupported":
      return {
        ...NO_RUN_COLUMNS,
        unsupportedVitest: JSON.stringify(run.vitest),
      };
    case "failed":
      return {
        ...NO_RUN_COLUMNS,
        vitestVersion: run.vitestVersion,
        error: run.error,
        closeError: run.closeError ?? null,
      };
    case "interrupted-before-load":
      return NO_RUN_COLUMNS;
    case "crashed":
      return { ...NO_RUN_COLUMNS, error: run.error };
  }
}

function ranColumns(run: RanRun): RunColumns {
  return {
    ...NO_RUN_COLUMNS,
    vitestVersion: run.vitestVersion,
    execution: run.execution,
    nothingRan: run.nothingRan ?? null,
    cancelError: run.cancelError ?? null,
    closeError: run.closeError ?? null,
    unhandledErrors: JSON.stringify(run.unhandledErrors),
    typecheckModules: JSON.stringify(run.typecheckModules),
    unsupportedProjects: JSON.stringify(run.unsupportedProjects),
    forceStopped: run.forceStopped ? FORCE_STOPPED : NOT_FORCE_STOPPED,
  };
}

function insertModules(
  statements: ChildStatements,
  runSequence: RunSequence,
  modules: readonly RecordedModule[],
): void {
  modules.forEach((module, moduleIndex) => {
    statements.insertModule.run(
      runSequence,
      moduleIndex,
      module.projectName,
      module.modulePath,
      module.state,
      moduleErrors(module),
    );
    if (module.state === "ran") {
      insertTests(statements, runSequence, moduleIndex, module.tests);
    }
  });
}

function moduleErrors(module: RecordedModule): string | null {
  return module.state === "ran" || module.state === "failed"
    ? JSON.stringify(module.errors)
    : null;
}

function insertTests(
  statements: ChildStatements,
  runSequence: RunSequence,
  moduleIndex: number,
  tests: readonly RecordedTest[],
): void {
  tests.forEach((test, testIndex) => {
    statements.insertTest.run(
      runSequence,
      moduleIndex,
      testIndex,
      ...testColumns(test),
    );
  });
}

function testColumns(test: RecordedTest): SQLInputValue[] {
  return [
    ...identifiedTestColumns(test),
    test.execution,
    ...testResultColumns(test),
  ];
}

function testResultColumns(state: TestRunState): SQLInputValue[] {
  return state.execution === "finished"
    ? [state.outcome, JSON.stringify(state.errors)]
    : [null, null];
}
