import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

/** The answer every `rt-test defects` gets in place of a daemon's, or the error it rejects with, and each call's arguments. */
const scripted = vi.hoisted(() => ({
  answer: undefined as unknown,
  rejection: undefined as Error | undefined,
  calls: [] as unknown[][],
}));

vi.mock("@rt-test/daemon/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@rt-test/daemon/client")>();
  return {
    ...actual,
    queryDefects: (...args: Parameters<typeof actual.queryDefects>) => {
      scripted.calls.push(args);
      return scripted.rejection === undefined
        ? Promise.resolve(scripted.answer)
        : Promise.reject(scripted.rejection);
    },
  };
});

import {
  PROTOCOL_VERSION,
  type DefectsResponse,
  type ListedDefinition,
} from "@rt-test/daemon/client";
import { main } from "../src/main.js";
import type { ExitCode } from "../src/output.js";
import { ANSWER_ROOT } from "./changes-answers.js";

/** Where each command runs, and the consumer root every scripted answer names. */
const CWD = ANSWER_ROOT;
const DEFECTS_USAGE = "rt-test defects [path] [--root <dir>] [--json]";
const NO_STATES = {
  "invalid-definition": 0,
  "anchor-missing": 0,
  "never-verified": 0,
} as const;

/** An answer for the whole worktree with no definition and no test, as `more` overrides. */
function defectsResponse(more: Partial<DefectsResponse> = {}): DefectsResponse {
  return {
    type: "defects",
    protocolVersion: PROTOCOL_VERSION,
    consumerRoot: ANSWER_ROOT,
    currentAdapterVersion: 3,
    discovery: {
      discoveryId: "discovery-1",
      adapterVersion: 3,
      adapterVersionCurrent: true,
      freshness: "current",
    },
    inputs: {
      revision: 4,
      reconciliation: { state: "complete" },
      watcher: { state: "healthy" },
      pendingChanges: 0,
      gitUnread: [],
    },
    unfingerprintedWorkspaces: [],
    activity: { state: "idle" },
    unstoredJobs: [],
    schedule: { round: { state: "planned", revision: 4 }, workspaces: [] },
    latestSelection: { state: "no-round-yet" },
    path: ".",
    counts: { total: 0, states: NO_STATES, invalidEntries: 0 },
    invalidEntries: [],
    definitions: [],
    definitionsNotListed: NO_STATES,
    testsInScope: 0,
    gaps: 0,
    gapModules: [],
    gapTests: [],
    gapTestsNotListed: 0,
    ...more,
  };
}

function listedDefinition(
  id: string,
  state: ListedDefinition["state"],
  reason?: string,
): ListedDefinition {
  return {
    id,
    file: "defects/a.json",
    position: 0,
    test: { module: "src/a.test.ts", name: ["t"] },
    resolvedTest: null,
    mutationFile: "src/a.ts",
    state,
    ...(reason === undefined
      ? {}
      : { reason: { reason, omittedCharacters: 0 } }),
  };
}

/** An answer holding a definition file problem, one definition in each state, and two gaps in one module. */
const WITH_PROBLEMS = defectsResponse({
  counts: {
    total: 4,
    states: {
      "invalid-definition": 1,
      "anchor-missing": 1,
      "never-verified": 1,
    },
    invalidEntries: 1,
  },
  invalidEntries: [
    {
      kind: "not-json",
      path: "defects/broken.json",
      reason: "it is not valid JSON",
      omittedCharacters: 0,
    },
  ],
  definitions: [
    listedDefinition("D1", "invalid-definition", "its test is not discovered"),
    listedDefinition(
      "D2",
      "anchor-missing",
      "its mutation's old text occurs 0 times in src/a.ts, not once",
    ),
    listedDefinition("D3", "never-verified"),
  ],
  testsInScope: 5,
  gaps: 2,
  gapModules: [{ module: "src/b.test.ts", gaps: 2 }],
});

interface DefectsRun {
  readonly exit: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  /** The arguments each call of `queryDefects` was given. */
  readonly calls: readonly unknown[][];
}

/** Runs `rt-test defects <argv>` in process from `CWD`, each call of `queryDefects` answered with `answer` or rejected. */
async function runDefects(
  argv: readonly string[],
  answer: DefectsResponse | Error = defectsResponse(),
): Promise<DefectsRun> {
  scripted.answer = answer instanceof Error ? undefined : answer;
  scripted.rejection = answer instanceof Error ? answer : undefined;
  scripted.calls = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    err += chunk.toString("utf8");
  });
  try {
    const exit = await main(["defects", ...argv], {
      stdin: new PassThrough(),
      stdout,
      stderr,
      stdinIsTerminal: false,
      stderrIsTerminal: false,
      cwd: CWD,
    });
    await new Promise((resolve) => setImmediate(resolve));
    return { exit, stdout: out, stderr: err, calls: scripted.calls };
  } finally {
    stdout.end();
    stderr.end();
  }
}

describe("sending a defects query", () => {
  it("D3702: the path and --root resolve against the current directory, and no path is sent without one", async () => {
    const scoped = await runDefects(["src", "--root", "sub"]);
    const whole = await runDefects([]);
    expect([...scoped.calls, ...whole.calls]).toStrictEqual([
      [join(CWD, "sub"), join(CWD, "src")],
      [CWD, undefined],
    ]);
  });

  it("D3703: a second path exits 2 with the usage on stderr, nothing on stdout, and sends nothing", async () => {
    const run = await runDefects(["src", "docs"]);
    expect({
      exit: run.exit,
      stdout: run.stdout,
      usage: run.stderr.includes(DEFECTS_USAGE),
      sent: run.calls.length,
    }).toStrictEqual({ exit: 2, stdout: "", usage: true, sent: 0 });
  });
});

describe("the answer to a defects query", () => {
  it("D3704: an answer with problems exits 0 and prints the counts, each definition file problem, each invalid and anchor-missing definition with its reason, and the gap counts, but no never-verified definition", async () => {
    const run = await runDefects([], WITH_PROBLEMS);
    const lines = run.stdout.split("\n");
    const printed = (pattern: RegExp) =>
      lines.some((line) => pattern.test(line));
    expect({
      exit: run.exit,
      total: printed(/\b4\b.*\b1\b.*definition file problem/),
      entry: printed(/not-json defects\/broken\.json: it is not valid JSON$/),
      invalid: printed(/invalid-definition D1 .*: its test is not discovered$/),
      anchorMissing: printed(
        /anchor-missing D2 .*: its mutation's old text occurs 0 times in src\/a\.ts, not once$/,
      ),
      neverVerified: printed(/\bD3\b/),
      gaps: printed(/src\/b\.test\.ts: 2$/),
    }).toStrictEqual({
      exit: 0,
      total: true,
      entry: true,
      invalid: true,
      anchorMissing: true,
      neverVerified: false,
      gaps: true,
    });
  });

  it("D3705: under --json stdout is one versioned document carrying the answer's counts, definitions, definition file problems and gaps", async () => {
    const run = await runDefects(["--json"], WITH_PROBLEMS);
    const document = JSON.parse(run.stdout) as Record<string, unknown>;
    expect({
      exit: run.exit,
      schemaVersion: typeof document["schemaVersion"],
      command: document["command"],
      ok: document["ok"],
      counts: document["counts"],
      definitions: document["definitions"],
      invalidEntries: document["invalidEntries"],
      gapModules: document["gapModules"],
    }).toStrictEqual({
      exit: 0,
      schemaVersion: "number",
      command: "defects",
      ok: true,
      counts: WITH_PROBLEMS.counts,
      definitions: WITH_PROBLEMS.definitions,
      invalidEntries: WITH_PROBLEMS.invalidEntries,
      gapModules: WITH_PROBLEMS.gapModules,
    });
  });
});
