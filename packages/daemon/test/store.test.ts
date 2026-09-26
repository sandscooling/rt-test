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
import { dirname, join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import {
  consumerIdentity,
  defaultStateDirectory,
} from "../src/store/consumer-identity.js";
import { openStore, type RtTestStore } from "../src/store/open-store.js";
import {
  STORE_APPLICATION_ID,
  STORE_FILE_NAME,
  STORE_SCHEMA,
  STORE_SCHEMA_VERSION,
} from "../src/store/schema.js";
import type {
  InputFingerprint,
  StoreBindings,
  StoreScope,
} from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { TestDiscovery } from "../src/vitest/discover-tests.js";
import type { VitestWorkspace } from "../src/vitest/find-workspaces.js";
import type { RecordedModule, RecordedTest } from "../src/vitest/run-states.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import { inTempDir, settle } from "./harness.js";

type Settled<T> = T | { thrown: string };
type RanRun = Extract<WorkspaceRun, { status: "ran" }>;

/** The value every RT Test store carries in `PRAGMA application_id`, whatever its schema version. */
const RT_TEST_APPLICATION_ID = 1381258324;
const OPENED = "opened";
/** Long enough that the store under test reads the empty file's header before the schema commits. */
const SCHEMA_HOLD_MS = 1000;
const WORKER_START_TIMEOUT_MS = 10_000;

/** Opens the file as the store's opener does, creates the schema in one held transaction, flags that it holds it, then commits after a pause. */
const CREATE_SCHEMA_WORKER = `
const { DatabaseSync } = require("node:sqlite");
const { workerData } = require("node:worker_threads");
const { file, schema, applicationId, schemaVersion, created, holdMs } = workerData;
const database = new DatabaseSync(file);
database.exec("PRAGMA busy_timeout = 10000");
database.exec("PRAGMA journal_mode = WAL");
database.exec("BEGIN IMMEDIATE");
database.exec(schema);
database.exec("PRAGMA application_id = " + applicationId);
database.exec("PRAGMA user_version = " + schemaVersion);
Atomics.store(created, 0, 1);
Atomics.notify(created, 0);
Atomics.wait(created, 0, 1, holdMs);
database.exec("COMMIT");
database.close();
`;

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

function mainCheckout(dir: string): string {
  const main = join(dir, "main");
  mkdirSync(join(main, ".git"), { recursive: true });
  return main;
}

/** A worktree the way `git worktree add` lays it out, its `.git` file naming its git directory as `gitdir` spells it. */
function linkedWorktree(
  main: string,
  name: string,
  gitdir: (worktreeGitDirectory: string) => string,
): string {
  const worktreeGitDirectory = join(main, ".git", "worktrees", name);
  mkdirSync(worktreeGitDirectory, { recursive: true });
  writeFileSync(join(worktreeGitDirectory, "commondir"), "../..\n");
  const root = join(dirname(main), name);
  mkdirSync(root);
  writeFileSync(
    join(root, ".git"),
    `gitdir: ${gitdir(worktreeGitDirectory)}\n`,
  );
  return root;
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
      const created = new Int32Array(new SharedArrayBuffer(4));
      const worker = new Worker(CREATE_SCHEMA_WORKER, {
        eval: true,
        workerData: {
          file: join(stateDirectory, STORE_FILE_NAME),
          schema: STORE_SCHEMA,
          applicationId: STORE_APPLICATION_ID,
          schemaVersion: STORE_SCHEMA_VERSION,
          created,
          holdMs: SCHEMA_HOLD_MS,
        },
      });
      const exited = once(worker, "exit");
      const held =
        Atomics.wait(created, 0, 0, WORKER_START_TIMEOUT_MS) !== "timed-out";
      const runs = settle(() =>
        withOpenStore(stateDirectory, (store) => runsOf(store, WORKTREE_A)),
      );
      const [exitCode] = (await exited) as [number];
      return { held, runs, exitCode };
    });
    expect(outcome).toStrictEqual({ held: true, runs: [], exitCode: 0 });
  });
});
