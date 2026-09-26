import { mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverTests,
  type DiscoveredTest,
  type TestDiscovery,
  type WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
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

function sortedIdentities(tests: readonly DiscoveredTest[]): string[] {
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
