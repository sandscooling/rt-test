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
  type DefectCounts,
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
  survived: 0,
  "invalid-experiment": 0,
  unclear: 0,
  "never-verified": 0,
  detected: 0,
} as const;
/** The counts of a scope holding no definition and no definition file problem. */
const NO_COUNTS: DefectCounts = {
  total: 0,
  states: NO_STATES,
  freshness: { current: 0, stale: 0, unknown: 0 },
  staleCauses: {
    "definition-changed": 0,
    "mutation-file-changed": 0,
    "another-adapter-version": 0,
    "another-falsifier-version": 0,
    "another-vitest-version": 0,
    "inputs-changed": 0,
  },
  unknownReasons: {
    "no-current-fingerprint": 0,
    "duplicate-test-discovery-not-current": 0,
  },
  unreadableEvidence: 0,
  eligible: 0,
  verified: 0,
  invalidEntries: 0,
};

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
    counts: NO_COUNTS,
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
  more: Partial<ListedDefinition> = {},
): ListedDefinition {
  return {
    id,
    file: "defects/a.json",
    position: 0,
    test: { module: "src/a.test.ts", name: ["t"] },
    resolvedTest: null,
    mutationFile: "src/a.ts",
    state,
    eligible: false,
    ...(reason === undefined
      ? {}
      : { reason: { reason, omittedCharacters: 0 } }),
    ...more,
  };
}

/**
 * An answer holding a definition file problem, a definition that is invalid, one whose anchor is missing, one never
 * verified and one detected, and two gaps in one module.
 */
const WITH_PROBLEMS = defectsResponse({
  counts: {
    ...NO_COUNTS,
    total: 5,
    states: {
      ...NO_STATES,
      "invalid-definition": 1,
      "anchor-missing": 1,
      "never-verified": 1,
      detected: 1,
    },
    freshness: { current: 1, stale: 0, unknown: 0 },
    eligible: 1,
    verified: 1,
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
    listedDefinition("D4", "detected", undefined, {
      eligible: true,
      evidence: { freshness: "current" },
    }),
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
  it("D3704: an answer with problems exits 0 and prints the counts, each definition file problem, each invalid and anchor-missing definition with its reason, and the gap counts, but no definition that is never verified with no reason or detected", async () => {
    const run = await runDefects([], WITH_PROBLEMS);
    const lines = run.stdout.split("\n");
    const printed = (pattern: RegExp) =>
      lines.some((line) => pattern.test(line));
    expect({
      exit: run.exit,
      total: printed(/\b5\b.*\b1\b.*definition file problem/),
      entry: printed(/not-json defects\/broken\.json: it is not valid JSON$/),
      invalid: printed(/invalid-definition D1 .*: its test is not discovered$/),
      anchorMissing: printed(
        /anchor-missing D2 .*: its mutation's old text occurs 0 times in src\/a\.ts, not once$/,
      ),
      neverVerified: printed(/\bD3\b/),
      detected: printed(/\bD4\b/),
      gaps: printed(/src\/b\.test\.ts: 2$/),
    }).toStrictEqual({
      exit: 0,
      total: true,
      entry: true,
      invalid: true,
      anchorMissing: true,
      neverVerified: false,
      detected: false,
      gaps: true,
    });
  });

  it("D3705: under --json stdout is one versioned document carrying the answer's counts, its definitions with a detected one and each one's eligibility, its definition file problems and gaps", async () => {
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

/** An answer of 50 definitions that lists two of them, so its counts and its lists differ. */
const PAST_THE_BOUND = defectsResponse({
  counts: {
    ...NO_COUNTS,
    total: 50,
    states: {
      ...NO_STATES,
      "invalid-definition": 7,
      "anchor-missing": 3,
      "never-verified": 40,
    },
  },
  definitions: [
    listedDefinition("D1", "invalid-definition", "its test is not discovered"),
    listedDefinition(
      "D2",
      "anchor-missing",
      "its mutation's old text occurs 0 times in src/a.ts, not once",
    ),
  ],
  definitionsNotListed: {
    ...NO_STATES,
    "invalid-definition": 6,
    "anchor-missing": 2,
    "never-verified": 40,
  },
  testsInScope: 9,
  gaps: 4,
  gapModules: [{ module: "src/b.test.ts", gaps: 4 }],
});

describe("an answer that lists fewer definitions than it counts", () => {
  it("D3729: the text says how many definitions of each state the answer did not list", async () => {
    const run = await runDefects([], PAST_THE_BOUND);
    expect(
      run.stdout
        .split("\n")
        .filter((line) =>
          /not listed.*\binvalid-definition 6\b.*\banchor-missing 2\b.*\bsurvived 0\b.*\bnever-verified 40\b.*\bdetected 0\b/.test(
            line,
          ),
        ).length,
    ).toBe(1);
  });

  it("D3730: the text gives each state's count from the answer's counts, never from the definitions it lists, and the tests in scope with their gaps", async () => {
    const run = await runDefects([], PAST_THE_BOUND);
    const lines = run.stdout.split("\n");
    const printed = (pattern: RegExp) =>
      lines.filter((line) => pattern.test(line)).length;
    expect({
      states: printed(
        /invalid-definition 7\b.*anchor-missing 3\b.*never-verified 40\b/,
      ),
      tests: printed(/^Tests in scope: 9\b.*\b4\b.*gaps/),
    }).toStrictEqual({ states: 1, tests: 1 });
  });
});

/** How many lines of what `rt-test defects` prints for `answer` match each pattern. */
async function printedLines<K extends string>(
  answer: DefectsResponse,
  patterns: Readonly<Record<K, RegExp>>,
): Promise<Record<K, number>> {
  const lines = (await runDefects([], answer)).stdout.split("\n");
  const counted = {} as Record<K, number>;
  for (const name of Object.keys(patterns) as K[]) {
    counted[name] = lines.filter((line) => patterns[name].test(line)).length;
  }
  return counted;
}

/** An answer over nine definitions holding evidence of each freshness, and one whose evidence could not be read. */
const WITH_EVIDENCE = defectsResponse({
  counts: {
    ...NO_COUNTS,
    total: 9,
    states: {
      ...NO_STATES,
      survived: 1,
      "invalid-experiment": 1,
      unclear: 1,
      "never-verified": 2,
      detected: 4,
    },
    freshness: { current: 2, stale: 4, unknown: 1 },
    staleCauses: {
      ...NO_COUNTS.staleCauses,
      "definition-changed": 1,
      "inputs-changed": 3,
    },
    unknownReasons: {
      ...NO_COUNTS.unknownReasons,
      "no-current-fingerprint": 1,
    },
    unreadableEvidence: 1,
    eligible: 5,
    verified: 2,
  },
  definitions: [
    listedDefinition("D4", "survived", undefined, {
      evidence: { freshness: "current" },
    }),
    listedDefinition("D5", "invalid-experiment", undefined, {
      evidence: {
        freshness: "stale",
        staleCauses: ["inputs-changed"],
        reason: "hook-not-passed",
        detail: { hook: "beforeEach", state: "fail" },
        omittedCharacters: 0,
      },
    }),
    listedDefinition("D6", "unclear", undefined, {
      evidence: {
        freshness: "unknown",
        unknownReasons: ["no-current-fingerprint"],
        reason: "not-an-assertion",
        errors: [{ kind: "other", name: "TypeError" }, { kind: "other" }],
        errorsNotListed: 2,
        omittedCharacters: 0,
      },
    }),
    listedDefinition(
      "D8",
      "never-verified",
      "its stored evidence was refused as unreadable, so it reads as none: The store holds an unreadable facts",
    ),
    listedDefinition("D9", "never-verified"),
    listedDefinition("D7", "detected", undefined, {
      eligible: true,
      evidence: { freshness: "stale", staleCauses: ["inputs-changed"] },
    }),
  ],
});

describe("what the text says of stored evidence", () => {
  it("D3958: the count of definition file problems is worded for one problem and for several", async () => {
    const withProblems = (invalidEntries: number) =>
      defectsResponse({
        counts: { ...NO_COUNTS, total: invalidEntries + 3, invalidEntries },
      });
    const one = await printedLines(withProblems(1), {
      worded: /\b4\b.*\b1 is a definition file problem$/,
    });
    const two = await printedLines(withProblems(2), {
      worded: /\b5\b.*\b2 are definition file problems$/,
    });
    expect([one, two]).toStrictEqual([{ worded: 1 }, { worded: 1 }]);
  });

  it("D3959: the text gives verified against the total with the eligible count, each evidence freshness, each cause of staleness, each reason for unknown and the evidence that could not be read", async () => {
    const printed = await printedLines(WITH_EVIDENCE, {
      verified: /\b2 of 9\b.*\beligible\D*5\b/,
      freshness: /\bcurrent 2\b.*\bstale 4\b.*\bunknown 1\b/,
      causes: /\bdefinition-changed 1\b.*\binputs-changed 3\b/,
      reasons: /\bno-current-fingerprint 1\b/,
      unreadable: /could not be read\D*1$/,
    });
    expect(printed).toStrictEqual({
      verified: 1,
      freshness: 1,
      causes: 1,
      reasons: 1,
      unreadable: 1,
    });
  });

  it("D3960: each listed verdict that is not a detection is printed with its reason, its detail, its listed errors and how many were not listed, and its freshness with each cause or reason, and no detected definition is", async () => {
    const printed = await printedLines(WITH_EVIDENCE, {
      survived: /\bsurvived D4\b.*\bcurrent\b/,
      invalid:
        /\binvalid-experiment D5\b.*\bhook-not-passed\b.*\bbeforeEach\b.*\bfail\b.*\bstale\b.*\binputs-changed\b/,
      unclear:
        /\bunclear D6\b.*\bnot-an-assertion\b.*\bother TypeError\b.*\b2\b.*\bunknown\b.*\bno-current-fingerprint\b/,
      detected: /\bD7\b/,
    });
    expect(printed).toStrictEqual({
      survived: 1,
      invalid: 1,
      unclear: 1,
      detected: 0,
    });
  });

  it("D3961: a listed never verified definition whose stored evidence was refused is printed with that reason, and one with no reason is not printed", async () => {
    const printed = await printedLines(WITH_EVIDENCE, {
      refused: /\bnever-verified D8\b.*refused as unreadable/,
      plain: /\bD9\b/,
    });
    expect(printed).toStrictEqual({ refused: 1, plain: 0 });
  });

  it("D3962: a scope whose every definition is verified prints the same lines as one where none is, differing only in their numbers", async () => {
    const scope = (verified: number) =>
      defectsResponse({
        counts: {
          ...NO_COUNTS,
          total: 2,
          states: {
            ...NO_STATES,
            detected: verified,
            "never-verified": 2 - verified,
          },
          freshness: { current: verified, stale: 0, unknown: 0 },
          eligible: 2,
          verified,
        },
        definitions: ["D1", "D2"].map((id) =>
          verified === 0
            ? listedDefinition(id, "never-verified")
            : listedDefinition(id, "detected", undefined, {
                eligible: true,
                evidence: { freshness: "current" },
              }),
        ),
      });
    const shapeOf = async (answer: DefectsResponse) =>
      (await runDefects([], answer)).stdout
        .split("\n")
        .map((line) => line.split(/\d+/).join("N"));
    expect(await shapeOf(scope(2))).toStrictEqual(await shapeOf(scope(0)));
  });

  it("D3999: a verdict's detail that holds a list is printed as that list, a failing suite's names in their order and none under an index", async () => {
    const printed = await printedLines(
      defectsResponse({
        counts: {
          ...NO_COUNTS,
          total: 1,
          states: { ...NO_STATES, "invalid-experiment": 1 },
          freshness: { current: 1, stale: 0, unknown: 0 },
        },
        definitions: [
          listedDefinition("D5", "invalid-experiment", undefined, {
            evidence: {
              freshness: "current",
              reason: "suite-error",
              detail: { suite: ["cart", "applies a coupon"] },
              omittedCharacters: 0,
            },
          }),
        ],
      }),
      {
        suite:
          /\binvalid-experiment D5\b.*\bsuite-error\b.*\bsuite\W+cart\W+applies a coupon\b/,
      },
    );
    expect(printed).toStrictEqual({ suite: 1 });
  });
});
