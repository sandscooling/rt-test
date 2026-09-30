import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  carriedUnion,
  type CarriedReason,
  type CarriedVariables,
  type FoundIn,
} from "../src/inputs/carried-variables.js";
import { DeclaredNonInputs } from "../src/inputs/declared-non-inputs.js";
import { countEnvironment } from "../src/inputs/environment-digest.js";
import {
  discoveryFingerprint,
  ProjectInputs,
  workspaceFingerprint,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import { readEntryDigest } from "../src/inputs/input-inventory.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import { memoryLog } from "./daemon-harness.js";
import {
  discoveredWorkspace,
  HAND_BUILT_ROOT,
  handBuiltEnvironment,
  handBuiltReads,
  inTempDir,
  onPlatform,
  projectFacts,
} from "./harness.js";

/** A variable `rt-test.json` declares, which no shell, terminal or agent sets. */
const DECLARED = "RT_TEST_SECRET";
const OTHER_DECLARED = "RT_TEST_TOKEN";
const DECLARATION = [DECLARED, OTHER_DECLARED];
/** A variable the session list names, for the cases that run with no declaration. */
const SESSION_NAMED = "SSH_TTY";
const APP = "packages/app";
const OTHER_APP = "packages/other";
const APP_ENV = `${APP}/.env`;
const VITE_PREFIX = "VITE_";
const MODE = "test";
const TEXT_BESIDE_NO_REFERENCE = "VITE_A=1\n";
const CHANGED_SINCE_HELD =
  "the env file packages/app/.env changed since the inputs were read";
const APP_LINE_HEAD =
  "environment: counted by value for the workspace packages/app although the session list or rt-test.json names it:";

/** The workspace at `path` under `root`, its one project loading env files from `path` under `prefixes`. */
function envWorkspace(
  path: string = APP,
  prefixes: readonly string[] = [VITE_PREFIX],
  root: string = HAND_BUILT_ROOT,
  envDirectory: string | null = path,
): WorkspaceDiscovery {
  return discoveredWorkspace({ path, directory: join(root, path) }, [], {
    reported: true,
    projects: [
      projectFacts({
        envSources: [{ envDirectory, envPrefixes: [...prefixes], mode: MODE }],
      }),
    ],
  });
}

/** The app workspace's env file holding `text`, and no other env file readable. */
function appText(text: string): ReadonlyMap<string, string | undefined> {
  return new Map([[APP_ENV, text]]);
}

/** A decision as plain data, so one assertion compares its every part. */
function decided(carried: CarriedVariables): unknown {
  return carried.every
    ? { every: true, where: carried.where }
    : { every: false, names: Object.fromEntries(carried.names) };
}

/** What the declaration decides for the app workspace whose `.env` holds `text`, under `start`. */
function decidedFor(
  text: string,
  start: NodeJS.ProcessEnv = {},
  entry: WorkspaceDiscovery = envWorkspace(),
): unknown {
  return decided(
    handBuiltEnvironment(start, DECLARATION).carried(entry, appText(text)),
  );
}

/** Only `names`, each for `reason`. */
function namesFor(
  reason: CarriedReason,
  ...names: string[]
): { every: false; names: Record<string, CarriedReason> } {
  return {
    every: false,
    names: Object.fromEntries(names.map((name) => [name, reason])),
  };
}

const FROM_APP_ENV: FoundIn = { file: APP_ENV };

function carriedNames(...names: string[]): CarriedVariables {
  return {
    every: false,
    names: new Map(names.map((name) => [name, FROM_APP_ENV])),
  };
}

function writeFiles(root: string, files: Readonly<Record<string, string>>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

function printed(print: FingerprintResult): string | undefined {
  return print.ok ? print.digest : undefined;
}

/** Whether a fingerprint was computed under both values of the declared variable, and whether they differ. */
function movedByValue(print: (value: string) => string | undefined): {
  computed: boolean;
  moved: boolean;
} {
  const first = print("first");
  const second = print("second");
  return {
    computed: first !== undefined && second !== undefined,
    moved: first !== second,
  };
}

/** The reads of one moment over `root` under a start environment holding the declared variable at `value`. */
function readsWith(root: string, value: string) {
  return handBuiltReads(
    root,
    handBuiltEnvironment({ [DECLARED]: value }, DECLARATION),
  );
}

/** Two workspaces, the app's `.env` referencing the declared variable, the other's listing nothing on disk. */
function referencingDiscovery(root: string): TestDiscovery {
  writeFiles(root, { [APP_ENV]: `VITE_URL=$${DECLARED}\n` });
  return {
    workspaces: [
      envWorkspace(APP, [VITE_PREFIX], root),
      envWorkspace(OTHER_APP, [VITE_PREFIX], root),
    ],
    notRead: [],
  };
}

/** The daemon's non-input state over `start` with no declaration, and the log it writes to. */
function loggingDeclared(
  start: NodeJS.ProcessEnv,
  root: string = HAND_BUILT_ROOT,
) {
  const log = memoryLog();
  return { declared: new DeclaredNonInputs(root, log, start), log };
}

describe("the references an env file makes", () => {
  it("D3390: a $NAME reference in a listed env file counts that declared variable by value for the workspace", () => {
    expect(decidedFor(`VITE_URL=$${DECLARED}/api\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3391: a ${NAME} reference counts that declared variable by value, not every variable", () => {
    expect(decidedFor(`VITE_URL=\${${DECLARED}}\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3392: a ${NAME:-default} reference counts that declared variable by value, not every variable", () => {
    expect(decidedFor(`VITE_URL=\${${DECLARED}:-fallback}\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3393: a ${NAME-default} reference counts that declared variable by value, not every variable", () => {
    expect(decidedFor(`VITE_URL=\${${DECLARED}-fallback}\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3394: a ${NAME:+alternate} reference counts that declared variable by value, not every variable", () => {
    expect(decidedFor(`VITE_URL=\${${DECLARED}:+alternate}\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3395: a ${NAME+alternate} reference counts that declared variable by value, not every variable", () => {
    expect(decidedFor(`VITE_URL=\${${DECLARED}+alternate}\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3396: an escaped reference counts its variable by value, since Vite writes it back unescaped for a later key to expand", () => {
    expect(decidedFor(`A=\\$${DECLARED}\nVITE_C=x$A\n`)).toStrictEqual(
      namesFor(FROM_APP_ENV, DECLARED),
    );
  });

  it("D3397: a reference reaches a declared variable through the start environment's values two variables deep", () => {
    const start = { G: "$H", H: `\${${DECLARED}}`, [DECLARED]: "held" };
    expect(decidedFor("VITE_URL=${G:-x}\n", start)).toStrictEqual(
      namesFor({ file: APP_ENV, through: "H" }, DECLARED),
    );
  });

  it("D3398: a reference reaches each set variable whose name begins with it, since a substitution after it can extend the name", () => {
    const start = { [SESSION_NAMED]: "/dev/pts/1" };
    expect(decidedFor("P=\\$SSH_\nVITE_Q=${P}TTY\n", start)).toStrictEqual(
      namesFor(FROM_APP_ENV, SESSION_NAMED),
    );
  });

  it("D3399: a reference reaches each set variable whose name begins it, since Vite splits a name without an operator at null", () => {
    const start = { [SESSION_NAMED]: "/dev/pts/1" };
    expect(decidedFor("VITE_Q=${SSH_TTYnullX}\n", start)).toStrictEqual(
      namesFor(FROM_APP_ENV, SESSION_NAMED),
    );
  });
});

describe("the env prefixes a workspace reports", () => {
  it("D3400: a set declared variable an env prefix begins counts by value, though the source loads no env file", () => {
    const entry = envWorkspace(APP, ["RT_TEST_"], HAND_BUILT_ROOT, null);
    const carried = handBuiltEnvironment(
      { [DECLARED]: "held", VITE_A: "1" },
      DECLARATION,
    ).carried(entry, new Map());
    expect(decided(carried)).toStrictEqual(
      namesFor({ prefix: "RT_TEST_" }, DECLARED),
    );
  });

  it("D3401: on Windows an env prefix begins a declared variable whatever the case of either", async () => {
    const carried = await onPlatform("win32", async () => {
      vi.resetModules();
      const fresh = await import("../src/inputs/carried-variables.js");
      const entry = envWorkspace(APP, ["rt_test_"], HAND_BUILT_ROOT, null);
      return new fresh.CountedEnvironment(
        { [DECLARED]: "held" },
        DECLARATION,
        () => undefined,
      ).carried(entry, new Map());
    });
    expect(decided(carried)).toStrictEqual(
      namesFor({ prefix: "rt_test_" }, DECLARED),
    );
  });
});

describe("a $ that begins no reference", () => {
  it("D3402: a listed env file holding a $ that begins no name counts every listed and declared variable by value", () => {
    expect(decidedFor("DB_PASS=pa$$word\n")).toStrictEqual({
      every: true,
      where: FROM_APP_ENV,
    });
  });

  it("D3403: a start environment value a reference reaches holding a stray $ counts every listed and declared variable by value", () => {
    expect(decidedFor("VITE_A=$H\n", { H: "$" })).toStrictEqual({
      every: true,
      where: { file: APP_ENV, through: "H" },
    });
  });

  it("D3409: a discovery counts every variable by value when any one of its workspaces does", () => {
    const every: CarriedVariables = { every: true, where: FROM_APP_ENV };
    expect(
      decided(carriedUnion([carriedNames(DECLARED), every])),
    ).toStrictEqual({ every: true, where: FROM_APP_ENV });
  });
});

describe("the environment's digest with carried variables", () => {
  it("D3404: a workspace whose references and env prefixes reach no listed or declared variable keeps the environment digest it had before carried variables counted", () => {
    const start = { [DECLARED]: "held", HOSTNAME_X: "host" };
    const environment = handBuiltEnvironment(start, DECLARATION);
    const carried = environment.carried(
      envWorkspace(),
      appText("VITE_URL=$HOSTNAME_X/api\n"),
    );
    expect(environment.digest(carried)).toBe(
      countEnvironment(start, DECLARATION).digest,
    );
  });

  it("D3405: the digest for one set of carried variables is not the one an earlier, different set gave", () => {
    const start = { [DECLARED]: "held", [OTHER_DECLARED]: "token" };
    const environment = handBuiltEnvironment(start, DECLARATION);
    environment.digest(carriedNames(DECLARED));
    expect(environment.digest(carriedNames(OTHER_DECLARED))).toBe(
      handBuiltEnvironment(start, DECLARATION).digest(
        carriedNames(OTHER_DECLARED),
      ),
    );
  });
});

describe("fingerprints over carried variables", () => {
  it("D3406: a change to the value of a declared variable a listed env file references changes the workspace's fingerprint", async () => {
    const outcome = await inTempDir((root) => {
      writeFiles(root, { [APP_ENV]: `VITE_URL=$${DECLARED}\n` });
      const project = new ProjectInputs(root, new Map());
      const entry = envWorkspace(APP, [VITE_PREFIX], root);
      return movedByValue((value) =>
        printed(workspaceFingerprint(project, entry, readsWith(root, value))),
      );
    });
    expect(outcome).toStrictEqual({ computed: true, moved: true });
  });

  it("D3407: a declared variable only one workspace's env file references stales that workspace's fingerprint and leaves the other's, after the discovery's composed in the same moment", async () => {
    const outcome = await inTempDir((root) => {
      const discovery = referencingDiscovery(root);
      const [app, other] = discovery.workspaces as [
        WorkspaceDiscovery,
        WorkspaceDiscovery,
      ];
      const project = new ProjectInputs(root, new Map());
      const printsWith = (value: string) => {
        const reads = readsWith(root, value);
        discoveryFingerprint(project, discovery, reads);
        return {
          app: printed(workspaceFingerprint(project, app, reads)),
          other: printed(workspaceFingerprint(project, other, reads)),
        };
      };
      const first = printsWith("first");
      const second = printsWith("second");
      return {
        appMoved: first.app !== undefined && first.app !== second.app,
        otherMoved: first.other === undefined || first.other !== second.other,
      };
    });
    expect(outcome).toStrictEqual({ appMoved: true, otherMoved: false });
  });

  it("D3408: the discovery's fingerprint counts by value a declared variable one of its workspaces' env files references", async () => {
    const outcome = await inTempDir((root) => {
      const discovery = referencingDiscovery(root);
      const project = new ProjectInputs(root, new Map());
      return movedByValue((value) =>
        printed(
          discoveryFingerprint(project, discovery, readsWith(root, value)),
        ),
      );
    });
    expect(outcome).toStrictEqual({ computed: true, moved: true });
  });

  it("D3410: an env file whose held digest is not of the content read leaves the workspace no fingerprint, saying it changed since the inputs were read", async () => {
    const print = await inTempDir((root) => {
      writeFiles(root, { [APP_ENV]: TEXT_BESIDE_NO_REFERENCE });
      return workspaceFingerprint(
        new ProjectInputs(root, new Map([[APP_ENV, "file:0000"]])),
        envWorkspace(APP, [VITE_PREFIX], root),
        handBuiltReads(root),
      );
    });
    expect(print).toStrictEqual({ ok: false, reason: CHANGED_SINCE_HELD });
  });

  it("D3412: an env file whose held digest is the tracker's read of the content read gives the workspace a fingerprint", async () => {
    const computed = await inTempDir(async (root) => {
      writeFiles(root, { [APP_ENV]: TEXT_BESIDE_NO_REFERENCE });
      const entry = await readEntryDigest(join(root, APP_ENV));
      if (entry.kind !== "input") return entry;
      return workspaceFingerprint(
        new ProjectInputs(root, new Map([[APP_ENV, entry.read.digest]])),
        envWorkspace(APP, [VITE_PREFIX], root),
        handBuiltReads(root),
      ).ok;
    });
    expect(computed).toBe(true);
  });
});

describe("the daemon log's line per workspace", () => {
  it("D3413: names a variable counted by value and the variable whose value the env file's reference passed through", () => {
    const { declared, log } = loggingDeclared({
      G: `$${SESSION_NAMED}`,
      [SESSION_NAMED]: "/dev/pts/1",
    });
    declared.environment.carried(envWorkspace(), appText("VITE_URL=$G\n"));
    expect(log.entries).toStrictEqual([
      `${APP_LINE_HEAD} "SSH_TTY" (referenced by the value of "G" from the env file packages/app/.env)`,
    ]);
  });

  it("D3414: names a variable counted by value and the env prefix that begins it", () => {
    const { declared, log } = loggingDeclared({
      [SESSION_NAMED]: "/dev/pts/1",
    });
    declared.environment.carried(
      envWorkspace(APP, ["SSH_"], HAND_BUILT_ROOT, null),
      new Map(),
    );
    expect(log.entries).toStrictEqual([
      `${APP_LINE_HEAD} "SSH_TTY" (the env prefix "SSH_" begins it)`,
    ]);
  });

  it("D3415: logs at warning level that every variable counts by value, naming the env file holding the stray $", () => {
    const { declared, log } = loggingDeclared({});
    declared.environment.carried(envWorkspace(), appText("DB_PASS=pa$$word\n"));
    expect(log.entries).toStrictEqual([
      "warning: environment: every variable the session list or rt-test.json names counted by value for the workspace packages/app, since the env file packages/app/.env holds a $ that begins no name Vite's expansion reads there",
    ]);
  });

  it("D3416: logs a workspace's unchanged decision once", () => {
    const { declared, log } = loggingDeclared({
      [SESSION_NAMED]: "/dev/pts/1",
    });
    const entry = envWorkspace();
    declared.environment.carried(entry, appText("VITE_Q=$SSH_TTY\n"));
    declared.environment.carried(entry, appText("VITE_Q=$SSH_TTY\n"));
    expect(log.entries).toHaveLength(1);
  });

  it("D3417: logs that none counts by value any longer when a workspace falls to none after some", () => {
    const { declared, log } = loggingDeclared({
      [SESSION_NAMED]: "/dev/pts/1",
    });
    const entry = envWorkspace();
    declared.environment.carried(entry, appText("VITE_Q=$SSH_TTY\n"));
    declared.environment.carried(entry, appText(TEXT_BESIDE_NO_REFERENCE));
    expect(log.entries).toStrictEqual([
      `${APP_LINE_HEAD} "SSH_TTY" (referenced by the env file packages/app/.env)`,
      "environment: none counted by value for the workspace packages/app any longer, so each variable the session list or rt-test.json names counts only as set there",
    ]);
  });

  it("D3418: logs nothing for a workspace that has never counted a variable by value", () => {
    const { declared, log } = loggingDeclared({
      [SESSION_NAMED]: "/dev/pts/1",
    });
    declared.environment.carried(
      envWorkspace(),
      appText(TEXT_BESIDE_NO_REFERENCE),
    );
    expect(log.entries).toStrictEqual([]);
  });

  it("D3419: does not log a workspace's unchanged decision again after rt-test.json is read again", async () => {
    const lines = await inTempDir((root) => {
      const { declared, log } = loggingDeclared(
        { [SESSION_NAMED]: "/dev/pts/1" },
        root,
      );
      const entry = envWorkspace(APP, [VITE_PREFIX], root);
      declared.environment.carried(entry, appText("VITE_Q=$SSH_TTY\n"));
      declared.read();
      declared.environment.carried(entry, appText("VITE_Q=$SSH_TTY\n"));
      return log.entries.filter((line) => line.startsWith(APP_LINE_HEAD));
    });
    expect(lines).toHaveLength(1);
  });
});

describe("the fingerprint's env file digests and every variable by value", () => {
  it("D3421: an edit to a listed env file the inputs hold, which the workspace's narrowed inputs leave out, changes its fingerprint", async () => {
    const outcome = await inTempDir(async (root) => {
      const entry = envWorkspace(APP, [VITE_PREFIX], root);
      const printOf = async (text: string): Promise<string | undefined> => {
        writeFiles(root, { [APP_ENV]: text });
        const read = await readEntryDigest(join(root, APP_ENV));
        if (read.kind !== "input") return undefined;
        return printed(
          workspaceFingerprint(
            new ProjectInputs(root, new Map([[APP_ENV, read.read.digest]])),
            entry,
            handBuiltReads(root),
            new ProjectInputs(root, new Map()),
          ),
        );
      };
      const before = await printOf("VITE_A=1\n");
      const after = await printOf("VITE_A=2\n");
      return {
        computed: before !== undefined && after !== undefined,
        moved: before !== after,
      };
    });
    expect(outcome).toStrictEqual({ computed: true, moved: true });
  });

  it("D3422: a change to a declared variable no reference names changes the fingerprint of a workspace whose env file holds a stray $", async () => {
    const outcome = await inTempDir((root) => {
      writeFiles(root, { [APP_ENV]: "DB_PASS=pa$$word\n" });
      const project = new ProjectInputs(root, new Map());
      const entry = envWorkspace(APP, [VITE_PREFIX], root);
      return movedByValue((value) =>
        printed(workspaceFingerprint(project, entry, readsWith(root, value))),
      );
    });
    expect(outcome).toStrictEqual({ computed: true, moved: true });
  });
});
