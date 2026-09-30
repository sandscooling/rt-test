import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

/** The answer every `rt-test wait` gets in place of a daemon's, and the arguments each of its calls was given. */
const scripted = vi.hoisted(() => ({
  answer: undefined as unknown,
  calls: [] as unknown[][],
}));

vi.mock("@rt-test/daemon/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@rt-test/daemon/client")>();
  return {
    ...actual,
    queryWait: (...args: Parameters<typeof actual.queryWait>) => {
      scripted.calls.push(args);
      return Promise.resolve(scripted.answer);
    },
  };
});

import {
  PROTOCOL_VERSION,
  TEST_STATES,
  type ExplainedPath,
  type NamedFailure,
  type WaitResponse,
} from "@rt-test/daemon/client";
import type {
  WaitAnswer,
  WaitOutcomeFacts,
} from "../../daemon/src/query/answer.js";
import { HAND_BUILT_ROOT } from "../../daemon/test/harness.js";
import { main } from "../src/main.js";
import type { ExitCode } from "../src/output.js";

/** Where each command runs, and the consumer root every scripted answer names. */
const CWD = HAND_BUILT_ROOT;
const WAIT_USAGE =
  "rt-test wait <file>... [--root <dir>] [--limit <seconds>] [--json]";
const FILE = "src/a.ts";
const README = "README.md";

const SETTLED: WaitOutcomeFacts = { outcome: "settled" };
const SUPERSEDED: WaitOutcomeFacts = {
  outcome: "superseded",
  supersededAt: 4,
  changedPaths: { named: [FILE], more: 0 },
};
const UNSETTLED: WaitOutcomeFacts = { outcome: "unsettled" };

/** A wait's answer at input revision 4, bound at 3, with its coverage not yet known and nothing counted, as `more` overrides. */
function waitResponse(
  outcome: WaitOutcomeFacts,
  more: Partial<Omit<WaitAnswer, keyof WaitOutcomeFacts>> = {},
): WaitResponse {
  return {
    type: "wait",
    protocolVersion: PROTOCOL_VERSION,
    consumerRoot: CWD,
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
    boundRevision: 3,
    coverage: { state: "not-yet-known" },
    files: [{ path: FILE }],
    counts: {
      tests: 0,
      states: Object.fromEntries(
        TEST_STATES.map((state) => [state, 0]),
      ) as WaitResponse["counts"]["states"],
      freshness: { current: 0, stale: 0, unknown: 0 },
    },
    notDiscovered: [],
    workspaces: [],
    namedFailures: { named: [], more: 0 },
    ...outcome,
    ...more,
  };
}

interface WaitRun {
  readonly exit: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  /** The arguments each call of `queryWait` was given. */
  readonly calls: readonly unknown[][];
}

/** Runs `rt-test wait <argv>` in process from `CWD`, each call of `queryWait` answered with `answer`. */
async function runWait(
  argv: readonly string[],
  answer: WaitResponse,
): Promise<WaitRun> {
  scripted.answer = answer;
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
    const exit = await main(["wait", ...argv], {
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

/** The indented lines under `heading` in `output`. */
function linesUnder(output: string, heading: string): string[] {
  const lines = output.split("\n");
  const start = lines.indexOf(heading);
  if (start === -1) return [];
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => !line.startsWith("  "));
  return end === -1 ? after : after.slice(0, end);
}

describe("sending a wait", () => {
  it("D3450: each file and --root resolve against the current directory, --limit is sent in ms, and no limit is sent without it", async () => {
    const given = await runWait(
      [FILE, "--root", "sub", "--limit", "5"],
      waitResponse(SETTLED),
    );
    const defaulted = await runWait([FILE], waitResponse(SETTLED));
    expect([...given.calls, ...defaulted.calls]).toStrictEqual([
      [join(CWD, "sub"), [join(CWD, "src", "a.ts")], { limitMs: 5_000 }],
      [CWD, [join(CWD, "src", "a.ts")], {}],
    ]);
  });

  it("D3451: a missing or empty file, an empty --root, an unknown option and a --limit that is not whole seconds from 1 to 3600 in decimal digits exit 2 with the usage and send nothing, while 1 and 3600 are sent", async () => {
    const refusedCases = [
      [],
      [""],
      [FILE, "--root", ""],
      [FILE, "--bogus"],
      [FILE, "--limit", "0"],
      [FILE, "--limit", "3601"],
      [FILE, "--limit", "1.5"],
      [FILE, "--limit", "0x4"],
      [FILE, "--limit", "1e1"],
      [FILE, "--limit", " 4"],
    ];
    const refused = [];
    for (const argv of refusedCases) {
      const run = await runWait(argv, waitResponse(SETTLED));
      refused.push({
        exit: run.exit,
        stdout: run.stdout,
        usage: run.stderr.includes(WAIT_USAGE),
        sent: run.calls.length,
      });
    }
    const taken = [];
    for (const seconds of ["1", "3600"]) {
      const run = await runWait(
        [FILE, "--limit", seconds],
        waitResponse(SETTLED),
      );
      taken.push(run.calls.map((call) => call[2]));
    }
    expect({ refused, taken }).toStrictEqual({
      refused: refusedCases.map(() => ({
        exit: 2,
        stdout: "",
        usage: true,
        sent: 0,
      })),
      taken: [[{ limitMs: 1_000 }], [{ limitMs: 3_600_000 }]],
    });
  });
});

describe("the answer to a wait", () => {
  it("D3452: a superseded answer and an unsettled one each exit 0, as every answer does", async () => {
    const exits = [
      (await runWait([FILE], waitResponse(SUPERSEDED))).exit,
      (await runWait([FILE], waitResponse(UNSETTLED))).exit,
    ];
    expect(exits).toStrictEqual([0, 0]);
  });

  it("D3453: the first line names only the outcome and the revisions, and a wait that never bound says so", async () => {
    const firstLines = [];
    for (const answer of [
      waitResponse(SETTLED),
      waitResponse(SUPERSEDED),
      waitResponse(UNSETTLED, { boundRevision: null }),
    ]) {
      firstLines.push((await runWait([FILE], answer)).stdout.split("\n")[0]);
    }
    expect(firstLines).toStrictEqual([
      `RT Test wait in ${CWD}: settled at input revision 4, bound to input revision 3`,
      `RT Test wait in ${CWD}: superseded by input revision 4, bound to input revision 3`,
      `RT Test wait in ${CWD}: unsettled, its limit passed at input revision 4, before it bound to an input revision`,
    ]);
  });

  it("D3454: a named file no workspace covers is printed as covered by no test", async () => {
    const selection: ExplainedPath = {
      path: README,
      owner: undefined,
      triggers: ["changed-path"],
      selected: { named: [], more: 0 },
      notRunnable: { named: [], more: 0 },
      nothingSelected: {
        kind: "no-dependent-vitest-workspace",
        detail: {
          reason: "no Vitest workspace depends on it",
          omittedCharacters: 0,
        },
      },
    };
    const run = await runWait(
      [README],
      waitResponse(SETTLED, {
        coverage: { state: "selected", revision: 4 },
        files: [{ path: README, selection, listed: { named: [], more: 0 } }],
      }),
    );
    expect(linesUnder(run.stdout, "Files:")[0]).toMatch(
      /^ {2}README\.md: covered by no test; /,
    );
  });

  it("D3455: a named failure whose test name holds a line break is printed on one line, the break escaped", async () => {
    const failure: NamedFailure = {
      workspacePath: "packages/a",
      projectName: "unit",
      modulePath: "src/a.test.ts",
      testName: ["outer", "inner\nline"],
      state: "failed",
      freshness: "current",
      firstError: { reason: "boom", omittedCharacters: 0 },
    };
    const run = await runWait(
      [FILE],
      waitResponse(SETTLED, { namedFailures: { named: [failure], more: 0 } }),
    );
    expect(linesUnder(run.stdout, "Failures:")).toStrictEqual([
      "  packages/a unit src/a.test.ts > outer > inner\\u000aline: failed, current: boom",
    ]);
  });
});
