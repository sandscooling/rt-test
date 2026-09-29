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
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { describe, expect, it, vi } from "vitest";
import {
  consumerIdentity,
  defaultStateDirectory,
} from "../src/store/consumer-identity.js";
import { column, UnreadableRecordError } from "../src/store/columns.js";
import { openStore, type RtTestStore } from "../src/store/open-store.js";
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
import type {
  ProjectSelectionFacts,
  ReportedAlias,
  SelectionFacts,
  TestFilePatterns,
} from "../src/vitest/selection-facts.js";
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
};
/** A project with no setup files, global setup files or aliases, matching from the consumer root, whose crawled links are not known. */
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

function countRows(file: string, table: "runs" | "discoveries"): unknown {
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
    database.exec(`PRAGMA user_version = ${userVersion}`);
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
    database.exec(`PRAGMA user_version = ${SELECTION_FACTS_UNAWARE_VERSION}`);
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
    database.exec(`PRAGMA user_version = ${VITE_ROOT_UNAWARE_VERSION}`);
  });
  return file;
}

/** Writes `DISCOVERY` and the runs through a store, then strips `unaware` from each stored project's test file patterns and takes the header back to `userVersion`, as a store from before those fields were kept holds them. */
function writeFactsUnawareStore(
  stateDirectory: string,
  userVersion: number,
  unaware: readonly (keyof TestFilePatterns)[],
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
      const stripped = projects.map((project) => {
        const patterns: Partial<TestFilePatterns> = {
          ...project.testFilePatterns,
        };
        for (const field of unaware) delete patterns[field];
        return { ...project, testFilePatterns: patterns };
      });
      update.run(JSON.stringify(stripped), Number(row["rowid"]));
    }
    database.exec(`PRAGMA user_version = ${userVersion}`);
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
        SPELLINGS_AND_LINKS_UNAWARE_FIELDS,
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

  it("D1280: the store is at schema version 7 once opened", async () => {
    const version = await inForceStopUnawareStore(
      [RAN_RUN],
      (stateDirectory, file) => {
        openStore(stateDirectory).close();
        return schemaVersionOf(file);
      },
    );
    expect(version).toBe(7);
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

  it("D2097: the store is at schema version 7 once opened", async () => {
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
    expect(version).toBe(7);
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

  it("D2846: a version 3 store opens at version 7, so the selection facts a discovery stores after it read back once the store is reopened", async () => {
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
    expect(outcome).toStrictEqual({ version: 7, facts: [SELECTION_FACTS] });
  });
});

describe("opening a store written before crashed runs", () => {
  it("D2791: a version 4 store opens at version 7, every run it held unchanged", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        withOpenStore(stateDirectory, (store) => {
          store.writeRun(bound(WORKTREE_A), RAN_RUN);
          store.writeRun(bound(WORKTREE_A), FAILED_RUN);
        });
        const file = join(stateDirectory, STORE_FILE_NAME);
        withRawDatabase(file, (database) => {
          database.exec("PRAGMA user_version = 4");
        });
        const runs = withOpenStore(stateDirectory, (store) =>
          runsOf(store, WORKTREE_A),
        );
        return { version: schemaVersionOf(file), runs };
      }),
    );
    expect(outcome).toStrictEqual({ version: 7, runs: [RAN_RUN, FAILED_RUN] });
  });

  it("D2829: each discovered workspace of a version 4 store reads back as not reporting selection facts, and the rest of the discovery unchanged", async () => {
    const discovery = await inSpellingUnawareStore(CRASH_UNAWARE_VERSION);
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });

  it("D2792: a new store is created at schema version 7", async () => {
    const version = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        openStore(stateDirectory).close();
        return schemaVersionOf(join(stateDirectory, STORE_FILE_NAME));
      }),
    );
    expect(version).toBe(7);
  });
});

describe("opening a store written before Vitest's spellings of the pattern directories", () => {
  it("D2830: each discovered workspace reads back as not reporting selection facts, rather than its report without spellings being read", async () => {
    const discovery = await inSpellingUnawareStore(
      VITEST_SPELLING_UNAWARE_VERSION,
    );
    expect(discovery).toStrictEqual(withoutReportedFacts(DISCOVERY));
  });

  it("D2831: a version 5 store opens at version 7, every run it held unchanged", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          VITEST_SPELLING_UNAWARE_VERSION,
          SPELLINGS_AND_LINKS_UNAWARE_FIELDS,
          [RAN_RUN, FAILED_RUN],
        );
        const runs = withOpenStore(stateDirectory, (store) =>
          runsOf(store, WORKTREE_A),
        );
        return { version: schemaVersionOf(file), runs };
      }),
    );
    expect(outcome).toStrictEqual({ version: 7, runs: [RAN_RUN, FAILED_RUN] });
  });
});

describe("opening a store written before the directory links Vitest's crawl follows", () => {
  it("D2859: a version 6 store opens at version 7, each discovered workspace reading back as not reporting selection facts rather than its report without crawled links being read", async () => {
    const outcome = await inTempDir((dir) =>
      settle(() => {
        const stateDirectory = defaultStateDirectory(dir);
        const file = writeFactsUnawareStore(
          stateDirectory,
          CRAWLED_LINKS_UNAWARE_VERSION,
          ["crawledLinks"],
        );
        const discovery = withOpenStore(
          stateDirectory,
          (store) => store.readLatestDiscovery(WORKTREE_A)?.discovery,
        );
        return { version: schemaVersionOf(file), discovery };
      }),
    );
    expect(outcome).toStrictEqual({
      version: 7,
      discovery: withoutReportedFacts(DISCOVERY),
    });
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
