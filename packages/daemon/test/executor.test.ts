import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Executor, type JobOutcome } from "../src/daemon/executor.js";
import {
  createParseRecord,
  openParseRecord,
} from "../src/daemon/parse-record.js";
import type { TreeContainment } from "../src/daemon/process-tree.js";
import type {
  DependencyInformation,
  SelectableWorkspace,
} from "../src/selection/selection-types.js";
import { buildDependencyInformation } from "../src/selection/workspace-graph.js";
import { findPackageWorkspaces } from "../src/vitest/find-workspaces.js";
import { STRING_FIND } from "../src/vitest/selection-facts.js";
import { EXECUTOR_BOUND_MS } from "../src/daemon/executor-jobs.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
  settled,
  withEnvironment,
  withPreload,
} from "./daemon-harness.js";
import { inTempDir, REPO, waitUntil } from "./harness.js";
import { manifest, rootManifest, writeTree } from "./selection/harness.js";

/** The containment the next `Executor` is built with, and where each message sent to a forked process is recorded. */
const next = vi.hoisted(() => ({
  containment: undefined as TreeContainment | undefined,
  sends: undefined as string[] | undefined,
  /** Makes each fork fail to spawn, as a fork does when Node cannot start the process. */
  unstartable: false,
  /** Resolves once the latest forked process has exited, or failed to start, before the executor hears of it. */
  forkEnded: Promise.resolve(),
  /** Makes removing a parse record fail, as it does when the file system holds the file busy. */
  unremovableRecord: false,
}));

/** Records when `child` ends, listening before the executor does. */
function recordEnd(child: ChildProcess): ChildProcess {
  next.forkEnded = new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  return child;
}

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: (...args: Parameters<typeof actual.fork>) => {
      if (next.unstartable) return recordEnd(unstartedChild());
      const child = recordEnd(actual.fork(...args));
      const send = child.send.bind(child) as (...a: unknown[]) => boolean;
      child.send = ((...a: unknown[]) => {
        next.sends?.push(`send ${(a[0] as { type?: string }).type}`);
        return send(...a);
      }) as ChildProcess["send"];
      return child;
    },
  };
});

vi.mock("../src/daemon/process-tree.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/daemon/process-tree.js")>();
  return {
    ...actual,
    treeContainment: () => next.containment ?? actual.treeContainment(),
  };
});

vi.mock("../src/daemon/parse-record.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/daemon/parse-record.js")>();
  return {
    ...actual,
    removeParseRecord: (file: string) => {
      if (next.unremovableRecord) {
        throw new Error(`EBUSY: resource busy or locked, rm '${file}'`);
      }
      actual.removeParseRecord(file);
    },
  };
});

/** A fork that failed to spawn: it has no pid, emits `error`, and never emits `exit`. */
function unstartedChild(): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    pid: undefined,
    exitCode: null,
    signalCode: null,
    connected: false,
    send: () => false,
    kill: () => false,
    disconnect: () => undefined,
  });
  setTimeout(() => child.emit("error", new Error("spawn EACCES")), 10);
  return child as unknown as ChildProcess;
}

const { endProcessTree } = await vi.importActual<
  typeof import("../src/daemon/process-tree.js")
>("../src/daemon/process-tree.js");

interface Recording {
  /** What happened, in order: `contain`, `contained`, `send <type>`, `end`, `exit` and `close`. */
  readonly events: string[];
  /** Lets a held containment finish. */
  release(): void;
}

/**
 * Builds the containment the next `Executor` uses, recording each step and every message sent to any child process.
 * With `hold`, containing waits for `release`; with `fail`, it rejects; with `endWhileHeld`, it ends the child and
 * waits for its exit before it resolves. Ending a tree ends the executor for real, `killDelayMs` after it is asked.
 */
function recording(
  options: {
    hold?: boolean;
    fail?: boolean;
    endWhileHeld?: boolean;
    killDelayMs?: number;
  } = {},
): Recording {
  const events: string[] = [];
  let release = (): void => undefined;
  const held = options.hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  next.containment = {
    contain: async (child) => {
      events.push("contain");
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => {
          events.push("exit");
          resolve();
        }),
      );
      await held;
      if (options.endWhileHeld) {
        endProcessTree(child);
        await exited;
      }
      if (options.fail) throw new Error("no job object could hold it");
      events.push("contained");
      return {
        end: () => {
          events.push("end");
          setTimeout(() => endProcessTree(child), options.killDelayMs ?? 0);
          return Promise.resolve();
        },
      };
    },
    close: () => {
      events.push("close");
      return Promise.resolve();
    },
  };
  return { events, release: () => release() };
}

/** Runs `body` with each message sent to a forked process recorded in `events` as `send <type>`. */
async function recordingSends<T>(
  events: string[],
  body: () => Promise<T>,
): Promise<T> {
  next.sends = events;
  try {
    return await body();
  } finally {
    next.sends = undefined;
  }
}

/**
 * The outcome of `job`, or "never settled" when the job's executor process has ended and the job has still not settled
 * a turn of the event loop later. One turn is enough only because the recorded containment's `contain` and `end`
 * settle without timers or I/O: once that process has ended, the job settles through callbacks its end runs at once,
 * so a job that has not settled by then never will. A real containment would need more than a turn.
 */
function withinBound<T>(job: Promise<T>): Promise<T | "never settled"> {
  const ended = next.forkEnded;
  return Promise.race([
    job,
    ended.then(
      () =>
        new Promise<"never settled">((resolve) =>
          setImmediate(() => resolve("never settled")),
        ),
    ),
  ]);
}

/** A discovery of an empty consumer root, which the executor answers at once. */
function discoverIn(executor: Executor, root: string) {
  return executor.discover({ consumerRoot: root, workspaces: [] });
}

describe("holding each executor's tree before its job", () => {
  it(
    "D1681: an executor is sent its job only once it is held with the processes it starts",
    async () => {
      const { events } = recording();
      await inTempDir((root) =>
        recordingSends(events, async () => {
          const executor = new Executor(memoryLog());
          try {
            await discoverIn(executor, root);
          } finally {
            await executor.close();
          }
        }),
      );
      expect(events.slice(0, 3)).toStrictEqual([
        "contain",
        "contained",
        "send discover",
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1682: a job whose executor cannot be held is not run, and ends with nothing to store and the reason",
    async () => {
      const { events } = recording({ fail: true });
      const outcome = await inTempDir((root) =>
        recordingSends(events, async () => {
          const executor = new Executor(memoryLog());
          try {
            return await discoverIn(executor, root);
          } finally {
            await executor.close();
          }
        }),
      );
      expect({
        outcome,
        sent: events.filter((event) => event.startsWith("send")),
      }).toStrictEqual({
        outcome: {
          ended: false,
          reason: expect.stringContaining(
            "could not be held with the processes it starts, so the job was not run",
          ),
        },
        sent: [],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1684: an abort that arrives while the executor is being held leaves the job unrun and ends its tree",
    async () => {
      const { events, release } = recording({ hold: true });
      const outcome = await inTempDir((root) =>
        recordingSends(events, async () => {
          const executor = new Executor(memoryLog());
          try {
            const job = discoverIn(executor, root);
            await eventually(() => events.includes("contain"));
            executor.abort();
            release();
            return await job;
          } finally {
            await executor.close();
          }
        }),
      );
      expect({
        outcome,
        steps: events.filter((event) => event !== "close"),
      }).toStrictEqual({
        outcome: {
          ended: false,
          reason: expect.stringContaining("before the job was sent"),
        },
        steps: ["contain", "contained", "end", "exit"],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D1683: closing the executor releases what holds the trees, which on Windows ends the job object helper", async () => {
    const { events } = recording();
    await new Executor(memoryLog()).close();
    expect(events).toStrictEqual(["close"]);
  });

  it(
    "D1693: a job settles only once its executor has exited, not as soon as its tree's end is asked for",
    async () => {
      const { events } = recording({ killDelayMs: 300 });
      await inTempDir(async (root) => {
        const executor = new Executor(memoryLog());
        try {
          events.push(
            `settled: ${String((await withinBound(discoverIn(executor, root))) === "never settled")}`,
          );
        } finally {
          await executor.close();
        }
      });
      expect(
        events.filter(
          (event) => event === "exit" || event.startsWith("settled"),
        ),
      ).toStrictEqual(["exit", "settled: false"]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1694: a job whose executor exits while it is being held ends unrun, saying so, rather than never settling",
    async () => {
      recording({ endWhileHeld: true });
      const outcome = await inTempDir(async (root) => {
        const executor = new Executor(memoryLog());
        try {
          return await withinBound(discoverIn(executor, root));
        } finally {
          await executor.close();
        }
      });
      expect(outcome).toStrictEqual({
        ended: false,
        reason: expect.stringContaining("ended before its job was sent"),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1695: a job whose executor could not be started, with no pid and no exit, ends unrun, saying so",
    async () => {
      recording();
      next.unstartable = true;
      const outcome = await inTempDir(async (root) => {
        const executor = new Executor(memoryLog());
        try {
          return await withinBound(discoverIn(executor, root));
        } finally {
          next.unstartable = false;
          await executor.close();
        }
      });
      expect(outcome).toStrictEqual({
        ended: false,
        reason: expect.stringContaining("could not be started"),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

const BUILD_HOOK = join(REPO, "test/fixtures/daemon/build-hook.mjs");
/** Read by the build-hook preload in each executor process a test starts. */
const HOOK_VARIABLE = "RT_FIXTURE_BUILD_HOOK";
/** How the build-hook preload ends an executor. */
const HOOK_EXIT = "exit code 7";
/** About 45,000 terms still parse; this many end the process inside the native parser on every gate platform. */
const CRASH_TERMS = 100_000;
/** How that crash ends a process: Windows reports the stack overflow as the exit code, Linux as SIGSEGV. */
const PARSER_CRASH_EXIT =
  process.platform === "win32" ? "exit code 3221225725" : "signal SIGSEGV";
const PARSED_FILE = "packages/b/src/x.ts";
const NOT_KNOWN = "and the file it was parsing, if any, is not known";
const STOPPED =
  "the dependency build was stopped, so its executor process was ended before the build finished (process <pid>)";

interface BuildHook {
  /** The root-relative label of the file the hook acts at. */
  readonly at: string;
  readonly action: "hold" | "exit" | "remove-and-exit";
  /** Written once a hold begins. */
  readonly marker?: string;
}

/** Runs `body` with every executor it starts preloading the build hook. */
function withBuildHook<T>(hook: BuildHook, body: () => Promise<T>): Promise<T> {
  return withEnvironment(HOOK_VARIABLE, JSON.stringify(hook), () =>
    withPreload(BUILD_HOOK, body),
  );
}

interface BuildConsumer {
  readonly root: string;
  readonly state: string;
}

/** A consumer under `dir` whose `packages/app` depends on `packages/b`, which holds `PARSED_FILE`, plus `files`. */
function buildConsumer(
  dir: string,
  files: Readonly<Record<string, string>> = {},
): BuildConsumer {
  const root = join(dir, "consumer");
  const state = join(dir, "state");
  writeTree(root, {
    "package.json": rootManifest(),
    "packages/app/package.json": manifest({
      name: "@x/app",
      dependencies: { "@x/b": "workspace:*" },
    }),
    "packages/b/package.json": manifest({ name: "@x/b" }),
    [PARSED_FILE]: "export const x = 1;\n",
    ...files,
  });
  mkdirSync(state);
  return { root, state };
}

/** Builds over the consumer in an executor that holds the job's tree for real, then closes the executor. */
async function buildIn(
  { root, state }: BuildConsumer,
  workspaces: readonly SelectableWorkspace[] = [],
): Promise<JobOutcome<DependencyInformation>> {
  next.containment = undefined;
  const executor = new Executor(memoryLog());
  try {
    return await executor.buildDependencies(root, workspaces, state);
  } finally {
    await executor.close();
  }
}

/** The outcome with each process id in its reason written as `<pid>`. */
function withoutPid(outcome: JobOutcome<DependencyInformation>): unknown {
  return outcome.ended
    ? outcome
    : {
        ended: false,
        reason: outcome.reason.replace(/process \d+/g, "process <pid>"),
      };
}

interface StoppedBuild {
  readonly outcome: unknown;
  /** From the stop to the build's settling. */
  readonly stopMs: number;
}

/**
 * Starts a build over a consumer, waits until its executor is held inside the parse of `PARSED_FILE`, stops it as
 * `stop` does, and hands back the build's outcome and how long it took to settle after the stop.
 */
function stoppedMidBuild(
  stop: (executor: Executor) => Promise<void> | void,
): Promise<StoppedBuild> {
  return inTempDir(async (dir) => {
    const consumer = buildConsumer(dir);
    const marker = join(dir, "holding");
    return withBuildHook(
      { at: PARSED_FILE, action: "hold", marker },
      async () => {
        next.containment = undefined;
        const executor = new Executor(memoryLog());
        let stopped: Promise<void> | void = undefined;
        try {
          const job = executor.buildDependencies(
            consumer.root,
            [],
            consumer.state,
          );
          await waitUntil(() => existsSync(marker), job);
          const stoppedAt = performance.now();
          stopped = stop(executor);
          const outcome = withoutPid(await job);
          return { outcome, stopMs: performance.now() - stoppedAt };
        } finally {
          await stopped;
          await executor.close();
        }
      },
    );
  });
}

function appWorkspace(root: string): SelectableWorkspace {
  return {
    workspace: { path: "packages/app", directory: join(root, "packages/app") },
    tests: {
      known: true,
      tests: [
        {
          workspacePath: "packages/app",
          projectName: "unit",
          modulePath: "src/x.test.ts",
          namePath: ["t"],
          occurrence: 0,
        },
      ],
    },
    setupFiles: ["packages/b/setup.ts"],
    globalSetupFiles: [],
    aliases: [
      {
        find: "@b",
        findKind: STRING_FIND,
        flags: "",
        replacement: join(root, "packages/b/src"),
        hasCustomResolver: false,
        viteRoot: join(root, "packages/app"),
      },
    ],
  };
}

describe("a dependency build in an executor process of its own", () => {
  it(
    "D2238: the build answers exactly what it answers in process over the same root and selectable workspaces",
    async () => {
      const { outcome, inProcess } = await inTempDir(async (dir) => {
        const consumer = buildConsumer(dir, {
          "packages/b/setup.ts": "",
          "packages/app/src/x.test.ts": 'import "@b/x";\n',
        });
        const workspaces = [appWorkspace(consumer.root)];
        return {
          outcome: await buildIn(consumer, workspaces),
          inProcess: buildDependencyInformation(
            findPackageWorkspaces(consumer.root),
            workspaces,
          ),
        };
      });
      expect(outcome).toStrictEqual({ ended: true, value: inProcess });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2239: a file that ends the process inside the parser fails the build, the reason naming the exit and the file",
    async () => {
      const outcome = await inTempDir((dir) =>
        buildIn(
          buildConsumer(dir, {
            "packages/b/src/crash.ts": `a${"+a".repeat(CRASH_TERMS)}`,
          }),
        ),
      );
      expect(withoutPid(outcome)).toStrictEqual({
        ended: false,
        reason: `the executor process <pid> exited during the job (${PARSER_CRASH_EXIT}) while parsing packages/b/src/crash.ts`,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2240: a process that ends before its record names the file says the file is not known",
    async () => {
      const outcome = await inTempDir((dir) =>
        withBuildHook({ at: PARSED_FILE, action: "exit" }, () =>
          buildIn(buildConsumer(dir)),
        ),
      );
      expect(withoutPid(outcome)).toStrictEqual({
        ended: false,
        reason: `the executor process <pid> exited during the job (${HOOK_EXIT}), ${NOT_KNOWN}`,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2241: a process that ends with its record gone says the file is not known",
    async () => {
      const outcome = await inTempDir((dir) =>
        withBuildHook({ at: PARSED_FILE, action: "remove-and-exit" }, () =>
          buildIn(buildConsumer(dir)),
        ),
      );
      expect(withoutPid(outcome)).toStrictEqual({
        ended: false,
        reason: `the executor process <pid> exited during the job (${HOOK_EXIT}), ${NOT_KNOWN}`,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2242: no parse record is left in the state directory once the build has ended",
    async () => {
      const left = await inTempDir(async (dir) => {
        const consumer = buildConsumer(dir);
        await buildIn(consumer);
        return readdirSync(consumer.state);
      });
      expect(left).toStrictEqual([]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2243: a record an earlier daemon left in the state directory does not stop a later build",
    async () => {
      const outcome = await inTempDir(async (dir) => {
        const consumer = buildConsumer(dir);
        const writer = openParseRecord(createParseRecord(consumer.state));
        writer.parsing("packages/b/src/old.ts");
        writer.close();
        return buildIn(consumer);
      });
      expect(outcome.ended).toBe(true);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2249: a walked tsconfig that ends the process inside the parser is named, its parse recorded before it starts",
    async () => {
      const outcome = await inTempDir((dir) =>
        buildIn(
          buildConsumer(dir, {
            "packages/b/tsconfig.json": `1${"+1".repeat(CRASH_TERMS)}`,
          }),
        ),
      );
      expect(withoutPid(outcome)).toStrictEqual({
        ended: false,
        reason: `the executor process <pid> exited during the job (${PARSER_CRASH_EXIT}) while parsing packages/b/tsconfig.json`,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2250: a parse record that cannot be created ends the build unrun, with the reason, and sends no job",
    async () => {
      const sent: string[] = [];
      const outcome = await inTempDir((dir) =>
        recordingSends(sent, () =>
          settled(
            buildIn({
              root: buildConsumer(dir).root,
              state: join(dir, "missing"),
            }),
          ),
        ),
      );
      expect({ outcome, sent }).toStrictEqual({
        outcome: {
          ended: false,
          reason: expect.stringContaining(
            "parse record could not be created in the state directory",
          ),
        },
        sent: [],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2252: a parse record that cannot be removed leaves a finished build's answer, and the failure is logged",
    async () => {
      const log = memoryLog();
      const outcome = await inTempDir(async (dir) => {
        const { root, state } = buildConsumer(dir);
        next.containment = undefined;
        next.unremovableRecord = true;
        const executor = new Executor(log);
        try {
          return await settled(executor.buildDependencies(root, [], state));
        } finally {
          next.unremovableRecord = false;
          await executor.close();
        }
      });
      expect({
        ended: "ended" in outcome ? outcome.ended : outcome,
        logged: log.entries.some((entry) =>
          entry.startsWith(
            "the dependency build's parse record could not be removed",
          ),
        ),
      }).toStrictEqual({ ended: true, logged: true });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("stopping a dependency build", () => {
  it(
    "D2244: an abort mid-build ends the build's process at once rather than after the bound a Vitest job is given",
    async () => {
      const { outcome } = await stoppedMidBuild((executor) => executor.abort());
      expect(outcome).toStrictEqual({ ended: false, reason: STOPPED });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2245: an abort mid-parse gives the stop's reason, never a crash's naming the file being parsed",
    async () => {
      const { outcome } = await stoppedMidBuild((executor) => executor.abort());
      expect(outcome).toStrictEqual({ ended: false, reason: STOPPED });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2246: closing the executor mid-build stops the build at once, with the stop's reason",
    async () => {
      const { outcome } = await stoppedMidBuild((executor) => executor.close());
      expect(outcome).toStrictEqual({ ended: false, reason: STOPPED });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2251: an abort mid-build settles the build before the bound a Vitest job is given has passed",
    async () => {
      const { stopMs } = await stoppedMidBuild((executor) => executor.abort());
      expect(stopMs).toBeLessThan(EXECUTOR_BOUND_MS);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
