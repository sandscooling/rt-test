import type { IdentifiedTest } from "@rt-test/core";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import {
  consumerIdentity,
  defaultStateDirectory,
} from "../src/store/consumer-identity.js";
import {
  FALSIFIER_VERSION,
  type ExperimentNotRun,
  type ExperimentRecord,
  type FalsificationJob,
  type Reach,
} from "../src/falsify/experiment-record.js";
import type { ErrorFact } from "../src/falsify/fact-types.js";
import type { MutationLoad } from "../src/falsify/mutation-transform.js";
import type { NoProbeSite } from "../src/falsify/reach-probe.js";
import { column, UnreadableRecordError } from "../src/store/columns.js";
import type { EvidenceBindings } from "../src/store/defect-evidence.js";
import {
  openStore,
  type LatestResults,
  type RtTestStore,
} from "../src/store/open-store.js";
import {
  STORE_APPLICATION_ID,
  STORE_FILE_NAME,
  STORE_MIGRATIONS,
  STORE_SCHEMA,
  STORE_SCHEMA_VERSION,
} from "../src/store/schema.js";
import type {
  InputFingerprint,
  StoreBindings,
  StoreScope,
} from "../src/store/stored-records.js";
import { NewerStoreSchemaError } from "../src/store/transaction.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { TestDiscovery } from "../src/vitest/discover-tests.js";
import type { VitestWorkspace } from "../src/vitest/find-workspaces.js";
import type { RecordedModule, RecordedTest } from "../src/vitest/run-states.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import {
  isNotKnown,
  type ProjectSelectionFacts,
  type ReportedAlias,
  type SelectionFacts,
  type TestFilePatterns,
} from "../src/vitest/selection-facts.js";
import {
  baseline,
  CLEAN_JOB,
  detection,
  EMPTY_RUN,
  IN_TEST,
  mutatedRun,
  ranOnce,
  ranReply,
  REJECTING_TEST,
  SURVIVING_TEST,
  TYPE_ERROR,
  type ReplyExperiment,
} from "./experiment-facts.js";
import { inTempDir, linkedWorktree, mainCheckout, settle } from "./harness.js";

type Settled<T> = T | { thrown: string };
type RanRun = Extract<WorkspaceRun, { status: "ran" }>;

/** The value every RT Test store carries in `PRAGMA application_id`, whatever its schema version. */
const RT_TEST_APPLICATION_ID = 1381258324;
const OPENED = "opened";
/** The message the held-write worker posts once it holds its transaction open. */
const HOLDING = "holding";
/** The value of the worker's shared flag that lets it commit. */
const RELEASED = 1;
/** The statement the store's opener takes its write lock with, once it has read the header. */
const WRITE_LOCK = "BEGIN IMMEDIATE";

/** Opens the file as the store's opener does, runs `sql` in one write transaction, says that it holds it, and commits once released. */
const HELD_WRITE_WORKER = `
const { DatabaseSync } = require("node:sqlite");
const { parentPort, workerData } = require("node:worker_threads");
const { file, sql, released } = workerData;
const database = new DatabaseSync(file);
database.exec("PRAGMA busy_timeout = 10000");
database.exec("PRAGMA journal_mode = WAL");
database.exec("BEGIN IMMEDIATE");
database.exec(sql);
parentPort.postMessage("${HOLDING}");
Atomics.wait(released, 0, 0);
database.exec("COMMIT");
database.close();
`;
/** The schema version before runs recorded whether Vitest was force-stopped. */
const FORCE_STOP_UNAWARE_VERSION = 1;
/** The schema version before discovered workspaces kept their selection facts. */
const SELECTION_FACTS_UNAWARE_VERSION = 2;
/** The schema version before each project's selection facts carried its Vite root. */
const VITE_ROOT_UNAWARE_VERSION = 3;
/** The schema version before runs could be stored crashed. */
const CRASH_UNAWARE_VERSION = 4;
/** The schema version before each project's selection facts carried Vitest's spellings of its pattern directories. */
const VITEST_SPELLING_UNAWARE_VERSION = 5;
/** The schema version before each project's selection facts carried the directory links Vitest's crawl follows. */
const CRAWLED_LINKS_UNAWARE_VERSION = 6;
/** The schema version before each project's selection facts carried the env sources Vite loads env files from. */
const ENV_SOURCES_UNAWARE_VERSION = 7;
/** What a project's test file patterns lacked before Vitest's spellings were kept, the crawled links added later included. */
const SPELLINGS_AND_LINKS_UNAWARE_FIELDS: readonly (keyof TestFilePatterns)[] =
  ["vitestDirectory", "patternBases", "crawledLinks"];

const WORKTREE_A: StoreScope = {
  projectIdentity: "/work/shop/.git",
  worktreeIdentity: "/work/shop",
};
const WORKTREE_B: StoreScope = {
  projectIdentity: "/work/shop/.git",
  worktreeIdentity: "/work/shop-feature",
};
const OTHER_PROJECT: StoreScope = {
  projectIdentity: "/work/shop-rewrite/.git",
  worktreeIdentity: "/work/shop",
};
const UNFINGERPRINTED: InputFingerprint = { kind: "not-fingerprinted" };
const DIGEST: InputFingerprint = {
  kind: "digest",
  digest: "sha256:9F86D081884C7D65",
};

const PROJECT_NAME = "shop";
const WORKSPACE: VitestWorkspace = {
  path: "packages/cart",
  directory: "/work/shop/packages/cart",
};
const OTHER_WORKSPACE: VitestWorkspace = {
  path: "packages/legacy",
  directory: "/work/shop/packages/legacy",
};
const CART_MODULE = "src/cart.test.ts";
const UNSUPPORTED_RANGE = "^4.1.0 || ^5.0.0";

function identified(
  namePath: readonly string[],
  occurrence = 0,
  isDuplicate = false,
): IdentifiedTest {
  return {
    identity: {
      workspacePath: WORKSPACE.path,
      projectName: PROJECT_NAME,
      modulePath: CART_MODULE,
      namePath,
      occurrence,
    },
    isDuplicate,
  };
}

const INTERRUPTED_TEST: RecordedTest = {
  ...identified(["cart", "applies a coupon"]),
  execution: "interrupted",
};
const RAN_MODULE: RecordedModule = {
  projectName: PROJECT_NAME,
  modulePath: CART_MODULE,
  state: "ran",
  tests: [
    {
      ...identified(["cart", "adds an item"]),
      execution: "finished",
      outcome: "passed",
      errors: [],
    },
    {
      ...identified(["cart", "totals"]),
      execution: "finished",
      outcome: "failed",
      errors: ["AssertionError: expected 3 to be 4"],
    },
    {
      ...identified(["cart", "ships abroad"]),
      execution: "finished",
      outcome: "skipped",
      errors: [],
    },
    {
      ...identified(["cart", "checks stock"]),
      execution: "finished",
      outcome: "error",
      errors: ["Error: beforeAll failed"],
    },
    {
      ...identified(["cart", "same name"], 0, true),
      execution: "finished",
      outcome: "passed",
      errors: [],
    },
    {
      ...identified(["cart", "same name"], 1, true),
      execution: "finished",
      outcome: "passed",
      errors: [],
    },
    INTERRUPTED_TEST,
  ],
  errors: ["Error: afterAll failed"],
};
const FAILED_MODULE: RecordedModule = {
  projectName: PROJECT_NAME,
  modulePath: "src/broken.test.ts",
  state: "failed",
  errors: ["SyntaxError: Unexpected token"],
};
const NOT_RUN_MODULE: RecordedModule = {
  projectName: PROJECT_NAME,
  modulePath: "src/later.test.ts",
  state: "not-run",
};
const CRASHED_MODULE: RecordedModule = {
  projectName: PROJECT_NAME,
  modulePath: "src/crash.test.ts",
  state: "crashed",
};

const RAN_RUN: RanRun = {
  status: "ran",
  workspace: WORKSPACE,
  vitestVersion: "5.0.1",
  execution: "interrupted",
  modules: [RAN_MODULE, FAILED_MODULE, NOT_RUN_MODULE],
  typecheckModules: [
    { projectName: PROJECT_NAME, modulePath: "src/types.test-d.ts" },
  ],
  unsupportedProjects: [
    { projectName: "browser", reason: "browser mode is not supported" },
  ],
  unhandledErrors: ["Error: leaked timer"],
  forceStopped: true,
  cancelError: "Error: cancel failed",
  closeError: "Error: close timed out",
};
const NOTHING_RAN_RUN: RanRun = {
  status: "ran",
  workspace: WORKSPACE,
  vitestVersion: "4.1.2",
  execution: "completed",
  modules: [
    CRASHED_MODULE,
    {
      projectName: PROJECT_NAME,
      modulePath: CART_MODULE,
      state: "ran",
      tests: [
        {
          ...identified(["cart", "ships abroad"]),
          execution: "finished",
          outcome: "skipped",
          errors: [],
        },
      ],
      errors: [],
    },
  ],
  typecheckModules: [],
  unsupportedProjects: [],
  unhandledErrors: [],
  nothingRan: "every-test-skipped",
  forceStopped: false,
};
const UNSUPPORTED_RUN: WorkspaceRun = {
  status: "unsupported",
  workspace: WORKSPACE,
  vitest: {
    supported: false,
    version: "3.2.4",
    supportedRange: UNSUPPORTED_RANGE,
    reason: "Vitest 3.2.4 is outside the supported range",
  },
};
const FAILED_RUN: WorkspaceRun = {
  status: "failed",
  workspace: WORKSPACE,
  vitestVersion: "5.0.1",
  error: "Error: Failed to load config",
  closeError: "Error: close timed out",
};
const BEFORE_LOAD_RUN: WorkspaceRun = {
  status: "interrupted-before-load",
  workspace: WORKSPACE,
};
const CRASHED_RUN: WorkspaceRun = {
  status: "crashed",
  workspace: WORKSPACE,
  error: "the executor process 7 exited during the job (exit code 1)",
};

const REGEXP_ALIAS: ReportedAlias = {
  find: "^~icons\\/(.*)$",
  findKind: "regexp",
  flags: "i",
  replacement: "icon-pack/$1",
  hasCustomResolver: true,
};
const CART_PROJECT_FACTS: ProjectSelectionFacts = {
  projectName: PROJECT_NAME,
  viteRoot: "packages/cart/web",
  setupFiles: ["packages/cart/test/setup.ts", "../shared/setup.ts"],
  globalSetupFiles: ["test/global-setup.ts"],
  aliases: [
    {
      find: "@cart",
      findKind: "string",
      flags: "",
      replacement: "/work/shop/packages/cart/src",
      hasCustomResolver: false,
    },
    REGEXP_ALIAS,
  ],
  testFilePatterns: {
    directory: "packages/cart",
    vitestDirectory: "/work/shop/packages/cart",
    patternBases: [
      {
        spelled: "/work/shop/packages/cart/src",
        directory: "packages/cart/src",
      },
    ],
    crawledLinks: {
      complete: true,
      links: [
        {
          spelled: "/work/shop/packages/cart/src/shared",
          directory: "packages/shared",
        },
      ],
    },
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    includeSource: ["src/**/*.ts"],
  },
  envSources: [
    {
      envDirectory: "packages/cart/web",
      envPrefixes: ["VITE_", "CART_"],
      mode: "staging",
    },
    { envDirectory: ".", envPrefixes: ["VITE_"], mode: "test" },
  ],
};
/**
 * A project with no setup files, global setup files or aliases, matching from the consumer root, whose crawled links
 * are not known and whose own config turns env files off.
 */
const EMPTY_PROJECT_FACTS: ProjectSelectionFacts = {
  projectName: "empty",
  viteRoot: ".",
  setupFiles: [],
  globalSetupFiles: [],
  aliases: [],
  testFilePatterns: {
    directory: ".",
    vitestDirectory: "/work/shop",
    patternBases: [],
    crawledLinks: {
      complete: false,
      reason:
        "the walk below /work/shop follows more than 1000 directory links",
    },
    include: [],
    exclude: [],
    includeSource: [],
  },
  envSources: [
    { envDirectory: null, envPrefixes: ["VITE_"], mode: "test" },
    { envDirectory: ".", envPrefixes: ["VITE_"], mode: "test" },
  ],
};
const SELECTION_FACTS: SelectionFacts = {
  reported: true,
  projects: [CART_PROJECT_FACTS, EMPTY_PROJECT_FACTS],
};
const NOT_REPORTED: SelectionFacts = { reported: false };

const DISCOVERY: TestDiscovery = {
  workspaces: [
    {
      status: "discovered",
      workspace: WORKSPACE,
      vitestVersion: "5.0.1",
      tests: [
        { ...identified(["cart", "adds an item"]), mode: "run" },
        { ...identified(["cart", "totals"]), mode: "only" },
        { ...identified(["cart", "ships abroad"]), mode: "skip" },
        { ...identified(["cart", "refunds"]), mode: "todo" },
        { ...identified(["cart", "same name"], 0, true), mode: "run" },
        { ...identified(["cart", "same name"], 1, true), mode: "run" },
      ],
      failedModules: [
        {
          projectName: PROJECT_NAME,
          modulePath: "src/broken.test.ts",
          errors: ["SyntaxError: Unexpected token"],
        },
      ],
      typecheckModules: [
        { projectName: PROJECT_NAME, modulePath: "src/types.test-d.ts" },
      ],
      unsupportedProjects: [
        { projectName: "browser", reason: "browser mode is not supported" },
      ],
      unhandledErrors: ["Error: leaked timer"],
      selectionFacts: SELECTION_FACTS,
      closeError: "Error: close timed out",
    },
    {
      status: "unsupported",
      workspace: OTHER_WORKSPACE,
      vitest: {
        supported: false,
        supportedRange: UNSUPPORTED_RANGE,
        reason: "no Vitest resolves",
      },
    },
  ],
  notRead: [{ source: "pnpm-workspace.yaml", reason: "YAML is not read" }],
};
const DISCOVERY_WITHOUT_TESTS: TestDiscovery = {
  workspaces: [
    {
      status: "failed",
      workspace: WORKSPACE,
      vitestVersion: "4.1.2",
      error: "Error: config threw",
      closeError: "Error: close timed out",
    },
  ],
  notRead: [
    { source: "package.json", reason: "Unexpected end of JSON input" },
    { source: "apps/*", reason: "the pattern matched no directory" },
  ],
};

function bound(
  scope: StoreScope,
  inputFingerprint: InputFingerprint = UNFINGERPRINTED,
): StoreBindings {
  return { ...scope, inputFingerprint };
}

function withOpenStore<T>(
  stateDirectory: string,
  body: (store: RtTestStore) => T,
): T {
  const store = openStore(stateDirectory);
  try {
    return body(store);
  } finally {
    store.close();
  }
}

/** A store in the default state directory of a fresh consumer root. */
function inStore<T>(
  body: (store: RtTestStore, stateDirectory: string) => T,
): Promise<Settled<T>> {
  return inTempDir((dir) => {
    const stateDirectory = defaultStateDirectory(dir);
    return settle(() =>
      withOpenStore(stateDirectory, (store) => body(store, stateDirectory)),
    );
  });
}

/** Writes through one store, closes it, and reads through a store opened again on the same directory. */
function acrossReopen<T>(
  write: (store: RtTestStore) => void,
  read: (store: RtTestStore) => T,
): Promise<Settled<T>> {
  return inTempDir((dir) => {
    const stateDirectory = defaultStateDirectory(dir);
    return settle(() => {
      withOpenStore(stateDirectory, write);
      return withOpenStore(stateDirectory, read);
    });
  });
}

function runsOf(store: RtTestStore, scope: StoreScope): WorkspaceRun[] {
  return store.readRuns(scope).map((stored) => stored.run);
}

function modulesOf(run: WorkspaceRun | undefined): readonly RecordedModule[] {
  return run?.status === "ran" ? run.modules : [];
}

function testsOf(module: RecordedModule | undefined): readonly RecordedTest[] {
  return module?.state === "ran" ? module.tests : [];
}

function rejection(result: Settled<unknown>): string {
  return typeof result === "object" && result !== null && "thrown" in result
    ? String(result.thrown)
    : "accepted";
}

function withRawDatabase<T>(
  file: string,
  body: (database: DatabaseSync) => T,
): T {
  const database = new DatabaseSync(file);
  try {
    return body(database);
  } finally {
    database.close();
  }
}

/** Takes a current store's header back to `userVersion`, dropping the evidence table and the not-covered column every version below 10 lacks. */
function lowerSchemaVersion(database: DatabaseSync, userVersion: number): void {
  database.exec("DROP TABLE defect_evidence");
  database.exec("ALTER TABLE discoveries DROP COLUMN not_covered");
  database.exec(`PRAGMA user_version = ${userVersion}`);
}

function countRows(
  file: string,
  table: "runs" | "discoveries" | "defect_evidence",
): unknown {
  return withRawDatabase(
    file,
    (database) =>
      database.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.[
        "count"
      ],
  );
}

/** Reports the module's project name as asked, calling `onRead` first. */
function observedModule(
  module: RecordedModule,
  onRead: () => void,
): RecordedModule {
  return Object.defineProperty({ ...module }, "projectName", {
    enumerable: true,
    get() {
      onRead();
      return module.projectName;
    },
  });
}

function posix(path: string): string {
  return path.split(sep).join("/");
}

function fileDigest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function openRefusal(stateDirectory: string): string {
  try {
    openStore(stateDirectory).close();
    return OPENED;
  } catch (error) {
    return String(error);
  }
}

interface Refusal {
  readonly reason: string;
  readonly file: string;
  readonly unchanged: boolean;
}

/** Opens a store over a file `prepare` wrote where the store's file goes. */
function openingOver(
  prepare: (file: string, stateDirectory: string) => void,
): Promise<Settled<Refusal>> {
  return inTempDir((dir) =>
    settle(() => {
      const stateDirectory = defaultStateDirectory(dir);
      const file = join(stateDirectory, STORE_FILE_NAME);
      mkdirSync(stateDirectory, { recursive: true });
      prepare(file, stateDirectory);
      const before = fileDigest(file);
      const reason = openRefusal(stateDirectory);
      return { reason, file, unchanged: fileDigest(file) === before };
    }),
  );
}

function refusalFacts(
  refusal: Settled<Refusal>,
  found: string,
): Settled<Record<string, boolean>> {
  if ("thrown" in refusal) return refusal;
  return {
    namesFile: refusal.reason.includes(refusal.file),
    namesFound: refusal.reason.includes(found),
    namesExpected: refusal.reason.includes(
      `expected application id ${RT_TEST_APPLICATION_ID} and schema version ${STORE_SCHEMA_VERSION}`,
    ),
  };
}

/**
 * Runs `body` while a worker holds a write transaction of `sql` open on the file, and waits for the worker to commit.
 * The worker commits only once the store under test asks for its write lock, so that store has read the header the
 * held transaction has not yet committed however slowly either thread runs, or once `body` has returned. `held` says
 * the store under test asked for its write lock while the worker held its transaction.
 */
async function whileWriteHeld<T>(
  file: string,
  sql: string,
  body: () => T,
): Promise<{ held: boolean; result: T; exitCode: number }> {
  const released = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(HELD_WRITE_WORKER, {
    eval: true,
    workerData: { file, sql, released },
  });
  const exited = once(worker, "exit");
  const holding = await Promise.race([
    once(worker, "message").then(([message]) => message === HOLDING),
    exited.then(() => false),
  ]);
  const release = () => {
    Atomics.store(released, 0, RELEASED);
    Atomics.notify(released, 0);
  };
  let lockAskedWhileHeld = false;
  const exec = DatabaseSync.prototype.exec;
  const releaseAtLock = vi
    .spyOn(DatabaseSync.prototype, "exec")
    .mockImplementation(function (this: DatabaseSync, statement: string) {
      if (statement === WRITE_LOCK) {
        lockAskedWhileHeld ||= Atomics.load(released, 0) !== RELEASED;
        release();
      }
      exec.call(this, statement);
    });
  let result: T;
  try {
    result = body();
  } finally {
    releaseAtLock.mockRestore();
    release();
  }
  const [exitCode] = (await exited) as [number];
  return { held: holding && lockAskedWhileHeld, result, exitCode };
}

/** Writes the runs through a store, then takes the file back to the schema version before the force-stop column, as the migration's inverse. */
function writeForceStopUnawareStore(
  stateDirectory: string,
  runs: readonly WorkspaceRun[],
  userVersion = FORCE_STOP_UNAWARE_VERSION,
): string {
  withOpenStore(stateDirectory, (store) => {
    for (const run of runs) store.writeRun(bound(WORKTREE_A), run);
  });
  const file = join(stateDirectory, STORE_FILE_NAME);
  withRawDatabase(file, (database) => {
    database.exec("ALTER TABLE runs DROP COLUMN force_stopped");
    database.exec(
      "ALTER TABLE discovery_workspaces DROP COLUMN selection_facts",
    );
    lowerSchemaVersion(database, userVersion);
  });
  return file;
}

/** Writes the discoveries and runs through a store, then takes the file back to the schema version before selection facts, as that migration's inverse. */
function writeSelectionFactsUnawareStore(
  stateDirectory: string,
  discoveries: readonly TestDiscovery[],
  runs: readonly WorkspaceRun[] = [],
): string {
  withOpenStore(stateDirectory, (store) => {
    for (const discovery of discoveries) {
      store.writeDiscovery(bound(WORKTREE_A), discovery);
    }
    for (const run of runs) store.writeRun(bound(WORKTREE_A), run);
  });
  const file = join(stateDirectory, STORE_FILE_NAME);
  withRawDatabase(file, (database) => {
    database.exec(
      "ALTER TABLE discovery_workspaces DROP COLUMN selection_facts",
    );
    lowerSchemaVersion(database, SELECTION_FACTS_UNAWARE_VERSION);
  });
  return file;
}

/** Writes the discoveries through a store, then strips each stored project's Vite root and takes the header back to version 3, as a store from before the root was kept holds them. */
function writeViteRootUnawareStore(
  stateDirectory: string,
  discoveries: readonly TestDiscovery[],
): string {
  withOpenStore(stateDirectory, (store) => {
    for (const discovery of discoveries) {
      store.writeDiscovery(bound(WORKTREE_A), discovery);
    }
  });
  const file = join(stateDirectory, STORE_FILE_NAME);
  withRawDatabase(file, (database) => {
    const rows = database
      .prepare(
        "SELECT rowid, selection_facts FROM discovery_workspaces WHERE selection_facts IS NOT NULL",
      )
      .all();
    const update = database.prepare(
      "UPDATE discovery_workspaces SET selection_facts = ? WHERE rowid = ?",
    );
    for (const row of rows) {
      const projects = JSON.parse(String(row["selection_facts"])) as Record<
        string,
        unknown
      >[];
      const rootless = projects.map(({ viteRoot: _dropped, ...rest }) => rest);
      update.run(JSON.stringify(rootless), Number(row["rowid"]));
    }
    lowerSchemaVersion(database, VITE_ROOT_UNAWARE_VERSION);
  });
  return file;
}

/** Each stored project without the test file pattern fields `unaware`, as a store from before they were kept holds it. */
function withoutPatternFields(
  unaware: readonly (keyof TestFilePatterns)[],
): (project: ProjectSelectionFacts) => object {
  return (project) => {
    const patterns: Partial<TestFilePatterns> = {
      ...project.testFilePatterns,
    };
    for (const field of unaware) delete patterns[field];
    return { ...project, testFilePatterns: patterns };
  };
}

/** Each stored project without its env sources, as a store from before they were kept holds it. */
function withoutEnvSources({
  envSources: _dropped,
  ...rest
}: ProjectSelectionFacts): object {
  return rest;
}

/** Writes `DISCOVERY` and the runs through a store, then rewrites each stored project with `strip` and takes the header back to `userVersion`, as a store from before the stripped fields were kept holds them. */
function writeFactsUnawareStore(
  stateDirectory: string,
  userVersion: number,
  strip: (project: ProjectSelectionFacts) => object,
  runs: readonly WorkspaceRun[] = [],
): string {
  withOpenStore(stateDirectory, (store) => {
    store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
    for (const run of runs) store.writeRun(bound(WORKTREE_A), run);
  });
  const file = join(stateDirectory, STORE_FILE_NAME);
  withRawDatabase(file, (database) => {
    const rows = database
      .prepare(
        "SELECT rowid, selection_facts FROM discovery_workspaces WHERE selection_facts IS NOT NULL",
      )
      .all();
    const update = database.prepare(
      "UPDATE discovery_workspaces SET selection_facts = ? WHERE rowid = ?",
    );
    for (const row of rows) {
      const projects = JSON.parse(
        String(row["selection_facts"]),
      ) as ProjectSelectionFacts[];
      update.run(JSON.stringify(projects.map(strip)), Number(row["rowid"]));
    }
    lowerSchemaVersion(database, userVersion);
  });
  return file;
}

/** `DISCOVERY` as it reads back from a store written without spellings at `userVersion`, once opened. */
function inSpellingUnawareStore(
  userVersion: number,
): Promise<Settled<TestDiscovery | undefined>> {
  return inTempDir((dir) =>
    settle(() => {
      const stateDirectory = defaultStateDirectory(dir);
      writeFactsUnawareStore(
        stateDirectory,
        userVersion,
        withoutPatternFields(SPELLINGS_AND_LINKS_UNAWARE_FIELDS),
      );
      return withOpenStore(
        stateDirectory,
        (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
      );
    }),
  );
}

/** The discovery with each discovered workspace's selection facts replaced by `facts`. */
function withFacts(
  discovery: TestDiscovery,
  facts: SelectionFacts,
): TestDiscovery {
  return {
    ...discovery,
    workspaces: discovery.workspaces.map((entry) =>
      entry.status === "discovered"
        ? { ...entry, selectionFacts: facts }
        : entry,
    ),
  };
}

/** The discovery as a store from before selection facts reads it back: each discovered workspace not reporting them. */
function withoutReportedFacts(discovery: TestDiscovery): TestDiscovery {
  return withFacts(discovery, NOT_REPORTED);
}

/** The selection facts of each discovered workspace of the latest discovery. */
function discoveredFacts(store: RtTestStore): SelectionFacts[] | undefined {
  return store
    .readLatestDiscovery(WORKTREE_A)
    ?.discovery.workspaces.flatMap((entry) =>
      entry.status === "discovered" ? [entry.selectionFacts] : [],
    );
}

/** Stores `DISCOVERY`, overwrites its discovered workspace's stored selection facts with `stored`, and reads it back. */
function readingStoredFacts(stored: unknown): Promise<Settled<string>> {
  return inStore((store) => {
    store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
    withRawDatabase(store.file, (database) => {
      database
        .prepare(
          "UPDATE discovery_workspaces SET selection_facts = ? WHERE status = 'discovered'",
        )
        .run(typeof stored === "string" ? stored : JSON.stringify(stored));
    });
    return rejection(settle(() => store.readLatestDiscovery(WORKTREE_A)));
  });
}

/** A store in the default state directory of a fresh consumer root, written at the schema version before the force-stop column. */
function inForceStopUnawareStore<T>(
  runs: readonly WorkspaceRun[],
  body: (stateDirectory: string, file: string) => T,
): Promise<Settled<T>> {
  return inTempDir((dir) =>
    settle(() => {
      const stateDirectory = defaultStateDirectory(dir);
      return body(
        stateDirectory,
        writeForceStopUnawareStore(stateDirectory, runs),
      );
    }),
  );
}

function schemaVersionOf(file: string): unknown {
  return withRawDatabase(
    file,
    (database) =>
      database.prepare("PRAGMA user_version").get()?.["user_version"],
  );
}

function otherSqliteDatabase(userVersion: number): (file: string) => void {
  return (file) => {
    withRawDatabase(file, (database) => {
      database.exec("CREATE TABLE notes (body TEXT)");
      database.exec(`PRAGMA user_version = ${userVersion}`);
    });
  };
}

describe("consumer identity", () => {
  it("D1211: a root spelled through a link and a trailing separator has the identity of its real path", async () => {
    const identity = await inTempDir((dir) => {
      const real = join(dir, "real");
      const link = join(dir, "link");
      mkdirSync(real);
      symlinkSync(real, link, "junction");
      return {
        link: settle(() => consumerIdentity(`${link}${sep}`)),
        real: posix(real),
      };
    });
    expect(identity).toStrictEqual({
      link: { projectIdentity: identity.real, worktreeIdentity: identity.real },
      real: identity.real,
    });
  });

  it("D1212: a root that cannot be resolved is refused rather than given the identity of its spelling", async () => {
    const identity = await inTempDir((dir) =>
      settle(() => consumerIdentity(join(dir, "missing"))),
    );
    expect(identity).toEqual({ thrown: expect.any(String) });
  });

  it("D1213: a linked worktree's project identity is the main checkout's git directory, found through commondir", async () => {
    const identity = await inTempDir((dir) => {
      const main = mainCheckout(dir);
      const worktree = linkedWorktree(main, "feature", posix);
      return {
        project: settle(() => consumerIdentity(worktree).projectIdentity),
        expected: posix(join(main, ".git")),
      };
    });
    expect(identity.project).toBe(identity.expected);
  });

  it("D1214: a relative gitdir resolves against the directory of the .git file that holds it", async () => {
    const identity = await inTempDir((dir) => {
      const main = mainCheckout(dir);
      const worktree = linkedWorktree(
        main,
        "hotfix",
        () => "../main/.git/worktrees/hotfix",
      );
      return {
        project: settle(() => consumerIdentity(worktree).projectIdentity),
        expected: posix(join(main, ".git")),
      };
    });
    expect(identity.project).toStrictEqual(identity.expected);
  });

  it("D1215: two worktrees of one repository keep their own worktree identities, each its root", async () => {
    const identities = await inTempDir((dir) => {
      const main = mainCheckout(dir);
      const worktree = linkedWorktree(main, "feature", posix);
      return {
        actual: settle(() => ({
          main: consumerIdentity(main).worktreeIdentity,
          worktree: consumerIdentity(worktree).worktreeIdentity,
        })),
        expected: { main: posix(main), worktree: posix(worktree) },
      };
    });
    expect(identities.actual).toStrictEqual(identities.expected);
  });

  it("D1216: a root below a repository's top takes the project identity of the repository it sits in", async () => {
    const identity = await inTempDir((dir) => {
      const main = mainCheckout(dir);
      const packageRoot = join(main, "packages", "cart");
      mkdirSync(packageRoot, { recursive: true });
      return {
        project: settle(() => consumerIdentity(packageRoot).projectIdentity),
        expected: posix(join(main, ".git")),
      };
    });
    expect(identity.project).toStrictEqual(identity.expected);
  });

  it("D1265: a submodule, whose git directory has no commondir, takes that git directory as its project identity", async () => {
    const identity = await inTempDir((dir) => {
      const gitDirectory = join(dir, "super", ".git", "modules", "sub");
      const root = join(dir, "super", "sub");
      mkdirSync(gitDirectory, { recursive: true });
      mkdirSync(root);
      writeFileSync(join(root, ".git"), `gitdir: ${posix(gitDirectory)}\n`);
      return {
        project: settle(() => consumerIdentity(root).projectIdentity),
        expected: posix(gitDirectory),
      };
    });
    expect(identity.project).toStrictEqual(identity.expected);
  });

  it("D1217: outside any git repository the project identity is the worktree identity", async () => {
    const identity = await inTempDir((dir) => {
      const root = join(dir, "plain");
      mkdirSync(root);
      return {
        actual: settle(() => consumerIdentity(root)),
        expected: {
          projectIdentity: posix(root),
          worktreeIdentity: posix(root),
        },
      };
    });
    expect(identity.actual).toStrictEqual(identity.expected);
  });

  it("D1218: the default state directory is .rt-test under the consumer root", () => {
    const root = join(sep, "work", "shop");
    expect(defaultStateDirectory(root)).toBe(join(root, ".rt-test"));
  });
});

describe("storing a workspace run", () => {
  it("D1219: a ran run reads back with every field unchanged", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), RAN_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([RAN_RUN]);
  });

  it("D1220: a run in which nothing ran reads back with its nothing-ran reason", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), NOTHING_RAN_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([NOTHING_RAN_RUN]);
  });

  it("D1221: an unsupported run reads back with its report, including the Vitest version found", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), UNSUPPORTED_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([UNSUPPORTED_RUN]);
  });

  it("D1222: a failed run reads back with its own error and its close error apart", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([FAILED_RUN]);
  });

  it("D2793: a crashed run reads back with the exit it stored", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), CRASHED_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([CRASHED_RUN]);
  });

  it("D1223: a run interrupted before load reads back with the workspace it was for", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([BEFORE_LOAD_RUN]);
  });

  it("D1224: a stored run is bound to its project, worktree, fingerprint, assigned run identity and the current adapter version", async () => {
    const stored = await inStore((store) => {
      const written = store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      return store.readRuns(WORKTREE_A).map(({ runId, ...rest }) => ({
        ...rest,
        runId: runId === written.runId,
      }));
    });
    expect(stored).toStrictEqual([
      {
        ...WORKTREE_A,
        inputFingerprint: UNFINGERPRINTED,
        adapterVersion: VITEST_ADAPTER_VERSION,
        run: BEFORE_LOAD_RUN,
        runId: true,
      },
    ]);
  });

  it("D1225: storing the same run twice records two runs under two run identities", async () => {
    const identities = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      return new Set(store.readRuns(WORKTREE_A).map((stored) => stored.runId))
        .size;
    });
    expect(identities).toBe(2);
  });

  it("D1226: a test recorded interrupted reads back with no outcome and no errors", async () => {
    const interrupted = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), RAN_RUN);
      const [ranModule] = modulesOf(runsOf(store, WORKTREE_A)[0]);
      return testsOf(ranModule).find(
        (test) => test.execution === "interrupted",
      );
    });
    expect(interrupted).toStrictEqual(INTERRUPTED_TEST);
  });

  it("D1227: a crashed module reads back with no tests", async () => {
    const crashed = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), NOTHING_RAN_RUN);
      return modulesOf(runsOf(store, WORKTREE_A)[0]).find(
        (module) => module.state === "crashed",
      );
    });
    expect(crashed).toStrictEqual(CRASHED_MODULE);
  });

  it("D1228: a run whose worktree identity is absent is refused, naming it, and nothing is stored", async () => {
    const outcome = await inStore((store) => {
      const bindings = {
        projectIdentity: WORKTREE_A.projectIdentity,
        inputFingerprint: UNFINGERPRINTED,
      } as unknown as StoreBindings;
      const reason = rejection(settle(() => store.writeRun(bindings, RAN_RUN)));
      return {
        namesWorktreeIdentity: reason.includes("worktree identity"),
        runs: countRows(store.file, "runs"),
      };
    });
    expect(outcome).toStrictEqual({ namesWorktreeIdentity: true, runs: 0 });
  });

  it("D1229: a run with no input fingerprint is refused, never stored as not fingerprinted", async () => {
    const outcome = await inStore((store) => {
      const bindings = { ...WORKTREE_A } as unknown as StoreBindings;
      const result = settle(() => store.writeRun(bindings, BEFORE_LOAD_RUN));
      return {
        refused: rejection(result) !== "accepted",
        runs: store.readRuns(WORKTREE_A).length,
      };
    });
    expect(outcome).toStrictEqual({ refused: true, runs: 0 });
  });

  it("D1230: a discovery whose project identity is empty is refused, naming it, and nothing is stored", async () => {
    const outcome = await inStore((store) => {
      const bindings = bound({ ...WORKTREE_A, projectIdentity: "" });
      const reason = rejection(
        settle(() => store.writeDiscovery(bindings, DISCOVERY)),
      );
      return {
        namesProjectIdentity: reason.includes("project identity"),
        discoveries: countRows(store.file, "discoveries"),
      };
    });
    expect(outcome).toStrictEqual({
      namesProjectIdentity: true,
      discoveries: 0,
    });
  });

  it("D1231: a digest fingerprint reads back exactly as the caller gave it", async () => {
    const fingerprint = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A, DIGEST), BEFORE_LOAD_RUN);
      return store.readRuns(WORKTREE_A)[0]?.inputFingerprint;
    });
    expect(fingerprint).toStrictEqual(DIGEST);
  });

  it("D1232: a discovery stored not fingerprinted reads back not fingerprinted, never as an empty digest", async () => {
    const fingerprint = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      return store.readLatestDiscovery(WORKTREE_A)?.inputFingerprint;
    });
    expect(fingerprint).toStrictEqual({ kind: "not-fingerprinted" });
  });
});

describe("storing a discovery", () => {
  it("D1233: a discovery reads back with every workspace, test, failed module and report unchanged", async () => {
    const discovery = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      return store.readLatestDiscovery(WORKTREE_A)?.discovery;
    });
    expect(discovery).toStrictEqual(DISCOVERY);
  });

  it("D1234: a discovery with no discovered workspace reads back with the sources it did not read", async () => {
    const discovery = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      return store.readLatestDiscovery(WORKTREE_A)?.discovery;
    });
    expect(discovery).toStrictEqual(DISCOVERY_WITHOUT_TESTS);
  });

  it("D1266: a failed discovery workspace reads back with its own error and its close error", async () => {
    const workspaces = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      return store.readLatestDiscovery(WORKTREE_A)?.discovery.workspaces;
    });
    expect(workspaces).toStrictEqual(DISCOVERY_WITHOUT_TESTS.workspaces);
  });

  it("D1482: a workspace not confirmed at start reads back as not confirmed, with its reason", async () => {
    const notConfirmed: TestDiscovery = {
      workspaces: [
        {
          status: "not-confirmed",
          workspace: WORKSPACE,
          reason: "not confirmed at start",
        },
      ],
      notRead: [],
    };
    const discovery = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), notConfirmed);
      return store.readLatestDiscovery(WORKTREE_A)?.discovery;
    });
    expect(discovery).toStrictEqual(notConfirmed);
  });

  it("D1235: the latest discovery is the one stored last", async () => {
    const discovery = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      return store.readLatestDiscovery(WORKTREE_A)?.discovery;
    });
    expect(discovery).toStrictEqual(DISCOVERY_WITHOUT_TESTS);
  });

  it("D1236: a stored discovery is bound to its project, worktree, fingerprint, assigned identity and the current adapter version", async () => {
    const stored = await inStore((store) => {
      const written = store.writeDiscovery(
        bound(WORKTREE_A, DIGEST),
        DISCOVERY,
      );
      const latest = store.readLatestDiscovery(WORKTREE_A);
      if (latest === undefined) return latest;
      const { discoveryId, ...rest } = latest;
      return { ...rest, discoveryId: discoveryId === written.discoveryId };
    });
    expect(stored).toStrictEqual({
      ...WORKTREE_A,
      inputFingerprint: DIGEST,
      adapterVersion: VITEST_ADAPTER_VERSION,
      discovery: DISCOVERY,
      discoveryId: true,
    });
  });
});

describe("writing a run or discovery whole", () => {
  it("D1237: a run write that fails part way leaves no trace of the run", async () => {
    const runs = await inStore((store) => {
      const partial: RanRun = {
        ...RAN_RUN,
        modules: [
          RAN_MODULE,
          { ...FAILED_MODULE, projectName: undefined as unknown as string },
        ],
      };
      settle(() => store.writeRun(bound(WORKTREE_A), partial));
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([]);
  });

  it("D1238: a discovery write that fails part way leaves no trace of the discovery", async () => {
    const latest = await inStore((store) => {
      const [discovered] = DISCOVERY.workspaces;
      const partial: TestDiscovery = {
        ...DISCOVERY,
        workspaces: [
          ...(discovered === undefined ? [] : [discovered]),
          {
            status: "failed",
            workspace: {
              path: undefined as unknown as string,
              directory: OTHER_WORKSPACE.directory,
            },
            vitestVersion: "5.0.1",
            error: "Error: config threw",
          },
        ],
      };
      settle(() => store.writeDiscovery(bound(WORKTREE_A), partial));
      return store.readLatestDiscovery(WORKTREE_A);
    });
    expect(latest).toBeUndefined();
  });

  it("D1239: a second store reading while a run is being written sees none of it", async () => {
    const seen = await inStore((store, stateDirectory) => {
      const reader = openStore(stateDirectory);
      try {
        const observed: { runs: Settled<WorkspaceRun[]> | "never read" } = {
          runs: "never read",
        };
        const run: RanRun = {
          ...RAN_RUN,
          modules: [
            RAN_MODULE,
            observedModule(FAILED_MODULE, () => {
              observed.runs = settle(() => runsOf(reader, WORKTREE_A));
            }),
            NOT_RUN_MODULE,
          ],
        };
        store.writeRun(bound(WORKTREE_A), run);
        return observed.runs;
      } finally {
        reader.close();
      }
    });
    expect(seen).toStrictEqual([]);
  });

  it("D1240: a run the readers could not rebuild is refused whole and the stored history stays readable", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      const unreadable: RanRun = {
        ...RAN_RUN,
        modules: [
          {
            ...RAN_MODULE,
            tests: [
              {
                ...INTERRUPTED_TEST,
                execution: "pending",
              } as unknown as RecordedTest,
            ],
          },
        ],
      };
      settle(() => store.writeRun(bound(WORKTREE_A), unreadable));
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([BEFORE_LOAD_RUN]);
  });

  it("D1241: a discovery the reader could not rebuild is refused whole and the latest discovery stays readable", async () => {
    const latest = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      const unreadable = {
        ...DISCOVERY,
        workspaces: DISCOVERY.workspaces.map((workspace) =>
          workspace.status === "discovered"
            ? {
                ...workspace,
                tests: workspace.tests.map((test) => ({
                  ...test,
                  mode: "queued",
                })),
              }
            : workspace,
        ),
      } as unknown as TestDiscovery;
      settle(() => store.writeDiscovery(bound(WORKTREE_A), unreadable));
      return store.readLatestDiscovery(WORKTREE_A)?.discovery;
    });
    expect(latest).toStrictEqual(DISCOVERY_WITHOUT_TESTS);
  });
});

describe("reading for one project and worktree", () => {
  it("D1242: runs stored for another project never answer, even under the same worktree path", async () => {
    const runs = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      store.writeRun(bound(OTHER_PROJECT), UNSUPPORTED_RUN);
      return runsOf(store, WORKTREE_A);
    });
    expect(runs).toStrictEqual([FAILED_RUN]);
  });

  it("D1243: two stores open on one state directory each store and read back only their own worktree's runs", async () => {
    const runs = await inStore((store, stateDirectory) => {
      const other = openStore(stateDirectory);
      try {
        store.writeRun(bound(WORKTREE_A), FAILED_RUN);
        other.writeRun(bound(WORKTREE_B), UNSUPPORTED_RUN);
        store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
        return {
          a: runsOf(store, WORKTREE_A),
          b: runsOf(other, WORKTREE_B),
        };
      } finally {
        other.close();
      }
    });
    expect(runs).toStrictEqual({
      a: [FAILED_RUN, BEFORE_LOAD_RUN],
      b: [UNSUPPORTED_RUN],
    });
  });

  it("D1244: a run read by identity answers its own worktree and never another", async () => {
    const reads = await inStore((store) => {
      const { runId } = store.writeRun(bound(WORKTREE_B), FAILED_RUN);
      return {
        own: store.readRun(WORKTREE_B, runId)?.run,
        other: store.readRun(WORKTREE_A, runId),
      };
    });
    expect(reads).toStrictEqual({ own: FAILED_RUN, other: undefined });
  });

  it("D1245: another worktree's discovery never answers as this worktree's latest", async () => {
    const reads = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_B), DISCOVERY);
      return {
        own: store.readLatestDiscovery(WORKTREE_B)?.discovery,
        other: store.readLatestDiscovery(WORKTREE_A),
      };
    });
    expect(reads).toStrictEqual({ own: DISCOVERY, other: undefined });
  });

  it("D1246: reading runs with an empty project identity is refused, naming it, rather than answered with none", async () => {
    const reason = await inStore((store) =>
      rejection(
        settle(() => store.readRuns({ ...WORKTREE_A, projectIdentity: "" })),
      ),
    );
    expect(reason).toContain("project identity");
  });

  it("D1247: reading the latest discovery with an empty worktree identity is refused, naming it", async () => {
    const reason = await inStore((store) =>
      rejection(
        settle(() =>
          store.readLatestDiscovery({ ...WORKTREE_A, worktreeIdentity: "" }),
        ),
      ),
    );
    expect(reason).toContain("worktree identity");
  });

  it("D1248: reading a run by identity with an empty worktree identity is refused, naming it", async () => {
    const reason = await inStore((store) => {
      const { runId } = store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      return rejection(
        settle(() =>
          store.readRun({ ...WORKTREE_A, worktreeIdentity: "" }, runId),
        ),
      );
    });
    expect(reason).toContain("worktree identity");
  });
});

describe("surviving a restart", () => {
  it("D1249: after close and reopen a worktree's runs read back unchanged in the order they were stored", async () => {
    const runs = await acrossReopen(
      (store) => {
        for (const run of [RAN_RUN, FAILED_RUN, UNSUPPORTED_RUN]) {
          store.writeRun(bound(WORKTREE_A), run);
        }
      },
      (store) => runsOf(store, WORKTREE_A),
    );
    expect(runs).toStrictEqual([RAN_RUN, FAILED_RUN, UNSUPPORTED_RUN]);
  });

  it("D1256: after close and reopen a worktree's latest discovery reads back unchanged", async () => {
    const discovery = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
    );
    expect(discovery).toStrictEqual(DISCOVERY);
  });
});

describe("the store's files and schema", () => {
  it("D1257: every file the store leaves on disk lies inside its state directory", async () => {
    const entries = await inTempDir((dir) =>
      settle(() => {
        withOpenStore(defaultStateDirectory(dir), (store) => {
          store.writeRun(bound(WORKTREE_A), RAN_RUN);
          store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
        });
        return readdirSync(dir, { encoding: "utf8", recursive: true })
          .map(posix)
          .sort();
      }),
    );
    expect(entries).toStrictEqual([".rt-test", `.rt-test/${STORE_FILE_NAME}`]);
  });

  it("D1258: opening a store creates its missing state directory", async () => {
    const runs = await inTempDir((dir) =>
      settle(() =>
        withOpenStore(defaultStateDirectory(dir), (store) => {
          store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
          return runsOf(store, WORKTREE_A);
        }),
      ),
    );
    expect(runs).toStrictEqual([BEFORE_LOAD_RUN]);
  });

  it("D1259: a new store records that it is an RT Test store and its schema version", async () => {
    const header = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        openStore(stateDirectory).close();
        return withRawDatabase(
          join(stateDirectory, STORE_FILE_NAME),
          (database) => ({
            applicationId: database.prepare("PRAGMA application_id").get()?.[
              "application_id"
            ],
            schemaVersion: database.prepare("PRAGMA user_version").get()?.[
              "user_version"
            ],
          }),
        );
      }),
    );
    expect(header).toStrictEqual({
      applicationId: RT_TEST_APPLICATION_ID,
      schemaVersion: STORE_SCHEMA_VERSION,
    });
  });

  it("D1260: a store with a newer schema version is refused, naming the file and the versions found and expected", async () => {
    const newer = STORE_SCHEMA_VERSION + 1;
    const refusal = await openingOver((file, stateDirectory) => {
      openStore(stateDirectory).close();
      withRawDatabase(file, (database) => {
        database.exec(`PRAGMA user_version = ${newer}`);
      });
    });
    expect(
      refusalFacts(
        refusal,
        `found application id ${RT_TEST_APPLICATION_ID} and schema version ${newer}`,
      ),
    ).toStrictEqual({ namesFile: true, namesFound: true, namesExpected: true });
  });

  it("D1261: a refused SQLite database is left byte for byte unchanged", async () => {
    const refusal = await openingOver(otherSqliteDatabase(0));
    expect(
      "thrown" in refusal
        ? refusal
        : { refused: refusal.reason !== OPENED, unchanged: refusal.unchanged },
    ).toStrictEqual({ refused: true, unchanged: true });
  });

  it("D1262: another application's SQLite database is refused even at the store's schema version", async () => {
    const refusal = await openingOver(
      otherSqliteDatabase(STORE_SCHEMA_VERSION),
    );
    expect(
      refusalFacts(
        refusal,
        `found application id 0 and schema version ${STORE_SCHEMA_VERSION}`,
      ),
    ).toStrictEqual({ namesFile: true, namesFound: true, namesExpected: true });
  });

  it("D1263: a file that is not a database is refused, naming the file and that no version could be read", async () => {
    const refusal = await openingOver((file) => {
      writeFileSync(file, "not a database\n");
    });
    expect(
      refusalFacts(
        refusal,
        "no application id or schema version could be read",
      ),
    ).toStrictEqual({ namesFile: true, namesFound: true, namesExpected: true });
  });

  it("D1264: a store opened while another opener creates the schema of the same new file does not create it again", async () => {
    const outcome = await inTempDir(async (dir) => {
      const stateDirectory = defaultStateDirectory(dir);
      mkdirSync(stateDirectory);
      const { held, result, exitCode } = await whileWriteHeld(
        join(stateDirectory, STORE_FILE_NAME),
        `${STORE_SCHEMA}
PRAGMA application_id = ${STORE_APPLICATION_ID};
PRAGMA user_version = ${STORE_SCHEMA_VERSION};`,
        () =>
          settle(() =>
            withOpenStore(stateDirectory, (store) => runsOf(store, WORKTREE_A)),
          ),
      );
      return { held, runs: result, exitCode };
    });
    expect(outcome).toStrictEqual({ held: true, runs: [], exitCode: 0 });
  });
});

describe("recording whether Vitest was force-stopped", () => {
  it("D1276: a force-stopped run reads back force-stopped", async () => {
    const forceStopped = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), { ...RAN_RUN, forceStopped: true });
      const [run] = runsOf(store, WORKTREE_A);
      return run?.status === "ran" ? run.forceStopped : run;
    });
    expect(forceStopped).toBe(true);
  });

  it("D1277: a run that was not force-stopped reads back not force-stopped", async () => {
    const forceStopped = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), { ...RAN_RUN, forceStopped: false });
      const [run] = runsOf(store, WORKTREE_A);
      return run?.status === "ran" ? run.forceStopped : run;
    });
    expect(forceStopped).toBe(false);
  });

  it("D1284: a ran run with no recorded force-stop fact is refused as unreadable, never read as not force-stopped", async () => {
    const reason = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), RAN_RUN);
      withRawDatabase(store.file, (database) => {
        database.exec("UPDATE runs SET force_stopped = NULL");
      });
      return rejection(settle(() => runsOf(store, WORKTREE_A)));
    });
    expect(reason).toContain("unreadable force_stopped: null");
  });
});

describe("opening a store written before the force-stop field", () => {
  it("D1278: each ran run reads back not force-stopped and every other run unchanged", async () => {
    const runs = await inForceStopUnawareStore(
      [RAN_RUN, BEFORE_LOAD_RUN],
      (stateDirectory) =>
        withOpenStore(stateDirectory, (store) => runsOf(store, WORKTREE_A)),
    );
    expect(runs).toStrictEqual([
      { ...RAN_RUN, forceStopped: false },
      BEFORE_LOAD_RUN,
    ]);
  });

  it("D1279: the store opens rather than being refused", async () => {
    const opened = await inForceStopUnawareStore([RAN_RUN], openRefusal);
    expect(opened).toBe(OPENED);
  });

  it("D1280: the store is at schema version 11 once opened", async () => {
    const version = await inForceStopUnawareStore(
      [RAN_RUN],
      (stateDirectory, file) => {
        openStore(stateDirectory).close();
        return schemaVersionOf(file);
      },
    );
    expect(version).toBe(11);
  });

  it("D1281: only ran runs are marked not force-stopped, and every other run holds no force-stop value", async () => {
    const rows = await inForceStopUnawareStore(
      [RAN_RUN, BEFORE_LOAD_RUN, FAILED_RUN],
      (stateDirectory, file) => {
        openStore(stateDirectory).close();
        return withRawDatabase(file, (database) =>
          database
            .prepare("SELECT status, force_stopped FROM runs ORDER BY sequence")
            .all()
            .map((row) => ({ ...row })),
        );
      },
    );
    expect(rows).toStrictEqual([
      { status: "ran", force_stopped: 0 },
      { status: "interrupted-before-load", force_stopped: null },
      { status: "failed", force_stopped: null },
    ]);
  });

  it("D1282: a store opened while another opener migrates the same file does not migrate it again", async () => {
    const outcome = await inTempDir(async (dir) => {
      const stateDirectory = defaultStateDirectory(dir);
      const file = writeForceStopUnawareStore(stateDirectory, [RAN_RUN]);
      const migration = STORE_MIGRATIONS.get(FORCE_STOP_UNAWARE_VERSION) ?? "";
      return whileWriteHeld(file, migration, () =>
        settle(() =>
          withOpenStore(stateDirectory, (store) => runsOf(store, WORKTREE_A)),
        ),
      );
    });
    expect(outcome).toStrictEqual({
      held: true,
      result: [{ ...RAN_RUN, forceStopped: false }],
      exitCode: 0,
    });
  });

  it("D1283: an RT Test store at a schema version older than 1 is still refused and left unchanged", async () => {
    const refusal = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeForceStopUnawareStore(stateDirectory, [RAN_RUN], 0);
        const before = fileDigest(file);
        const reason = openRefusal(stateDirectory);
        return {
          namesFound: reason.includes(
            `found application id ${RT_TEST_APPLICATION_ID} and schema version 0`,
          ),
          unchanged: fileDigest(file) === before,
        };
      }),
    );
    expect(refusal).toStrictEqual({ namesFound: true, unchanged: true });
  });

  it("D1327: runs and discoveries recorded under adapter version 1 keep that version through the migration", async () => {
    const versions = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        withOpenStore(stateDirectory, (store) => {
          store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
        });
        const file = writeForceStopUnawareStore(stateDirectory, [RAN_RUN]);
        withRawDatabase(file, (database) => {
          database.exec("UPDATE runs SET adapter_version = 1");
          database.exec("UPDATE discoveries SET adapter_version = 1");
        });
        return withOpenStore(stateDirectory, (store) => ({
          run: store.readRuns(WORKTREE_A)[0]?.adapterVersion,
          discovery: store.readLatestDiscovery(WORKTREE_A)?.adapterVersion,
        }));
      }),
    );
    expect(versions).toStrictEqual({ run: 1, discovery: 1 });
  });
});

describe("storing each discovered workspace's selection facts", () => {
  it("D2093: a workspace's reported selection facts read back exactly as written after the store is reopened", async () => {
    const facts = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) =>
        store
          .readLatestDiscovery(WORKTREE_A)
          ?.discovery.workspaces.map((entry) =>
            entry.status === "discovered" ? entry.selectionFacts : entry.status,
          ),
    );
    expect(facts).toStrictEqual([SELECTION_FACTS, "unsupported"]);
  });

  it("D2094: a workspace that reported no projects reads back as reporting none, never as not reporting", async () => {
    const reportsNone: SelectionFacts = { reported: true, projects: [] };
    const facts = await inStore((store) => {
      store.writeDiscovery(
        bound(WORKTREE_A),
        withFacts(DISCOVERY, reportsNone),
      );
      return discoveredFacts(store);
    });
    expect(facts).toStrictEqual([{ reported: true, projects: [] }]);
  });

  it("D2095: a workspace that never reported its selection facts reads back as not reporting them, never as reporting empty lists", async () => {
    const facts = await inStore((store) => {
      store.writeDiscovery(
        bound(WORKTREE_A),
        withFacts(DISCOVERY, NOT_REPORTED),
      );
      return discoveredFacts(store);
    });
    expect(facts).toStrictEqual([{ reported: false }]);
  });

  it("D2259: each project's Vite root reads back as written after the store is reopened", async () => {
    const roots = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) =>
        discoveredFacts(store)?.flatMap((facts) =>
          facts.reported ? facts.projects.map(({ viteRoot }) => viteRoot) : [],
        ),
    );
    expect(roots).toStrictEqual(["packages/cart/web", "."]);
  });

  it("D2261: a stored project with no Vite root is refused as unreadable, never read with a guessed root", async () => {
    const { viteRoot: _dropped, ...withoutViteRoot } = CART_PROJECT_FACTS;
    const reason = await readingStoredFacts([withoutViteRoot]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field viteRoot",
    );
  });

  it("D2815: each project's spelling of its pattern directory and its patterns' spellings read back as written after the store is reopened", async () => {
    const spellings = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) =>
        discoveredFacts(store)?.flatMap((facts) =>
          facts.reported
            ? facts.projects.map(
                ({ testFilePatterns: { vitestDirectory, patternBases } }) => ({
                  vitestDirectory,
                  patternBases,
                }),
              )
            : [],
        ),
    );
    expect(spellings).toStrictEqual([
      {
        vitestDirectory: "/work/shop/packages/cart",
        patternBases: [
          {
            spelled: "/work/shop/packages/cart/src",
            directory: "packages/cart/src",
          },
        ],
      },
      { vitestDirectory: "/work/shop", patternBases: [] },
    ]);
  });

  it("D2858: each project's crawled links, known with a link or not known with a reason, read back as written after the store is reopened", async () => {
    const crawled = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) =>
        discoveredFacts(store)?.flatMap((facts) =>
          facts.reported
            ? facts.projects.map(
                ({ testFilePatterns }) => testFilePatterns.crawledLinks,
              )
            : [],
        ),
    );
    expect(crawled).toStrictEqual([
      {
        complete: true,
        links: [
          {
            spelled: "/work/shop/packages/cart/src/shared",
            directory: "packages/shared",
          },
        ],
      },
      {
        complete: false,
        reason:
          "the walk below /work/shop follows more than 1000 directory links",
      },
    ]);
  });

  it("D2828: a stored project with no pattern spellings is refused as unreadable, never read with none", async () => {
    const { patternBases: _patternBases, ...withoutPatternBases } =
      CART_PROJECT_FACTS.testFilePatterns;
    const reason = await readingStoredFacts([
      { ...CART_PROJECT_FACTS, testFilePatterns: withoutPatternBases },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field patternBases",
    );
  });

  it("D2896: a stored project with no crawled links is refused as unreadable, never read as complete with none", async () => {
    const { crawledLinks: _crawledLinks, ...withoutCrawledLinks } =
      CART_PROJECT_FACTS.testFilePatterns;
    const reason = await readingStoredFacts([
      { ...CART_PROJECT_FACTS, testFilePatterns: withoutCrawledLinks },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field crawledLinks",
    );
  });

  it("D3036: each project's env sources, with their env directory, prefixes and a mode of the project's own, read back as written after the store is reopened", async () => {
    const sources = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) =>
        discoveredFacts(store)?.flatMap((facts) =>
          facts.reported
            ? facts.projects.map(({ envSources }) => envSources)
            : [],
        ),
    );
    expect(sources).toStrictEqual([
      [
        {
          envDirectory: "packages/cart/web",
          envPrefixes: ["VITE_", "CART_"],
          mode: "staging",
        },
        { envDirectory: ".", envPrefixes: ["VITE_"], mode: "test" },
      ],
      [
        { envDirectory: null, envPrefixes: ["VITE_"], mode: "test" },
        { envDirectory: ".", envPrefixes: ["VITE_"], mode: "test" },
      ],
    ]);
  });

  it("D3037: an env source whose config turns env files off reads back with no env directory, never refused as unreadable", async () => {
    const directory = await acrossReopen(
      (store) => {
        store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      },
      (store) =>
        discoveredFacts(store)?.flatMap((facts) =>
          facts.reported
            ? facts.projects
                .filter(({ projectName }) => projectName === "empty")
                .map(({ envSources }) =>
                  isNotKnown(envSources)
                    ? envSources
                    : envSources[0]?.envDirectory,
                )
            : [],
        ),
    );
    expect(directory).toStrictEqual([null]);
  });

  it("D3038: a stored project with no env sources is refused as unreadable, never read as naming no env file", async () => {
    const reason = await readingStoredFacts([
      withoutEnvSources(CART_PROJECT_FACTS),
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field envSources",
    );
  });

  it("D3039: a stored env directory that is neither a string nor null is refused as unreadable, never read as env files turned off", async () => {
    const reason = await readingStoredFacts([
      {
        ...CART_PROJECT_FACTS,
        envSources: [
          { envDirectory: false, envPrefixes: ["VITE_"], mode: "test" },
        ],
      },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field envDirectory",
    );
  });

  it("D3091: a stored env source with no env directory is refused as unreadable, never read as env files turned off", async () => {
    const reason = await readingStoredFacts([
      {
        ...CART_PROJECT_FACTS,
        envSources: [{ envPrefixes: ["VITE_"], mode: "test" }],
      },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field envDirectory",
    );
  });

  it("D3092: a stored env source with no mode is refused as unreadable, never read with a mode it did not record", async () => {
    const reason = await readingStoredFacts([
      {
        ...CART_PROJECT_FACTS,
        envSources: [{ envDirectory: ".", envPrefixes: ["VITE_"] }],
      },
    ]);
    expect(reason).toContain("The store holds an unreadable JSON field mode");
  });

  it("D2847: a stored project with no spelling of its pattern directory is refused as unreadable, never read with another field in its place", async () => {
    const { vitestDirectory: _vitestDirectory, ...withoutVitestDirectory } =
      CART_PROJECT_FACTS.testFilePatterns;
    const reason = await readingStoredFacts([
      { ...CART_PROJECT_FACTS, testFilePatterns: withoutVitestDirectory },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field vitestDirectory",
    );
  });

  it("D2099: stored selection facts that are not JSON are refused as unreadable, naming the column", async () => {
    const reason = await readingStoredFacts("[{");
    expect(reason).toContain(
      'The store holds an unreadable selection_facts: "[{"',
    );
  });

  it("D2100: an alias whose find kind is neither string nor regexp is refused as unreadable", async () => {
    const reason = await readingStoredFacts([
      {
        ...CART_PROJECT_FACTS,
        aliases: [{ ...REGEXP_ALIAS, findKind: "glob" }],
      },
    ]);
    expect(reason).toContain(
      'The store holds an unreadable JSON field findKind: "glob"',
    );
  });

  it("D2101: an alias whose customResolver mark is not a boolean is refused as unreadable", async () => {
    const reason = await readingStoredFacts([
      {
        ...CART_PROJECT_FACTS,
        aliases: [{ ...REGEXP_ALIAS, hasCustomResolver: "yes" }],
      },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field hasCustomResolver",
    );
  });

  it("D2102: an alias with no flags is refused as unreadable, never read as a find without flags", async () => {
    const { flags: _dropped, ...withoutFlags } = REGEXP_ALIAS;
    const reason = await readingStoredFacts([
      { ...CART_PROJECT_FACTS, aliases: [withoutFlags] },
    ]);
    expect(reason).toContain("The store holds an unreadable JSON field flags");
  });

  it("D2103: a project with no global setup list is refused as unreadable, never read as having none", async () => {
    const { globalSetupFiles: _dropped, ...withoutGlobalSetup } =
      CART_PROJECT_FACTS;
    const reason = await readingStoredFacts([withoutGlobalSetup]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field globalSetupFiles",
    );
  });

  it("D2121: a string find carrying flags is refused as unreadable, a record the writer never makes", async () => {
    const [stringAlias] = CART_PROJECT_FACTS.aliases;
    const reason = await readingStoredFacts([
      { ...CART_PROJECT_FACTS, aliases: [{ ...stringAlias, flags: "i" }] },
    ]);
    expect(reason).toContain("The store holds an unreadable JSON field flags");
  });

  it("D2104: selection facts under a workspace that is not discovered are refused, naming its status and path", async () => {
    const reason = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      withRawDatabase(store.file, (database) => {
        database.exec("UPDATE discovery_workspaces SET selection_facts = '[]'");
      });
      return rejection(settle(() => store.readLatestDiscovery(WORKTREE_A)));
    });
    expect(reason).toContain(
      `The store holds selection facts under the failed workspace ${WORKSPACE.path}`,
    );
  });
});

describe("opening a store written before selection facts", () => {
  it("D2096: each discovered workspace reads back as not reporting selection facts, and the rest of the discovery unchanged", async () => {
    const discovery = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        writeSelectionFactsUnawareStore(stateDirectory, [DISCOVERY]);
        return withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
      }),
    );
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });

  it("D2097: the store is at schema version 11 once opened", async () => {
    const version = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeSelectionFactsUnawareStore(stateDirectory, [
          DISCOVERY,
        ]);
        openStore(stateDirectory).close();
        return schemaVersionOf(file);
      }),
    );
    expect(version).toBe(11);
  });

  it("D2122: every run and discovery a version 2 store held reads back, a force-stopped run still force-stopped", async () => {
    const stored = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeSelectionFactsUnawareStore(
          stateDirectory,
          [DISCOVERY, DISCOVERY_WITHOUT_TESTS],
          [RAN_RUN, FAILED_RUN],
        );
        return withOpenStore(stateDirectory, (store) => ({
          runs: runsOf(store, WORKTREE_A),
          latest: store.readLatestDiscovery(WORKTREE_A)?.discovery,
          discoveries: countRows(file, "discoveries"),
        }));
      }),
    );
    expect(stored).toStrictEqual({
      runs: [RAN_RUN, FAILED_RUN],
      latest: DISCOVERY_WITHOUT_TESTS,
      discoveries: 2,
    });
  });

  it("D2098: a version 1 store's discovery reads back not reporting selection facts, beside its runs read not force-stopped", async () => {
    const stored = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        withOpenStore(stateDirectory, (store) => {
          store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
        });
        writeForceStopUnawareStore(stateDirectory, [RAN_RUN]);
        return withOpenStore(stateDirectory, (store) => ({
          discovery: store.readLatestDiscovery(WORKTREE_A)?.discovery,
          runs: runsOf(store, WORKTREE_A),
        }));
      }),
    );
    expect(stored).toStrictEqual({
      discovery: withoutReportedFacts(DISCOVERY),
      runs: [{ ...RAN_RUN, forceStopped: false }],
    });
  });
});

describe("opening a store written before each project's Vite root", () => {
  it("D2260: each discovered workspace reads back as not reporting selection facts, rather than its root-less report being read", async () => {
    const discovery = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        writeViteRootUnawareStore(stateDirectory, [DISCOVERY]);
        return withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
      }),
    );
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });

  it("D2846: a version 3 store opens at version 11, so the selection facts a discovery stores after it read back once the store is reopened", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeViteRootUnawareStore(stateDirectory, [DISCOVERY]);
        withOpenStore(stateDirectory, (store) => {
          store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
        });
        return {
          version: schemaVersionOf(file),
          facts: withOpenStore(stateDirectory, discoveredFacts),
        };
      }),
    );
    expect(outcome).toStrictEqual({ version: 11, facts: [SELECTION_FACTS] });
  });
});

describe("opening a store written before crashed runs", () => {
  it("D2791: a version 4 store opens at version 11, every run it held unchanged", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        withOpenStore(stateDirectory, (store) => {
          store.writeRun(bound(WORKTREE_A), RAN_RUN);
          store.writeRun(bound(WORKTREE_A), FAILED_RUN);
        });
        const file = join(stateDirectory, STORE_FILE_NAME);
        withRawDatabase(file, (database) => {
          lowerSchemaVersion(database, 4);
        });
        const runs = withOpenStore(stateDirectory, (store) =>
          runsOf(store, WORKTREE_A),
        );
        return { version: schemaVersionOf(file), runs };
      }),
    );
    expect(outcome).toStrictEqual({ version: 11, runs: [RAN_RUN, FAILED_RUN] });
  });

  it("D2829: each discovered workspace of a version 4 store reads back as not reporting selection facts, and the rest of the discovery unchanged", async () => {
    const discovery = await inSpellingUnawareStore(CRASH_UNAWARE_VERSION);
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });

  it("D2792: a new store is created at schema version 11", async () => {
    const version = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        openStore(stateDirectory).close();
        return schemaVersionOf(join(stateDirectory, STORE_FILE_NAME));
      }),
    );
    expect(version).toBe(11);
  });
});

describe("opening a store written before Vitest's spellings of the pattern directories", () => {
  it("D2830: each discovered workspace reads back as not reporting selection facts, rather than its report without spellings being read", async () => {
    const discovery = await inSpellingUnawareStore(
      VITEST_SPELLING_UNAWARE_VERSION,
    );
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });

  it("D2831: a version 5 store opens at version 11, every run it held unchanged", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          VITEST_SPELLING_UNAWARE_VERSION,
          withoutPatternFields(SPELLINGS_AND_LINKS_UNAWARE_FIELDS),
          [RAN_RUN, FAILED_RUN],
        );
        const runs = withOpenStore(stateDirectory, (store) =>
          runsOf(store, WORKTREE_A),
        );
        return { version: schemaVersionOf(file), runs };
      }),
    );
    expect(outcome).toStrictEqual({ version: 11, runs: [RAN_RUN, FAILED_RUN] });
  });
});

describe("opening a store written before the directory links Vitest's crawl follows", () => {
  it("D2859: a version 6 store opens at version 11, each discovered workspace reading back as not reporting selection facts rather than its report without crawled links being read", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          CRAWLED_LINKS_UNAWARE_VERSION,
          withoutPatternFields(["crawledLinks"]),
        );
        const discovery = withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
        return { version: schemaVersionOf(file), discovery };
      }),
    );
    expect(outcome).toStrictEqual({
      version: 11,
      discovery: withoutReportedFacts(DISCOVERY),
    });
  });
});

describe("opening a store written before each project's env sources", () => {
  it("D3040: a version 7 store opens at version 11, each discovered workspace reading back as not reporting selection facts rather than its report without env sources being read", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          ENV_SOURCES_UNAWARE_VERSION,
          withoutEnvSources,
        );
        const discovery = withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
        return { version: schemaVersionOf(file), discovery };
      }),
    );
    expect(outcome).toStrictEqual({
      version: 11,
      discovery: withoutReportedFacts(DISCOVERY),
    });
  });

  it("D3041: a version 7 store opens at version 11, every run it held unchanged", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          ENV_SOURCES_UNAWARE_VERSION,
          withoutEnvSources,
          [RAN_RUN, FAILED_RUN],
        );
        const runs = withOpenStore(stateDirectory, (store) =>
          runsOf(store, WORKTREE_A),
        );
        return { version: schemaVersionOf(file), runs };
      }),
    );
    expect(outcome).toStrictEqual({ version: 11, runs: [RAN_RUN, FAILED_RUN] });
  });
});

/** The schema version before a project's env sources could be stored as not known. */
const ENV_SOURCES_ALWAYS_KNOWN_VERSION = 8;
const NOT_KNOWN_REASON =
  "a nested projects container declares its projects (app/vitest.config.mjs)";
/** One project whose discovery could not learn its env sources, stored with the reason why. */
const NOT_KNOWN_FACTS: SelectionFacts = {
  reported: true,
  projects: [
    {
      ...CART_PROJECT_FACTS,
      envSources: { notKnown: NOT_KNOWN_REASON },
    },
  ],
};

/** Each stored project as written, as a version 8 store holds a report its code wrote complete. */
function unchangedProject(project: ProjectSelectionFacts): object {
  return project;
}

describe("storing env sources that are not known", () => {
  it("D3126: a project's env sources that are not known read back with their reason after the store is reopened, never as naming no env file", async () => {
    const sources = await acrossReopen(
      (store) => {
        store.writeDiscovery(
          bound(WORKTREE_A),
          withFacts(DISCOVERY, NOT_KNOWN_FACTS),
        );
      },
      (store) =>
        discoveredFacts(store)?.flatMap((facts) =>
          facts.reported
            ? facts.projects.map(({ envSources }) => envSources)
            : [],
        ),
    );
    expect(sources).toStrictEqual([{ notKnown: NOT_KNOWN_REASON }]);
  });

  it("D3127: a stored not-known report whose reason is not a string is refused as unreadable, never read with that value as its reason", async () => {
    const reason = await readingStoredFacts([
      { ...CART_PROJECT_FACTS, envSources: { notKnown: 5 } },
    ]);
    expect(reason).toContain(
      "The store holds an unreadable JSON field notKnown",
    );
  });
});

describe("opening a store written before env sources could be not known", () => {
  it("D3128: a version 8 store opens at version 11, each discovered workspace reading back as not reporting selection facts rather than its report being read as complete", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          ENV_SOURCES_ALWAYS_KNOWN_VERSION,
          unchangedProject,
        );
        const discovery = withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
        return { version: schemaVersionOf(file), discovery };
      }),
    );
    expect(outcome).toStrictEqual({
      version: 11,
      discovery: withoutReportedFacts(DISCOVERY),
    });
  });

  it("D3129: a version 8 store opens at version 11, every run it held unchanged", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          ENV_SOURCES_ALWAYS_KNOWN_VERSION,
          unchangedProject,
          [RAN_RUN, FAILED_RUN],
        );
        const runs = withOpenStore(stateDirectory, (store) =>
          runsOf(store, WORKTREE_A),
        );
        return { version: schemaVersionOf(file), runs };
      }),
    );
    expect(outcome).toStrictEqual({ version: 11, runs: [RAN_RUN, FAILED_RUN] });
  });
});

/** The schema version before a discovery's not-covered workspaces were stored. */
const NOT_COVERED_UNAWARE_VERSION = 9;
const NOT_COVERED: NonNullable<TestDiscovery["notCovered"]> = [
  {
    path: "packages/eslint-plugin",
    reason:
      'has a test script, "node run-tests.js", but is not a Vitest workspace',
  },
];

/** The latest discovery after `discovery` is written and the store reopened. */
function reopenedDiscovery(
  discovery: TestDiscovery,
): Promise<Settled<TestDiscovery | undefined>> {
  return acrossReopen(
    (store) => {
      store.writeDiscovery(bound(WORKTREE_A), discovery);
    },
    (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
  );
}

function holdsNotCovered(
  discovery: Settled<TestDiscovery | undefined>,
): Settled<boolean> | undefined {
  if (discovery === undefined || "thrown" in discovery) return discovery;
  return Object.hasOwn(discovery, "notCovered");
}

describe("storing a discovery's workspaces with a test script that are not Vitest workspaces", () => {
  it("D3347: a discovery's not-covered workspaces read back after the store is reopened", async () => {
    const discovery = await reopenedDiscovery({
      ...DISCOVERY,
      notCovered: NOT_COVERED,
    });
    expect(
      discovery !== undefined && !("thrown" in discovery)
        ? discovery.notCovered
        : discovery,
    ).toStrictEqual(NOT_COVERED);
  });

  it("D3348: a discovery that found no not-covered workspace reads back with an empty list, never as not reporting them", async () => {
    const discovery = await reopenedDiscovery({
      ...DISCOVERY,
      notCovered: [],
    });
    expect(
      discovery !== undefined && !("thrown" in discovery)
        ? discovery.notCovered
        : discovery,
    ).toStrictEqual([]);
  });

  it("D3349: a discovery written without a not-covered list reads back without one, never as an empty list", async () => {
    expect(holdsNotCovered(await reopenedDiscovery(DISCOVERY))).toBe(false);
  });
});

describe("opening a store written before not-covered workspaces", () => {
  it("D3350: a version 9 store opens at version 11, its discovery reading back unchanged and not reporting not-covered workspaces", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          NOT_COVERED_UNAWARE_VERSION,
          unchangedProject,
        );
        const discovery = withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
        return { version: schemaVersionOf(file), discovery };
      }),
    );
    expect(outcome).toStrictEqual({ version: 11, discovery: DISCOVERY });
  });

  it("D3351: a version 2 store's discovery reads back once migrated, not reporting not-covered workspaces", async () => {
    const discovery = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        writeSelectionFactsUnawareStore(stateDirectory, [DISCOVERY]);
        return withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
      }),
    );
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });
});

describe("the adapter version a stored record carries", () => {
  it("D1285: a stored run carries Vitest adapter version 3", async () => {
    const version = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      return store.readRuns(WORKTREE_A)[0]?.adapterVersion;
    });
    expect(version).toBe(3);
  });

  it("D1286: a stored discovery carries Vitest adapter version 3", async () => {
    const version = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      return store.readLatestDiscovery(WORKTREE_A)?.adapterVersion;
    });
    expect(version).toBe(3);
  });
});

describe("the latest run of each workspace a query reads", () => {
  const OTHER_WORKSPACE_RUN: WorkspaceRun = {
    status: "interrupted-before-load",
    workspace: OTHER_WORKSPACE,
  };

  /** The latest runs a query of `scope` reads, each named by the label of the written run it is. */
  function latestRunLabels(
    store: RtTestStore,
    scope: StoreScope,
    written: Readonly<Record<string, string>>,
  ): string[] {
    return store
      .readLatestResults(scope)
      .latestRuns.map((run) => written[run.runId] ?? run.runId);
  }

  it("D1832: a workspace's latest run is the one stored last, never an earlier one", async () => {
    const labels = await inStore((store) => {
      const first = store.writeRun(bound(WORKTREE_A), RAN_RUN);
      const last = store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      return latestRunLabels(store, WORKTREE_A, {
        [first.runId]: "first",
        [last.runId]: "last",
      });
    });
    expect(labels).toStrictEqual(["last"]);
  });

  it("D1833: each workspace path keeps its own latest run, whichever workspace ran last", async () => {
    const labels = await inStore((store) => {
      const first = store.writeRun(bound(WORKTREE_A), RAN_RUN);
      const other = store.writeRun(bound(WORKTREE_A), OTHER_WORKSPACE_RUN);
      const last = store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
      return latestRunLabels(store, WORKTREE_A, {
        [first.runId]: "first",
        [other.runId]: "other workspace",
        [last.runId]: "last",
      });
    });
    expect(labels).toStrictEqual(["other workspace", "last"]);
  });

  it("D1834: another worktree's newer run of the same workspace never hides this worktree's latest run", async () => {
    const labels = await inStore((store) => {
      const own = store.writeRun(bound(WORKTREE_A), RAN_RUN);
      const other = store.writeRun(bound(WORKTREE_B), BEFORE_LOAD_RUN);
      return latestRunLabels(store, WORKTREE_A, {
        [own.runId]: "own",
        [other.runId]: "other worktree",
      });
    });
    expect(labels).toStrictEqual(["own"]);
  });

  it("D1863: another project's newer run of the same worktree and workspace never hides this project's latest run", async () => {
    const labels = await inStore((store) => {
      const own = store.writeRun(bound(WORKTREE_A), RAN_RUN);
      const other = store.writeRun(bound(OTHER_PROJECT), BEFORE_LOAD_RUN);
      return latestRunLabels(store, WORKTREE_A, {
        [own.runId]: "own",
        [other.runId]: "other project",
      });
    });
    expect(labels).toStrictEqual(["own"]);
  });
});

describe("a latest discovery the store refuses as unreadable", () => {
  const LEGACY_RUN: WorkspaceRun = {
    status: "interrupted-before-load",
    workspace: OTHER_WORKSPACE,
  };

  interface LatestRead {
    readonly discovery: TestDiscovery | undefined;
    readonly discoveryRefusal: string | undefined;
    readonly runs: readonly WorkspaceRun[];
  }

  /** What a query reads once `corrupt` has run through a second connection over the stored `DISCOVERY` and a run of each workspace. */
  function latestAfter(corrupt: string): Promise<Settled<LatestRead>> {
    return inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      store.writeRun(bound(WORKTREE_A), LEGACY_RUN);
      withRawDatabase(store.file, (database) => {
        database.exec(corrupt);
      });
      const { discovery, discoveryRefusal, latestRuns } =
        store.readLatestResults(WORKTREE_A);
      return {
        discovery: discovery?.discovery,
        discoveryRefusal,
        runs: latestRuns.map((stored) => stored.run),
      };
    });
  }

  /** No discovery beside `discoveryRefusal`, and each workspace's latest run still read. */
  function refusedWith(discoveryRefusal: string): LatestRead {
    return {
      discovery: undefined,
      discoveryRefusal,
      runs: [FAILED_RUN, LEGACY_RUN],
    };
  }

  function parseFailure(text: string): string {
    try {
      JSON.parse(text);
      return "parsed";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  it("D2915: a latest discovery refused as unreadable reads as none beside its refusal, and every latest run still reads", async () => {
    expect(
      await latestAfter(`UPDATE discoveries SET not_read = '{"x":1}'`),
    ).toStrictEqual(
      refusedWith('The store holds an unreadable not_read: {"x":1}'),
    );
  });

  it("D2916: a refused discovery's refusal carries its cause chain", async () => {
    expect(
      await latestAfter("UPDATE discoveries SET not_read = 'not json'"),
    ).toStrictEqual(
      refusedWith(
        `The store holds an unreadable not_read: "not json"\n  caused by: ${parseFailure("not json")}`,
      ),
    );
  });

  it("D2917: a latest discovery whose input fingerprint is unreadable is refused as a record, not thrown", async () => {
    expect(
      await latestAfter(
        "PRAGMA ignore_check_constraints = ON; UPDATE discoveries SET fingerprint_kind = 'guessed'",
      ),
    ).toStrictEqual(
      refusedWith(
        "The store holds an unreadable input fingerprint: kind guessed, digest null",
      ),
    );
  });

  it("D2918: a latest discovery holding tests under a workspace not discovered is refused as a record, not thrown", async () => {
    expect(
      await latestAfter("UPDATE discovered_tests SET workspace_index = 1"),
    ).toStrictEqual(
      refusedWith(
        `The store holds tests under the unsupported workspace ${OTHER_WORKSPACE.path}`,
      ),
    );
  });

  it("D2919: a latest discovery holding selection facts under a workspace not discovered is refused as a record, not thrown", async () => {
    expect(
      await latestAfter(
        "UPDATE discovery_workspaces SET selection_facts = '[]' WHERE status = 'unsupported'",
      ),
    ).toStrictEqual(
      refusedWith(
        `The store holds selection facts under the unsupported workspace ${OTHER_WORKSPACE.path}`,
      ),
    );
  });

  it("D2920: a SQLite failure reading the latest discovery still throws, never read as a refused record", async () => {
    expect(
      rejection(
        await latestAfter("ALTER TABLE discoveries DROP COLUMN not_read"),
      ),
    ).toContain("no such column: not_read");
  });

  it("D2962: a query row missing a column its reader needs throws as a store failure, never as a refused record", () => {
    let outcome: unknown = "read";
    try {
      column({}, "not_read");
    } catch (error) {
      outcome = { refusedAsRecord: error instanceof UnreadableRecordError };
    }
    expect(outcome).toStrictEqual({ refusedAsRecord: false });
  });

  it("D2963: the latest discovery and the latest runs are read from one snapshot, so a discovery and a run committed as the read begins are answered together", async () => {
    const read = await inStore((store, stateDirectory) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      const writer = openStore(stateDirectory);
      const prepare = DatabaseSync.prototype.prepare;
      let written = false;
      const writeAtVersionRead = vi
        .spyOn(DatabaseSync.prototype, "prepare")
        .mockImplementation(function (this: DatabaseSync, sql: string) {
          if (!written && sql.includes("pragma_user_version")) {
            written = true;
            writer.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
            writer.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN);
          }
          return prepare.call(this, sql);
        });
      try {
        const latest = store.readLatestResults(WORKTREE_A);
        return {
          discovery: latest.discovery?.discovery,
          runs: latest.latestRuns.map((stored) => stored.run),
        };
      } finally {
        writeAtVersionRead.mockRestore();
        writer.close();
      }
    });
    expect(read).toStrictEqual({
      discovery: DISCOVERY,
      runs: [BEFORE_LOAD_RUN],
    });
  });
});

describe("a latest run the store refuses as unreadable", () => {
  const LEGACY_RUN: WorkspaceRun = {
    status: "interrupted-before-load",
    workspace: OTHER_WORKSPACE,
  };
  const LATER_LEGACY_RUN: WorkspaceRun = {
    status: "crashed",
    workspace: OTHER_WORKSPACE,
    error: "the executor process 9 exited during the job (exit code 1)",
  };
  /** Gives the latest stored run of the legacy workspace a status no reader knows. */
  const LEGACY_MADE_UNREADABLE = `PRAGMA ignore_check_constraints = ON;
    UPDATE runs SET status = 'bogus' WHERE sequence =
      (SELECT max(sequence) FROM runs WHERE workspace_path = '${OTHER_WORKSPACE.path}')`;
  const LEGACY_REFUSAL = 'The store holds an unreadable runs.status: "bogus"';

  interface LatestRunsRead {
    readonly runs: readonly WorkspaceRun[];
    readonly runRefusals: LatestResults["runRefusals"];
  }

  /** What a query reads once `written` is stored in order and `corrupt` has run through a second connection. */
  function latestAfter(
    written: readonly WorkspaceRun[],
    corrupt: string,
  ): Promise<Settled<LatestRunsRead>> {
    return inStore((store) => {
      for (const run of written) store.writeRun(bound(WORKTREE_A), run);
      withRawDatabase(store.file, (database) => {
        database.exec(corrupt);
      });
      const { latestRuns, runRefusals } = store.readLatestResults(WORKTREE_A);
      return { runs: latestRuns.map((stored) => stored.run), runRefusals };
    });
  }

  function runsOfRead(read: Settled<LatestRunsRead>) {
    return "thrown" in read ? read : read.runs;
  }

  function refusalsOfRead(read: Settled<LatestRunsRead>) {
    return "thrown" in read ? read : read.runRefusals;
  }

  it("D3266: a refused latest run leaves every other workspace's latest run read, one stored after it included", async () => {
    expect(
      runsOfRead(
        await latestAfter([LEGACY_RUN, FAILED_RUN], LEGACY_MADE_UNREADABLE),
      ),
    ).toStrictEqual([FAILED_RUN]);
  });

  it("D3267: the refused workspace is named among the refusals with the reason its run was refused, and no readable one is", async () => {
    expect(
      refusalsOfRead(
        await latestAfter([LEGACY_RUN, FAILED_RUN], LEGACY_MADE_UNREADABLE),
      ),
    ).toStrictEqual([
      { workspacePath: OTHER_WORKSPACE.path, reason: LEGACY_REFUSAL },
    ]);
  });

  it("D3268: a refused run's reason carries its cause chain", async () => {
    const read = await latestAfter(
      [RAN_RUN],
      "PRAGMA ignore_check_constraints = ON; UPDATE runs SET unhandled_errors = 'not json'",
    );
    const refusals = refusalsOfRead(read);
    expect(
      Array.isArray(refusals)
        ? refusals.map(({ workspacePath, reason }) => {
            const [head, cause] = reason.split("\n");
            return {
              workspacePath,
              head,
              causedBy: cause?.startsWith("  caused by: ") ?? false,
            };
          })
        : refusals,
    ).toStrictEqual([
      {
        workspacePath: WORKSPACE.path,
        head: 'The store holds an unreadable unhandled_errors: "not json"',
        causedBy: true,
      },
    ]);
  });

  it("D3269: an older readable run of a refused workspace never stands in for its refused latest run", async () => {
    expect(
      runsOfRead(
        await latestAfter(
          [LEGACY_RUN, FAILED_RUN, LATER_LEGACY_RUN],
          LEGACY_MADE_UNREADABLE,
        ),
      ),
    ).toStrictEqual([FAILED_RUN]);
  });

  it("D3270: a store failure reading a latest run's rows still throws, never read as a refused run", async () => {
    const read = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      const all = StatementSync.prototype.all;
      const failingTestRows = vi
        .spyOn(StatementSync.prototype, "all")
        .mockImplementation(function (
          this: StatementSync,
          ...parameters: Parameters<StatementSync["all"]>
        ) {
          if (this.sourceSQL.includes("FROM run_tests")) {
            throw new Error("disk I/O error");
          }
          return all.apply(this, parameters);
        });
      try {
        return store.readLatestResults(WORKTREE_A).runRefusals;
      } finally {
        failingTestRows.mockRestore();
      }
    });
    expect(rejection(read)).toContain("disk I/O error");
  });
});

describe("a store a newer RT Test migrated while this one held it open", () => {
  const NEWER = STORE_SCHEMA_VERSION + 1;

  interface NewerRefusal {
    readonly newerSchema: boolean;
    readonly namesFound: boolean;
    readonly namesOwn: boolean;
    readonly nothingStored: boolean;
    readonly nothingRead: boolean;
    readonly namesRestart: boolean;
  }

  const WRITE_REFUSAL: NewerRefusal = {
    newerSchema: true,
    namesFound: true,
    namesOwn: true,
    nothingStored: true,
    nothingRead: false,
    namesRestart: true,
  };
  const READ_REFUSAL: NewerRefusal = {
    ...WRITE_REFUSAL,
    nothingStored: false,
    nothingRead: true,
  };

  function migrateTo(file: string, version: number): void {
    withRawDatabase(file, (database) => {
      database.exec(`PRAGMA user_version = ${version}`);
    });
  }

  /** What `work`'s refusal names, or that it went ahead. */
  function refusalOf(work: () => unknown): NewerRefusal | "went ahead" {
    try {
      work();
      return "went ahead";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        newerSchema: error instanceof NewerStoreSchemaError,
        namesFound: message.includes(`schema version ${NEWER}`),
        namesOwn: message.includes(`version ${STORE_SCHEMA_VERSION} `),
        nothingStored: message.includes("nothing was stored"),
        nothingRead: message.includes("nothing was read"),
        namesRestart: message.includes(
          "Restart the daemon with the newer RT Test",
        ),
      };
    }
  }

  it("D2921: a run written into a store a newer RT Test migrated is refused whole, naming both versions, that nothing was stored and the restart", async () => {
    const outcome = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      migrateTo(store.file, NEWER);
      return {
        refusal: refusalOf(() =>
          store.writeRun(bound(WORKTREE_A), BEFORE_LOAD_RUN),
        ),
        runs: countRows(store.file, "runs"),
      };
    });
    expect(outcome).toStrictEqual({ refusal: WRITE_REFUSAL, runs: 1 });
  });

  it("D2922: a discovery written into a store a newer RT Test migrated is refused whole, naming both versions, that nothing was stored and the restart", async () => {
    const outcome = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      migrateTo(store.file, NEWER);
      return {
        refusal: refusalOf(() =>
          store.writeDiscovery(bound(WORKTREE_A), DISCOVERY),
        ),
        discoveries: countRows(store.file, "discoveries"),
      };
    });
    expect(outcome).toStrictEqual({ refusal: WRITE_REFUSAL, discoveries: 1 });
  });

  it("D2923: a query's read of a store a newer RT Test migrated is refused, naming both versions, that nothing was read and the restart", async () => {
    const refusal = await inStore((store) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      migrateTo(store.file, NEWER);
      return refusalOf(() => store.readLatestResults(WORKTREE_A));
    });
    expect(refusal).toStrictEqual(READ_REFUSAL);
  });

  it("D2924: a store one schema version newer is refused by the opener and the transaction guard alike, and one at this version by neither", async () => {
    const verdicts = await inStore((store, stateDirectory) => {
      const verdictsAt = (version: number) => {
        migrateTo(store.file, version);
        const guarded = refusalOf(() => store.readLatestResults(WORKTREE_A));
        return {
          opener: openRefusal(stateDirectory) === OPENED ? "opens" : "refuses",
          guard:
            guarded === "went ahead"
              ? "reads"
              : guarded.newerSchema
                ? "refuses"
                : "fails",
        };
      };
      return {
        current: verdictsAt(STORE_SCHEMA_VERSION),
        newer: verdictsAt(NEWER),
      };
    });
    expect(verdicts).toStrictEqual({
      current: { opener: "opens", guard: "reads" },
      newer: { opener: "refuses", guard: "refuses" },
    });
  });

  it("D2925: a write reads the schema version under the write lock it writes with, so a migration committed while it waited is refused", async () => {
    const outcome = await inTempDir(async (dir) => {
      const store = openStore(defaultStateDirectory(dir));
      try {
        const { held, result } = await whileWriteHeld(
          store.file,
          `PRAGMA user_version = ${NEWER}`,
          () => refusalOf(() => store.writeRun(bound(WORKTREE_A), FAILED_RUN)),
        );
        return {
          held,
          refusal: result,
          runs: countRows(store.file, "runs"),
        };
      } finally {
        store.close();
      }
    });
    expect(outcome).toStrictEqual({
      held: true,
      refusal: WRITE_REFUSAL,
      runs: 0,
    });
  });

  it("D2926: a read takes the schema version from the snapshot it reads the records from, so a migration committed as the read begins is refused", async () => {
    const refusal = await inStore((store) => {
      store.writeRun(bound(WORKTREE_A), FAILED_RUN);
      const exec = DatabaseSync.prototype.exec;
      let migrated = false;
      const migrateAtBegin = vi
        .spyOn(DatabaseSync.prototype, "exec")
        .mockImplementation(function (this: DatabaseSync, statement: string) {
          exec.call(this, statement);
          if (statement === "BEGIN" && !migrated) {
            migrated = true;
            migrateTo(store.file, NEWER);
          }
        });
      try {
        return refusalOf(() => store.readLatestResults(WORKTREE_A));
      } finally {
        migrateAtBegin.mockRestore();
      }
    });
    expect(refusal).toStrictEqual(READ_REFUSAL);
  });
});

/** The schema version before a defect's falsification evidence was stored. */
const EVIDENCE_UNAWARE_VERSION = 10;
/** Every schema version the opener migrates. */
const MIGRATED_VERSIONS = Array.from(
  { length: EVIDENCE_UNAWARE_VERSION },
  (_, index) => index + 1,
);
/** The digest of the workspace's input fingerprint each job below ran at. */
const PRINT = "sha256:2C26B46B68FFC68F";
/** A text no evidence row may hold. */
const SECRET = "SECRET";

const DETECTING: ReplyExperiment = {
  defectId: "D1",
  facts: detection(),
  mutationFileDigest: "file-digest-1",
};
const SURVIVING: ReplyExperiment = {
  defectId: "D2",
  facts: ranOnce({ test: SURVIVING_TEST }),
  mutationFileDigest: "file-digest-2",
};
/** Its test failed in a hook, so it reads invalid experiment with a detail. */
const HOOK_FAILED: ReplyExperiment = {
  defectId: "D3",
  facts: ranOnce({
    test: { ...REJECTING_TEST, hooks: { beforeEach: "fail" } },
  }),
  mutationFileDigest: "file-digest-3",
};
const HOOK_FAILED_JUDGEMENT = {
  verdict: "invalid-experiment",
  reason: "hook-not-passed",
  detail: { hook: "beforeEach", state: "fail" },
  facts: HOOK_FAILED.facts,
};
/** An aborted job's experiment: its confirming run was interrupted, so it has no verdict. */
const UNDECIDED_FACTS = detection({ confirming: { status: "interrupted" } });
/** Its run would be a detection and its confirming run passed, so it reads unclear with what the confirming run read. */
const UNCONFIRMED: ReplyExperiment = {
  defectId: "D6",
  facts: detection({
    confirming: { status: "ran", ...mutatedRun({ test: SURVIVING_TEST }) },
  }),
  mutationFileDigest: "file-digest-6",
};
/** Where a probe would alter what the module does, as the job's check before any run names the place. */
const UNPROBED_SITE: NoProbeSite = {
  kind: "position",
  line: 4,
  column: 12,
  nodeKind: "Identifier",
  role: "CallExpression.callee",
};

/** Why a job gives an experiment no run and still a verdict. */
type DecidedBeforeRun = Extract<
  ExperimentNotRun,
  { kind: "no-probe-site" | "no-module" }
>;
interface UnrunExperiment extends ReplyExperiment {
  readonly reason: DecidedBeforeRun;
  readonly mutationFileDigest: string;
}

/** An experiment the job decided before any run, beside others it ran: it shares their baselines and holds no run. */
function decidedBeforeRun(
  defectId: string,
  reason: DecidedBeforeRun,
): UnrunExperiment {
  return {
    defectId,
    reason,
    facts: {
      baseline: baseline(),
      restoredBaseline: { recorded: true, ...baseline() },
      job: CLEAN_JOB,
      notRun: reason,
    },
    mutationFileDigest: `file-digest-${defectId}`,
  };
}

const UNPROBED = decidedBeforeRun("D4", {
  kind: "no-probe-site",
  site: UNPROBED_SITE,
});
const UNLOCATED = decidedBeforeRun("D5", { kind: "no-module" });

/** The reply of a job that ran `ran` and gave each of `unrun` no run, whose record holds its reason and its mutation file's digest. */
function replyWithUnrun(
  ran: readonly ReplyExperiment[],
  unrun: readonly UnrunExperiment[],
): FalsificationJob {
  const reply = ranReply([...ran, ...unrun]);
  const records: ExperimentRecord[] = unrun.map(
    ({ defectId, reason, mutationFileDigest }) => ({
      defectId,
      status: "not-run",
      reason,
      mutationFileDigest,
    }),
  );
  return {
    ...reply,
    experiments: [...reply.experiments.slice(0, ran.length), ...records],
  };
}

function evidenceBound(scope: StoreScope): EvidenceBindings {
  return { ...scope, inputFingerprintDigest: PRINT };
}

/** The definition digest handed in for each experiment's defect. */
function digestsFor(
  experiments: readonly ReplyExperiment[],
): Map<string, string> {
  return new Map(
    experiments.map(({ defectId }) => [
      defectId,
      `definition-digest-${defectId}`,
    ]),
  );
}

/** Stores the reply of a job that ran `experiments`, a definition digest handed in for each defect. */
function storeReply(
  store: RtTestStore,
  scope: StoreScope,
  experiments: readonly ReplyExperiment[],
) {
  return store.writeEvidence(
    evidenceBound(scope),
    ranReply(experiments),
    digestsFor(experiments),
  );
}

/** Each defect a query of `scope` reads evidence for, with its verdict. */
function verdictsIn(store: RtTestStore, scope: StoreScope): string[][] {
  return store
    .readLatestResults(scope)
    .evidence.map(({ defectId, verdict }) => [defectId, verdict]);
}

/** Each defect a query of worktree A reads evidence for, with its judgement whole. */
function judgementsRead(store: RtTestStore): unknown[][] {
  return store
    .readLatestResults(WORKTREE_A)
    .evidence.map(({ defectId, judgement }) => [defectId, judgement]);
}

/** What storing each of `replies` says, and what the store holds once every one was tried. */
function refusalsOf(
  store: RtTestStore,
  replies: readonly unknown[],
  experiments: readonly ReplyExperiment[] = [DETECTING, SURVIVING],
) {
  return {
    reasons: replies.map((reply) =>
      rejection(
        settle(() =>
          store.writeEvidence(
            evidenceBound(WORKTREE_A),
            reply as FalsificationJob,
            digestsFor(experiments),
          ),
        ),
      ),
    ),
    stored: verdictsIn(store, WORKTREE_A),
  };
}

/** `value` with members its type does not name, as a reply built by other code could carry them. */
function withExtra<T extends object>(
  value: T,
  extra: Readonly<Record<string, string>>,
): T {
  return { ...value, ...extra };
}

/** How many evidence rows the file holds, and each column of one whose text holds `SECRET`. */
function secretsStored(file: string): { rows: number; holding: string[] } {
  return withRawDatabase(file, (database) => {
    const rows = database.prepare("SELECT * FROM defect_evidence").all();
    return {
      rows: rows.length,
      holding: rows.flatMap((row) =>
        Object.entries(row)
          .filter(([, value]) => String(value).includes(SECRET))
          .map(([name]) => name),
      ),
    };
  });
}

/** A store holding `DISCOVERY` and a run, taken back to `version` as that version's migration's inverse. */
function writeStoreAt(stateDirectory: string, version: number): string {
  if (version === FORCE_STOP_UNAWARE_VERSION) {
    return writeForceStopUnawareStore(stateDirectory, [FAILED_RUN]);
  }
  if (version === SELECTION_FACTS_UNAWARE_VERSION) {
    return writeSelectionFactsUnawareStore(
      stateDirectory,
      [DISCOVERY],
      [FAILED_RUN],
    );
  }
  if (version < EVIDENCE_UNAWARE_VERSION) {
    return writeFactsUnawareStore(stateDirectory, version, unchangedProject, [
      FAILED_RUN,
    ]);
  }
  withOpenStore(stateDirectory, (store) => {
    store.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
    store.writeRun(bound(WORKTREE_A), FAILED_RUN);
  });
  const file = join(stateDirectory, STORE_FILE_NAME);
  withRawDatabase(file, (database) => {
    database.exec("DROP TABLE defect_evidence");
    database.exec(`PRAGMA user_version = ${EVIDENCE_UNAWARE_VERSION}`);
  });
  return file;
}

describe("storing a falsification reply's verdicts as defect evidence", () => {
  it("D3910: each verdict is stored with the mutation file digest of the experiment record naming its defect, whatever the order of the reply's records", async () => {
    const digests = await inStore((store) => {
      const experiments = [DETECTING, SURVIVING];
      const reply = ranReply(experiments);
      store.writeEvidence(
        evidenceBound(WORKTREE_A),
        { ...reply, experiments: [...reply.experiments].reverse() },
        digestsFor(experiments),
      );
      return store
        .readLatestResults(WORKTREE_A)
        .evidence.map(({ defectId, mutationFileDigest }) => [
          defectId,
          mutationFileDigest,
        ]);
    });
    expect(digests).toStrictEqual([
      ["D1", "file-digest-1"],
      ["D2", "file-digest-2"],
    ]);
  });

  it("D3911: a stored record carries its verdict, reason, detail and facts, bound to its scope, the definition digest handed in, its record's mutation file digest, the fingerprint digest, the reply's versions and adapter version 3", async () => {
    const stored = await inStore((store) => {
      store.writeEvidence(
        evidenceBound(WORKTREE_A),
        { ...ranReply([HOOK_FAILED]), vitestVersion: "4.1.11" },
        digestsFor([HOOK_FAILED]),
      );
      return store
        .readLatestResults(WORKTREE_A)
        .evidence.map(({ evidenceId, ...record }) => ({
          ...record,
          hasEvidenceId: evidenceId !== "",
        }));
    });
    expect(stored).toStrictEqual([
      {
        ...WORKTREE_A,
        inputFingerprintDigest: PRINT,
        defectId: "D3",
        definitionDigest: "definition-digest-D3",
        mutationFileDigest: "file-digest-3",
        vitestVersion: "4.1.11",
        falsifierVersion: FALSIFIER_VERSION,
        adapterVersion: 3,
        verdict: "invalid-experiment",
        judgement: HOOK_FAILED_JUDGEMENT,
        hasEvidenceId: true,
      },
    ]);
  });

  it("D3912: a new verdict replaces that defect's record in that worktree alone, leaving every other defect's and the other worktree's evidence", async () => {
    const verdicts = await inStore((store) => {
      storeReply(store, WORKTREE_A, [DETECTING, SURVIVING]);
      storeReply(store, WORKTREE_B, [DETECTING]);
      storeReply(store, WORKTREE_A, [{ ...SURVIVING, defectId: "D1" }]);
      return {
        a: verdictsIn(store, WORKTREE_A),
        b: verdictsIn(store, WORKTREE_B),
      };
    });
    expect(verdicts).toStrictEqual({
      a: [
        ["D1", "survived"],
        ["D2", "survived"],
      ],
      b: [["D1", "detected"]],
    });
  });

  it("D3913: a judgement with no verdict stores nothing and leaves its defect's earlier evidence, while the verdict beside it is stored", async () => {
    const outcome = await inStore((store) => {
      storeReply(store, WORKTREE_A, [DETECTING]);
      const second = storeReply(store, WORKTREE_A, [
        { ...DETECTING, facts: UNDECIDED_FACTS },
        SURVIVING,
      ]);
      return {
        stored: second.map(({ defectId }) => defectId),
        verdicts: verdictsIn(store, WORKTREE_A),
      };
    });
    expect(outcome).toStrictEqual({
      stored: ["D2"],
      verdicts: [
        ["D1", "detected"],
        ["D2", "survived"],
      ],
    });
  });

  it("D3914: a second store reading while a reply's records are being written sees none of them", async () => {
    const seen = await inStore((store, stateDirectory) => {
      const reader = openStore(stateDirectory);
      const run = StatementSync.prototype.run;
      const observed: { verdicts: Settled<string[][]> | "never read" } = {
        verdicts: "never read",
      };
      const readAfterFirstInsert = vi
        .spyOn(StatementSync.prototype, "run")
        .mockImplementation(function (
          this: StatementSync,
          ...parameters: Parameters<StatementSync["run"]>
        ) {
          const result = run.apply(this, parameters);
          if (
            observed.verdicts === "never read" &&
            this.sourceSQL.includes("INSERT INTO defect_evidence")
          ) {
            observed.verdicts = settle(() => verdictsIn(reader, WORKTREE_A));
          }
          return result;
        });
      try {
        storeReply(store, WORKTREE_A, [DETECTING, SURVIVING]);
        return observed.verdicts;
      } finally {
        readAfterFirstInsert.mockRestore();
        reader.close();
      }
    });
    expect(seen).toStrictEqual([]);
  });

  it("D3930: a new store holds evidence from its creation, and a store opened again reads each record the first stored, whole", async () => {
    const judgements = await acrossReopen(
      (store) => {
        storeReply(store, WORKTREE_A, [DETECTING, HOOK_FAILED]);
      },
      (store) =>
        store
          .readLatestResults(WORKTREE_A)
          .evidence.map(({ defectId, judgement }) => [defectId, judgement]),
    );
    expect(judgements).toStrictEqual([
      ["D1", { verdict: "detected", facts: DETECTING.facts }],
      ["D3", HOOK_FAILED_JUDGEMENT],
    ]);
  });

  it("D3963: a no-probe-site and a no-module verdict, each decided before any run, are stored beside a detection and read back whole by a store opened again, the site's members included", async () => {
    const judgements = await acrossReopen((store) => {
      const unrun = [UNPROBED, UNLOCATED];
      store.writeEvidence(
        evidenceBound(WORKTREE_A),
        replyWithUnrun([DETECTING], unrun),
        digestsFor([DETECTING, ...unrun]),
      );
    }, judgementsRead);
    expect(judgements).toStrictEqual([
      ["D1", { verdict: "detected", facts: DETECTING.facts }],
      [
        "D4",
        {
          verdict: "invalid-experiment",
          reason: "no-probe-site",
          detail: {
            site: {
              kind: "position",
              line: 4,
              column: 12,
              nodeKind: "Identifier",
              role: "CallExpression.callee",
            },
          },
          facts: UNPROBED.facts,
        },
      ],
      [
        "D5",
        {
          verdict: "invalid-experiment",
          reason: "no-module",
          facts: UNLOCATED.facts,
        },
      ],
    ]);
  });

  it("D4002: an unclear verdict whose confirming run differed is stored with what its confirming run alone read, and read back whole by a store opened again", async () => {
    const judgements = await acrossReopen((store) => {
      storeReply(store, WORKTREE_A, [UNCONFIRMED]);
    }, judgementsRead);
    expect(judgements).toStrictEqual([
      [
        "D6",
        {
          verdict: "unclear",
          reason: "confirming-run-differed",
          detail: { confirming: { verdict: "survived" } },
          facts: UNCONFIRMED.facts,
        },
      ],
    ]);
  });
});

describe("a falsification reply the store refuses whole", () => {
  it("D3915: a reply that does not read ran, or carries no Vitest version or no falsifier version, stores nothing and says which", async () => {
    const refusals = await inStore((store) => {
      const reply = ranReply([DETECTING]);
      return refusalsOf(store, [
        {
          status: "failed",
          workspace: reply.workspace,
          vitestVersion: reply.vitestVersion,
          error: "Error: config threw",
        },
        { ...reply, vitestVersion: undefined },
        { ...reply, falsifierVersion: undefined },
      ]);
    });
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(/must read ran .* got status "failed"/),
        expect.stringMatching(/carries no Vitest version/),
        expect.stringMatching(/carries no falsifier version/),
      ],
      stored: [],
    });
  });

  it("D3916: an empty project identity, worktree identity or fingerprint digest refuses the write, naming it, and stores nothing", async () => {
    const refusals = await inStore((store) => {
      const reply = ranReply([DETECTING]);
      const whole = evidenceBound(WORKTREE_A);
      const broken: EvidenceBindings[] = [
        { ...whole, projectIdentity: "" },
        { ...whole, worktreeIdentity: "" },
        { ...whole, inputFingerprintDigest: "" },
      ];
      return {
        reasons: broken.map((bindings) =>
          rejection(
            settle(() =>
              store.writeEvidence(bindings, reply, digestsFor([DETECTING])),
            ),
          ),
        ),
        rows: countRows(store.file, "defect_evidence"),
      };
    });
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(/The project identity is required/),
        expect.stringMatching(/The worktree identity is required/),
        expect.stringMatching(/The input fingerprint digest is required/),
      ],
      rows: 0,
    });
  });

  it("D3917: a verdict whose defect has no definition digest handed in refuses the reply, naming the defect, and the verdict beside it is not stored", async () => {
    const refusals = await inStore((store) =>
      refusalsOf(store, [ranReply([DETECTING, SURVIVING])], [DETECTING]),
    );
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(
          /No definition digest was handed in for defect D2/,
        ),
      ],
      stored: [],
    });
  });

  it("D3918: a verdict whose defect names no experiment record of the reply, or two, refuses the reply, naming the defect and the count", async () => {
    const refusals = await inStore((store) => {
      const reply = ranReply([DETECTING, SURVIVING]);
      const [first, second] = reply.experiments;
      return refusalsOf(store, [
        { ...reply, experiments: [second] },
        { ...reply, experiments: [first, first, second] },
      ]);
    });
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(
          /defect D1 must name one experiment record .* it names 0$/,
        ),
        expect.stringMatching(
          /defect D1 must name one experiment record .* it names 2$/,
        ),
      ],
      stored: [],
    });
  });

  it("D3919: a defect two judgements of one reply name, both with a verdict or one without, refuses the reply, naming the defect", async () => {
    const refusals = await inStore((store) => {
      const twice = (second: ReplyExperiment) => {
        const reply = ranReply([DETECTING, { ...second, defectId: "D1" }]);
        return { ...reply, experiments: reply.experiments.slice(0, 1) };
      };
      return refusalsOf(store, [
        twice(SURVIVING),
        twice({ ...SURVIVING, facts: UNDECIDED_FACTS }),
      ]);
    });
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(/More than one judgement .* names defect D1/),
        expect.stringMatching(/More than one judgement .* names defect D1/),
      ],
      stored: [],
    });
  });

  it("D3920: a verdict whose experiment record carries no mutation file digest refuses the reply, naming the defect", async () => {
    const refusals = await inStore((store) =>
      refusalsOf(store, [
        ranReply([{ defectId: "D1", facts: DETECTING.facts }, SURVIVING]),
      ]),
    );
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(
          /experiment record for defect D1 carries no mutation file digest/,
        ),
      ],
      stored: [],
    });
  });

  it("D3921: a reply whose verdict or detail is not the one the judge gives the facts beside it is refused, so a surviving run is never stored as a detection", async () => {
    const refusals = await inStore((store) => {
      const survived = ranReply([SURVIVING]);
      const hookFailed = ranReply([HOOK_FAILED]);
      return refusalsOf(
        store,
        [
          {
            ...survived,
            judgements: survived.judgements.map((judgement) => ({
              ...judgement,
              verdict: "detected",
            })),
          },
          {
            ...hookFailed,
            judgements: hookFailed.judgements.map((judgement) => ({
              ...judgement,
              detail: { hook: "beforeEach", state: "skip" },
            })),
          },
        ],
        [SURVIVING, HOOK_FAILED],
      );
    });
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(/judgement for defect D2 cannot be stored/),
        expect.stringMatching(/judgement for defect D3 cannot be stored/),
      ],
      stored: [],
    });
  });

  it("D3925: a judgement naming no defect id, an experiment record that is no object, or a reply with no list of experiment records refuses the reply, naming the entry by its place", async () => {
    const refusals = await inStore((store) => {
      const reply = ranReply([DETECTING]);
      return refusalsOf(store, [
        {
          ...reply,
          judgements: [{ verdict: "detected", facts: DETECTING.facts }],
        },
        { ...reply, experiments: [null] },
        { ...reply, experiments: undefined },
      ]);
    });
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(
          /judgement 0 is not an object naming a defect id/,
        ),
        expect.stringMatching(
          /experiment record 0 is not an object naming a defect id/,
        ),
        expect.stringMatching(/no list of experiment records/),
      ],
      stored: [],
    });
  });

  it("D3926: a reply whose facts hold a negative or a fractional count is refused, though the judge gives those facts its verdict", async () => {
    const refusals = await inStore((store) =>
      refusalsOf(store, [
        ranReply([
          {
            ...DETECTING,
            facts: detection({
              nextRun: { recorded: true, unhandledErrorCount: -1 },
            }),
          },
        ]),
        ranReply([
          {
            ...DETECTING,
            facts: detection({
              baseline: baseline({ unnamedUnhandledErrorCount: 0.5 }),
            }),
          },
        ]),
      ]),
    );
    expect(refusals).toStrictEqual({
      reasons: [
        expect.stringMatching(/judgement for defect D1 cannot be stored/),
        expect.stringMatching(/judgement for defect D1 cannot be stored/),
      ],
      stored: [],
    });
  });
});

describe("what an evidence row holds", () => {
  it("D3927: no member the judgement and fact types do not name reaches a row, and no text of the reply's raw run records does", async () => {
    const stored = await inStore((store) => {
      const leakingError: ErrorFact = withExtra(TYPE_ERROR, {
        message: `${SECRET} message`,
        stack: `${SECRET} stack`,
      });
      const reply = ranReply([
        {
          ...DETECTING,
          facts: ranOnce({
            test: { ...REJECTING_TEST, errors: [leakingError] },
          }),
          run: {
            ...EMPTY_RUN,
            unhandledErrors: [{ message: `${SECRET} raw record` }],
          },
        },
      ]);
      store.writeEvidence(
        evidenceBound(WORKTREE_A),
        {
          ...reply,
          judgements: reply.judgements.map((judgement) =>
            withExtra(
              {
                ...judgement,
                facts: withExtra(judgement.facts, {
                  codeFrame: `${SECRET} frame`,
                }),
              },
              { old: `${SECRET} old text` },
            ),
          ),
        },
        digestsFor([DETECTING]),
      );
      return secretsStored(store.file);
    });
    expect(stored).toStrictEqual({ rows: 1, holding: [] });
  });

  it("D3928: a member a mutation load, a probe site or a reach does not name reaches no row", async () => {
    const stored = await inStore((store) => {
      const load: MutationLoad = withExtra(
        {
          applied: true,
          probe: {
            placed: true,
            site: withExtra(
              { line: 2, column: 10, nodeKind: "BinaryExpression" },
              { text: `${SECRET} site` },
            ),
          },
        },
        { code: `${SECRET} load` },
      );
      const reach: Reach = withExtra(IN_TEST, { source: `${SECRET} reach` });
      storeReply(store, WORKTREE_A, [
        {
          ...SURVIVING,
          facts: ranOnce({
            mutation: [load],
            test: { ...SURVIVING_TEST, reach },
          }),
        },
      ]);
      return secretsStored(store.file);
    });
    expect(stored).toStrictEqual({ rows: 1, holding: [] });
  });
});

describe("evidence a query reads back", () => {
  /** What a query reads once `stored` is written and `corrupt` has run through a second connection. */
  function evidenceAfter(
    stored: readonly ReplyExperiment[],
    corrupt: string,
  ): Promise<Settled<{ verdicts: string[][]; refusals: unknown }>> {
    return inStore((store) => {
      storeReply(store, WORKTREE_A, stored);
      withRawDatabase(store.file, (database) => {
        database.exec(corrupt);
      });
      return {
        verdicts: verdictsIn(store, WORKTREE_A),
        refusals: store.readLatestResults(WORKTREE_A).evidenceRefusals,
      };
    });
  }

  it("D3922: a row whose verdict its own facts do not give is refused as unreadable, never read as that verdict", async () => {
    expect(
      await evidenceAfter(
        [DETECTING, SURVIVING],
        "UPDATE defect_evidence SET verdict = 'detected' WHERE defect_id = 'D2'",
      ),
    ).toStrictEqual({
      verdicts: [["D1", "detected"]],
      refusals: [
        {
          defectId: "D2",
          reason: expect.stringMatching(
            /unreadable judgement that its facts do not give/,
          ),
        },
      ],
    });
  });

  it("D3923: a record that cannot be rebuilt is refused alone, with its reason and cause, and every other defect's evidence still reads", async () => {
    expect(
      await evidenceAfter(
        [DETECTING, SURVIVING],
        "UPDATE defect_evidence SET facts = 'not json' WHERE defect_id = 'D1'",
      ),
    ).toStrictEqual({
      verdicts: [["D2", "survived"]],
      refusals: [
        {
          defectId: "D1",
          reason: expect.stringMatching(
            /^The store holds an unreadable facts: "not json"\n {2}caused by: /,
          ),
        },
      ],
    });
  });

  it("D3924: a record stored under another falsifier version reads its bindings and its verdict alone, its reason, detail and facts never parsed", async () => {
    const read = await inStore((store) => {
      store.writeEvidence(
        evidenceBound(WORKTREE_A),
        {
          ...ranReply([HOOK_FAILED]),
          falsifierVersion: FALSIFIER_VERSION + 1,
        },
        digestsFor([HOOK_FAILED]),
      );
      withRawDatabase(store.file, (database) => {
        database.exec(
          `UPDATE defect_evidence SET reason = 'a-reason-of-that-version',
            detail = 'not json', facts = '{"shape":"of that version"}'`,
        );
      });
      const { evidence, evidenceRefusals } =
        store.readLatestResults(WORKTREE_A);
      return {
        records: evidence.map((record) => ({
          defectId: record.defectId,
          verdict: record.verdict,
          falsifierVersion: record.falsifierVersion,
          interpreted: "judgement" in record,
        })),
        refusals: evidenceRefusals,
      };
    });
    expect(read).toStrictEqual({
      records: [
        {
          defectId: "D3",
          verdict: "invalid-experiment",
          falsifierVersion: FALSIFIER_VERSION + 1,
          interpreted: false,
        },
      ],
      refusals: [],
    });
  });

  it("D3931: the evidence is read from the snapshot the latest discovery is read from, so a discovery and a verdict committed as the read begins are answered together", async () => {
    const read = await inStore((store, stateDirectory) => {
      store.writeDiscovery(bound(WORKTREE_A), DISCOVERY_WITHOUT_TESTS);
      storeReply(store, WORKTREE_A, [{ ...SURVIVING, defectId: "D1" }]);
      const writer = openStore(stateDirectory);
      const prepare = DatabaseSync.prototype.prepare;
      let written = false;
      const writeAtVersionRead = vi
        .spyOn(DatabaseSync.prototype, "prepare")
        .mockImplementation(function (this: DatabaseSync, sql: string) {
          if (!written && sql.includes("pragma_user_version")) {
            written = true;
            writer.writeDiscovery(bound(WORKTREE_A), DISCOVERY);
            storeReply(writer, WORKTREE_A, [DETECTING]);
          }
          return prepare.call(this, sql);
        });
      try {
        const latest = store.readLatestResults(WORKTREE_A);
        return {
          discovery: latest.discovery?.discovery,
          verdicts: latest.evidence.map(({ defectId, verdict }) => [
            defectId,
            verdict,
          ]),
        };
      } finally {
        writeAtVersionRead.mockRestore();
        writer.close();
      }
    });
    expect(read).toStrictEqual({
      discovery: DISCOVERY,
      verdicts: [["D1", "detected"]],
    });
  });
});

describe("opening a store written before defect evidence", () => {
  it("D3929: a store at each schema version from 1 to 10 opens at version 11 and holds evidence from then on, read by the store opened next", async () => {
    const outcomes = await inTempDir((dir) =>
      settle(() =>
        MIGRATED_VERSIONS.map((from) => {
          const stateDirectory = defaultStateDirectory(join(dir, `v${from}`));
          const file = writeStoreAt(stateDirectory, from);
          withOpenStore(stateDirectory, (store) => {
            storeReply(store, WORKTREE_A, [DETECTING]);
          });
          return {
            from,
            version: schemaVersionOf(file),
            evidence: withOpenStore(stateDirectory, (store) =>
              verdictsIn(store, WORKTREE_A),
            ),
          };
        }),
      ),
    );
    expect(outcomes).toStrictEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((from) => ({
        from,
        version: 11,
        evidence: [["D1", "detected"]],
      })),
    );
  });

  it("D3964: a version 10 store opens at version 11, its discovery reading back with each workspace's selection facts and its run as they were stored", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeStoreAt(stateDirectory, EVIDENCE_UNAWARE_VERSION);
        return withOpenStore(stateDirectory, (store) => ({
          version: schemaVersionOf(file),
          discovery: store.readLatestDiscovery(WORKTREE_A)?.discovery,
          runs: runsOf(store, WORKTREE_A),
        }));
      }),
    );
    expect(outcome).toStrictEqual({
      version: 11,
      discovery: DISCOVERY,
      runs: [FAILED_RUN],
    });
  });
});
