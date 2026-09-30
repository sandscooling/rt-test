import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HOOK_EXIT_CODE,
  HOOK_VARIABLE,
} from "../../../test/fixtures/daemon/build-hook.mjs";
import { REPORT_VARIABLE } from "../../../test/fixtures/daemon/report-environment.mjs";
import {
  type ChildEnd,
  WatchedChild,
} from "../../../test/scripts/child-end.js";
import { recordStarted } from "../../../test/scripts/run-cleanup.mjs";
import { daemonEntryPoint } from "../src/daemon/entry-point.js";
import {
  ABORT_PURPOSE,
  Executor,
  type JobOutcome,
} from "../src/daemon/executor.js";
import {
  createParseRecord,
  openParseRecord,
} from "../src/daemon/parse-record.js";
import type { TreeContainment } from "../src/daemon/process-tree.js";
import { takeStartEnvironment } from "../src/inputs/environment-digest.js";
import type {
  DependencyInformation,
  SelectableWorkspace,
} from "../src/selection/selection-types.js";
import { buildDependencyInformation } from "../src/selection/workspace-graph.js";
import type { TestDiscovery } from "../src/vitest/discover-tests.js";
import { findPackageWorkspaces } from "../src/vitest/find-workspaces.js";
import type {
  NotConfirmedRun,
  WorkspaceRun,
} from "../src/vitest/run-workspace.js";
import { STRING_FIND } from "../src/vitest/selection-facts.js";
import { EXECUTOR_BOUND_MS } from "../src/daemon/executor-jobs.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
  REPORT_ENVIRONMENT,
  reportedEnvironments,
  settled,
  withEnvironment,
  withPreload,
  withVariables,
} from "./daemon-harness.js";
import {
  finished,
  inConsumerCopy,
  inTempDir,
  ranRun,
  REPO,
  runSummary,
  runTempRoot,
  waitUntil,
  type VitestInstall,
} from "./harness.js";
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

const STOPPED_BEFORE_SEND =
  "the stop arrived before the job was sent to its executor process, so the job was not run";
const INTERRUPTED_BEFORE_SEND =
  "the run was interrupted by a change before the job was sent to its executor process, so the job was not run";

interface AbortedWhileHeld {
  readonly outcome: JobOutcome<TestDiscovery>;
  readonly events: string[];
  /** The outcome of the discovery run next on the same executor, when one was asked for. */
  readonly next: JobOutcome<TestDiscovery> | undefined;
}

/**
 * Starts a discovery whose executor is held before its job is sent, calls `abort` while it is held, then lets the hold
 * go, and hands back the discovery's outcome and each step the containment recorded. With `runNext`, a second
 * discovery then runs on the same executor.
 */
async function abortedWhileHeld(
  abort: (executor: Executor) => void,
  runNext = false,
): Promise<AbortedWhileHeld> {
  const { events, release } = recording({ hold: true });
  const [outcome, next] = await inTempDir((root) =>
    recordingSends(events, async () => {
      const executor = new Executor(memoryLog(), takeStartEnvironment());
      try {
        const job = discoverIn(executor, root);
        await eventually(() => events.includes("contain"));
        abort(executor);
        release();
        const first = await job;
        return [
          first,
          runNext ? await discoverIn(executor, root) : undefined,
        ] as const;
      } finally {
        await executor.close();
      }
    }),
  );
  return { outcome, events, next };
}

describe("holding each executor's tree before its job", () => {
  it(
    "D1681: an executor is sent its job only once it is held with the processes it starts",
    async () => {
      const { events } = recording();
      await inTempDir((root) =>
        recordingSends(events, async () => {
          const executor = new Executor(memoryLog(), takeStartEnvironment());
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
          const executor = new Executor(memoryLog(), takeStartEnvironment());
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
      const { outcome, events } = await abortedWhileHeld((executor) => {
        executor.abort();
      });
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

  it(
    "D2877: an interruption that arrives while the executor is being held leaves the job unrun with the interruption's reason, never the stop's",
    async () => {
      const { outcome } = await abortedWhileHeld((executor) => {
        executor.abort(ABORT_PURPOSE.interruption);
      });
      expect(outcome).toStrictEqual({
        ended: false,
        reason: expect.stringContaining(INTERRUPTED_BEFORE_SEND),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2891: an interruption asked after a stop, while the executor is being held, leaves the job unrun with the stop's reason",
    async () => {
      const { outcome } = await abortedWhileHeld((executor) => {
        executor.abort(ABORT_PURPOSE.stop);
        executor.abort(ABORT_PURPOSE.interruption);
      });
      expect(outcome).toStrictEqual({
        ended: false,
        reason: expect.stringContaining(STOPPED_BEFORE_SEND),
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2907: after an interruption left a job unrun before its send, the next job on the same executor runs",
    async () => {
      const { outcome, next } = await abortedWhileHeld((executor) => {
        executor.abort(ABORT_PURPOSE.interruption);
      }, true);
      expect({ first: outcome.ended, next: next?.ended }).toStrictEqual({
        first: false,
        next: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2908: an abort while the executor is being held, before its job is sent, says it reached the job",
    async () => {
      const reached: boolean[] = [];
      await abortedWhileHeld((executor) => {
        reached.push(executor.abort(ABORT_PURPOSE.interruption));
      });
      expect(reached).toStrictEqual([true]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2892: an abort once a job's reply has settled reaches no job, and says so",
    async () => {
      recording();
      const reached = await inTempDir(async (root) => {
        const executor = new Executor(memoryLog(), takeStartEnvironment());
        try {
          await discoverIn(executor, root);
          return executor.abort(ABORT_PURPOSE.interruption);
        } finally {
          await executor.close();
        }
      });
      expect(reached).toBe(false);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D1683: closing the executor releases what holds the trees, which on Windows ends the job object helper", async () => {
    const { events } = recording();
    await new Executor(memoryLog(), takeStartEnvironment()).close();
    expect(events).toStrictEqual(["close"]);
  });

  it(
    "D1693: a job settles only once its executor has exited, not as soon as its tree's end is asked for",
    async () => {
      const { events } = recording({ killDelayMs: 300 });
      await inTempDir(async (root) => {
        const executor = new Executor(memoryLog(), takeStartEnvironment());
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
        const executor = new Executor(memoryLog(), takeStartEnvironment());
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
        const executor = new Executor(memoryLog(), takeStartEnvironment());
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
/** How the build-hook preload ends an executor. */
const HOOK_EXIT = `exit code ${HOOK_EXIT_CODE}`;
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
  const executor = new Executor(memoryLog(), takeStartEnvironment());
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
        const executor = new Executor(memoryLog(), takeStartEnvironment());
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
        const executor = new Executor(log, takeStartEnvironment());
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
      const { outcome } = await stoppedMidBuild((executor) => {
        executor.abort();
      });
      expect(outcome).toStrictEqual({ ended: false, reason: STOPPED });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2245: an abort mid-parse gives the stop's reason, never a crash's naming the file being parsed",
    async () => {
      const { outcome } = await stoppedMidBuild((executor) => {
        executor.abort();
      });
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
      const { stopMs } = await stoppedMidBuild((executor) => {
        executor.abort();
      });
      expect(stopMs).toBeLessThan(EXECUTOR_BOUND_MS);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

const HOST_REJECTION_FIXTURE = "host-rejection";
/** Read by the host-rejection fixture's config and global setup: the one site that leaks a rejection. */
const LEAK_SITE = "RT_HOST_REJECTION";
const FIXTURE_CONFIG = "vitest.config.mjs";
const RECORDED =
  "unhandled rejection on the host thread while the session was open: ";
const OUTSIDE =
  "unhandled rejection on the host thread while no Vitest session was open: ";
const STRICT_REJECTIONS = "--unhandled-rejections=strict";

type LeakSite =
  | "config"
  | "plugin"
  | "global-setup"
  | "teardown"
  | "config-then-throw"
  | "global-setup-and-test-body";

/** Runs `job` in a fresh executor over a copy of the host-rejection fixture whose `site` leaks, then closes it. */
function inLeakingConsumer<T>(
  install: VitestInstall,
  site: LeakSite,
  job: (executor: Executor, root: string) => Promise<T>,
): Promise<T> {
  return inConsumerCopy(HOST_REJECTION_FIXTURE, install, (root) =>
    withEnvironment(LEAK_SITE, site, async () => {
      next.containment = undefined;
      const executor = new Executor(memoryLog(), takeStartEnvironment());
      try {
        return await job(executor, root);
      } finally {
        await executor.close();
      }
    }),
  );
}

function runLeaking(
  install: VitestInstall,
  site: LeakSite,
): Promise<JobOutcome<WorkspaceRun | NotConfirmedRun>> {
  return inLeakingConsumer(install, site, (executor, root) =>
    executor.run({ path: ".", directory: root }, FIXTURE_CONFIG),
  );
}

function discoverLeaking(
  install: VitestInstall,
  site: LeakSite,
): Promise<JobOutcome<TestDiscovery>> {
  return inLeakingConsumer(install, site, (executor, root) =>
    executor.discover({
      consumerRoot: root,
      workspaces: [{ path: ".", configFile: FIXTURE_CONFIG }],
    }),
  );
}

/** A run's test states and unhandled errors; a job that ended unrun as its outcome, which names why. */
function ranWithErrors(
  outcome: JobOutcome<WorkspaceRun | NotConfirmedRun>,
): unknown {
  if (!outcome.ended) return outcome;
  return {
    summary: runSummary(outcome.value),
    unhandledErrors: ranRun(outcome.value)?.unhandledErrors,
  };
}

/** Both fixture tests passed and stored, beside the rejection from `where` as the run's only unhandled error. */
function completedWithRejection(where: string): unknown {
  return {
    summary: {
      execution: "completed",
      modules: {
        "a.test.mjs": {
          first: finished("passed"),
          second: finished("passed"),
        },
      },
    },
    unhandledErrors: [`${RECORDED}host rejection from ${where}`],
  };
}

/** The discovered workspace's test count and unhandled errors; anything else as it came. */
function discoveredErrors(outcome: JobOutcome<TestDiscovery>): unknown {
  if (!outcome.ended) return outcome;
  const [workspace] = outcome.value.workspaces;
  if (workspace?.status !== "discovered") return workspace;
  return {
    status: workspace.status,
    tests: workspace.tests.length,
    unhandledErrors: workspace.unhandledErrors,
  };
}

/** Whether a failed run keeps its own error and has the labelled rejection follow it; anything else as it came. */
function failedWithRejection(
  outcome: JobOutcome<WorkspaceRun | NotConfirmedRun>,
): unknown {
  if (!outcome.ended || outcome.value.status !== "failed") return outcome;
  const { error } = outcome.value;
  return {
    status: outcome.value.status,
    keepsItsError: error.includes("the config does not load"),
    rejectionFollows: error.endsWith(
      `\n${RECORDED}host rejection from the config`,
    ),
  };
}

describe("an unhandled rejection on the executor's host thread while a run's session is open", () => {
  it(
    "D2748: on Vitest 5, a run whose global setup leaks one completes, its tests passed and the rejection labelled among its unhandled errors",
    async () => {
      expect(
        ranWithErrors(await runLeaking("vitest", "global-setup")),
      ).toStrictEqual(completedWithRejection("the global setup"));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2749: on Vitest 4.1, a run whose global setup leaks one completes, its tests passed and the rejection labelled among its unhandled errors",
    async () => {
      expect(
        ranWithErrors(await runLeaking("vitest-4", "global-setup")),
      ).toStrictEqual(completedWithRejection("the global setup"));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2750: on Vitest 5, a run whose config leaks one as it loads completes, with the rejection labelled among its unhandled errors",
    async () => {
      expect(ranWithErrors(await runLeaking("vitest", "config"))).toStrictEqual(
        completedWithRejection("the config"),
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2751: on Vitest 4.1, a run whose config leaks one as it loads completes, with the rejection labelled among its unhandled errors",
    async () => {
      expect(
        ranWithErrors(await runLeaking("vitest-4", "config")),
      ).toStrictEqual(completedWithRejection("the config"));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2752: on Vitest 5, a run whose plugin leaks one in a transform completes, with the rejection labelled among its unhandled errors",
    async () => {
      expect(ranWithErrors(await runLeaking("vitest", "plugin"))).toStrictEqual(
        completedWithRejection("a plugin transform"),
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2753: on Vitest 4.1, a run whose plugin leaks one in a transform completes, with the rejection labelled among its unhandled errors",
    async () => {
      expect(
        ranWithErrors(await runLeaking("vitest-4", "plugin")),
      ).toStrictEqual(completedWithRejection("a plugin transform"));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2754: on Vitest 5, a run whose global setup's teardown leaks one as the session closes completes, with the rejection labelled among its unhandled errors",
    async () => {
      expect(
        ranWithErrors(await runLeaking("vitest", "teardown")),
      ).toStrictEqual(completedWithRejection("the global setup's teardown"));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2755: on Vitest 4.1, a run whose global setup's teardown leaks one as the session closes completes, with the rejection labelled among its unhandled errors",
    async () => {
      expect(
        ranWithErrors(await runLeaking("vitest-4", "teardown")),
      ).toStrictEqual(completedWithRejection("the global setup's teardown"));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2759: under a strict --unhandled-rejections mode in NODE_OPTIONS, a run whose global setup leaks one still completes with it labelled",
    async () => {
      const outcome = await withEnvironment(
        "NODE_OPTIONS",
        [process.env["NODE_OPTIONS"], STRICT_REJECTIONS]
          .filter(Boolean)
          .join(" "),
        () => runLeaking("vitest", "global-setup"),
      );
      expect(ranWithErrors(outcome)).toStrictEqual(
        completedWithRejection("the global setup"),
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2768: a run whose test body and global setup each leak one keeps both, the worker's unlabelled and the host's labelled",
    async () => {
      const outcome = await runLeaking("vitest", "global-setup-and-test-body");
      const errors = outcome.ended
        ? (ranRun(outcome.value)?.unhandledErrors ?? [])
        : [outcome.reason];
      expect({
        worker: errors.filter((error) => !error.startsWith(RECORDED)),
        host: errors.filter((error) => error.startsWith(RECORDED)),
      }).toStrictEqual({
        worker: [expect.stringMatching(/^rejection from a test body/)],
        host: [`${RECORDED}host rejection from the global setup`],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2758: a rejection leaked by a config that then fails to load follows the failed session's own error, labelled, rather than being dropped",
    async () => {
      expect(
        failedWithRejection(await runLeaking("vitest", "config-then-throw")),
      ).toStrictEqual({
        status: "failed",
        keepsItsError: true,
        rejectionFollows: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("an unhandled rejection on the executor's host thread while a discovery's session is open", () => {
  it(
    "D2756: on Vitest 5, it is recorded, labelled, among the discovered workspace's unhandled errors",
    async () => {
      expect(
        discoveredErrors(await discoverLeaking("vitest", "config")),
      ).toStrictEqual({
        status: "discovered",
        tests: 2,
        unhandledErrors: [`${RECORDED}host rejection from the config`],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2757: on Vitest 4.1, it is recorded, labelled, among the discovered workspace's unhandled errors",
    async () => {
      expect(
        discoveredErrors(await discoverLeaking("vitest-4", "config")),
      ).toStrictEqual({
        status: "discovered",
        tests: 2,
        unhandledErrors: [`${RECORDED}host rejection from the config`],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

const GUARD_DRIVER = join(
  REPO,
  "test/fixtures/daemon/host-rejection/guard-driver.mjs",
);
const GUARD_MODULE = new URL(
  "../src/vitest/host-rejections.ts",
  import.meta.url,
).href;
/** The mode the executor is forked in, so the driver meets a rejection as the executor does. */
const EXECUTOR_REJECTION_MODE = "--unhandled-rejections=throw";
const ISO_TIME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z`;
const LOGGED_REJECTION = "unhandled rejection on the host thread";
const NOT_RECORDED_COUNT =
  "1 more unhandled rejections on the host thread while the session was open are not recorded";

interface DrivenGuard {
  readonly end: ChildEnd;
  readonly pid: number | undefined;
}

/** Runs the guard driver's `scenario` in a Node process of its own, which installs the guard as the executor does. */
async function driveGuard(...scenario: string[]): Promise<DrivenGuard> {
  const child = spawn(
    process.execPath,
    [
      ...daemonEntryPoint("executor-main").execArgv,
      EXECUTOR_REJECTION_MODE,
      GUARD_DRIVER,
      GUARD_MODULE,
      ...scenario,
    ],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const watched = new WatchedChild(child, "the guard driver");
  if (child.pid !== undefined) {
    recordStarted(runTempRoot(), { pids: [child.pid] });
  }
  return { end: await watched.end, pid: child.pid };
}

/** The rejections a driven session recorded, or a throw naming how the driver ended when it wrote none. */
function recordedBy({ end }: DrivenGuard): string[] {
  if (end.code !== 0) {
    throw new Error(
      `the guard driver ended with ${end.code ?? end.signal}: ${end.stderr}`,
    );
  }
  return JSON.parse(end.stdout) as string[];
}

/** The lines the guard logged to stderr. */
function loggedRejections({ end }: DrivenGuard): string[] {
  return end.stderr
    .split(/\r?\n/)
    .filter((line) => line.includes(LOGGED_REJECTION));
}

/** How many of a session's entries are labelled rejections, and the entries that are not. */
function keptAndCounted(rejections: readonly string[]): {
  kept: number;
  counted: string[];
} {
  return {
    kept: rejections.filter((entry) => entry.startsWith(RECORDED)).length,
    counted: rejections.filter((entry) => !entry.startsWith(RECORDED)),
  };
}

describe("the executor's guard against host unhandled rejections", () => {
  it(
    "D2760: a rejection raised while no session is open leaves the process running",
    async () => {
      const { end } = await driveGuard("outside");
      expect({
        code: end.code,
        signal: end.signal,
        stdout: end.stdout,
      }).toStrictEqual({ code: 0, signal: null, stdout: "survived\n" });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2761: a rejection raised while no session is open is logged to stderr with an ISO time, the process id and its label",
    async () => {
      const driven = await driveGuard("outside");
      expect(loggedRejections(driven)).toStrictEqual([
        expect.stringMatching(
          new RegExp(
            `^${ISO_TIME} executor ${driven.pid}: ${OUTSIDE}host rejection while no session was open$`,
          ),
        ),
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2769: a rejection raised after a session has closed is logged as raised while no session was open, not taken by the closed one",
    async () => {
      const driven = await driveGuard("after-close");
      expect(loggedRejections(driven)).toStrictEqual([
        expect.stringMatching(
          new RegExp(
            `^${ISO_TIME} executor ${driven.pid}: ${OUTSIDE}host rejection after the session closed$`,
          ),
        ),
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2762: a rejection raised as the session's body returns is recorded on that session, not left to fall outside it",
    async () => {
      expect(recordedBy(await driveGuard("at-end"))).toStrictEqual([
        `${RECORDED}host rejection as the session's body returns`,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2763: a session that meets exactly 100 rejections keeps all 100 and counts none",
    async () => {
      expect(
        keptAndCounted(recordedBy(await driveGuard("record", "100"))),
      ).toStrictEqual({ kept: 100, counted: [] });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2764: a session that meets 101 rejections keeps no more than 100",
    async () => {
      expect(
        keptAndCounted(recordedBy(await driveGuard("record", "101"))).kept,
      ).toBe(100);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2765: a session that meets 101 rejections adds one entry counting the one it did not keep",
    async () => {
      expect(
        keptAndCounted(recordedBy(await driveGuard("record", "101"))).counted,
      ).toStrictEqual([NOT_RECORDED_COUNT]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2766: each rejection a session keeps is also logged, and one past the bound is not",
    async () => {
      expect(loggedRejections(await driveGuard("record", "101")).length).toBe(
        100,
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

const CRASH_FIXTURE = "executor-crash";
/** Read by the executor-crash fixture's global setup at each job: how it ends the executor process. */
const CRASH_FILE = "crash";
/** While this directory exists, the executor-crash fixture's first test holds on it. */
const HOLD_POINT = "hold-point";
const UNCAUGHT_EXIT =
  "the executor process <pid> exited during the job (exit code 1)";
const TEARDOWN_EXIT =
  "the executor process <pid> exited during the job (exit code 3)";

type CrashKind = "throw" | "exit-in-teardown" | "send-ready" | "none";

/** Runs `job` in a fresh executor over a copy of the executor-crash fixture set to `crash`, then closes it. */
function inCrashingConsumer<T>(
  install: VitestInstall,
  crash: CrashKind,
  job: (executor: Executor, root: string) => Promise<T>,
): Promise<T> {
  return inConsumerCopy(CRASH_FIXTURE, install, async (root) => {
    crashAs(root, crash);
    next.containment = undefined;
    const executor = new Executor(memoryLog(), takeStartEnvironment());
    try {
      return await job(executor, root);
    } finally {
      await executor.close();
    }
  });
}

/** Sets how the executor-crash fixture at `root` ends each executor process from its next job on. */
function crashAs(root: string, crash: CrashKind): void {
  writeFileSync(join(root, CRASH_FILE), crash);
}

function runIn(executor: Executor, root: string) {
  return executor.run({ path: ".", directory: root }, FIXTURE_CONFIG);
}

/**
 * Starts a run whose first test holds, waits until it holds, applies `stop`, releases the test, and hands back the
 * run's outcome once `stop` has also settled.
 */
async function stoppedWhileHeld(
  executor: Executor,
  root: string,
  stop: (executor: Executor) => Promise<void> | void,
): Promise<JobOutcome<WorkspaceRun | NotConfirmedRun>> {
  const hold = join(root, HOLD_POINT);
  mkdirSync(hold);
  const job = runIn(executor, root);
  await waitUntil(() => existsSync(join(hold, "holding")), job);
  const stopped = stop(executor);
  writeFileSync(join(hold, "release"), "");
  const outcome = await job;
  await stopped;
  return outcome;
}

const pidless = (text: string): string =>
  text.replace(/process \d+/g, "process <pid>");

/** A job's outcome with each process id written as `<pid>`: a crashed run as its status, path and error, and any other result as its status. */
function crashFacts(
  outcome: JobOutcome<WorkspaceRun | NotConfirmedRun | TestDiscovery>,
): unknown {
  if (!outcome.ended) return { ended: false, reason: pidless(outcome.reason) };
  const { value } = outcome;
  if (!("status" in value)) return { ended: true, status: "discovered" };
  if (value.status !== "crashed") return { ended: true, status: value.status };
  return {
    ended: true,
    status: value.status,
    workspacePath: value.workspace.path,
    error: pidless(value.error),
  };
}

function crashedWith(error: string): unknown {
  return { ended: true, status: "crashed", workspacePath: ".", error };
}

describe("a run whose executor process dies with no stop asked of it", () => {
  it(
    "D2775: on Vitest 5, a run whose global setup throws uncaught is a crashed run naming the exit code",
    async () => {
      const outcome = await inCrashingConsumer("vitest", "throw", runIn);
      expect(crashFacts(outcome)).toStrictEqual(crashedWith(UNCAUGHT_EXIT));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2776: on Vitest 4.1, a run whose global setup throws uncaught is a crashed run naming the exit code",
    async () => {
      const outcome = await inCrashingConsumer("vitest-4", "throw", runIn);
      expect(crashFacts(outcome)).toStrictEqual(crashedWith(UNCAUGHT_EXIT));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2777: a run whose global setup's teardown calls process.exit is a crashed run naming that exit code",
    async () => {
      const outcome = await inCrashingConsumer(
        "vitest",
        "exit-in-teardown",
        runIn,
      );
      expect(crashFacts(outcome)).toStrictEqual(crashedWith(TEARDOWN_EXIT));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2799: a run whose global setup sends its own message on the executor's channel runs to completion, its tests passed",
    async () => {
      const outcome = await inCrashingConsumer("vitest", "send-ready", runIn);
      expect(outcome.ended ? runSummary(outcome.value) : outcome).toStrictEqual(
        {
          execution: "completed",
          modules: {
            "a.test.mjs": {
              held: finished("passed"),
              second: finished("passed"),
            },
          },
        },
      );
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2800: a message on the executor's channel that is no job reply is logged as ignored, naming the process",
    async () => {
      const log = memoryLog();
      await inConsumerCopy(CRASH_FIXTURE, "vitest", async (root) => {
        crashAs(root, "send-ready");
        next.containment = undefined;
        const executor = new Executor(log, takeStartEnvironment());
        try {
          await runIn(executor, root);
        } finally {
          await executor.close();
        }
      });
      expect(
        log.entries
          .filter((entry) => entry.includes("no job reply"))
          .map(pidless),
      ).toStrictEqual([
        "the executor process sent a message that is no job reply, as the project's own code may, so the message was ignored (process <pid>)",
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2797: a run whose executor dies settles once the process has exited, rather than never",
    async () => {
      const outcome = await inConsumerCopy(
        CRASH_FIXTURE,
        "vitest",
        async (root) => {
          crashAs(root, "throw");
          recording();
          const executor = new Executor(memoryLog(), takeStartEnvironment());
          try {
            return await withinBound(runIn(executor, root));
          } finally {
            await executor.close();
          }
        },
      );
      expect(
        outcome === "never settled" ? outcome : crashFacts(outcome),
      ).toStrictEqual(crashedWith(UNCAUGHT_EXIT));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2780: after a job that was stopped, the next job's unasked death is still a crashed run",
    async () => {
      const outcome = await inCrashingConsumer(
        "vitest",
        "none",
        async (executor, root) => {
          await stoppedWhileHeld(executor, root, (stopping) => {
            stopping.abort();
          });
          crashAs(root, "throw");
          return runIn(executor, root);
        },
      );
      expect(crashFacts(outcome)).toStrictEqual(crashedWith(UNCAUGHT_EXIT));
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("interrupting a run in progress", () => {
  it(
    "D2909: an abort of a run whose job was sent and is running says it reached the job",
    async () => {
      const reached: boolean[] = [];
      await inCrashingConsumer("vitest", "none", (executor, root) =>
        stoppedWhileHeld(executor, root, (running) => {
          reached.push(running.abort(ABORT_PURPOSE.interruption));
        }),
      );
      expect(reached).toStrictEqual([true]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("an executor process that dies after a stop, or during a job that is not a run", () => {
  it(
    "D2778: a run whose executor exits after an abort stores nothing, ending with the exit's reason",
    async () => {
      const outcome = await inCrashingConsumer(
        "vitest",
        "exit-in-teardown",
        (executor, root) =>
          stoppedWhileHeld(executor, root, (stopping) => {
            stopping.abort();
          }),
      );
      expect(crashFacts(outcome)).toStrictEqual({
        ended: false,
        reason: TEARDOWN_EXIT,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2779: a run whose executor exits after the executor is closed stores nothing, ending with the exit's reason",
    async () => {
      const outcome = await inCrashingConsumer(
        "vitest",
        "exit-in-teardown",
        (executor, root) =>
          stoppedWhileHeld(executor, root, (stopping) => stopping.close()),
      );
      expect(crashFacts(outcome)).toStrictEqual({
        ended: false,
        reason: TEARDOWN_EXIT,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D2781: a discovery whose executor dies stores nothing, ending with the exit's reason as before",
    async () => {
      const outcome = await inCrashingConsumer(
        "vitest",
        "throw",
        (executor, root) =>
          executor.discover({
            consumerRoot: root,
            workspaces: [{ path: ".", configFile: FIXTURE_CONFIG }],
          }),
      );
      expect(crashFacts(outcome)).toStrictEqual({
        ended: false,
        reason: UNCAUGHT_EXIT,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

const GAINED_VARIABLE = "RT_TEST_GAINED";
const CHANGED_VARIABLE = "RT_TEST_CHANGED";
const LOST_VARIABLE = "RT_TEST_LOST";
/** Node copies this one from its own live environment into a child's. */
const COVERAGE_VARIABLE = "NODE_V8_COVERAGE";

type Variables = Readonly<Record<string, string | undefined>>;

interface EnvironmentScenario {
  /** Set in the live environment as the start environment is taken; unset where undefined. */
  readonly start: Variables;
  /** Applied to the live environment once the executor is built, and held while its job runs. */
  readonly later: Variables;
}

/**
 * Takes a start environment with `start` applied, builds an executor from it, applies `later` to the live environment
 * around one discovery, and hands back the environment each executor process started with, as the report-environment
 * preload saw it. `scenario` is given the test's directory.
 */
function executorEnvironments(
  scenario: (dir: string) => EnvironmentScenario,
): Promise<{ dir: string; environments: NodeJS.ProcessEnv[] }> {
  return inTempDir(async (dir) => {
    const { start, later } = scenario(dir);
    const report = join(dir, "environments.jsonl");
    return withPreload(REPORT_ENVIRONMENT, () =>
      withVariables({ ...start, [REPORT_VARIABLE]: report }, async () => {
        next.containment = undefined;
        const executor = new Executor(memoryLog(), takeStartEnvironment());
        try {
          await withVariables(later, () => discoverIn(executor, dir));
        } finally {
          await executor.close();
        }
        return { dir, environments: reportedEnvironments(report) };
      }),
    );
  });
}

describe("the environment each executor process starts with", () => {
  it(
    "D3331: an executor process starts with the start environment rather than the daemon's live one: a variable gained since is absent, and one changed or lost since arrives as the start environment held it",
    async () => {
      const { environments } = await executorEnvironments(() => ({
        start: {
          [GAINED_VARIABLE]: undefined,
          [CHANGED_VARIABLE]: "at the start",
          [LOST_VARIABLE]: "at the start",
        },
        later: {
          [GAINED_VARIABLE]: "later",
          [CHANGED_VARIABLE]: "later",
          [LOST_VARIABLE]: undefined,
        },
      }));
      expect(
        environments.map((environment) => ({
          gained: environment[GAINED_VARIABLE],
          changed: environment[CHANGED_VARIABLE],
          lost: environment[LOST_VARIABLE],
        })),
      ).toStrictEqual([
        { gained: undefined, changed: "at the start", lost: "at the start" },
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3332: a NODE_V8_COVERAGE the daemon's live environment gains after the start never reaches an executor process",
    async () => {
      const { environments } = await executorEnvironments((dir) => ({
        start: { [COVERAGE_VARIABLE]: undefined },
        later: { [COVERAGE_VARIABLE]: join(dir, "coverage-gained") },
      }));
      expect(
        environments.map((environment) => environment[COVERAGE_VARIABLE]),
      ).toStrictEqual([undefined]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3333: a NODE_V8_COVERAGE the start environment holds reaches the executor process with its value, after the live environment lost it",
    async () => {
      const { dir, environments } = await executorEnvironments((root) => ({
        start: { [COVERAGE_VARIABLE]: join(root, "coverage-at-start") },
        later: { [COVERAGE_VARIABLE]: undefined },
      }));
      expect(
        environments.map((environment) => environment[COVERAGE_VARIABLE]),
      ).toStrictEqual([join(dir, "coverage-at-start")]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
