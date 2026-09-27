import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { Executor } from "../src/daemon/executor.js";
import type { TreeContainment } from "../src/daemon/process-tree.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  eventually,
  memoryLog,
} from "./daemon-harness.js";
import { inTempDir } from "./harness.js";

/** The containment the next `Executor` is built with, and where each message sent to a forked process is recorded. */
const next = vi.hoisted(() => ({
  containment: undefined as TreeContainment | undefined,
  sends: undefined as string[] | undefined,
  /** Makes each fork fail to spawn, as a fork does when Node cannot start the process. */
  unstartable: false,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: (...args: Parameters<typeof actual.fork>) => {
      if (next.unstartable) return unstartedChild();
      const child = actual.fork(...args);
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

/** Far past any job these tests run, so a job that never settles is reported rather than left to time the test out. */
const SETTLE_BOUND_MS = 20_000;

/** The outcome of `job`, or "never settled" once the bound passes. */
function withinBound<T>(job: Promise<T>): Promise<T | "never settled"> {
  return Promise.race([
    job,
    new Promise<"never settled">((resolve) =>
      setTimeout(() => resolve("never settled"), SETTLE_BOUND_MS).unref(),
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
