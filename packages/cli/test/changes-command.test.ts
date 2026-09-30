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

import type { ChangesResponse, ListedChange } from "@rt-test/daemon/client";
import { main } from "../src/main.js";
import type { ExitCode } from "../src/output.js";
import {
  ANSWER_ROOT,
  BUILD_NOT_ENDED,
  countsOf,
  determined,
  DROPPED_TEST,
  FAILING_CHANGE,
  GIVEN_CURSOR,
  NEW_CURSOR,
  NO_TESTS,
  notDetermined,
  RECOVERED_ENTRY,
} from "./changes-answers.js";

/** Where each command runs, and the consumer root every scripted answer names. */
const CWD = ANSWER_ROOT;
const CHANGES_USAGE =
  "rt-test changes <file>... [--since <cursor>] [--root <dir>] [--json]";
const FILE = "src/a.ts";

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
        counts: countsOf(2, "failed", "current"),
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
      [
        `${lead} 3 changes in scope since the given cursor`,
        `Cursor: ${NEW_CURSOR}`,
      ],
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

const LEAD = `RT Test changes in ${CWD} at input revision 4:`;
const BUSY = "EBUSY: resource busy or locked";

/** A module of workspace `a` that newly fails to load, listed as a failing change. */
const APPEARED_ENTRY: ListedChange = {
  kind: "failing",
  firstError: { reason: "SyntaxError: Unexpected token", omittedCharacters: 0 },
  now: {
    kind: "failed-module",
    workspacePath: "packages/a",
    projectName: "unit",
    modulePath: "src/d.test.ts",
    errorCount: 1,
    reason: "SyntaxError: Unexpected token",
    omittedCharacters: 0,
  },
};

/** The first line `rt-test changes` prints for each of `answers`. */
async function headlines(
  answers: readonly ChangesResponse[],
): Promise<string[]> {
  const heads = [];
  for (const answer of answers) {
    heads.push((await runChanges([FILE], answer)).stdout.split("\n")[0] ?? "");
  }
  return heads;
}

/** The `count` lines of `output` from the line `first` on. */
function linesFrom(output: string, first: string, count: number): string[] {
  const lines = output.split("\n");
  const start = lines.indexOf(first);
  return start === -1 ? [] : lines.slice(start, start + count);
}

describe("the text of a changes answer", () => {
  it("D3512: an answer not determined since named files could not be read names each file, escaped, and its reason under the unread files", async () => {
    const run = await runChanges(
      [FILE],
      notDetermined({
        cursor: null,
        cursorUse: "none-given",
        notDetermined: {
          kind: "paths-unread",
          unread: [
            {
              path: "src/a\u0007.ts",
              reason: { reason: BUSY, omittedCharacters: 0 },
            },
            {
              path: "src/b.ts",
              reason: {
                reason: "EACCES: permission denied",
                omittedCharacters: 0,
              },
            },
          ],
        },
      }),
    );
    expect({
      head: run.stdout.split("\n")[0],
      unread: linesUnder(run.stdout, "Unread files:"),
    }).toStrictEqual({
      head: `${LEAD} not determined, since 2 named files could not be read`,
      unread: [
        `  src/a\\u0007.ts: ${BUSY}`,
        "  src/b.ts: EACCES: permission denied",
      ],
    });
  });

  it("D3513: the tests in scope and the tests outside it are each counted under their own heading, with how many outside changed only when a cursor was used", async () => {
    const counts = {
      counts: countsOf(1, "passed", "current"),
      outside: { counts: countsOf(2, "failed", "stale"), changed: 2 },
    };
    const used = await runChanges([FILE], determined(counts));
    const baseline = await runChanges(
      [FILE],
      determined({
        ...counts,
        cursorUse: "none-given",
        outside: { ...counts.outside, changed: null },
      }),
    );
    expect([
      linesFrom(used.stdout, "Tests in scope: 1", 6),
      linesFrom(baseline.stdout, "Tests in scope: 1", 4).slice(3),
    ]).toStrictEqual([
      [
        "Tests in scope: 1",
        "  States: passed 1",
        "  Freshness: current 1, stale 0, unknown 0",
        "Tests outside scope: 2, 2 changed since the given cursor",
        "  States: failed 2",
        "  Freshness: current 0, stale 2, unknown 0",
      ],
      ["Tests outside scope: 2"],
    ]);
  });

  it("D3514: an answer given a usable cursor with no test in scope says so after its count of changes, and one with tests in scope does not", async () => {
    expect(
      await headlines([
        determined(),
        determined({
          changes: [FAILING_CHANGE],
          counts: countsOf(1, "failed", "current"),
        }),
      ]),
    ).toStrictEqual([
      `${LEAD} 0 changes in scope since the given cursor; no test is in scope`,
      `${LEAD} 1 change in scope since the given cursor`,
    ]);
  });

  it("D3515: a baseline for an expired cursor, and an answer not determined given a cursor not issued or expired, each say why the given cursor was not used", async () => {
    expect(
      await headlines([
        determined({
          cursorUse: "expired",
          outside: { counts: NO_TESTS, changed: null },
        }),
        notDetermined({ cursor: NEW_CURSOR, cursorUse: "not-issued" }),
        notDetermined({ cursor: NEW_CURSOR, cursorUse: "expired" }),
      ]),
    ).toStrictEqual([
      `${LEAD} a baseline, since the given cursor is older than the changes the daemon keeps`,
      `${LEAD} not determined, since the dependency build at this input revision has not ended: ${BUILD_NOT_ENDED}; the given cursor was not issued in this daemon's life`,
      `${LEAD} not determined, since the dependency build at this input revision has not ended: ${BUILD_NOT_ENDED}; the given cursor is older than the changes the daemon keeps`,
    ]);
  });

  it("D3516: an entry that newly appeared is printed with the entry it names", async () => {
    const run = await runChanges(
      [FILE],
      determined({
        changes: [APPEARED_ENTRY],
        counts: countsOf(1, "passed", "current"),
      }),
    );
    expect(linesUnder(run.stdout, "Changes:")).toStrictEqual([
      "  failing entry appeared: failed-module packages/a unit src/d.test.ts: SyntaxError: Unexpected token (1 errors); first error: SyntaxError: Unexpected token",
    ]);
  });
});
