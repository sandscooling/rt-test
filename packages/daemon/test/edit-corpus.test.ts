import { describe, expect, it } from "vitest";
import { DAEMON_TEST_TIMEOUT_MS } from "./daemon-harness.js";
import { checkSequence, CLEAN } from "./edit-corpus.js";
import { FINDING, storedRunFindings } from "./edit-corpus-findings.js";
import {
  CONFIG_AND_RUN_IN_PROGRESS,
  INSIDE_PACKAGES,
  NO_FAILURES,
  RENAME,
  SHARED_LIBRARY,
  TESTS_IN_AN_EXISTING_MODULE,
  type CorpusEdit,
} from "./edit-corpus-sequences.js";
import { runsLogged } from "./stored-run-log.js";

describe("the edit corpus replayed against the daemon beside plain Vitest", () => {
  it(
    "D3466: an edit to the shared library runs it and every workspace depending on it, and the daemon holds each failure a full run finds",
    async () => {
      expect(await checkSequence(SHARED_LIBRARY)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3467: edits inside packages run only the workspaces they reach, and no workspace holding a current result runs again",
    async () => {
      expect(await checkSequence(INSIDE_PACKAGES)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3468: a rename that leaves one import behind fails that module to load, and a docs edit afterwards runs nothing and moves no input revision",
    async () => {
      expect(await checkSequence(RENAME)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3469: a Vitest config edit runs its workspace and that workspace's dependents only, as does an edit saved while a run is going",
    async () => {
      expect(await checkSequence(CONFIG_AND_RUN_IN_PROGRESS)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D4345: a test added to an existing module, and then removed, is counted by the daemon's answers as a full run reports it once its workspace has run, with no workspace run twice",
    async () => {
      expect(await checkSequence(TESTS_IN_AN_EXISTING_MODULE)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the corpus's own detectors, each firing alone", () => {
  it(
    "D3470: after the shared library edit, the daemon holds each test the full run fails as a current failure",
    async () => {
      expect(await checkSequence(SHARED_LIBRARY)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D3471: a run the log says was stored under its workspace's previous fingerprint is one duplicate execution", () => {
    const runs = runsLogged([
      "run stored: packages/lib under fingerprint sha256:11AA",
      "run stored: packages/lib under fingerprint sha256:11AA",
    ]);
    const findings = storedRunFindings(edited(["packages/lib"]), runs, 1);
    expect(
      findings.map(({ kind, subject }) => ({ kind, subject })),
    ).toStrictEqual([
      { kind: FINDING.duplicateExecution, subject: "packages/lib" },
    ]);
  });

  it("D3472: a run at a fingerprint only an older, superseded run held, or after a run stored not fingerprinted, is no duplicate execution", () => {
    const runs = runsLogged([
      "run stored: packages/lib under fingerprint sha256:11AA",
      "run stored: packages/lib under fingerprint sha256:22BB",
      "run stored: packages/ui not fingerprinted",
      "run stored: packages/lib under fingerprint sha256:11AA",
      "run stored: packages/ui under fingerprint sha256:33CC",
    ]);
    const edit = edited(["packages/lib", "packages/ui"]);
    expect(storedRunFindings(edit, runs, 3)).toStrictEqual([]);
  });

  it("D4378: the corpus's history holds one stored run for each `run stored:` entry of the log, with its workspace and its fingerprint or that it has none, and none for any other entry", () => {
    expect(
      runsLogged([
        "the run of packages/ui is stored not fingerprinted: packages/ui/src/label.mjs changed while it ran",
        "run stored: packages/ui not fingerprinted",
        "run ended: packages/ui ran completed",
        "run stored: packages/lib under fingerprint sha256:11AA",
        "run ended: packages/lib ran completed",
        "the run of packages/lib ended with nothing stored: the store write failed",
      ]),
    ).toStrictEqual([
      {
        workspacePath: "packages/ui",
        inputFingerprint: { kind: "not-fingerprinted" },
      },
      {
        workspacePath: "packages/lib",
        inputFingerprint: { kind: "digest", digest: "sha256:11AA" },
      },
    ]);
  });

  it("D3473: a workspace the baseline runs twice, under two fingerprints, is a run outside the declared set", () => {
    const runs = runsLogged([
      "run stored: packages/lib under fingerprint sha256:11AA",
      "run stored: packages/lib under fingerprint sha256:22BB",
      "run stored: packages/ui under fingerprint sha256:33CC",
    ]);
    const baseline: CorpusEdit = {
      ...edited(["packages/lib", "packages/ui"]),
      declaredRunsOnce: true,
    };
    const findings = storedRunFindings(baseline, runs, 0);
    expect(
      findings.map(({ kind, subject }) => ({ kind, subject })),
    ).toStrictEqual([
      { kind: FINDING.runOutsideDeclaredSet, subject: "packages/lib" },
    ]);
  });
});

function edited(declaredRuns: readonly string[]): CorpusEdit {
  return {
    name: "an edit",
    changes: [],
    declaredRuns,
    declaredFailures: NO_FAILURES,
  };
}
