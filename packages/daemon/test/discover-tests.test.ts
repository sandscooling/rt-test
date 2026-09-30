import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { crawledLinks } from "../src/inputs/crawl-links.js";
import { workspaceEnvFiles } from "../src/inputs/env-files.js";
import {
  discoveryFingerprint,
  ProjectInputs,
  workspaceFingerprint,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import { MAX_NAMED_CHANGES } from "../src/inputs/input-jobs.js";
import { protection } from "../src/inputs/protection.js";
import {
  discoverTests,
  type DiscoveredTest,
  type TestDiscovery,
  type WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import type { RecordedTest } from "../src/vitest/run-states.js";
import { runWorkspace } from "../src/vitest/run-workspace.js";
import {
  isNotKnown,
  type EnvSource,
  type EnvSourcesNotKnown,
  type ProjectSelectionFacts,
  type ReportedAlias,
  type SelectionFacts,
} from "../src/vitest/selection-facts.js";
import { queueSessionJob } from "../src/vitest/workspace-session.js";
import {
  confirmEvery,
  copyFixture,
  fakeVitest,
  finished,
  inConsumerCopy,
  inTempDir,
  INTERRUPTED,
  linkVitest,
  ranRun,
  REPO,
  RUN_HOOK,
  runHooks,
  runState,
  runSummary,
  settle,
  settledRun,
  slashed,
  waitUntil,
  withPool,
  type Pool,
  type RunResult,
  type VitestInstall,
} from "./harness.js";

/** Walks as it does, unless a test acts at the moment discovery starts the walk. */
vi.mock("../src/inputs/crawl-links.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/inputs/crawl-links.js")>();
  return {
    ...actual,
    crawledLinks: vi.fn<typeof actual.crawledLinks>(actual.crawledLinks),
  };
});

const DISCOVERY_TIMEOUT_MS = 60_000;
const MARKER_PREFIX = "ran-";
const FIXTURE_ENV_KEYS = ["RT_FIXTURE_DEFINE", "RT_FIXTURE_ENV"] as const;
const NEVER_ABORTED = new AbortController().signal;

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
    const discovery = await discoverTests(
      confirmEvery(dir),
      NEVER_ABORTED,
    ).catch((error: unknown) => ({ thrown: String(error) }));
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

function settledDiscovery(
  root: string,
  signal: AbortSignal = NEVER_ABORTED,
): Promise<TestDiscovery | { thrown: string }> {
  return discoverTests(confirmEvery(root), signal).catch((error: unknown) => ({
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
        inConsumerCopy("run-interrupt", "vitest", async (gatedRoot) => {
          let openGate = (): void => undefined;
          const gate = new Promise<void>((resolve) => {
            openGate = resolve;
          });
          runHooks()[RUN_HOOK] = (event) =>
            event === "configure" ? gate : undefined;
          try {
            const first = settledDiscovery(envRoot);
            await waitUntil(
              () =>
                FIXTURE_ENV_KEYS.some((key) => process.env[key] !== undefined),
              first,
            );
            const second = settledDiscovery(gatedRoot);
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

interface FixtureRun {
  readonly run: RunResult;
  readonly exitCode: { before: unknown; after: unknown };
}

/** The running test's annotation, which Vitest reports straight from the worker rather than in a throttled task update. */
const MID_RUN_EVENT = "running:running at abort";
const NOTHING_RAN_WORKSPACES = [
  "empty",
  "setup-fail",
  "no-tests",
  "all-skipped",
  "blocked",
  "only-failed",
] as const;

const fixtureRuns = new Map<string, Promise<FixtureRun>>();

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

function recordedTests(run: RunResult): readonly RecordedTest[] {
  return (ranRun(run)?.modules ?? []).flatMap((module) =>
    module.state === "ran" ? module.tests : [],
  );
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

const ABORT_REASON = new Error("stop requested");
const ABORTED = { thrown: "Error: stop requested" };

interface InterruptedDiscovery {
  readonly discovery: ConsumerRun["discovery"];
  /** The host's state when the discovery settled. */
  readonly atSettle: {
    readonly env: string | undefined;
    readonly exitCode: unknown;
  };
  readonly exitCodeBefore: unknown;
  readonly laterModuleCollected: boolean;
  readonly furtherWorkspaceLoaded: boolean;
}

const interruptedDiscoveries = new Map<
  VitestInstall,
  Promise<InterruptedDiscovery>
>();

/** Discovers the discover-interrupt fixture, aborting while its first workspace's first module holds collection open. */
function discoverInterrupted(
  install: VitestInstall,
): Promise<InterruptedDiscovery> {
  const cached = interruptedDiscoveries.get(install);
  if (cached !== undefined) return cached;
  const started = inConsumerCopy(
    "discover-interrupt",
    install,
    async (root) => {
      const held = join(root, "packages/a");
      const controller = new AbortController();
      const exitCodeBefore = process.exitCode;
      let atSettle: InterruptedDiscovery["atSettle"] = {
        env: "never settled",
        exitCode: undefined,
      };
      const settled = settledDiscovery(root, controller.signal).then(
        (discovery) => {
          atSettle = {
            env: process.env["RT_FIXTURE_ENV"],
            exitCode: process.exitCode,
          };
          return discovery;
        },
      );
      try {
        await waitUntil(() => existsSync(join(held, "collecting")), settled);
        controller.abort(ABORT_REASON);
      } finally {
        writeFileSync(join(held, "release"), "");
      }
      const discovery = await settled;
      await queueSessionJob(() => Promise.resolve());
      return {
        discovery,
        atSettle,
        exitCodeBefore,
        laterModuleCollected: existsSync(join(held, "later-collected")),
        furtherWorkspaceLoaded: existsSync(join(root, "packages/b/loaded")),
      };
    },
  );
  interruptedDiscoveries.set(install, started);
  return started;
}

describe("interrupting a discovery", () => {
  it(
    "D1300: a discovery aborted before its turn loads no workspace and rejects with the signal's reason",
    async () => {
      const outcome = await inConsumerCopy(
        "discover-interrupt",
        "vitest",
        async (root) => ({
          discovery: await settledDiscovery(
            root,
            AbortSignal.abort(ABORT_REASON),
          ),
          loaded: ["packages/a", "packages/b"].filter((path) =>
            existsSync(join(root, path, "loaded")),
          ),
        }),
      );
      expect(outcome).toEqual({ discovery: ABORTED, loaded: [] });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1301: a discovery aborted mid-collection loads no further workspace and rejects with the signal's reason",
    async () => {
      const { discovery, furtherWorkspaceLoaded } =
        await discoverInterrupted("vitest");
      expect({ discovery, furtherWorkspaceLoaded }).toEqual({
        discovery: ABORTED,
        furtherWorkspaceLoaded: false,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1302: an abort while a module holds collection open interrupts the collection, so no later module is collected",
    async () => {
      expect((await discoverInterrupted("vitest")).laterModuleCollected).toBe(
        false,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1304: on Vitest 4.1, an abort while a module holds collection open interrupts the collection, so no later module is collected",
    async () => {
      expect((await discoverInterrupted("vitest-4")).laterModuleCollected).toBe(
        false,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2900: a discovery interrupted once its walk for crawled links has begun stops the walk, which throws the discovery's abort reason rather than walking on",
    async () => {
      const actual = await vi.importActual<
        typeof import("../src/inputs/crawl-links.js")
      >("../src/inputs/crawl-links.js");
      const outcome = await inConsumerCopy("single", "vitest", async (root) => {
        const controller = new AbortController();
        let walked: unknown = "never walked";
        vi.mocked(crawledLinks).mockImplementationOnce(
          async (project, signal) => {
            controller.abort(ABORT_REASON);
            const walk = actual.crawledLinks(project, signal);
            walked = await walk.then(
              () => "walked on",
              (error: unknown) => error,
            );
            return walk;
          },
        );
        await settledDiscovery(root, controller.signal);
        return walked;
      });
      expect(outcome).toBe(ABORT_REASON);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1303: an aborted discovery rejects only once the host's environment and exit code are restored",
    async () => {
      const { atSettle, exitCodeBefore } = await discoverInterrupted("vitest");
      expect({
        env: atSettle.env,
        exitCodeRestored: atSettle.exitCode === exitCodeBefore,
      }).toEqual({ env: undefined, exitCodeRestored: true });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("recording whether a run was force-stopped", () => {
  it(
    "D1305: a run that completed records that Vitest was not force-stopped",
    async () => {
      const run = await runOf("run", "vitest");
      expect(ranRun(run)?.forceStopped ?? run).toBe(false);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1307: a run aborted while its workspace loads records that Vitest was not force-stopped",
    async () => {
      const run = await runOf("run-interrupt", "vitest", "configure");
      expect(ranRun(run)?.forceStopped ?? run).toBe(false);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1306: a run aborted mid-test that ends within the grace is not force-stopped and its afterAll runs",
    async () => {
      const outcome = await inConsumerCopy(
        "force-stop",
        "vitest",
        async (root) => {
          const directory = join(root, "graceful");
          const controller = new AbortController();
          const run = settledRun(directory, controller.signal);
          try {
            await waitUntil(() => existsSync(join(directory, "holding")), run);
            controller.abort();
          } finally {
            writeFileSync(join(directory, "release"), "");
          }
          const recorded = ranRun(await run);
          return recorded === undefined
            ? await run
            : {
                execution: recorded.execution,
                forceStopped: recorded.forceStopped,
                afterAllRan: existsSync(join(directory, "after-all-ran")),
              };
        },
      );
      expect(outcome).toEqual({
        execution: "interrupted",
        forceStopped: false,
        afterAllRan: true,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

type ConfigFormat = "esm" | "cjs";
type Job = "run" | "discovery";

interface NoWritesJob {
  readonly status: unknown;
  readonly changes: readonly string[];
  readonly outcomes: unknown;
}

const noWritesJobs = new Map<string, Promise<NoWritesJob>>();

/** Every file (by content hash), directory and link under `root`, without following a link. */
function treeState(
  root: string,
  relative = "",
  state = new Map<string, string>(),
): Map<string, string> {
  for (const name of readdirSync(join(root, relative))) {
    const path = relative === "" ? name : `${relative}/${name}`;
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) {
      state.set(path, "link");
    } else if (stat.isDirectory()) {
      state.set(`${path}/`, "directory");
      treeState(root, path, state);
    } else {
      state.set(
        path,
        createHash("sha256")
          .update(readFileSync(join(root, path)))
          .digest("hex"),
      );
    }
  }
  return state;
}

function treeChanges(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const changes: string[] = [];
  for (const [path, entry] of after) {
    if (!before.has(path)) changes.push(`added ${path}`);
    else if (before.get(path) !== entry) changes.push(`changed ${path}`);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push(`removed ${path}`);
  }
  return changes.sort();
}

function snapshotOutcomes(run: RunResult): unknown {
  return Object.fromEntries(
    recordedTests(run).map((test) => [
      test.identity.namePath.at(-1),
      test.execution === "finished" ? test.outcome : test.execution,
    ]),
  );
}

const SNAPSHOT_HEADER =
  "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html";
const CRLF = "\r\n";

/**
 * A snapshot file with CRLF line endings, which Vitest does not write itself, so under update `none` a file that also
 * holds an unchecked entry is one Vitest would rewrite. Written by the test, so git's newline conversion cannot undo it.
 */
function writeCrlfSnapshotFile(
  file: string,
  entries: Readonly<Record<string, string>>,
): void {
  mkdirSync(dirname(file), { recursive: true });
  const lines = Object.entries(entries).flatMap(([key, value]) => [
    `exports[\`${key}\`] = \`${value}\`;`,
    "",
  ]);
  writeFileSync(file, [SNAPSHOT_HEADER, "", ...lines].join(CRLF));
}

/** Runs or discovers a no-writes consumer once per install, format and job, under UPDATE_SNAPSHOT=all. */
function noWritesJob(
  install: VitestInstall,
  format: ConfigFormat,
  job: Job,
): Promise<NoWritesJob> {
  const key = JSON.stringify([install, format, job]);
  const cached = noWritesJobs.get(key);
  if (cached !== undefined) return cached;
  const started = inConsumerCopy(
    `no-writes/${format}`,
    install,
    async (root) => {
      writeCrlfSnapshotFile(join(root, "__snapshots__/snap.test.mjs.snap"), {
        "file snapshot mismatch 1": '"stored"',
        "no test checks this 1": '"unchecked"',
      });
      const before = treeState(root);
      const saved = process.env["UPDATE_SNAPSHOT"];
      process.env["UPDATE_SNAPSHOT"] = "all";
      try {
        if (job === "run") {
          const run = await settledRun(root);
          return {
            status: "status" in run ? run.status : run,
            changes: treeChanges(before, treeState(root)),
            outcomes: snapshotOutcomes(run),
          };
        }
        const discovery = await settledDiscovery(root);
        const entry = workspace(discovery, ".");
        return {
          status:
            entry !== undefined && "status" in entry ? entry.status : entry,
          changes: treeChanges(before, treeState(root)),
          outcomes: testsOf(discovery, ".").map(lastName),
        };
      } finally {
        restoreEnv(["UPDATE_SNAPSHOT"], [saved]);
      }
    },
  );
  noWritesJobs.set(key, started);
  return started;
}

async function statusAndChanges(
  install: VitestInstall,
  format: ConfigFormat,
  job: Job,
): Promise<unknown> {
  const { status, changes } = await noWritesJob(install, format, job);
  return { status, changes };
}

const SNAPSHOTS_CHECKED_ONLY = {
  "file snapshot": "failed",
  "file snapshot mismatch": "failed",
  "inline snapshot": "failed",
  plain: "passed",
};

describe("leaving the consumer's tree as it was found", () => {
  it(
    "D1308: a run on Vitest 5 over an ESM config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest", "esm", "run")).toEqual({
        status: "ran",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1309: a run on Vitest 4.1 over an ESM config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest-4", "esm", "run")).toEqual({
        status: "ran",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1310: a run on Vitest 5 over a CommonJS config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest", "cjs", "run")).toEqual({
        status: "ran",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1311: a run on Vitest 4.1 over a CommonJS config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest-4", "cjs", "run")).toEqual({
        status: "ran",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1312: a discovery on Vitest 5 over an ESM config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest", "esm", "discovery")).toEqual({
        status: "discovered",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1313: a discovery on Vitest 4.1 over a CommonJS config loads it and writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest-4", "cjs", "discovery")).toEqual({
        status: "discovered",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1314: a discovery on Vitest 5 over a CommonJS config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest", "cjs", "discovery")).toEqual({
        status: "discovered",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1315: a discovery on Vitest 4.1 over an ESM config writes nothing under the consumer",
    async () => {
      expect(await statusAndChanges("vitest-4", "esm", "discovery")).toEqual({
        status: "discovered",
        changes: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("checking snapshots only against those stored", () => {
  it(
    "D1316: on Vitest 5, a snapshot with none stored and a mismatched one record failed while a plain test passes",
    async () => {
      expect((await noWritesJob("vitest", "esm", "run")).outcomes).toEqual(
        SNAPSHOTS_CHECKED_ONLY,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1317: on Vitest 4.1, a snapshot with none stored and a mismatched one record failed while a plain test passes",
    async () => {
      expect((await noWritesJob("vitest-4", "cjs", "run")).outcomes).toEqual(
        SNAPSHOTS_CHECKED_ONLY,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

function snapshotFileChanges(job: NoWritesJob): readonly string[] {
  return job.changes.filter((change) => change.includes("__snapshots__"));
}

describe("leaving a snapshot file Vitest would rewrite as it was found", () => {
  it(
    "D1331: on Vitest 5, a CRLF snapshot file holding an unchecked entry is not rewritten by a run",
    async () => {
      expect(
        snapshotFileChanges(await noWritesJob("vitest", "esm", "run")),
      ).toEqual([]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1332: on Vitest 4.1, a CRLF snapshot file holding an unchecked entry is not rewritten by a run",
    async () => {
      expect(
        snapshotFileChanges(await noWritesJob("vitest-4", "cjs", "run")),
      ).toEqual([]);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

const STORED_AND_UNCHECKED = {
  "stored 1": '"stored"',
  "gone 1": '"gone"',
};

/** Runs the snapshot-projects workspace, whose two projects each hold a CRLF snapshot file with an unchecked entry. */
function snapshotProjectsRun(
  install: VitestInstall,
  pool: Pool,
): Promise<unknown> {
  return inConsumerCopy("snapshot-projects", install, (root) =>
    withPool(pool, async () => {
      writeCrlfSnapshotFile(
        join(root, "own/__snapshots__/snap.test.mjs.snap"),
        STORED_AND_UNCHECKED,
      );
      writeCrlfSnapshotFile(
        join(root, "custom/__custom__/snap.test.mjs.snap"),
        STORED_AND_UNCHECKED,
      );
      const before = treeState(root);
      const run = await settledRun(root);
      return {
        status: "status" in run ? run.status : run,
        changes: treeChanges(before, treeState(root)),
        stored: Object.fromEntries(
          recordedTests(run).map((test) => [
            test.identity.projectName,
            test.execution === "finished" ? test.outcome : test.execution,
          ]),
        ),
      };
    }),
  );
}

const PROJECTS_UNWRITTEN = {
  status: "ran",
  changes: [],
  stored: { own: "passed", custom: "passed" },
};

describe("leaving every project's snapshot files as they were found", () => {
  it(
    "D1333: on Vitest 5's forks pool, no project's snapshot file is rewritten and each stored snapshot is still read",
    async () => {
      expect(await snapshotProjectsRun("vitest", "forks")).toEqual(
        PROJECTS_UNWRITTEN,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1334: on Vitest 5's threads pool, no project's snapshot file is rewritten and each stored snapshot is still read",
    async () => {
      expect(await snapshotProjectsRun("vitest", "threads")).toEqual(
        PROJECTS_UNWRITTEN,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1335: on Vitest 4.1's forks pool, no project's snapshot file is rewritten and each stored snapshot is still read",
    async () => {
      expect(await snapshotProjectsRun("vitest-4", "forks")).toEqual(
        PROJECTS_UNWRITTEN,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1336: on Vitest 4.1's threads pool, no project's snapshot file is rewritten and each stored snapshot is still read",
    async () => {
      expect(await snapshotProjectsRun("vitest-4", "threads")).toEqual(
        PROJECTS_UNWRITTEN,
      );
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

/** The `confirmed` fixture's workspace the user was shown, with the config file shown for it. */
const SHOWN = "packages/shown";
const SHOWN_START_ENTRY = {
  path: SHOWN,
  configFile: "packages/shown/vitest.config.mjs",
};
/** Vitest looks for a `.ts` config before a `.mjs` one, so adding one changes the config a load would choose. */
const ADDED_CONFIG = `${SHOWN}/vitest.config.ts`;
const ADDED_CONFIG_SOURCE = `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./added-loaded", import.meta.url), "");\nexport default {};\n`;
const LOAD_MARKERS = ["added-loaded", "loaded"];

/** Adds a config to the shown workspace after the prompt, as a user or a branch switch could. */
function addConfigAfterPrompt(root: string): void {
  writeFileSync(join(root, ADDED_CONFIG), ADDED_CONFIG_SOURCE);
}

/** The markers the shown workspace's configs leave when loaded. */
function shownLoads(root: string): string[] {
  return LOAD_MARKERS.filter((marker) => existsSync(join(root, SHOWN, marker)));
}

function discoverShownOnly(
  root: string,
): Promise<TestDiscovery | { thrown: string }> {
  return discoverTests(
    { consumerRoot: root, workspaces: [SHOWN_START_ENTRY] },
    NEVER_ABORTED,
  ).catch((error: unknown) => ({ thrown: String(error) }));
}

/** A workspace's discovery as its status and reason. */
function statusOf(
  discovery: TestDiscovery | { thrown: string },
  path: string,
): unknown {
  if (!("workspaces" in discovery)) return discovery;
  const entry = discovery.workspaces.find(
    (candidate) => candidate.workspace.path === path,
  );
  if (entry === undefined) return entry;
  return entry.status === "not-confirmed"
    ? { status: entry.status, reason: entry.reason }
    : { status: entry.status };
}

describe("loading only what the user confirmed at start", () => {
  it(
    "D1477: a workspace missing from the confirmed start is listed as not confirmed at start, and its config is never loaded",
    async () => {
      const outcome = await inConsumerCopy(
        "confirmed",
        "vitest",
        async (root) => {
          const discovery = await discoverShownOnly(root);
          return {
            unshown: statusOf(discovery, "packages/unshown"),
            loaded: existsSync(join(root, "packages/unshown/loaded")),
          };
        },
      );
      expect(outcome).toStrictEqual({
        unshown: { status: "not-confirmed", reason: "not confirmed at start" },
        loaded: false,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1535: a confirmed entry whose config file is written root-relative with / is discovered and loaded",
    async () => {
      const outcome = await inConsumerCopy(
        "confirmed",
        "vitest",
        async (root) => {
          const discovery = await discoverShownOnly(root);
          return {
            shown: statusOf(discovery, SHOWN),
            loaded: shownLoads(root),
          };
        },
      );
      expect(outcome).toStrictEqual({
        shown: { status: "discovered" },
        loaded: ["loaded"],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1478: a discovery loads nothing from a confirmed workspace whose chosen config changed after the prompt",
    async () => {
      const outcome = await inConsumerCopy(
        "confirmed",
        "vitest",
        async (root) => {
          addConfigAfterPrompt(root);
          const discovery = await discoverShownOnly(root);
          return {
            shown: statusOf(discovery, SHOWN),
            loaded: shownLoads(root),
          };
        },
      );
      expect(outcome).toStrictEqual({
        shown: { status: "not-confirmed", reason: "not confirmed at start" },
        loaded: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1479: a run whose chosen config changed after the prompt loads nothing and says its config is no longer the one confirmed",
    async () => {
      const outcome = await inConsumerCopy(
        "confirmed",
        "vitest",
        async (root) => {
          addConfigAfterPrompt(root);
          const run: RunResult = await runWorkspace(
            { path: SHOWN, directory: join(root, SHOWN) },
            SHOWN_START_ENTRY.configFile,
            NEVER_ABORTED,
          ).catch((error: unknown) => ({ thrown: String(error) }));
          return {
            run:
              "status" in run
                ? {
                    status: run.status,
                    reason: "reason" in run ? run.reason : undefined,
                  }
                : run,
            loaded: shownLoads(root),
          };
        },
      );
      expect(outcome).toStrictEqual({
        run: {
          status: "not-confirmed",
          reason: "its config file is no longer the one confirmed at start",
        },
        loaded: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

interface WorkspaceBRun {
  readonly run: RunResult;
  readonly before: string;
  readonly after: string;
}

/** Runs the `cwd` fixture's `packages/b`, and reports the host's working directory before and after the run. */
function runInWorkspaceB(): Promise<WorkspaceBRun> {
  return inConsumerCopy("cwd", "vitest", async (root) => {
    const before = process.cwd();
    try {
      const run = await settledRun(
        join(root, "packages/b"),
        undefined,
        "packages/b",
      );
      return { run, before, after: process.cwd() };
    } finally {
      process.chdir(before);
    }
  });
}

describe("the working directory of a workspace's discovery and run", () => {
  it(
    "D1480: a workspace's tests run with the workspace's own directory as the working directory",
    async () => {
      const { run } = await runInWorkspaceB();
      const states = ranRun(run)?.modules.flatMap((module): unknown[] =>
        module.state === "ran" ? module.tests.map(runState) : [module.state],
      );
      expect(states ?? run).toStrictEqual([finished("passed")]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D1481: the host's working directory is restored once the run has ended",
    async () => {
      const { before, after } = await runInWorkspaceB();
      expect(after).toBe(before);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

/** The selection-facts fixture's `packages/solo` names this file one directory above the consumer root. */
const OUTSIDE_SETUP_FILE = "outside-setup.mjs";
/** Where the `root-spelling` fixture's config reads the spelling of the root discovery was started from. */
const STARTED_ROOT_KEY = "RT_STARTED_ROOT";
/** The node project's own aliases, in its config's order, as Vite's resolved config holds them. */
const NODE_ALIASES: readonly ReportedAlias[] = [
  {
    find: "@shared",
    findKind: "string",
    flags: "",
    replacement: "shared-lib",
    hasCustomResolver: false,
  },
  {
    find: "^~icons\\/(.*)$",
    findKind: "regexp",
    flags: "i",
    replacement: "icon-pack/$1",
    hasCustomResolver: false,
  },
  {
    find: "virtual:facts",
    findKind: "string",
    flags: "",
    replacement: "facts-module",
    hasCustomResolver: true,
  },
];

const selectionFactsRuns = new Map<
  string,
  Promise<TestDiscovery | { thrown: string }>
>();

/**
 * Discovers the selection-facts fixture once per install and root spelling, first writing the setup file it names
 * outside the consumer root, the `setup-link` directory link its bare project names, and `unit/shared`, a link to
 * `setup` that the node project's crawl follows.
 */
function discoverSelectionFacts(
  install: VitestInstall,
  throughLink = false,
): Promise<TestDiscovery | { thrown: string }> {
  const key = `${install}:${String(throughLink)}`;
  const cached = selectionFactsRuns.get(key);
  if (cached !== undefined) return cached;
  const run = inConsumerCopy(
    "selection-facts",
    install,
    (root) => {
      writeFileSync(join(dirname(root), OUTSIDE_SETUP_FILE), "export {};\n");
      symlinkSync(join(root, "setup"), join(root, "setup-link"), "junction");
      symlinkSync(join(root, "setup"), join(root, "unit/shared"), "junction");
      return settledDiscovery(root);
    },
    throughLink,
  );
  selectionFactsRuns.set(key, run);
  return run;
}

function selectionFactsOf(
  discovery: ConsumerRun["discovery"],
  path: string,
): unknown {
  const entry = workspace(discovery, path);
  if (entry === undefined || !("status" in entry)) return entry;
  return entry.status === "discovered" ? entry.selectionFacts : entry;
}

/** One fact of one project's report, or what stood in its way. */
function projectFact(
  discovery: ConsumerRun["discovery"],
  path: string,
  projectName: string,
  fact: (facts: ProjectSelectionFacts) => unknown,
): unknown {
  const facts = selectionFactsOf(discovery, path);
  if (!isReported(facts)) return facts;
  const project = facts.projects.find(
    (entry) => entry.projectName === projectName,
  );
  return project === undefined ? `no project ${projectName}` : fact(project);
}

/** The root a workspace was discovered from, as Vitest's glob spells a directory, or what stood in its way. */
function spelledRoot(
  discovery: ConsumerRun["discovery"],
  path: string,
): string | undefined {
  const entry = workspace(discovery, path);
  return entry !== undefined && "workspace" in entry
    ? slashed(entry.workspace.directory)
    : undefined;
}

interface SpelledRootRun {
  readonly discovery: TestDiscovery | { thrown: string };
  /** The root as discovery was started from it, through a directory link, `/`-separated. */
  readonly started: string;
  /** The root's real path, as the daemon hands it to protection. */
  readonly realRoot: string;
}

const spelledRootRuns = new Map<VitestInstall, Promise<SpelledRootRun>>();

/**
 * Discovers the `root-spelling` fixture once per Vitest install, started through a directory link, with its config's
 * absolute patterns spelled from that link.
 */
function discoverThroughLink(install: VitestInstall): Promise<SpelledRootRun> {
  const cached = spelledRootRuns.get(install);
  if (cached !== undefined) return cached;
  const run = inConsumerCopy(
    "root-spelling",
    install,
    async (root) => {
      const started = slashed(root);
      process.env[STARTED_ROOT_KEY] = started;
      try {
        const discovery = await settledDiscovery(root);
        return { discovery, started, realRoot: realpathSync.native(root) };
      } finally {
        delete process.env[STARTED_ROOT_KEY];
      }
    },
    true,
  );
  spelledRootRuns.set(install, run);
  return run;
}

/** Whether each root-relative path, none of them a module the discovery lists, is protected, or why none is. */
function protectedAfter(
  run: SpelledRootRun,
  paths: readonly string[],
): Record<string, boolean> | string {
  if (!("workspaces" in run.discovery)) return run.discovery.thrown;
  const value = protection(run.discovery, run.realRoot);
  if (!value.applies) return value.reason;
  return Object.fromEntries(paths.map((path) => [path, value.protects(path)]));
}

function isReported(
  facts: unknown,
): facts is Extract<SelectionFacts, { reported: true }> {
  return (
    typeof facts === "object" &&
    facts !== null &&
    "reported" in facts &&
    facts.reported === true
  );
}

function sorted(files: readonly string[]): string[] {
  return [...files].sort();
}

describe("reporting each workspace's selection facts", () => {
  it(
    "D2105: a project's setup files leave out RT Test's snapshot guard, so a project with none reports an empty list",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "bare", (facts) => facts.setupFiles),
      ).toStrictEqual([]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2106: on Vitest 4.1, setup files are root-relative, climbing with .. for a file outside the consumer root",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(
          discovery,
          "packages/solo",
          "",
          (facts) => facts.setupFiles,
        ),
      ).toStrictEqual([
        "packages/solo/setup.mjs",
        "setup/shared-setup.mjs",
        `../${OUTSIDE_SETUP_FILE}`,
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2107: through a linked consumer root, setup files read as they do from the real root",
    async () => {
      const discovery = await discoverSelectionFacts("vitest", true);
      expect(
        projectFact(
          discovery,
          "packages/solo",
          "",
          (facts) => facts.setupFiles,
        ),
      ).toStrictEqual([
        "packages/solo/setup.mjs",
        "setup/shared-setup.mjs",
        `../${OUTSIDE_SETUP_FILE}`,
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2108: on Vitest 5, a project extending the root config reports the root's global setup beside its own",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "node", (facts) =>
          sorted(facts.globalSetupFiles),
        ),
      ).toStrictEqual(["setup/global-own.mjs", "setup/global-root.mjs"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2109: on Vitest 4.1, a workspace with no projects lists its global setup once, though it is both the project's and the root's",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(
          discovery,
          "packages/solo",
          "",
          (facts) => facts.globalSetupFiles,
        ),
      ).toStrictEqual(["packages/solo/global.mjs"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2110: a project whose own global setup names the root's file, through a directory link, lists that file once",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "bare", (facts) => facts.globalSetupFiles),
      ).toStrictEqual(["setup/global-root.mjs"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2119: a project naming the root's global setup file by an absolute path through a directory link lists that file once",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(
          discovery,
          ".",
          "absolute",
          (facts) => facts.globalSetupFiles,
        ),
      ).toStrictEqual(["setup/global-root.mjs"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2120: a setup file named by an absolute path through a directory link reports the file's own path, not the link's",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "absolute", (facts) => facts.setupFiles),
      ).toStrictEqual(["setup/node-setup.mjs"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2111: on Vitest 4.1, a browser-mode project is left out of the report while its sibling project is reported",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      const facts = selectionFactsOf(discovery, "packages/browser");
      expect(
        isReported(facts)
          ? facts.projects.map((project) => project.projectName)
          : facts,
      ).toStrictEqual(["node"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2112: on Vitest 5, a project's own aliases lead its report in config order, a RegExp find as its source text and flags",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "node", (facts) =>
          facts.aliases.slice(0, NODE_ALIASES.length),
        ),
      ).toStrictEqual(NODE_ALIASES);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2113: on Vitest 4.1, a project's own aliases lead its report in config order, marking the one with a customResolver",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "node", (facts) =>
          facts.aliases.slice(0, NODE_ALIASES.length),
        ),
      ).toStrictEqual(NODE_ALIASES);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2114: a workspace's report survives a JSON round trip unchanged",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      const facts = selectionFactsOf(discovery, ".");
      const carried: unknown =
        facts === undefined
          ? "no facts"
          : JSON.parse(JSON.stringify(facts) as string);
      expect(carried).toStrictEqual(facts);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2115: on Vitest 5, a project's test file patterns match from its dir, root-relative",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      const root = spelledRoot(discovery, ".");
      expect(
        projectFact(discovery, ".", "node", (facts) => facts.testFilePatterns),
      ).toStrictEqual({
        directory: "unit",
        vitestDirectory: `${root}/unit`,
        patternBases: [{ spelled: `${root}/unit/src`, directory: "unit/src" }],
        crawledLinks: {
          complete: true,
          links: [{ spelled: `${root}/unit/shared`, directory: "setup" }],
        },
        include: ["**/*.test.mjs"],
        exclude: ["**/skipped/**"],
        includeSource: ["src/**/*.mjs"],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2116: a project dir not yet on disk, named through a directory link, reports the real path of the directory holding it",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(
          discovery,
          ".",
          "pending",
          (facts) => facts.testFilePatterns.directory,
        ),
      ).toBe("setup/later");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2117: on Vitest 4.1, a project that sets no includeSource reports none, matching from the consumer root as .",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      const root = spelledRoot(discovery, ".");
      expect(
        projectFact(discovery, ".", "bare", (facts) => facts.testFilePatterns),
      ).toStrictEqual({
        directory: ".",
        vitestDirectory: root,
        patternBases: [{ spelled: `${root}/bare`, directory: "bare" }],
        crawledLinks: { complete: true, links: [] },
        include: ["bare/*.test.mjs"],
        exclude: ["**/node_modules/**", "**/.git/**"],
        includeSource: [],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2860: on Vitest 4.1, a directory link the project's crawl follows is reported in its spelling below Vitest's pattern directory, beside the root-relative directory it resolves to",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      const root = spelledRoot(discovery, ".");
      expect(
        projectFact(
          discovery,
          ".",
          "node",
          (facts) => facts.testFilePatterns.crawledLinks,
        ),
      ).toStrictEqual({
        complete: true,
        links: [{ spelled: `${root}/unit/shared`, directory: "setup" }],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2257: on Vitest 5, a nested workspace's project reports its Vite root relative to the consumer root",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, "packages/solo", "", (facts) => facts.viteRoot),
      ).toBe("packages/solo");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2258: on Vitest 4.1, a project that sets its own root reports that root, not the root project's",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "rooted", (facts) => facts.viteRoot),
      ).toBe("rooted");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2813: a project dir named through a directory link is reported in the link's spelling as Vitest's glob matches from it, beside its real root-relative path",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      const root = spelledRoot(discovery, ".");
      expect(
        projectFact(discovery, ".", "pending", (facts) => ({
          directory: facts.testFilePatterns.directory,
          vitestDirectory: facts.testFilePatterns.vitestDirectory,
        })),
      ).toStrictEqual({
        directory: "setup/later",
        vitestDirectory: `${root}/setup-link/later`,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

/**
 * The root config's env source as each project of the selection-facts fixture reports it: the prefixes the config
 * sets, and Vitest's own mode rather than the one the config sets.
 */
const ROOT_ENV_SOURCE = {
  envDirectory: ".",
  envPrefixes: ["VITE_", "ROOT_"],
  mode: "test",
};

/** The project's env source at `index`, or why its env sources are not known. */
function envSourceAt(
  facts: ProjectSelectionFacts,
  index: number,
): EnvSource | EnvSourcesNotKnown | undefined {
  return isNotKnown(facts.envSources)
    ? facts.envSources
    : facts.envSources[index];
}

/** One field of the project's env source at `index`, or why its env sources are not known. */
function envSourceField<K extends keyof EnvSource>(
  facts: ProjectSelectionFacts,
  index: number,
  key: K,
): EnvSource[K] | EnvSourcesNotKnown | undefined {
  const source = envSourceAt(facts, index);
  return source === undefined || "notKnown" in source ? source : source[key];
}

describe("reporting each project's env sources", () => {
  it(
    "D3042: on Vitest 5, a project's own env directory is named relative to the consumer root",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "rooted", (facts) =>
          envSourceField(facts, 0, "envDirectory"),
        ),
      ).toBe("rooted");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3043: on Vitest 4.1, a project's own env source is its own config's, an env directory outside the consumer root named climbing with ..",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "bare", (facts) =>
          envSourceField(facts, 0, "envDirectory"),
        ),
      ).toBe("../outside-env");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3044: on Vitest 5, a config that turns env files off reports no env directory",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "pending", (facts) =>
          envSourceField(facts, 0, "envDirectory"),
        ),
      ).toBeNull();
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3045: on Vitest 4.1, a config that sets no env prefix reports VITE_ alone",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "pending", (facts) =>
          envSourceField(facts, 0, "envPrefixes"),
        ),
      ).toStrictEqual(["VITE_"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3046: on Vitest 4.1, a single env prefix written as a string is reported as a list holding it",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "rooted", (facts) =>
          envSourceField(facts, 0, "envPrefixes"),
        ),
      ).toStrictEqual(["RT_"]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3047: on Vitest 4.1, an env prefix a JavaScript config writes as null or a number is reported as the string Vite tests names against",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      const ownPrefixes = (projectName: string): unknown =>
        projectFact(discovery, ".", projectName, (facts) =>
          envSourceField(facts, 0, "envPrefixes"),
        );
      expect({
        absolute: ownPrefixes("absolute"),
        bare: ownPrefixes("bare"),
      }).toStrictEqual({ absolute: ["APP_", "7"], bare: ["null"] });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3048: on Vitest 5, a project that sets its own env options still reports the root config's source, in Vitest's mode though the root config sets its own",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "rooted", (facts) => envSourceAt(facts, 1)),
      ).toStrictEqual(ROOT_ENV_SOURCE);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3049: on Vitest 5, a project that sets its own mode reports that mode for its own source",
    async () => {
      const discovery = await discoverSelectionFacts("vitest");
      expect(
        projectFact(discovery, ".", "rooted", (facts) =>
          envSourceField(facts, 0, "mode"),
        ),
      ).toBe("custom");
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3050: on Vitest 4.1, a project reports its own config's env source first and the root config's after it",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "rooted", (facts) => facts.envSources),
      ).toStrictEqual([
        { envDirectory: "rooted", envPrefixes: ["RT_"], mode: "custom" },
        ROOT_ENV_SOURCE,
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3051: on Vitest 4.1, a project that does not extend the root config still reports the root config's env source",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "absolute", (facts) =>
          envSourceAt(facts, 1),
        ),
      ).toStrictEqual(ROOT_ENV_SOURCE);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3085: on Vitest 4.1, a mode a JavaScript config writes as a number is reported as the string Vite names its env files by",
    async () => {
      const discovery = await discoverSelectionFacts("vitest-4");
      expect(
        projectFact(discovery, ".", "absolute", (facts) =>
          envSourceField(facts, 0, "mode"),
        ),
      ).toBe("2");
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

const PRESENTED_VERSION_KEY = "RT_FIXTURE_VITEST_VERSION";
const PRESENTED_RECORD_KEY = "RT_FIXTURE_CONTAINER_RECORD";
const PRESENTED_KEYS = [PRESENTED_VERSION_KEY, PRESENTED_RECORD_KEY] as const;
/** The record the nested-projects fixture's plugin reads as removing Vitest's container record. */
const RECORD_ABSENT = "absent";
const FLAT_WORKSPACE = "packages/flat";
const FINGERPRINTED = "fingerprinted";
/** The reason every project of the nested-projects fixture's root workspace reports on Vitest 5.0. */
const NESTED_REASON =
  "a nested projects container declares its projects (app/inner/vitest.config.mjs, app/vitest.config.mjs)";
/** The flat workspace's own directory, shared by its inline project, then its directory and config file projects. */
const FLAT_ENV_FILES = [
  "packages/flat/.env",
  "packages/flat/.env.local",
  "packages/flat/.env.test",
  "packages/flat/.env.test.local",
  "packages/flat/dir/.env",
  "packages/flat/dir/.env.local",
  "packages/flat/dir/.env.test",
  "packages/flat/dir/.env.test.local",
  "packages/flat/pkg/.env",
  "packages/flat/pkg/.env.local",
  "packages/flat/pkg/.env.test",
  "packages/flat/pkg/.env.test.local",
];

/** What the nested-projects fixture's plugin makes the resolved Vitest present in place of its own. */
interface Presented {
  readonly name: string;
  readonly version?: string;
  /** The container record as JSON, or `RECORD_ABSENT`. */
  readonly record?: (root: string) => string;
}

const AS_INSTALLED: Presented = { name: "as installed" };
/** A Vitest 5 minor later than the newest RT Test verified, recording no container where 5.0 records them. */
const UNVERIFIED_MINOR: Presented = {
  name: "unverified minor",
  version: "5.1.0",
  record: () => RECORD_ABSENT,
};
const RECORD_NOT_A_LIST: Presented = {
  name: "record not a list",
  record: () => JSON.stringify("app/vitest.config.mjs"),
};
const RECORD_EMPTY: Presented = { name: "record empty", record: () => "[]" };
/** A Vitest 5 minor later than the newest RT Test verified, recording an empty list of containers. */
const UNVERIFIED_MINOR_RECORD_EMPTY: Presented = {
  name: "unverified minor, record empty",
  version: "5.1.0",
  record: () => "[]",
};
const RECORD_NOT_PATHS: Presented = {
  name: "record not paths",
  record: () => JSON.stringify([1]),
};
/** One container config file recorded twice, as two containers declaring the same nested container leave it. */
const RECORD_REPEATED: Presented = {
  name: "record repeated",
  record: (root) => {
    const file = join(
      root,
      FLAT_WORKSPACE,
      containerDirectory(0),
      "vitest.config.mjs",
    );
    return JSON.stringify([file, file]);
  },
};
/** Two more recorded container config files than a reason names, none of them on disk. */
const RECORD_PAST_BOUND: Presented = {
  name: "record past the bound",
  record: (root) =>
    JSON.stringify(
      Array.from({ length: MAX_NAMED_CHANGES + 2 }, (_, index) =>
        join(
          root,
          FLAT_WORKSPACE,
          containerDirectory(index),
          "vitest.config.mjs",
        ),
      ),
    ),
};

/** A container's directory, named so the names sort in index order. */
function containerDirectory(index: number): string {
  return `c${String(index).padStart(2, "0")}`;
}

const nestedRuns = new Map<
  string,
  Promise<TestDiscovery | { thrown: string }>
>();

/** Discovers the nested-projects fixture once per install and presentation, set in the environment its plugin reads. */
function discoverNested(
  install: VitestInstall,
  presented: Presented = AS_INSTALLED,
): Promise<TestDiscovery | { thrown: string }> {
  const runKey = `${install}:${presented.name}`;
  const cached = nestedRuns.get(runKey);
  if (cached !== undefined) return cached;
  const run = inConsumerCopy("nested-projects", install, async (root) => {
    const saved = PRESENTED_KEYS.map((name) => process.env[name]);
    restoreEnv(PRESENTED_KEYS, [presented.version, presented.record?.(root)]);
    try {
      return await settledDiscovery(root);
    } finally {
      restoreEnv(PRESENTED_KEYS, saved);
    }
  });
  nestedRuns.set(runKey, run);
  return run;
}

/** The workspace's env files, sorted, or why they are not known, or what stood in the way. */
function envFilesOf(
  discovery: ConsumerRun["discovery"],
  path: string,
): unknown {
  const entry = workspace(discovery, path);
  if (entry === undefined || !("status" in entry)) return entry;
  const listed = workspaceEnvFiles(entry);
  return listed.known ? { known: true, files: sorted(listed.files) } : listed;
}

function refusal(print: FingerprintResult | { thrown: string }): string {
  if ("thrown" in print) return print.thrown;
  return print.ok ? FINGERPRINTED : print.reason;
}

/** Why the workspace and its discovery have no fingerprint, or that each has one, or what stood in the way. */
function fingerprintRefusals(
  discovery: ConsumerRun["discovery"],
  path: string,
): unknown {
  if (!("workspaces" in discovery)) return discovery.thrown;
  const entry = discovery.workspaces.find(
    (candidate) => candidate.workspace.path === path,
  );
  if (entry === undefined) return `no workspace ${path}`;
  const inputs = new ProjectInputs(REPO, new Map());
  return {
    workspace: refusal(settle(() => workspaceFingerprint(inputs, entry))),
    discovery: refusal(settle(() => discoveryFingerprint(inputs, discovery))),
  };
}

/** Each reported project's env sources by its name, or what stood in the way. */
function envSourcesByProject(
  discovery: ConsumerRun["discovery"],
  path: string,
): unknown {
  const facts = selectionFactsOf(discovery, path);
  if (!isReported(facts)) return facts;
  return Object.fromEntries(
    facts.projects.map((project) => [project.projectName, project.envSources]),
  );
}

describe("the env sources of a workspace holding a nested projects container", () => {
  it(
    "D3113: on Vitest 5.0, a workspace in which a nested projects container declares projects has no fingerprint, nor has its discovery, the reason saying its env files are not known and naming each container's config file",
    async () => {
      const discovery = await discoverNested("vitest");
      const reason = `the env files of the workspace at the consumer root are not known: ${NESTED_REASON}`;
      expect(fingerprintRefusals(discovery, ".")).toStrictEqual({
        workspace: reason,
        discovery: reason,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3114: on Vitest 5.0, every project of such a workspace, a top-level one included, reports its env sources not known, naming each container's config file relative to the consumer root",
    async () => {
      const discovery = await discoverNested("vitest");
      expect(envSourcesByProject(discovery, ".")).toStrictEqual({
        top: { notKnown: NESTED_REASON },
        "app (inline)": { notKnown: NESTED_REASON },
        "app (inner) (deep)": { notKnown: NESTED_REASON },
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3115: on Vitest 5.0, a workspace beside it in the same discovery, whose projects by path, a config file and a directory, declare no projects, lists each project's env files and its root config's",
    async () => {
      const discovery = await discoverNested("vitest");
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: true,
        files: FLAT_ENV_FILES,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3116: on Vitest 4.1, a project whose config declares projects, which 4.1 ignores, reports its own env directory and the root config's",
    async () => {
      const discovery = await discoverNested("vitest-4");
      expect(
        projectFact(discovery, ".", "app", (facts) => facts.envSources),
      ).toStrictEqual([
        { envDirectory: "app/envs", envPrefixes: ["VITE_"], mode: "test" },
        { envDirectory: ".", envPrefixes: ["VITE_"], mode: "test" },
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3117: on a Vitest 5 minor RT Test has not verified, which records no container, a workspace declaring projects by path has env files not known, the reason naming the missing record and the Vitest version",
    async () => {
      const discovery = await discoverNested("vitest", UNVERIFIED_MINOR);
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: false,
        workspace: FLAT_WORKSPACE,
        reason:
          "RT Test has not verified where Vitest 5.1.0 records nested projects containers, and it records none in _containerConfigFiles while the root config declares projects by path",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3118: on a Vitest 5 minor RT Test has not verified, a workspace declaring only inline projects lists its env files",
    async () => {
      const discovery = await discoverNested("vitest", UNVERIFIED_MINOR);
      expect(envFilesOf(discovery, "packages/inline")).toStrictEqual({
        known: true,
        files: [
          "packages/inline/.env",
          "packages/inline/.env.local",
          "packages/inline/.env.test",
          "packages/inline/.env.test.local",
        ],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3119: on a Vitest 5 minor RT Test has not verified, a workspace declaring no projects lists its env files",
    async () => {
      const discovery = await discoverNested("vitest", UNVERIFIED_MINOR);
      expect(envFilesOf(discovery, "packages/single")).toStrictEqual({
        known: true,
        files: [
          "packages/single/.env",
          "packages/single/.env.local",
          "packages/single/.env.test",
          "packages/single/.env.test.local",
        ],
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3120: on Vitest 5, a container record in a shape other than a list of paths leaves a workspace's env files not known, the reason naming the record",
    async () => {
      const discovery = await discoverNested("vitest", RECORD_NOT_A_LIST);
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: false,
        workspace: FLAT_WORKSPACE,
        reason:
          "Vitest records its nested projects containers in _containerConfigFiles in a form RT Test does not read",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3121: on Vitest 5.0, the verified minor, an empty container record reads as no container, so a workspace declaring projects by path lists its env files",
    async () => {
      const discovery = await discoverNested("vitest", RECORD_EMPTY);
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: true,
        files: FLAT_ENV_FILES,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3122: the not-known reason names at most 20 container config files and counts the rest",
    async () => {
      const discovery = await discoverNested("vitest", RECORD_PAST_BOUND);
      const named = Array.from(
        { length: MAX_NAMED_CHANGES },
        (_, index) =>
          `${FLAT_WORKSPACE}/${containerDirectory(index)}/vitest.config.mjs`,
      ).join(", ");
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: false,
        workspace: FLAT_WORKSPACE,
        reason: `a nested projects container declares its projects (${named} and 2 more)`,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3130: on a Vitest 5 minor RT Test has not verified, an empty container record leaves a workspace declaring projects by path with env files not known, the reason naming the record and the Vitest version",
    async () => {
      const discovery = await discoverNested(
        "vitest",
        UNVERIFIED_MINOR_RECORD_EMPTY,
      );
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: false,
        workspace: FLAT_WORKSPACE,
        reason:
          "RT Test has not verified where Vitest 5.1.0 records nested projects containers, and it records none in _containerConfigFiles while the root config declares projects by path",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3131: on Vitest 5, a container record listing a value that is not a path leaves a workspace's env files not known, the reason naming the record, rather than failing its discovery",
    async () => {
      const discovery = await discoverNested("vitest", RECORD_NOT_PATHS);
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: false,
        workspace: FLAT_WORKSPACE,
        reason:
          "Vitest records its nested projects containers in _containerConfigFiles in a form RT Test does not read",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D3132: a container config file Vitest records twice is named once in the not-known reason",
    async () => {
      const discovery = await discoverNested("vitest", RECORD_REPEATED);
      expect(envFilesOf(discovery, FLAT_WORKSPACE)).toStrictEqual({
        known: false,
        workspace: FLAT_WORKSPACE,
        reason:
          "a nested projects container declares its projects (packages/flat/c00/vitest.config.mjs)",
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );
});

describe("a project started through another spelling of its root", () => {
  it(
    "D2811: on Vitest 5, a test file an absolute include pattern spelled from the link the project was started through finds is protected, though discovery never listed it",
    async () => {
      const run = await discoverThroughLink("vitest");
      expect(
        protectedAfter(run, ["spelled/b.test.mjs", "elsewhere/b.test.mjs"]),
      ).toStrictEqual({
        "spelled/b.test.mjs": true,
        "elsewhere/b.test.mjs": false,
      });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2812: on Vitest 4.1, a source file an absolute includeSource pattern spelled from the link the project was started through finds is protected",
    async () => {
      const run = await discoverThroughLink("vitest-4");
      expect(
        protectedAfter(run, ["source/b.mjs", "elsewhere/b.mjs"]),
      ).toStrictEqual({ "source/b.mjs": true, "elsewhere/b.mjs": false });
    },
    DISCOVERY_TIMEOUT_MS,
  );

  it(
    "D2814: on Vitest 5, an absolute include pattern's directories are reported as it spells them, beside the root-relative path they resolve to",
    async () => {
      const run = await discoverThroughLink("vitest");
      expect(
        projectFact(
          run.discovery,
          ".",
          "spelled",
          (facts) => facts.testFilePatterns.patternBases,
        ),
      ).toStrictEqual([
        { spelled: `${run.started}/spelled`, directory: "spelled" },
      ]);
    },
    DISCOVERY_TIMEOUT_MS,
  );
});
