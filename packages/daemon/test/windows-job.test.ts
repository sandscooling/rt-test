import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { WindowsJobs } from "../src/daemon/windows-job.js";
import { settled } from "./daemon-harness.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn<typeof actual.spawn>() };
});

/** How a stand-in helper answers: what it writes at its start, and its answer to each command it is sent. */
interface HelperScript {
  readonly start: readonly string[];
  readonly answer: (command: string) => string | undefined;
  /** Closes its output and exits right after its start lines, as a helper that cannot compile does. */
  readonly exitAfterStart?: boolean;
}

/**
 * Makes each `spawn` of the job object helper start a stand-in following the next script in `scripts`, whichever
 * platform runs the test. It answers across a tick, as a pipe does, and its `kill` is recorded and ends nothing, like
 * a helper slow to exit.
 */
function standInHelpers(scripts: readonly HelperScript[]): void {
  const queue = [...scripts];
  vi.mocked(spawn).mockImplementation((() => {
    const script = queue.shift();
    if (script === undefined) throw new Error("no stand-in helper left");
    const helper = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn<ChildProcess["kill"]>(() => true),
    });
    helper.stdin.on("data", (chunk: Buffer) => {
      for (const command of chunk.toString("utf8").split("\n")) {
        const reply = command === "" ? undefined : script.answer(command);
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

const CLM_REASON =
  "Cannot add type. Definition of new types is not supported in this language mode.";

describe("the job object helper", () => {
  it("D1698: a helper that cannot compile its job class is reported with PowerShell's reason, the policy and the remedy", async () => {
    standInHelpers([
      {
        start: [`cannot-compile ${CLM_REASON}`],
        answer: () => undefined,
        exitAfterStart: true,
      },
    ]);
    const outcome = await withSystemRoot(() =>
      settled(new WindowsJobs().contain(4242)),
    );
    expect(outcome).toStrictEqual({
      thrown: expect.stringMatching(
        /refused to compile .*\(Cannot add type\. Definition of new types is not supported in this language mode\)\. .*Constrained Language Mode.*allow Add-Type/,
      ),
    });
  });

  it("D1699: once a helper misses the answer bound, the next job starts a new helper rather than asking the silent one", async () => {
    standInHelpers([
      { start: ["ready"], answer: () => undefined },
      {
        start: ["ready"],
        answer: (command) => (command.startsWith("assign") ? "ok 7" : "ok"),
      },
    ]);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const outcome = await withSystemRoot(async () => {
        const jobs = new WindowsJobs();
        const first = settled(jobs.contain(4242));
        await vi.advanceTimersByTimeAsync(10_000);
        const second = settled(jobs.contain(4243).then(() => "held"));
        await vi.advanceTimersByTimeAsync(10_000);
        return {
          first: await first,
          second: await second,
          helpers: vi.mocked(spawn).mock.calls.length,
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
});
