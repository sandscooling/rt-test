import type { TestOutcome } from "@rt-test/core";
import type { DatabaseSync } from "node:sqlite";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import type {
  NothingRanReason,
  RecordedModule,
  RecordedTest,
  RunExecution,
  TestRunState,
} from "../vitest/run-states.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import {
  arrayOf,
  closeError,
  column,
  identifiedTest,
  integer,
  json,
  member,
  moduleReport,
  optionalText,
  rowsBy,
  stringArray,
  text,
  unreadable,
  unsupportedProject,
  unsupportedVitest,
  type Members,
  type Row,
} from "./columns.js";
import {
  fingerprintFromColumns,
  requireScope,
  type StoredRun,
  type StoreScope,
} from "./stored-records.js";
import { inReadTransaction } from "./transaction.js";

type RanRun = Extract<WorkspaceRun, { status: "ran" }>;

/** One run's module rows and test rows, each in stored order. */
interface RunChildren {
  readonly modules: readonly Row[];
  readonly tests: readonly Row[];
}

const TEST_OUTCOMES: Members<TestOutcome> = {
  passed: true,
  failed: true,
  skipped: true,
  error: true,
};
const RUN_EXECUTIONS: Members<RunExecution> = {
  completed: true,
  interrupted: true,
};
const NOTHING_RAN_REASONS: Members<NothingRanReason> = {
  "no-module": true,
  "no-module-ran": true,
  "no-test-declared": true,
  "every-test-skipped": true,
  "tests-blocked-by-hook": true,
  "interrupted-before-any-test-finished": true,
};

const RUN_COLUMNS = `sequence, run_id, project_identity, worktree_identity, fingerprint_kind,
  fingerprint_digest, adapter_version, status, workspace_path, workspace_directory, vitest_version,
  unsupported_vitest, error, execution, nothing_ran, cancel_error, close_error, unhandled_errors,
  typecheck_modules, unsupported_projects`;
const MODULE_COLUMNS =
  "m.run_sequence, m.module_index, m.project_name, m.module_path, m.state, m.errors";
const TEST_COLUMNS = `t.run_sequence, t.module_index, t.workspace_path, t.project_name, t.module_path,
  t.name_path, t.occurrence, t.is_duplicate, t.execution, t.outcome, t.errors`;
const IN_SCOPE = "r.project_identity = ? AND r.worktree_identity = ?";

const SELECT_RUNS = `SELECT ${RUN_COLUMNS} FROM runs r WHERE ${IN_SCOPE} ORDER BY sequence`;
const SELECT_SCOPE_MODULES = `SELECT ${MODULE_COLUMNS} FROM run_modules m
  JOIN runs r ON r.sequence = m.run_sequence WHERE ${IN_SCOPE}
  ORDER BY m.run_sequence, m.module_index`;
const SELECT_SCOPE_TESTS = `SELECT ${TEST_COLUMNS} FROM run_tests t
  JOIN runs r ON r.sequence = t.run_sequence WHERE ${IN_SCOPE}
  ORDER BY t.run_sequence, t.module_index, t.test_index`;
const SELECT_RUN = `SELECT ${RUN_COLUMNS} FROM runs r WHERE ${IN_SCOPE} AND run_id = ?`;
const SELECT_MODULES = `SELECT ${MODULE_COLUMNS} FROM run_modules m
  WHERE m.run_sequence = ? ORDER BY m.module_index`;
const SELECT_TESTS = `SELECT ${TEST_COLUMNS} FROM run_tests t
  WHERE t.run_sequence = ? ORDER BY t.module_index, t.test_index`;

/** In the order they were stored. */
export function readRuns(
  database: DatabaseSync,
  scope: StoreScope,
): StoredRun[] {
  requireScope(scope);
  const keys = [scope.projectIdentity, scope.worktreeIdentity];
  return inReadTransaction(database, () => {
    const runs = database.prepare(SELECT_RUNS).all(...keys);
    const modules = rowsBy(
      database.prepare(SELECT_SCOPE_MODULES).all(...keys),
      "run_sequence",
    );
    const tests = rowsBy(
      database.prepare(SELECT_SCOPE_TESTS).all(...keys),
      "run_sequence",
    );
    return runs.map((row) => {
      const sequence = integer(row, "sequence");
      return storedRun(row, {
        modules: modules.get(sequence) ?? [],
        tests: tests.get(sequence) ?? [],
      });
    });
  });
}

export function readRun(
  database: DatabaseSync,
  scope: StoreScope,
  runId: string,
): StoredRun | undefined {
  requireScope(scope);
  return inReadTransaction(database, () => selectRun(database, scope, runId));
}

/** Reads inside the caller's transaction, so a writer can read back what it has not yet committed. */
export function selectRun(
  database: DatabaseSync,
  scope: StoreScope,
  runId: string,
): StoredRun | undefined {
  const row = database
    .prepare(SELECT_RUN)
    .get(scope.projectIdentity, scope.worktreeIdentity, runId);
  if (row === undefined) return undefined;
  const sequence = integer(row, "sequence");
  return storedRun(row, {
    modules: database.prepare(SELECT_MODULES).all(sequence),
    tests: database.prepare(SELECT_TESTS).all(sequence),
  });
}

function storedRun(row: Row, children: RunChildren): StoredRun {
  return {
    projectIdentity: text(row, "project_identity"),
    worktreeIdentity: text(row, "worktree_identity"),
    inputFingerprint: fingerprintFromColumns(
      column(row, "fingerprint_kind"),
      column(row, "fingerprint_digest"),
    ),
    adapterVersion: integer(row, "adapter_version"),
    runId: text(row, "run_id"),
    run: workspaceRun(row, children),
  };
}

function workspaceRun(row: Row, children: RunChildren): WorkspaceRun {
  const status = text(row, "status");
  const workspace: VitestWorkspace = {
    path: text(row, "workspace_path"),
    directory: text(row, "workspace_directory"),
  };
  if (status !== "ran") requireNoChildren(children, `${status} run`);
  switch (status) {
    case "ran":
      return ranRun(row, workspace, recordedModules(children));
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
    case "interrupted-before-load":
      return { status, workspace };
    default:
      throw unreadable("runs.status", status);
  }
}

function ranRun(
  row: Row,
  workspace: VitestWorkspace,
  modules: readonly RecordedModule[],
): RanRun {
  const nothingRan = optionalText(row, "nothing_ran");
  const cancelError = optionalText(row, "cancel_error");
  return {
    status: "ran",
    workspace,
    vitestVersion: text(row, "vitest_version"),
    execution: member(RUN_EXECUTIONS, text(row, "execution"), "runs.execution"),
    modules,
    typecheckModules: arrayOf(json(row, "typecheck_modules"), moduleReport),
    unsupportedProjects: arrayOf(
      json(row, "unsupported_projects"),
      unsupportedProject,
    ),
    unhandledErrors: stringArray(json(row, "unhandled_errors")),
    ...(nothingRan === undefined
      ? {}
      : {
          nothingRan: member(
            NOTHING_RAN_REASONS,
            nothingRan,
            "runs.nothing_ran",
          ),
        }),
    ...(cancelError === undefined ? {} : { cancelError }),
    ...closeError(row),
  };
}

function recordedModules(children: RunChildren): RecordedModule[] {
  const tests = rowsBy(children.tests, "module_index");
  const modules = children.modules.map((row) => {
    const moduleIndex = integer(row, "module_index");
    const moduleTests = tests.get(moduleIndex) ?? [];
    tests.delete(moduleIndex);
    return recordedModule(row, moduleTests.map(recordedTest));
  });
  if (tests.size > 0) {
    throw unreadable("run_tests.module_index", [...tests.keys()]);
  }
  return modules;
}

function recordedModule(
  row: Row,
  tests: readonly RecordedTest[],
): RecordedModule {
  const report = {
    projectName: text(row, "project_name"),
    modulePath: text(row, "module_path"),
  };
  const state = text(row, "state");
  if (state === "ran") {
    return {
      ...report,
      state,
      tests,
      errors: stringArray(json(row, "errors")),
    };
  }
  if (tests.length > 0) {
    throw unreadable(`tests under the ${state} module`, report.modulePath);
  }
  switch (state) {
    case "failed":
      return { ...report, state, errors: stringArray(json(row, "errors")) };
    case "crashed":
    case "not-run":
      return { ...report, state };
    default:
      throw unreadable("run_modules.state", state);
  }
}

function recordedTest(row: Row): RecordedTest {
  return { ...identifiedTest(row), ...testRunState(row) };
}

function testRunState(row: Row): TestRunState {
  const execution = text(row, "execution");
  if (execution === "interrupted") return { execution };
  if (execution !== "finished") {
    throw unreadable("run_tests.execution", execution);
  }
  return {
    execution,
    outcome: member(TEST_OUTCOMES, text(row, "outcome"), "run_tests.outcome"),
    errors: stringArray(json(row, "errors")),
  };
}

function requireNoChildren(children: RunChildren, owner: string): void {
  if (children.modules.length > 0 || children.tests.length > 0) {
    throw unreadable(`modules or tests under a ${owner}`, {
      modules: children.modules.length,
      tests: children.tests.length,
    });
  }
}
