import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  endOwnTree,
  endProcessTree,
  ownsProcessGroup,
  treeContainment,
} from "../src/daemon/process-tree.js";
import { runSystemTool } from "../src/daemon/windows-system-tool.js";

vi.mock("../src/daemon/windows-system-tool.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../src/daemon/windows-system-tool.js")
    >();
  return {
    ...actual,
    runSystemTool: vi.fn<typeof actual.runSystemTool>(() => ""),
  };
});

vi.mock("../src/daemon/windows-job.js", () => ({
  /** Job objects whose helper cannot end the job it holds. */
  WindowsJobs: class {
    contain(): Promise<{ end(): Promise<void> }> {
      return Promise.resolve({
        end: () => Promise.reject(new Error("TerminateJobObject failed")),
      });
    }

    close(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

const EXECUTOR_PID = 4242;

/** A running executor as the daemon holds it, recording each kill rather than sending it. */
function runningExecutor(): {
  readonly executor: ChildProcess;
  readonly kills: unknown[][];
} {
  const kill = vi.fn<ChildProcess["kill"]>(() => true);
  return {
    executor: {
      pid: EXECUTOR_PID,
      exitCode: null,
      signalCode: null,
      kill,
    } as unknown as ChildProcess,
    kills: kill.mock.calls,
  };
}

/** Runs `body` with `process.exit` throwing instead of exiting, so a test can call a function that ends the process. */
function withoutExiting(body: () => void): void {
  const exit = vi.spyOn(process, "exit").mockImplementation(() => {
    throw new Error("exited");
  });
  try {
    body();
  } catch {
    // The stand-in exit throws, so the test process lives on.
  } finally {
    exit.mockRestore();
  }
}

/** Runs `body` to its end as `platform` does, and puts the platform back, for work that reads it after an await. */
async function onUntilDone<T>(
  platform: NodeJS.Platform,
  body: () => Promise<T>,
): Promise<T> {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return await body();
  } finally {
    if (saved !== undefined) Object.defineProperty(process, "platform", saved);
  }
}

/** Runs `body` with every warning recorded rather than printed, and returns what it resolved with and the warnings. */
async function warningsDuring<T>(
  body: () => Promise<T>,
): Promise<{ readonly result: T; readonly warnings: string[] }> {
  const warnings: string[] = [];
  const warn = vi
    .spyOn(process, "emitWarning")
    .mockImplementation((warning: string | Error) => {
      warnings.push(String(warning));
    });
  try {
    return { result: await body(), warnings };
  } finally {
    warn.mockRestore();
  }
}

/** Runs `body` as `platform` does, whichever platform runs the test, and puts the platform back. */
function on<T>(platform: NodeJS.Platform, body: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return body();
  } finally {
    if (saved !== undefined) Object.defineProperty(process, "platform", saved);
  }
}

/** Runs `body` with every `process.kill` recorded rather than sent, and returns the calls. */
function killsDuring(body: () => void): unknown[][] {
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  try {
    body();
    return [...kill.mock.calls];
  } finally {
    kill.mockRestore();
  }
}

describe("the executor's process group", () => {
  it("D1656: on Linux an executor starts its own process group", () => {
    expect(on("linux", ownsProcessGroup)).toBe(true);
  });

  it("D1657: on Windows an executor stays attached, inside the job object that ends its tree", () => {
    expect(on("win32", ownsProcessGroup)).toBe(false);
  });

  it("D1658: on Linux ending an executor's tree kills its whole process group, not only the executor", () => {
    const { executor, kills: childKills } = runningExecutor();
    const kills = on("linux", () =>
      killsDuring(() => endProcessTree(executor)),
    );
    expect({ kills, childKills }).toStrictEqual({
      kills: [[-EXECUTOR_PID, "SIGKILL"]],
      childKills: [],
    });
  });

  it("D1659: on Linux an executor ending itself kills its own process group before it exits", () => {
    const kills = on("linux", () =>
      killsDuring(() => withoutExiting(endOwnTree)),
    );
    expect(kills).toStrictEqual([[-process.pid, "SIGKILL"]]);
  });
});

describe("the executor's tree on Windows", () => {
  const tool = vi.mocked(runSystemTool);

  it("D1662: on Windows ending an executor's tree walks it with taskkill /T /F before killing the executor", () => {
    tool.mockClear();
    const { executor, kills } = runningExecutor();
    on("win32", () => endProcessTree(executor));
    expect({ tools: [...tool.mock.calls], kills }).toStrictEqual({
      tools: [["taskkill.exe", ["/PID", String(EXECUTOR_PID), "/T", "/F"]]],
      kills: [["SIGKILL"]],
    });
  });

  it("D1663: on Windows an executor ending itself walks its own tree with taskkill /T /F before it exits", () => {
    tool.mockClear();
    on("win32", () => withoutExiting(endOwnTree));
    expect([...tool.mock.calls]).toStrictEqual([
      ["taskkill.exe", ["/PID", String(process.pid), "/T", "/F"]],
    ]);
  });
});

describe("ending a held tree that cannot be ended as held", () => {
  const tool = vi.mocked(runSystemTool);

  it("D1696: on Windows a job the helper cannot end is walked with taskkill /T /F instead", async () => {
    tool.mockClear();
    const { executor, kills } = runningExecutor();
    await warningsDuring(() =>
      onUntilDone("win32", async () => {
        const tree = await treeContainment().contain(executor);
        await tree.end();
      }),
    );
    expect({ tools: [...tool.mock.calls], kills }).toStrictEqual({
      tools: [["taskkill.exe", ["/PID", String(EXECUTOR_PID), "/T", "/F"]]],
      kills: [["SIGKILL"]],
    });
  });

  it("D1697: on Linux a process group that cannot be signalled is warned about, not thrown into the daemon", async () => {
    const { executor } = runningExecutor();
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
    });
    try {
      const outcome = await warningsDuring(() =>
        onUntilDone("linux", async () => {
          const tree = await treeContainment().contain(executor);
          return Promise.resolve()
            .then(() => tree.end())
            .then(
              () => "resolved",
              () => "rejected",
            );
        }),
      );
      expect(outcome).toStrictEqual({
        result: "resolved",
        warnings: [
          expect.stringContaining(
            `cannot end the process group of executor process ${EXECUTOR_PID}`,
          ),
        ],
      });
    } finally {
      kill.mockRestore();
    }
  });
});
