import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { onPlatform } from "../../../packages/daemon/test/harness.js";
import {
  childProcessesOf,
  endOwnedProcesses,
  namedAsParent,
  processRecords,
} from "../run-cleanup.mjs";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn<typeof actual.spawnSync>() };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn<typeof actual.readFileSync>(actual.readFileSync),
  };
});

/** A run root no real process names, so only the answers a test scripts can lie inside it. */
const ROOT = "/no-such-parent/rt-test-run";
const PARENT = 200;
const EARLIER_CHILD = 100;
const LATER_CHILD = 101;
/** An id the stubbed `/proc` answers for. */
const LINUX_PID = 4242;

interface QueryEntry {
  readonly pid?: number;
  readonly parent?: number;
  readonly startedAt?: string;
  readonly commandLine?: string;
}

const entry = (
  pid: number,
  parent: number,
  startedAt: string,
  commandLine = "node idle.js",
): QueryEntry => ({ pid, parent, startedAt, commandLine });

const answer = (stdout: string): SpawnSyncReturns<string> => ({
  pid: 0,
  output: [null, stdout, ""],
  stdout,
  stderr: "",
  status: 0,
  signal: null,
});

/**
 * What Windows PowerShell prints through a pipe: the console's code page unless the query sets UTF-8 output, and
 * each character that code page garbles reaches Node's UTF-8 decoding as U+FFFD. A run on Windows confirmed both.
 */
function printedByPowerShell(script: string, json: string): string {
  const utf8 = script.includes(
    "[Console]::OutputEncoding = [System.Text.UTF8Encoding]",
  );
  return utf8 ? json : json.replace(/\P{ASCII}/gu, "\ufffd");
}

/** Runs `read` as on Windows, where the process query prints `entries` as the PowerShell above prints them. */
async function onWindowsAnswering<T>(
  entries: readonly QueryEntry[],
  read: () => T,
): Promise<T> {
  vi.mocked(spawnSync).mockImplementation(((
    _command: string,
    args: readonly string[],
  ) =>
    answer(
      printedByPowerShell(args.at(-1) ?? "", JSON.stringify(entries)),
    )) as typeof spawnSync);
  vi.stubEnv("SystemRoot", "C:\\Windows");
  try {
    return await onPlatform("win32", async () => read());
  } finally {
    vi.unstubAllEnvs();
    vi.mocked(spawnSync).mockReset();
  }
}

/**
 * Runs `read` as on Windows, where the query's CIM call fails. Windows PowerShell then prints an empty list and exits
 * 0, unless the query stops on an error, when it exits 1. A run on Windows confirmed both.
 */
async function onWindowsFailingCim<T>(read: () => T): Promise<T> {
  vi.mocked(spawnSync).mockImplementation(((
    _command: string,
    args: readonly string[],
  ) => {
    const stops = (args.at(-1) ?? "").includes(
      "$ErrorActionPreference = 'Stop'",
    );
    return stops
      ? {
          ...answer(""),
          status: 1,
          stderr: "Get-CimInstance : Access denied",
        }
      : answer("[]");
  }) as typeof spawnSync);
  vi.stubEnv("SystemRoot", "C:\\Windows");
  try {
    return await onPlatform("win32", async () => read());
  } finally {
    vi.unstubAllEnvs();
    vi.mocked(spawnSync).mockReset();
  }
}

/** Runs `read` as on Linux, where `/proc/<LINUX_PID>/stat` reads as `stat`. */
async function onLinuxWithStat<T>(stat: string, read: () => T): Promise<T> {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(readFileSync).mockImplementation(((
    path: Parameters<typeof actual.readFileSync>[0],
    options?: Parameters<typeof actual.readFileSync>[1],
  ) =>
    typeof path === "string" &&
    new RegExp(`[\\\\/]proc[\\\\/]${LINUX_PID}[\\\\/]stat$`).test(path)
      ? stat
      : actual.readFileSync(path, options)) as typeof readFileSync);
  try {
    return await onPlatform("linux", async () => read());
  } finally {
    vi.mocked(readFileSync).mockImplementation(actual.readFileSync);
  }
}

/** What `read` returns, or `threw` when it throws. */
function outcomeOf<T>(read: () => T): T | "threw" {
  try {
    return read();
  } catch {
    return "threw";
  }
}

/** The ids `end` signalled to end, through a stand-in `process.kill` that ends nothing and reports every id running. */
function killedBy(end: () => unknown): number[] {
  const killed: number[] = [];
  const kill = vi
    .spyOn(process, "kill")
    .mockImplementation((pid: number, signal?: string | number) => {
      if (signal !== 0) killed.push(pid);
      return true;
    });
  try {
    end();
  } finally {
    kill.mockRestore();
  }
  return killed;
}

/** What `end` returns, or `threw`, through a stand-in `process.kill` that reports every id running and refuses each kill. */
function underRefusedKills<T>(end: () => T): T | "threw" {
  const kill = vi
    .spyOn(process, "kill")
    .mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) return true;
      throw Object.assign(new Error("operation not permitted"), {
        code: "EPERM",
      });
    });
  try {
    return outcomeOf(end);
  } finally {
    kill.mockRestore();
  }
}

/** A `/proc/<pid>/stat` line after the command name: state, parent, 17 fields, then the start time and two more. */
const statAfterName = (parent: string, startedAt: string) =>
  `S ${parent} ${"0 ".repeat(17)}${startedAt} 0 0`;

describe("reading which process holds an id", () => {
  it("D2444: does not admit a process whose recorded parent id a process started after it now holds", async () => {
    const killed = await onWindowsAnswering(
      [
        entry(EARLIER_CHILD, PARENT, "5"),
        entry(PARENT, 4, "9", `node ${ROOT}/daemon.mjs`),
      ],
      () => killedBy(() => endOwnedProcesses([ROOT], [EARLIER_CHILD])),
    );
    expect(killed).toEqual([]);
  });

  it("D2475: lists as a live parent's children only the processes started no earlier than it", async () => {
    const children = await onWindowsAnswering(
      [
        entry(PARENT, 4, "9"),
        entry(EARLIER_CHILD, PARENT, "5"),
        entry(LATER_CHILD, PARENT, "12"),
      ],
      () => childProcessesOf(PARENT).map(({ pid }) => pid),
    );
    expect(children).toEqual([LATER_CHILD]);
  });

  it("D2446: lists no children of a parent that has exited, though processes still name its id", async () => {
    const children = await onWindowsAnswering(
      [entry(EARLIER_CHILD, PARENT, "5"), entry(LATER_CHILD, PARENT, "12")],
      () => childProcessesOf(PARENT).map(({ pid }) => pid),
    );
    expect(children).toEqual([]);
  });

  it("D2447: says a process still names a parent that has exited", async () => {
    const named = await onWindowsAnswering(
      [entry(EARLIER_CHILD, PARENT, "5")],
      () => namedAsParent(PARENT),
    );
    expect(named).toBe(true);
  });

  it("D2448: drops a Windows query entry missing its parent id", async () => {
    const ids = await onWindowsAnswering(
      [
        { pid: EARLIER_CHILD, startedAt: "5", commandLine: "node idle.js" },
        entry(LATER_CHILD, 4, "7"),
      ],
      () => [...processRecords([EARLIER_CHILD, LATER_CHILD]).keys()],
    );
    expect(ids).toEqual([LATER_CHILD]);
  });

  it("D2497: drops a Windows query entry missing its command line", async () => {
    const ids = await onWindowsAnswering(
      [
        { pid: EARLIER_CHILD, parent: 4, startedAt: "5" },
        entry(LATER_CHILD, 4, "7"),
      ],
      () => [...processRecords([EARLIER_CHILD, LATER_CHILD]).keys()],
    );
    expect(ids).toEqual([LATER_CHILD]);
  });

  it("D2495: fails the Windows query, rather than reading every process as gone, when its CIM call fails", async () => {
    const outcome = await onWindowsFailingCim(() =>
      outcomeOf(() => processRecords([EARLIER_CHILD]).size),
    );
    expect(outcome).toBe("threw");
  });

  it("D2498: fails, rather than reporting it ended, when the OS refuses to kill a process the run owns", async () => {
    const outcome = await onWindowsAnswering(
      [entry(EARLIER_CHILD, 4, "5", `node ${ROOT}/daemon.mjs`)],
      () =>
        underRefusedKills(() =>
          endOwnedProcesses([ROOT], [EARLIER_CHILD]).map(({ pid }) => pid),
        ),
    );
    expect(outcome).toBe("threw");
  });

  it("D2449: reads a Windows command line holding a non-ASCII character, a tab and a newline exactly", async () => {
    const commandLine = `node idle.js C:\\runs\\é-root\tx\ny`;
    const read = await onWindowsAnswering(
      [entry(EARLIER_CHILD, 4, "5", commandLine)],
      () => processRecords([EARLIER_CHILD]).get(EARLIER_CHILD)?.commandLine,
    );
    expect(read).toBe(commandLine);
  });

  it("D2450: yields no record, rather than throwing, for a Linux stat line whose start time is not decimal", async () => {
    const outcome = await onLinuxWithStat(
      `${LINUX_PID} (node) ${statAfterName("1", "x")}`,
      () => outcomeOf(() => processRecords([LINUX_PID]).size),
    );
    expect(outcome).toBe(0);
  });

  it("D2499: yields no record for a Linux stat line whose parent is not decimal", async () => {
    const outcome = await onLinuxWithStat(
      `${LINUX_PID} (node) ${statAfterName("x", "7")}`,
      () => outcomeOf(() => processRecords([LINUX_PID]).size),
    );
    expect(outcome).toBe(0);
  });

  it("D2451: yields no record for a Linux stat line without the command name's closing parenthesis", async () => {
    const outcome = await onLinuxWithStat(
      `${LINUX_PID} 1${" 0".repeat(19)}`,
      () => outcomeOf(() => processRecords([LINUX_PID]).size),
    );
    expect(outcome).toBe(0);
  });
});
