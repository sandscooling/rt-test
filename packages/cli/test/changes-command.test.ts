import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

/** The answer every `rt-test changes` gets in place of a daemon's, or the error it rejects with, and each call's arguments. */
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
    queryChanges: (...args: Parameters<typeof actual.queryChanges>) => {
      scripted.calls.push(args);
      return scripted.rejection === undefined
        ? Promise.resolve(scripted.answer)
        : Promise.reject(scripted.rejection);
    },
  };
});

import {
  PROTOCOL_VERSION,
  TEST_STATES,
  type ChangesResponse,
  type ListedChange,
  type TestCounts,
} from "@rt-test/daemon/client";
import { HAND_BUILT_ROOT } from "../../daemon/test/harness.js";
import { main } from "../src/main.js";
import type { ExitCode } from "../src/output.js";

/** Where each command runs, and the consumer root every scripted answer names. */
const CWD = HAND_BUILT_ROOT;
const CHANGES_USAGE =
  "rt-test changes <file>... [--since <cursor>] [--root <dir>] [--json]";
const FILE = "src/a.ts";
const GIVEN_CURSOR = "life.1";
const NEW_CURSOR = "life.2";
const BUILD_NOT_ENDED =
  "the dependency build that decides its inputs at input revision 4 has not ended";

type Determined = Extract<ChangesResponse, { determined: true }>;
type NotDetermined = Extract<ChangesResponse, { determined: false }>;

const NO_TESTS: TestCounts = {
  tests: 0,
  states: Object.fromEntries(
    TEST_STATES.map((state) => [state, 0]),
  ) as TestCounts["states"],
  freshness: { current: 0, stale: 0, unknown: 0 },
};

/** What every answer carries, at input revision 4. */
const CONTEXT = {
  type: "changes",
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
  revision: 4,
} as const;

/** A determined answer listing the changes since the given cursor, none by default, as `more` overrides. */
function determined(more: Partial<Determined> = {}): Determined {
  return {
    ...CONTEXT,
    cursor: NEW_CURSOR,
    cursorUse: "used",
    determined: true,
    changes: [],
    omittedChanges: { failing: 0, recovered: 0, other: 0 },
    coverage: { state: "selected", revision: 4 },
    files: [{ path: FILE }],
    counts: NO_TESTS,
    outside: { counts: NO_TESTS, changed: 0 },
    ...more,
  };
}

/** An answer not determined since the build at revision 4 has not ended, handing back the given cursor. */
function notDetermined(more: Partial<NotDetermined> = {}): NotDetermined {
  return {
    ...CONTEXT,
    cursor: GIVEN_CURSOR,
    cursorUse: "used",
    determined: false,
    notDetermined: {
      kind: "build-not-ended",
      reason: { reason: BUILD_NOT_ENDED, omittedCharacters: 0 },
    },
    ...more,
  };
}

const FAILING_CHANGE: ListedChange = {
  kind: "failing",
  firstError: { reason: "boom", omittedCharacters: 0 },
  test: {
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/a.test.ts",
    namePath: ["outer", "inner"],
    occurrence: 0,
  },
  atCursor: { state: "passed", freshness: "current" },
  now: { state: "failed", freshness: "current" },
};

const RECOVERED_ENTRY: ListedChange = {
  kind: "recovered",
  atCursor: {
    kind: "failed-module",
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/b.test.ts",
    errorCount: 1,
    reason: "SyntaxError: Unexpected token",
    omittedCharacters: 0,
  },
};

const DROPPED_TEST: ListedChange = {
  kind: "other",
  test: {
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/c.test.ts",
    namePath: ["dropped"],
    occurrence: 0,
  },
  atCursor: { state: "passed", freshness: "current" },
};

interface ChangesRun {
  readonly exit: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
  /** The arguments each call of `queryChanges` was given. */
  readonly calls: readonly unknown[][];
}

/** Runs `rt-test changes <argv>` in process from `CWD`, each call of `queryChanges` answered with `answer` or rejected. */
async function runChanges(
  argv: readonly string[],
  answer: ChangesResponse | Error,
): Promise<ChangesRun> {
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
    const exit = await main(["changes", ...argv], {
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

describe("sending a changes query", () => {
  it("D3503: each file and --root resolve against the current directory, --since is sent as the cursor, and no cursor is sent without it", async () => {
    const given = await runChanges(
      [FILE, "--since", GIVEN_CURSOR, "--root", "sub"],
      determined(),
    );
    const baseline = await runChanges([FILE], determined());
    expect([...given.calls, ...baseline.calls]).toStrictEqual([
      [join(CWD, "sub"), [join(CWD, "src", "a.ts")], { since: GIVEN_CURSOR }],
      [CWD, [join(CWD, "src", "a.ts")], {}],
    ]);
  });

  it("D3504: a missing or empty file, an empty --root, an empty --since and an unknown option exit 2 with the usage on stderr, nothing on stdout, and send nothing", async () => {
    const cases = [
      [],
      [""],
      [FILE, "--root", ""],
      [FILE, "--since", ""],
      [FILE, "--bogus"],
    ];
    const outcomes = [];
    for (const argv of cases) {
      const run = await runChanges(argv, determined());
      outcomes.push({
        exit: run.exit,
        stdout: run.stdout,
        usage: run.stderr.includes(CHANGES_USAGE),
        sent: run.calls.length,
      });
    }
    expect(outcomes).toStrictEqual(
      cases.map(() => ({ exit: 2, stdout: "", usage: true, sent: 0 })),
    );
  });
});

describe("the answer to a changes query", () => {
  it("D3505: an answer listing a failing change exits 0, and under --json stdout is one document carrying the answer's cursor and changes", async () => {
    const run = await runChanges(
      [FILE, "--json"],
      determined({ changes: [FAILING_CHANGE] }),
    );
    const document = JSON.parse(run.stdout) as Record<string, unknown>;
    expect({
      exit: run.exit,
      schemaVersion: typeof document["schemaVersion"],
      command: document["command"],
      ok: document["ok"],
      cursor: document["cursor"],
      changes: document["changes"],
    }).toStrictEqual({
      exit: 0,
      schemaVersion: "number",
      command: "changes",
      ok: true,
      cursor: NEW_CURSOR,
      changes: [FAILING_CHANGE],
    });
  });

  it("D3506: a query that gets no answer exits 1 with the reason on stderr, and under --json prints one document with ok false and that reason", async () => {
    const reason = `The daemon serving ${CWD} is stopping.`;
    const human = await runChanges([FILE], new Error(reason));
    const json = await runChanges([FILE, "--json"], new Error(reason));
    const document = JSON.parse(json.stdout) as Record<string, unknown>;
    expect({
      human: { exit: human.exit, stdout: human.stdout, stderr: human.stderr },
      json: { exit: json.exit, ok: document["ok"], reason: document["reason"] },
    }).toStrictEqual({
      human: { exit: 1, stdout: "", stderr: `${reason}\n` },
      json: { exit: 1, ok: false, reason },
    });
  });

  it("D3507: the first line says whether the answer lists changes since the given cursor and how many, is a baseline and why, or is not determined and why, naming the revision, and the cursor follows on its own line", async () => {
    const lead = `RT Test changes in ${CWD} at input revision 4:`;
    const answers = [
      determined({
        changes: [FAILING_CHANGE, RECOVERED_ENTRY],
        omittedChanges: { failing: 0, recovered: 0, other: 1 },
      }),
      determined({
        cursorUse: "none-given",
        outside: { counts: NO_TESTS, changed: null },
      }),
      determined({
        cursorUse: "not-issued",
        outside: { counts: NO_TESTS, changed: null },
      }),
      notDetermined(),
      notDetermined({
        cursor: null,
        cursorUse: "none-given",
        notDetermined: {
          kind: "inputs-unavailable",
          reason: { reason: "a reconciliation runs", omittedCharacters: 0 },
        },
      }),
    ];
    const heads = [];
    for (const answer of answers) {
      heads.push(
        (await runChanges([FILE], answer)).stdout.split("\n").slice(0, 2),
      );
    }
    expect(heads).toStrictEqual([
      [`${lead} 3 changes since the given cursor`, `Cursor: ${NEW_CURSOR}`],
      [
        `${lead} a baseline, since no cursor was given`,
        `Cursor: ${NEW_CURSOR}`,
      ],
      [
        `${lead} a baseline, since the given cursor was not issued in this daemon's life`,
        `Cursor: ${NEW_CURSOR}`,
      ],
      [
        `${lead} not determined, since the dependency build at this input revision has not ended: ${BUILD_NOT_ENDED}; the given cursor is handed back unchanged`,
        `Cursor: ${GIVEN_CURSOR}`,
      ],
      [
        `${lead} not determined, since no input fingerprint can be computed: a reconciliation runs`,
        "Cursor: none, since this daemon life has recorded no moment yet",
      ],
    ]);
  });

  it("D3508: each listed change names its kind, its test or entry, its standing at the cursor and now, and a failing change's first error, and the changes left out are counted by kind", async () => {
    const run = await runChanges(
      [FILE],
      determined({
        changes: [FAILING_CHANGE, RECOVERED_ENTRY, DROPPED_TEST],
        omittedChanges: { failing: 0, recovered: 0, other: 2 },
      }),
    );
    expect(linesUnder(run.stdout, "Changes:")).toStrictEqual([
      "  failing packages/a unit src/a.test.ts > outer > inner: at the cursor: passed, current; now: failed, current; first error: boom",
      "  recovered entry went away: failed-module packages/a unit src/b.test.ts: SyntaxError: Unexpected token (1 errors)",
      "  other packages/a unit src/c.test.ts > dropped: at the cursor: passed, current; now: none",
      "  and 2 more: other 2",
    ]);
  });
});
