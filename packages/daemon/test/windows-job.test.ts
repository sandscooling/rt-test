import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi, type Mock } from "vitest";
import { WindowsJobs } from "../src/daemon/windows-job.js";
import { settled } from "./daemon-harness.js";
import { flush } from "./scheduling-harness.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn<typeof actual.spawn>() };
});

/** A stand-in helper as a test drives it: the commands it was sent, its output, its exit as Node records it, and its kill. */
type StandInHelper = EventEmitter & {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly kill: Mock<ChildProcess["kill"]>;
  readonly commands: string[];
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
};

/** How a stand-in helper answers: what it writes at its start, and its answer to each command it is sent. */
interface HelperScript {
  readonly start: readonly string[];
  readonly answer: (
    command: string,
    helper: StandInHelper,
  ) => string | undefined;
  /** Closes its output and exits right after its start lines, as a helper that cannot compile does. */
  readonly exitAfterStart?: boolean;
}

/**
 * Makes each `spawn` of the job object helper start a stand-in following the next script in `scripts`, whichever
 * platform runs the test, and returns the stand-ins as they start. It answers across a tick, as a pipe does, and its
 * `kill` is recorded and ends nothing, like a helper slow to exit.
 */
function standInHelpers(scripts: readonly HelperScript[]): StandInHelper[] {
  const queue = [...scripts];
  const started: StandInHelper[] = [];
  vi.mocked(spawn).mockImplementation((() => {
    const script = queue.shift();
    if (script === undefined) throw new Error("no stand-in helper left");
    const helper: StandInHelper = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn<ChildProcess["kill"]>(() => true),
      commands: [],
      exitCode: null,
      signalCode: null,
    });
    started.push(helper);
    helper.stdin.on("data", (chunk: Buffer) => {
      for (const command of chunk.toString("utf8").split("\n")) {
        if (command === "") continue;
        helper.commands.push(command);
        const reply = script.answer(command, helper);
        if (reply !== undefined) {
          process.nextTick(() => helper.stdout.write(`${reply}\n`));
        }
      }
    });
    for (const line of script.start) helper.stdout.write(`${line}\n`);
    if (script.exitAfterStart) {
      helper.stdout.end();
      helper.stdout.once("end", () =>
        setImmediate(() => helper.emit("close", 1, null)),
      );
    }
    return helper as unknown as ChildProcess;
  }) as unknown as typeof spawn);
  return started;
}

const EXECUTOR_PID = 4242;
const OTHER_EXECUTOR_PID = 4243;

/** A stand-in executor as `contain` reads it: its process id, and whether Node has recorded its exit. */
function standInExecutor(pid = EXECUTOR_PID): {
  readonly child: ChildProcess;
  readonly exit: () => void;
} {
  const executor: {
    pid: number | undefined;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
  } = { pid, exitCode: null, signalCode: null };
  return {
    child: executor as unknown as ChildProcess,
    exit: () => {
      executor.exitCode = 1;
    },
  };
}

/** Answers every command as a helper that assigns each process to job 7 does. */
function answersEveryCommand(command: string): string {
  return command.startsWith("assign") ? "ok 7" : "ok";
}

/** Runs `body` with `SystemRoot` set, as Windows sets it, so the helper's path resolves on either host. */
async function withSystemRoot<T>(body: () => Promise<T>): Promise<T> {
  const saved = process.env["SystemRoot"];
  process.env["SystemRoot"] = saved ?? "C:\\Windows";
  try {
    return await body();
  } finally {
    if (saved === undefined) delete process.env["SystemRoot"];
  }
}

const STILL_WAITING = "still waiting";

/**
 * Settles `work` with the answer bound's clock stopped, or reports it still waiting once the stand-ins have had every
 * turn they need to answer, so a job left waiting fails its assertion rather than the test's timeout.
 */
async function settledSoon<T>(work: () => Promise<T>) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    return await Promise.race([
      settled(work()),
      flush().then(() => STILL_WAITING),
    ]);
  } finally {
    vi.useRealTimers();
  }
}

/** Emits an error on a stand-in helper and says whether a listener handled it or the emit threw it. */
function emittedError(helper: StandInHelper, error: Error): string {
  try {
    helper.emit("error", error);
    return "handled";
  } catch {
    return "thrown";
  }
}

const CLM_REASON =
  "Cannot add type. Definition of new types is not supported in this language mode.";
const READ_FAILURE = "the pipe read failed with ERROR_NETNAME_DELETED";
const WRITE_FAILURE = "write EPIPE";

describe("the job object helper", () => {
  it("D1698: a helper that cannot compile its job class is reported with PowerShell's reason, the policy and the remedy", async () => {
    standInHelpers([
      {
        start: [`blocked-by-policy ${CLM_REASON}`],
        answer: () => undefined,
        exitAfterStart: true,
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settled(new WindowsJobs().contain(standInExecutor().child)),
    );
    expect(outcome).toStrictEqual({
      thrown: expect.stringMatching(
        /refused to compile .*\(Cannot add type\. Definition of new types is not supported in this language mode\)\. .*Constrained Language Mode.*allow Add-Type/,
      ),
    });
  });

  it("D1699: once a helper misses the answer bound, the next job starts a new helper rather than asking the silent one", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: () => undefined },
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const outcome = await withSystemRoot(async () => {
        const jobs = new WindowsJobs();
        const first = settled(jobs.contain(standInExecutor().child));
        await vi.advanceTimersByTimeAsync(10_000);
        const second = settled(
          jobs
            .contain(standInExecutor(OTHER_EXECUTOR_PID).child)
            .then(() => "held"),
        );
        await vi.advanceTimersByTimeAsync(10_000);
        return {
          first: await first,
          second: await second,
          helpers: helpers.length,
        };
      });
      expect(outcome).toStrictEqual({
        first: {
          thrown: expect.stringContaining("did not answer within 10000 ms"),
        },
        second: "held",
        helpers: 2,
      });
    } finally {
      vi.useRealTimers();
      vi.mocked(spawn).mockReset();
    }
  });

  it("D2816: a read error on the helper's output rejects the job waiting on its answer with that error", async () => {
    standInHelpers([
      {
        start: ["ready"],
        answer: (_command, helper) => {
          helper.stdout.destroy(new Error(READ_FAILURE));
          return undefined;
        },
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(standInExecutor().child)),
    );
    expect(outcome).toStrictEqual({ thrown: READ_FAILURE });
  });

  it("D2817: a helper whose output failed is killed, so every job tree it held ends with it", async () => {
    const helpers = standInHelpers([
      {
        start: ["ready"],
        answer: (_command, helper) => {
          helper.stdout.destroy(new Error(READ_FAILURE));
          return undefined;
        },
      },
    ]);
    await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(standInExecutor().child)),
    );
    expect(
      helpers.map((helper) => helper.kill.mock.calls.length),
    ).toStrictEqual([1]);
  });

  it("D2818: a second error on the helper process is handled rather than thrown into the daemon", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(async () => {
      await settledSoon(() =>
        new WindowsJobs().contain(standInExecutor().child),
      );
      return helpers.flatMap((helper) => [
        emittedError(helper, new Error("spawn failed")),
        emittedError(helper, new Error("kill failed")),
      ]);
    });
    expect(outcome).toStrictEqual(["handled", "handled"]);
  });

  it("D2819: a helper whose exit Node has recorded is not handed the next job, even before its close event", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(async () => {
      const jobs = new WindowsJobs();
      await settledSoon(() => jobs.contain(standInExecutor().child));
      const [first] = helpers;
      if (first !== undefined) first.exitCode = 1;
      await settledSoon(() =>
        jobs.contain(standInExecutor(OTHER_EXECUTOR_PID).child),
      );
      return helpers.map((helper) => helper.commands);
    });
    expect(outcome).toStrictEqual([
      ["assign 4242", "hold 7"],
      ["assign 4243", "hold 7"],
    ]);
  });

  it("D2820: an executor that exited before its assign is refused with the reason, and no assign is sent", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const executor = standInExecutor();
    executor.exit();
    const outcome = await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(executor.child)),
    );
    expect({
      outcome,
      commands: helpers.flatMap((helper) => helper.commands),
    }).toStrictEqual({
      outcome: {
        thrown:
          "it exited before it could be put in a job object, and its process id may since name another process",
      },
      commands: [],
    });
  });

  it("D2821: an executor that exits while it is assigned is refused with the reason, and its job is released without ever being held", async () => {
    const executor = standInExecutor();
    const helpers = standInHelpers([
      {
        start: ["ready"],
        answer: (command) => {
          if (command.startsWith("assign")) executor.exit();
          return answersEveryCommand(command);
        },
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(executor.child)),
    );
    expect({
      outcome,
      commands: helpers.flatMap((helper) => helper.commands),
    }).toStrictEqual({
      outcome: {
        thrown:
          "it exited while it was put in a job object, so that job was closed without ending the process it held, which may be another that took the id",
      },
      commands: ["assign 4242", "release 7"],
    });
  });

  it("D2822: a running executor's job is held after its assign, and contain resolves once the helper confirms it", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() =>
        new WindowsJobs().contain(standInExecutor().child).then(() => "held"),
      ),
    );
    expect({
      outcome,
      commands: helpers.flatMap((helper) => helper.commands),
    }).toStrictEqual({ outcome: "held", commands: ["assign 4242", "hold 7"] });
  });

  it("D2823: a helper answer's escapes are decoded, so a multi-line non-ASCII reason arrives whole", async () => {
    standInHelpers([
      {
        start: ["ready"],
        answer: () => "oops \\u00fc\\u000d\\u000anext \\u005cu0041",
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(standInExecutor().child)),
    );
    expect(outcome).toStrictEqual({
      thrown:
        'the job object helper refused "assign 4242": oops \u00fc\r\nnext \\u0041',
    });
  });

  it("D2824: an Add-Type failure outside any policy is reported with PowerShell's reason and no policy remedy", async () => {
    standInHelpers([
      {
        start: ["cannot-compile Cannot add type. Compilation errors occurred."],
        answer: () => undefined,
        exitAfterStart: true,
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settled(new WindowsJobs().contain(standInExecutor().child)),
    );
    expect(outcome).toStrictEqual({
      thrown:
        "Windows PowerShell could not compile the job object helper that ends each job's processes, so no job can run (Cannot add type. Compilation errors occurred)",
    });
  });

  it("D2825: a close while a helper starts ends that helper once it starts, and refuses the job that started it", async () => {
    const helpers = standInHelpers([
      { start: [], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(async () => {
        const jobs = new WindowsJobs();
        const contained = settled(
          jobs.contain(standInExecutor().child).then(() => "held"),
        );
        // The stand-in never emits `close`, so this close stays waiting on it.
        void jobs.close();
        for (const helper of helpers) helper.stdout.write("ready\n");
        return {
          contained: await contained,
          kills: helpers.map((helper) => helper.kill.mock.calls.length),
        };
      }),
    );
    expect(outcome).toStrictEqual({
      contained: { thrown: "the job object helper was closed" },
      kills: [1],
    });
  });

  it("D2826: a job after close starts no helper and is refused", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(async () => {
        const jobs = new WindowsJobs();
        await jobs.close();
        return jobs.contain(standInExecutor().child).then(() => "held");
      }),
    );
    expect({ outcome, helpers: helpers.length }).toStrictEqual({
      outcome: { thrown: "the job object helper was closed" },
      helpers: 0,
    });
  });

  it("D2827: ending a job tree twice sends the helper one end, so a job that reused the handle is never ended", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(async () => {
        const tree = await new WindowsJobs().contain(standInExecutor().child);
        await tree.end();
        await tree.end();
        return helpers.flatMap((helper) => helper.commands);
      }),
    );
    expect(outcome).toStrictEqual(["assign 4242", "hold 7", "end 7"]);
  });

  it("D2834: a job whose kill-on-close the helper refuses to arm is refused rather than returned as held", async () => {
    standInHelpers([
      {
        start: ["ready"],
        answer: (command) =>
          command.startsWith("hold")
            ? "SetInformationJobObject failed with 5"
            : answersEveryCommand(command),
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() =>
        new WindowsJobs().contain(standInExecutor().child).then(() => "held"),
      ),
    );
    expect(outcome).toStrictEqual({
      thrown:
        'the job object helper refused "hold 7": SetInformationJobObject failed with 5',
    });
  });

  it("D2835: a failed release after an executor exits during its assign keeps the exit reason and adds the release failure", async () => {
    const executor = standInExecutor();
    standInHelpers([
      {
        start: ["ready"],
        answer: (command, helper) => {
          if (command.startsWith("assign")) executor.exit();
          if (!command.startsWith("release")) {
            return answersEveryCommand(command);
          }
          helper.emit("close", 1, null);
          return undefined;
        },
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(executor.child)),
    );
    expect(outcome).toStrictEqual({
      thrown:
        "it exited while it was put in a job object, so that job was closed without ending the process it held, which may be another that took the id; closing that job failed: the job object helper exited (exit code 1)",
    });
  });

  it("D2836: an executor that never started is refused as never started, and no assign is sent", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() =>
        new WindowsJobs().contain(
          Object.assign(standInExecutor().child, { pid: undefined }),
        ),
      ),
    );
    expect({
      outcome,
      commands: helpers.flatMap((helper) => helper.commands),
    }).toStrictEqual({ outcome: { thrown: "it never started" }, commands: [] });
  });

  it("D2837: closing the jobs kills their running helper, so every job tree it holds ends", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    await withSystemRoot(() =>
      settledSoon(async () => {
        const jobs = new WindowsJobs();
        await jobs.contain(standInExecutor().child);
        return jobs.close();
      }),
    );
    expect(
      helpers.map((helper) => helper.kill.mock.calls.length),
    ).toStrictEqual([1]);
  });

  it("D2838: a write error on the helper's input rejects the job waiting on its answer with that error", async () => {
    standInHelpers([
      {
        start: ["ready"],
        answer: (_command, helper) => {
          helper.stdin.destroy(new Error(WRITE_FAILURE));
          return undefined;
        },
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() => new WindowsJobs().contain(standInExecutor().child)),
    );
    expect(outcome).toStrictEqual({ thrown: WRITE_FAILURE });
  });

  it("D2839: closing the jobs after their helper has closed finishes rather than waiting for a close that already came", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(async () => {
        const jobs = new WindowsJobs();
        await jobs.contain(standInExecutor().child);
        for (const helper of helpers) helper.emit("close", 1, null);
        return jobs.close().then(() => "closed");
      }),
    );
    expect(outcome).toBe("closed");
  });

  it("D2840: once a started helper closes, the next job starts a new helper rather than being handed the closed one", async () => {
    const helpers = standInHelpers([
      { start: ["ready"], answer: answersEveryCommand },
      { start: ["ready"], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(async () => {
        const jobs = new WindowsJobs();
        await jobs.contain(standInExecutor().child);
        for (const helper of helpers) helper.emit("close", 1, null);
        return jobs
          .contain(standInExecutor(OTHER_EXECUTOR_PID).child)
          .then(() => "held");
      }),
    );
    expect({ outcome, helpers: helpers.length }).toStrictEqual({
      outcome: "held",
      helpers: 2,
    });
  });

  it("D2841: an error on the helper process before its first line rejects the job waiting on it with that error", async () => {
    const helpers = standInHelpers([
      { start: [], answer: answersEveryCommand },
    ]);
    const outcome = await withSystemRoot(() =>
      settledSoon(() => {
        const contained = new WindowsJobs().contain(standInExecutor().child);
        for (const helper of helpers) {
          helper.emit("error", new Error("spawn powershell.exe ENOENT"));
        }
        return contained;
      }),
    );
    expect(outcome).toStrictEqual({ thrown: "spawn powershell.exe ENOENT" });
  });

  it("D2842: an executor that exits while its helper starts is refused before its assign, and no command is sent", async () => {
    const helpers = standInHelpers([
      { start: [], answer: answersEveryCommand },
    ]);
    const executor = standInExecutor();
    const outcome = await withSystemRoot(() =>
      settledSoon(() => {
        const contained = new WindowsJobs().contain(executor.child);
        executor.exit();
        for (const helper of helpers) helper.stdout.write("ready\n");
        return contained;
      }),
    );
    expect({
      outcome,
      commands: helpers.flatMap((helper) => helper.commands),
    }).toStrictEqual({
      outcome: {
        thrown:
          "it exited before it could be put in a job object, and its process id may since name another process",
      },
      commands: [],
    });
  });

  it("D2843: a job whose helper start a close overtook sends that closing helper no command", async () => {
    const helpers = standInHelpers([
      { start: [], answer: answersEveryCommand },
    ]);
    await withSystemRoot(() =>
      settledSoon(() => {
        const jobs = new WindowsJobs();
        const contained = jobs.contain(standInExecutor().child);
        // The stand-in never emits `close`, so this close stays waiting on it.
        void jobs.close();
        for (const helper of helpers) helper.stdout.write("ready\n");
        return contained;
      }),
    );
    expect(helpers.map((helper) => helper.commands)).toStrictEqual([[]]);
  });
});
