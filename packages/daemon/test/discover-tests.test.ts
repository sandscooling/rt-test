import { mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverTests,
  type DiscoveredTest,
  type TestDiscovery,
  type WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type {
  RecordedModule,
  RecordedTest,
  TestRunState,
} from "../src/vitest/run-states.js";
import {
  runWorkspace,
  type WorkspaceRun,
} from "../src/vitest/run-workspace.js";
import {
  copyFixture,
  fakeVitest,
  inTempDir,
  linkVitest,
  type VitestInstall,
} from "./harness.js";

const DISCOVERY_TIMEOUT_MS = 60_000;
const MARKER_PREFIX = "ran-";
const FIXTURE_ENV_KEYS = ["RT_FIXTURE_DEFINE", "RT_FIXTURE_ENV"] as const;

interface ConsumerRun {
  readonly discovery: TestDiscovery | { thrown: string };
  readonly markers: readonly string[];
  readonly exitCode: { before: unknown; after: unknown };
  readonly fixtureEnv: readonly (string | undefined)[];
}

const consumerRuns = new Map<VitestInstall, Promise<ConsumerRun>>();

/** Discovers the consumer fixture once per Vitest install, since each discovery loads every workspace. */
function discoverConsumer(install: VitestInstall): Promise<ConsumerRun> {
  const cached = consumerRuns.get(install);
  if (cached !== undefined) return cached;
  const run = inTempDir(async (dir) => {
    copyFixture("consumer", dir);
    linkVitest(dir, install);
    fakeVitest(join(dir, "packages/old"), "3.2.4");
    const exitCodeBefore = process.exitCode;
    const discovery = await discoverTests(dir).catch((error: unknown) => ({
      thrown: String(error),
    }));
    return {
      discovery,
      markers: readdirSync(join(dir, "unit")).filter((name) =>
        name.startsWith(MARKER_PREFIX),
      ),
      exitCode: { before: exitCodeBefore, after: process.exitCode },
      fixtureEnv: FIXTURE_ENV_KEYS.map((key) => process.env[key]),
    };
  });
  consumerRuns.set(install, run);
  return run;
}

function inConsumerCopy<T>(
  fixture: string,
  install: VitestInstall,
  body: (root: string) => Promise<T>,
  throughLink = false,
): Promise<T> {
  return inTempDir(async (dir) => {
    const real = join(dir, "real");
    mkdirSync(real);
    copyFixture(fixture, real);
    linkVitest(real, install);
    const root = throughLink ? join(dir, "link") : real;
    if (throughLink) symlinkSync(real, root, "junction");
    return body(root);
  });
}

function settledDiscovery(
  root: string,
): Promise<TestDiscovery | { thrown: string }> {
  return discoverTests(root).catch((error: unknown) => ({
    thrown: String(error),
  }));
}

function discoverFixture(
  fixture: string,
  install: VitestInstall,
  throughLink = false,
): Promise<TestDiscovery | { thrown: string }> {
  return inConsumerCopy(fixture, install, settledDiscovery, throughLink);
}

function restoreEnv(
  keys: readonly string[],
  values: readonly (string | undefined)[],
): void {
  keys.forEach((key, index) => {
    const value = values[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}

/** Polls until `ready` holds or `settled` resolves, whichever comes first. */
async function waitUntil(
  ready: () => boolean,
  settled: Promise<unknown>,
): Promise<void> {
  let done = false;
  void settled.then(() => {
    done = true;
  });
  while (!ready() && !done) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function discoveredField<K extends "unhandledErrors" | "failedModules">(
  discovery: ConsumerRun["discovery"],
  key: K,
): unknown {
  const root = workspace(discovery, ".");
  return root !== undefined && "status" in root && root.status === "discovered"
    ? root[key]
    : root;
}

function workspace(
  discovery: ConsumerRun["discovery"],
  path: string,
): WorkspaceDiscovery | ConsumerRun["discovery"] | undefined {
  if (!("workspaces" in discovery)) return discovery;
  return discovery.workspaces.find((entry) => entry.workspace.path === path);
}

function testsOf(
  discovery: ConsumerRun["discovery"],
  path: string,
  modulePath?: string,
): readonly DiscoveredTest[] {
  const entry = workspace(discovery, path);
  if (entry === undefined || !("status" in entry)) return [];
  if (entry.status !== "discovered") return [];
  return entry.tests.filter(
    (test) =>
      modulePath === undefined || test.identity.modulePath === modulePath,
  );
}

function namePaths(tests: readonly DiscoveredTest[]): string[][] {
  return tests.map((test) => [...test.identity.namePath]);
}

function lastName(test: DiscoveredTest): string | undefined {
  return test.identity.namePath.at(-1);
}

function sortedIdentities(
  tests: readonly Pick<DiscoveredTest, "identity">[],
): string[] {
  return tests.map((test) => JSON.stringify(test.identity)).sort();
}

const MODULE_A_NAME_PATHS = [
  ["suite", "plain"],
  ["suite", "skipped"],
  ["suite", "todo"],
  ["suite", "arm 1"],
  ["suite", "arm 1"],
  ["suite", "arm 2"],
  ["suite", "for 3"],
  ["suite", "for 4"],
  ["each x", "inner"],
  ["each y", "inner"],
  ["dfor z", "inner"],
  ["group", "same"],
  ["group", "same"],
  ["group", "same"],
];

describe("discovering tests on Vitest 5", () => {
  it(
    "D1050: every test is listed, each parameterized arm as its own test",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(namePaths(testsOf(discovery, ".", "unit/a.test.mjs"))).toEqual(
        MODULE_A_NAME_PATHS,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1052: skipped and todo tests are listed with their mode",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(
        testsOf(discovery, ".", "unit/a.test.mjs")
          .filter((test) => test.mode !== "run")
          .map((test) => [lastName(test), test.mode]),
      ).toEqual([
        ["skipped", "skip"],
        ["todo", "todo"],
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1054: discovery runs no test body or hook",
    async () => {
      expect((await discoverConsumer("vitest")).markers).toEqual([]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1056: a typecheck module is reported as not discovered and none of its tests is listed",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      const root = workspace(discovery, ".");
      expect({
        typecheckModules:
          root !== undefined && "status" in root && root.status === "discovered"
            ? root.typecheckModules
            : root,
        listed: testsOf(discovery, ".", "types/t.test-d.mts").length,
      }).toEqual({
        typecheckModules: [
          { projectName: "types", modulePath: "types/t.test-d.mts" },
        ],
        listed: 0,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1057: a module that fails to load is reported with its error and lists no tests",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      const root = workspace(discovery, ".");
      expect({
        failedModules:
          root !== undefined && "status" in root && root.status === "discovered"
            ? root.failedModules
            : root,
        listed: testsOf(discovery, ".", "unit/b.test.mjs").length,
      }).toEqual({
        failedModules: [
          {
            projectName: "unit",
            modulePath: "unit/b.test.mjs",
            errors: ["collection boom"],
          },
        ],
        listed: 0,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1059: a workspace whose configuration fails to load is reported failed with its error",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(workspace(discovery, "packages/cfgfail")).toMatchObject({
        status: "failed",
        error: "config boom",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1060: a workspace that fails or is unsupported does not stop the others",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(
        "workspaces" in discovery
          ? Object.fromEntries(
              discovery.workspaces.map((entry) => [
                entry.workspace.path,
                entry.status,
              ]),
            )
          : discovery,
      ).toEqual({
        ".": "discovered",
        "packages/app": "discovered",
        "packages/browser": "failed",
        "packages/cfgfail": "failed",
        "packages/envdef": "discovered",
        "packages/lib": "discovered",
        "packages/old": "unsupported",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1061: a workspace on an unsupported Vitest is reported with the version found and the supported range",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(workspace(discovery, "packages/old")).toMatchObject({
        status: "unsupported",
        vitest: { version: "3.2.4", supportedRange: "4.1.x || 5.x" },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1064: a browser project with no provider fails its workspace with the provider error",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(workspace(discovery, "packages/browser")).toMatchObject({
        status: "failed",
        error: expect.stringContaining(
          "Browser Mode was enabled, but provider was not specified",
        ),
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1065: discovery leaves the host's exit code as it found it",
    async () => {
      const { exitCode } = await discoverConsumer("vitest");
      expect(exitCode.after).toBe(exitCode.before);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1066: discovery removes the environment values a workspace's configuration wrote",
    async () => {
      expect((await discoverConsumer("vitest")).fixtureEnv).toEqual([
        undefined,
        undefined,
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1068: two copies of a consumer at different paths give the same identities",
    async () => {
      const [first, second] = [
        await discoverFixture("single", "vitest"),
        await discoverFixture("single", "vitest"),
      ];
      expect(sortedIdentities(testsOf(first, "."))).toEqual(
        sortedIdentities(testsOf(second, ".")),
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1070: a test's name path holds each enclosing suite's name",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(
        namePaths(
          testsOf(discovery, ".", "unit/a.test.mjs").filter(
            (test) => lastName(test) === "inner",
          ),
        ),
      ).toEqual([
        ["each x", "inner"],
        ["each y", "inner"],
        ["dfor z", "inner"],
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1071: the same module and test name in two workspaces get distinct identities",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(
        new Set(
          sortedIdentities([
            ...testsOf(discovery, "packages/lib"),
            ...testsOf(discovery, "packages/app"),
          ]),
        ).size,
      ).toBe(2);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1072: the same module and test name in two projects get distinct identities",
    async () => {
      const { discovery } = await discoverConsumer("vitest");
      expect(
        new Set(
          sortedIdentities(testsOf(discovery, ".", "unit/shared.test.mjs")),
        ).size,
      ).toBe(2);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("discovering tests on Vitest 4.1", () => {
  it(
    "D1051: every test is listed, each parameterized arm as its own test",
    async () => {
      const { discovery } = await discoverConsumer("vitest-4");
      expect(namePaths(testsOf(discovery, ".", "unit/a.test.mjs"))).toEqual(
        MODULE_A_NAME_PATHS,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1053: skipped and todo tests are listed with their mode",
    async () => {
      const { discovery } = await discoverConsumer("vitest-4");
      expect(
        testsOf(discovery, ".", "unit/a.test.mjs")
          .filter((test) => test.mode !== "run")
          .map((test) => [lastName(test), test.mode]),
      ).toEqual([
        ["skipped", "skip"],
        ["todo", "todo"],
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1055: discovery runs no test body or hook",
    async () => {
      expect((await discoverConsumer("vitest-4")).markers).toEqual([]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1058: a module that fails to load keeps its error text",
    async () => {
      const { discovery } = await discoverConsumer("vitest-4");
      const root = workspace(discovery, ".");
      expect(
        root !== undefined && "status" in root && root.status === "discovered"
          ? root.failedModules.map((failed) => failed.errors)
          : root,
      ).toEqual([["collection boom"]]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1062: a browser-mode project is reported unsupported by name",
    async () => {
      const { discovery } = await discoverConsumer("vitest-4");
      const browser = workspace(discovery, "packages/browser");
      expect(
        browser !== undefined &&
          "status" in browser &&
          browser.status === "discovered"
          ? browser.unsupportedProjects.map((project) => project.projectName)
          : browser,
      ).toEqual(["br (chromium)"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1063: a browser-mode project's modules are never collected while its sibling project's are",
    async () => {
      const { discovery } = await discoverConsumer("vitest-4");
      const browser = workspace(discovery, "packages/browser");
      expect(
        browser !== undefined &&
          "status" in browser &&
          browser.status === "discovered"
          ? {
              tests: namePaths(browser.tests),
              unhandledErrors: browser.unhandledErrors,
            }
          : browser,
      ).toEqual({ tests: [["node test"]], unhandledErrors: [] });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1069: a consumer root reached through a link gives module paths relative to the workspace",
    async () => {
      expect(
        testsOf(await discoverFixture("single", "vitest-4", true), ".").map(
          (test) => test.identity.modulePath,
        ),
      ).toEqual(["a.test.mjs"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("test identity across Vitest versions", () => {
  it(
    "D1067: one test gets the same identity on Vitest 4.1 and 5",
    async () => {
      const [v4, v5] = [
        await discoverConsumer("vitest-4"),
        await discoverConsumer("vitest"),
      ];
      expect(sortedIdentities(testsOf(v4.discovery, "."))).toEqual(
        sortedIdentities(testsOf(v5.discovery, ".")),
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

const ENV_FIXTURE = "consumer/packages/envdef";
const VITEST_PROCESS_EVENTS = [
  "SIGINT",
  "SIGTERM",
  "exit",
  "unhandledRejection",
] as const;

function processListenerCounts(): number[] {
  return VITEST_PROCESS_EVENTS.map((event) => process.listenerCount(event));
}

describe("discovery's effect on the host process", () => {
  it(
    "D1073: a host environment value a workspace's configuration overwrote reads the host value after discovery",
    async () => {
      const saved = FIXTURE_ENV_KEYS.map((key) => process.env[key]);
      try {
        for (const key of FIXTURE_ENV_KEYS) process.env[key] = "host";
        await discoverFixture(ENV_FIXTURE, "vitest");
        expect(FIXTURE_ENV_KEYS.map((key) => process.env[key])).toEqual([
          "host",
          "host",
        ]);
      } finally {
        restoreEnv(FIXTURE_ENV_KEYS, saved);
      }
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1074: discovery closes each Vitest instance it creates, releasing its process handlers",
    async () => {
      const before = processListenerCounts();
      await discoverFixture("single", "vitest");
      expect(processListenerCounts()).toEqual(before);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1077: collection sees NODE_ENV=test when the host sets none, as a Vitest run does",
    async () => {
      const saved = process.env["NODE_ENV"];
      try {
        delete process.env["NODE_ENV"];
        const discovery = await discoverFixture("nodeenv", "vitest");
        expect(namePaths(testsOf(discovery, "."))).toEqual([
          ["always"],
          ["only under test"],
        ]);
      } finally {
        restoreEnv(["NODE_ENV"], [saved]);
      }
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1080: overlapping discoveries leave no workspace's environment values in the host",
    async () => {
      const leftover = await inConsumerCopy(ENV_FIXTURE, "vitest", (envRoot) =>
        inConsumerCopy("consumer", "vitest", async (otherRoot) => {
          const first = settledDiscovery(envRoot);
          await waitUntil(
            () =>
              FIXTURE_ENV_KEYS.some((key) => process.env[key] !== undefined),
            first,
          );
          await Promise.all([first, settledDiscovery(otherRoot)]);
          return FIXTURE_ENV_KEYS.map((key) => process.env[key]);
        }),
      );
      expect(leftover).toEqual([undefined, undefined]);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("errors and lost modules during collection", () => {
  it(
    "D1075: an unhandled error raised while collecting is reported on its workspace",
    async () => {
      expect(
        discoveredField(
          await discoverFixture("stray", "vitest"),
          "unhandledErrors",
        ),
      ).toEqual(
        expect.arrayContaining([expect.stringContaining("stray boom")]),
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1076: a module whose worker crashed before reporting it is listed as a failed module",
    async () => {
      expect(
        discoveredField(
          await discoverFixture("crash", "vitest"),
          "failedModules",
        ),
      ).toEqual([
        {
          projectName: "",
          modulePath: "crash.test.mjs",
          errors: [
            "Vitest returned no collection result for this module; see the workspace's unhandled errors",
          ],
        },
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1083: on Vitest 4.1, a module whose worker crashed before reporting it is listed as a failed module",
    async () => {
      expect(
        discoveredField(
          await discoverFixture("crash", "vitest-4"),
          "failedModules",
        ),
      ).toEqual([
        {
          projectName: "",
          modulePath: "crash.test.mjs",
          errors: [
            "Vitest returned no collection result for this module; see the workspace's unhandled errors",
          ],
        },
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

type RunResult = WorkspaceRun | { thrown: string };
/** A promise returned for `global-setup` holds the run-unqueued fixture's run until it settles. */
type RunHook = (event: string) => Promise<void> | undefined;

interface FixtureRun {
  readonly run: RunResult;
  readonly exitCode: { before: unknown; after: unknown };
}

/** The run-interrupt fixture's config reports its run events to this global. */
const RUN_HOOK = Symbol.for("rt-test.fixture.run-hook");
const MID_RUN_EVENT = "ready:running at abort";
const NOTHING_RAN_WORKSPACES = [
  "empty",
  "setup-fail",
  "no-tests",
  "all-skipped",
  "blocked",
  "only-failed",
] as const;

const fixtureRuns = new Map<string, Promise<FixtureRun>>();

function runHooks(): Record<symbol, RunHook | undefined> {
  return globalThis as unknown as Record<symbol, RunHook | undefined>;
}

function settledRun(
  directory: string,
  signal: AbortSignal = new AbortController().signal,
  path = ".",
): Promise<RunResult> {
  return runWorkspace({ path, directory }, signal).catch((error: unknown) => ({
    thrown: String(error),
  }));
}

/** Runs a fixture once per install and abort point, aborting when its run hook reports `abortOn`. */
function runFixture(
  fixture: string,
  install: VitestInstall,
  abortOn?: string,
): Promise<FixtureRun> {
  const key = JSON.stringify([fixture, install, abortOn]);
  const cached = fixtureRuns.get(key);
  if (cached !== undefined) return cached;
  const started = inConsumerCopy(fixture, install, async (root) => {
    const controller = new AbortController();
    runHooks()[RUN_HOOK] = (event) => {
      if (event === abortOn) controller.abort();
    };
    try {
      const before = process.exitCode;
      const run = await settledRun(root, controller.signal);
      return { run, exitCode: { before, after: process.exitCode } };
    } finally {
      delete runHooks()[RUN_HOOK];
    }
  });
  fixtureRuns.set(key, started);
  return started;
}

async function runOf(
  fixture: string,
  install: VitestInstall,
  abortOn?: string,
): Promise<RunResult> {
  return (await runFixture(fixture, install, abortOn)).run;
}

let nothingRanRuns: Promise<Record<string, RunResult>> | undefined;

function runNothingRanWorkspaces(): Promise<Record<string, RunResult>> {
  nothingRanRuns ??= inConsumerCopy("run-nothing", "vitest", async (root) => {
    const runs: Record<string, RunResult> = {};
    for (const name of NOTHING_RAN_WORKSPACES) {
      runs[name] = await settledRun(join(root, name));
    }
    return runs;
  });
  return nothingRanRuns;
}

async function nothingRanOf(
  name: (typeof NOTHING_RAN_WORKSPACES)[number],
): Promise<unknown> {
  const run = (await runNothingRanWorkspaces())[name];
  const recorded = run === undefined ? undefined : ranRun(run);
  return recorded === undefined ? run : { nothingRan: recorded.nothingRan };
}

function runConsumerWorkspace(
  install: VitestInstall,
  path: string,
): Promise<RunResult> {
  return inConsumerCopy("consumer", install, (root) => {
    fakeVitest(join(root, "packages/old"), "3.2.4");
    return settledRun(join(root, path), undefined, path);
  });
}

function ranRun(
  run: RunResult,
): Extract<WorkspaceRun, { status: "ran" }> | undefined {
  return "status" in run && run.status === "ran" ? run : undefined;
}

function finished(outcome: string, errors: readonly unknown[] = []): unknown {
  return { execution: "finished", outcome, errors };
}

const INTERRUPTED = { execution: "interrupted" };

function runState(test: RecordedTest): TestRunState {
  return test.execution === "finished"
    ? { execution: test.execution, outcome: test.outcome, errors: test.errors }
    : { execution: test.execution };
}

function recordedTests(run: RunResult): readonly RecordedTest[] {
  return (ranRun(run)?.modules ?? []).flatMap((module) =>
    module.state === "ran" ? module.tests : [],
  );
}

/** A ran module as its tests' states by name; any other module as its state. */
function moduleSummary(module: RecordedModule): unknown {
  return module.state === "ran"
    ? Object.fromEntries(
        module.tests.map((test) => [
          test.identity.namePath.at(-1),
          runState(test),
        ]),
      )
    : module.state;
}

function runSummary(run: RunResult): unknown {
  const recorded = ranRun(run);
  if (recorded === undefined) return run;
  return {
    execution: recorded.execution,
    modules: Object.fromEntries(
      recorded.modules.map((module) => [
        module.modulePath,
        moduleSummary(module),
      ]),
    ),
  };
}

function recordedModule(run: RunResult, modulePath: string): unknown {
  const module = ranRun(run)?.modules.find(
    (entry) => entry.modulePath === modulePath,
  );
  return module ?? run;
}

function stateOf(run: RunResult, modulePath: string, name: string): unknown {
  const test = recordedTests(run).find(
    (entry) =>
      entry.identity.modulePath === modulePath &&
      entry.identity.namePath.at(-1) === name,
  );
  return test === undefined ? run : runState(test);
}

describe("recording a run's test outcomes", () => {
  it(
    "D1160: a run records each test under the identity discovery gives it",
    async () => {
      const run = await runOf("run", "vitest");
      const discovery = await discoverFixture("run", "vitest");
      expect(sortedIdentities(recordedTests(run))).toEqual(
        sortedIdentities(testsOf(discovery, ".")),
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1161: a failed test and a timed-out test are recorded failed with their error text",
    async () => {
      const run = await runOf("run", "vitest");
      expect([
        stateOf(run, "outcomes.test.mjs", "fails"),
        stateOf(run, "outcomes.test.mjs", "times out"),
      ]).toEqual([
        finished("failed", ["fail boom"]),
        finished("failed", [
          expect.stringContaining("Test timed out in 50ms."),
        ]),
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1162: on Vitest 4.1, passing, declared-skip, todo, self-skipped and expected-failure tests keep their outcomes",
    async () => {
      const run = await runOf("run", "vitest-4");
      expect(
        [
          "passes",
          "declared skip",
          "todo",
          "skips itself",
          "expected failure",
          "inside",
        ].map((name) => stateOf(run, "outcomes.test.mjs", name)),
      ).toEqual([
        finished("passed"),
        finished("skipped"),
        finished("skipped"),
        finished("skipped"),
        finished("passed"),
        finished("skipped"),
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1163: on Vitest 4.1, a module that throws at load is recorded failed with its error and no tests",
    async () => {
      expect(
        recordedModule(await runOf("run", "vitest-4"), "load.test.mjs"),
      ).toEqual({
        projectName: "run",
        modulePath: "load.test.mjs",
        state: "failed",
        errors: ["load boom"],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1164: a test blocked by its suite's failing beforeAll is recorded as an error with the hook's error",
    async () => {
      expect(
        stateOf(await runOf("run", "vitest"), "hooks.test.mjs", "blocked"),
      ).toEqual(finished("error", ["beforeAll boom"]));
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1165: on Vitest 4.1, a test in a nested suite under a failing beforeAll takes the enclosing suite's error",
    async () => {
      expect(
        stateOf(
          await runOf("run", "vitest-4"),
          "hooks.test.mjs",
          "blocked deeper",
        ),
      ).toEqual(finished("error", ["beforeAll boom"]));
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1166: a test blocked by a failing module-level beforeAll is recorded as an error with the module's error",
    async () => {
      expect(
        stateOf(
          await runOf("run", "vitest"),
          "module-hook.test.mjs",
          "blocked by module",
        ),
      ).toEqual(finished("error", ["module beforeAll boom"]));
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1167: on Vitest 4.1, suite hook errors sit on the module while a test under a failing afterAll stays passed",
    async () => {
      const run = await runOf("run", "vitest-4");
      const module = ranRun(run)?.modules.find(
        (entry) => entry.modulePath === "hooks.test.mjs",
      );
      expect({
        errors:
          module !== undefined && "errors" in module
            ? [...module.errors].sort()
            : run,
        ran: stateOf(run, "hooks.test.mjs", "ran"),
      }).toEqual({
        errors: ["afterAll boom", "beforeAll boom"],
        ran: finished("passed"),
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1168: a test that skips itself in a suite whose afterAll fails is recorded skipped, not as an error",
    async () => {
      expect(
        stateOf(await runOf("run", "vitest"), "hooks.test.mjs", "skips itself"),
      ).toEqual(finished("skipped"));
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1169: on Vitest 4.1, a failing module-level beforeAll's error is recorded on its module",
    async () => {
      expect(
        recordedModule(await runOf("run", "vitest-4"), "module-hook.test.mjs"),
      ).toMatchObject({ state: "ran", errors: ["module beforeAll boom"] });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1170: an unhandled error is recorded on the run and leaves its module's tests passed",
    async () => {
      const run = await runOf("run", "vitest");
      expect({
        unhandledErrors: ranRun(run)?.unhandledErrors ?? run,
        tests: [
          stateOf(run, "unhandled.test.mjs", "throws later"),
          stateOf(run, "unhandled.test.mjs", "sibling"),
        ],
      }).toEqual({
        unhandledErrors: [expect.stringContaining("unhandled boom")],
        tests: [finished("passed"), finished("passed")],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1171: a run leaves the host's exit code as it found it",
    async () => {
      const { exitCode } = await runFixture("run", "vitest");
      expect(exitCode.after).toBe(exitCode.before);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1172: a run that executed tests records no reason that nothing ran",
    async () => {
      const run = await runOf("run", "vitest");
      const recorded = ranRun(run);
      expect(
        recorded === undefined ? run : { nothingRan: recorded.nothingRan },
      ).toEqual({ nothingRan: undefined });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("recording worker crashes", () => {
  it(
    "D1173: a module whose worker crashed mid-run is recorded crashed with no test outcome, and the run stays completed",
    async () => {
      expect(runSummary(await runOf("run-crash", "vitest"))).toEqual({
        execution: "completed",
        modules: {
          "crashes.test.mjs": "crashed",
          "healthy.test.mjs": { healthy: finished("passed") },
        },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1174: on Vitest 4.1, a module whose worker crashed at load is recorded crashed in a completed run",
    async () => {
      expect(runSummary(await runOf("crash", "vitest-4"))).toEqual({
        execution: "completed",
        modules: {
          "crash.test.mjs": "crashed",
          "ok.test.mjs": { survivor: finished("passed") },
        },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1207: a module whose worker crashed at load, left as Vitest's placeholder, is recorded crashed rather than as a module with no tests",
    async () => {
      expect(runSummary(await runOf("crash", "vitest"))).toEqual({
        execution: "completed",
        modules: {
          "crash.test.mjs": "crashed",
          "ok.test.mjs": { survivor: finished("passed") },
        },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

/** The run-interrupt fixture's record when the cancel lands before the first module runs any test. */
const CANCELLED_BEFORE_ANY_TEST = {
  execution: "interrupted",
  modules: {
    "a.test.mjs": {
      "declared skip": finished("skipped"),
      "declared todo": finished("skipped"),
      "skips itself": INTERRUPTED,
      "blocked test": INTERRUPTED,
      "passes first": INTERRUPTED,
      "running at abort": INTERRUPTED,
      "never finishes": INTERRUPTED,
    },
    "b.test.mjs": "not-run",
  },
};

describe("recording an interrupted run", () => {
  it(
    "D1175: an abort mid-module keeps finished outcomes, marks unfinished tests interrupted and unstarted modules not run",
    async () => {
      expect(
        runSummary(await runOf("run-interrupt", "vitest", MID_RUN_EVENT)),
      ).toEqual({
        execution: "interrupted",
        modules: {
          "a.test.mjs": {
            "declared skip": finished("skipped"),
            "declared todo": finished("skipped"),
            "skips itself": INTERRUPTED,
            "blocked test": INTERRUPTED,
            "passes first": finished("passed"),
            "running at abort": INTERRUPTED,
            "never finishes": INTERRUPTED,
          },
          "b.test.mjs": "not-run",
        },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1176: a declared skip stays skipped in an interrupted run",
    async () => {
      expect(
        stateOf(
          await runOf("run-interrupt", "vitest", MID_RUN_EVENT),
          "a.test.mjs",
          "declared skip",
        ),
      ).toEqual(finished("skipped"));
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1199: a declared todo stays skipped in an interrupted run",
    async () => {
      expect(
        stateOf(
          await runOf("run-interrupt", "vitest", MID_RUN_EVENT),
          "a.test.mjs",
          "declared todo",
        ),
      ).toEqual(finished("skipped"));
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1177: on Vitest 4.1, a test that skipped itself before the abort is recorded interrupted",
    async () => {
      expect(
        stateOf(
          await runOf("run-interrupt", "vitest-4", MID_RUN_EVENT),
          "a.test.mjs",
          "skips itself",
        ),
      ).toEqual(INTERRUPTED);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1178: on Vitest 4.1, a test blocked by a failing beforeAll before the abort is recorded interrupted",
    async () => {
      expect(
        stateOf(
          await runOf("run-interrupt", "vitest-4", MID_RUN_EVENT),
          "a.test.mjs",
          "blocked test",
        ),
      ).toEqual(INTERRUPTED);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1179: a module the interrupted run never started is recorded not run",
    async () => {
      expect(
        recordedModule(
          await runOf("run-interrupt", "vitest", MID_RUN_EVENT),
          "b.test.mjs",
        ),
      ).toEqual({
        projectName: "",
        modulePath: "b.test.mjs",
        state: "not-run",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1180: an abort as Vitest starts the run, before it resets its cancel state, still interrupts the run",
    async () => {
      const run = await runOf("run-interrupt", "vitest", "run-start");
      expect(ranRun(run)?.execution ?? run).toBe("interrupted");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1181: tests an abort at the run's start left unfinished are recorded interrupted",
    async () => {
      expect(
        runSummary(await runOf("run-interrupt", "vitest", "run-start")),
      ).toEqual(CANCELLED_BEFORE_ANY_TEST);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1182: a run interrupted before any test finished records that reason",
    async () => {
      const run = await runOf("run-interrupt", "vitest", "run-start");
      expect(ranRun(run)?.nothingRan ?? run).toBe(
        "interrupted-before-any-test-finished",
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1183: on Vitest 4.1, an abort during global setup, before any module is queued, cancels the run before any test runs",
    async () => {
      expect(
        runSummary(await runOf("run-interrupt", "vitest-4", "global-setup")),
      ).toEqual(CANCELLED_BEFORE_ANY_TEST);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1206: a run aborted while its workspace loads records that it was interrupted before any test finished",
    async () => {
      const run = await runOf("run-interrupt", "vitest", "configure");
      expect(ranRun(run)?.nothingRan ?? run).toBe(
        "interrupted-before-any-test-finished",
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1208: an abort in a run whose every module failed before Vitest queued it still interrupts the run",
    async () => {
      const run = await runOf("run-unqueued", "vitest", "global-setup");
      expect(ranRun(run)?.execution ?? run).toBe("interrupted");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1184: an abort while the workspace loads starts no module",
    async () => {
      expect(
        runSummary(await runOf("run-interrupt", "vitest", "configure")),
      ).toEqual({
        execution: "interrupted",
        modules: { "a.test.mjs": "not-run", "b.test.mjs": "not-run" },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1185: on Vitest 4.1, a run aborted while it waits behind a discovery never loads the workspace",
    async () => {
      const run = await inConsumerCopy(
        "run-interrupt",
        "vitest-4",
        async (root) => {
          const discovery = settledDiscovery(root);
          const controller = new AbortController();
          const queued = settledRun(root, controller.signal);
          controller.abort();
          await discovery;
          return queued;
        },
      );
      expect(run).toMatchObject({ status: "interrupted-before-load" });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1186: an abort that arrives after Vitest ended the run leaves it completed",
    async () => {
      const run = await runOf("run-interrupt", "vitest", "run-end");
      expect(ranRun(run)?.execution ?? run).toBe("completed");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1187: on Vitest 4.1, a run Vitest stops early under the consumer's bail is recorded interrupted",
    async () => {
      const run = await runOf("run-bail", "vitest-4");
      expect(ranRun(run)?.execution ?? run).toBe("interrupted");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1188: overlapping runs leave no workspace's environment values in the host",
    async () => {
      const leftover = await inConsumerCopy(ENV_FIXTURE, "vitest", (envRoot) =>
        inConsumerCopy("run-unqueued", "vitest", async (gatedRoot) => {
          let openGate = (): void => undefined;
          const gate = new Promise<void>((resolve) => {
            openGate = resolve;
          });
          runHooks()[RUN_HOOK] = (event) =>
            event === "global-setup" ? gate : undefined;
          try {
            const first = settledRun(envRoot);
            await waitUntil(
              () =>
                FIXTURE_ENV_KEYS.some((key) => process.env[key] !== undefined),
              first,
            );
            const second = settledRun(gatedRoot);
            await first;
            openGate();
            await second;
            return FIXTURE_ENV_KEYS.map((key) => process.env[key]);
          } finally {
            openGate();
            delete runHooks()[RUN_HOOK];
          }
        }),
      );
      expect(leftover).toEqual([undefined, undefined]);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("recording why nothing ran", () => {
  it(
    "D1189: a workspace with no test module records that it had none",
    async () => {
      expect(await nothingRanOf("empty")).toEqual({ nothingRan: "no-module" });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1190: a run whose every module failed records that no module ran",
    async () => {
      expect(await nothingRanOf("setup-fail")).toEqual({
        nothingRan: "no-module-ran",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1191: a run whose modules declared no test records that none was declared",
    async () => {
      expect(await nothingRanOf("no-tests")).toEqual({
        nothingRan: "no-test-declared",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1192: a run whose every test was skipped records that",
    async () => {
      expect(await nothingRanOf("all-skipped")).toEqual({
        nothingRan: "every-test-skipped",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1193: a run whose every test a failing hook blocked records that",
    async () => {
      expect(await nothingRanOf("blocked")).toEqual({
        nothingRan: "tests-blocked-by-hook",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1194: a run whose only executed test failed is a run that ran",
    async () => {
      expect(await nothingRanOf("only-failed")).toEqual({
        nothingRan: undefined,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("runs over workspaces discovery cannot run", () => {
  it(
    "D1195: a workspace on an unsupported Vitest is recorded unsupported with the version found and the supported range",
    async () => {
      expect(
        await runConsumerWorkspace("vitest", "packages/old"),
      ).toMatchObject({
        status: "unsupported",
        vitest: { version: "3.2.4", supportedRange: "4.1.x || 5.x" },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1196: a workspace whose configuration fails to load is recorded failed with its error",
    async () => {
      expect(
        await runConsumerWorkspace("vitest", "packages/cfgfail"),
      ).toMatchObject({ status: "failed", error: "config boom" });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1197: a typecheck module is recorded as not discovered and never run",
    async () => {
      const run = await runConsumerWorkspace("vitest", ".");
      const recorded = ranRun(run);
      expect(
        recorded === undefined
          ? run
          : {
              typecheckModules: recorded.typecheckModules,
              recordedTypecheck: recorded.modules.filter(
                (module) => module.projectName === "types",
              ).length,
            },
      ).toEqual({
        typecheckModules: [
          { projectName: "types", modulePath: "types/t.test-d.mts" },
        ],
        recordedTypecheck: 0,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1198: on Vitest 4.1, a browser-mode project is recorded unsupported by name while its sibling project runs",
    async () => {
      const run = await runConsumerWorkspace("vitest-4", "packages/browser");
      const recorded = ranRun(run);
      expect(
        recorded === undefined
          ? run
          : {
              unsupported: recorded.unsupportedProjects.map(
                (project) => project.projectName,
              ),
              modules: recorded.modules.map((module) => [
                module.projectName,
                module.state,
              ]),
            },
      ).toEqual({
        unsupported: ["br (chromium)"],
        modules: [["node", "ran"]],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});
