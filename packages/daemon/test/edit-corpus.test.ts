import { describe, expect, it } from "vitest";
import type { StoreBindings, StoredRun } from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import { DAEMON_TEST_TIMEOUT_MS } from "./daemon-harness.js";
import { checkSequence, CLEAN } from "./edit-corpus.js";
import { FINDING, storedRunFindings } from "./edit-corpus-findings.js";
import {
  CONFIG_AND_RUN_IN_PROGRESS,
  INSIDE_PACKAGES,
  NO_FAILURES,
  RENAME,
  SHARED_LIBRARY,
  type CorpusEdit,
} from "./edit-corpus-sequences.js";
import { ranWorkspace } from "./round-fixtures.js";
import { digestOf, SCOPE, UNFINGERPRINTED } from "./scheduling-harness.js";

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
});

describe("the corpus's own detectors, each firing alone", () => {
  it(
    "D3470: after the shared library edit, the daemon holds each test the full run fails as a current failure",
    async () => {
      expect(await checkSequence(SHARED_LIBRARY)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D3471: a run stored under its workspace's previous fingerprint and adapter version is one duplicate execution", () => {
    const runs = [
      storedAt(0, "packages/lib", digestOf("lib-1")),
      storedAt(1, "packages/lib", digestOf("lib-1")),
    ];
    const findings = storedRunFindings(edited(["packages/lib"]), runs, 1);
    expect(
      findings.map(({ kind, subject }) => ({ kind, subject })),
    ).toStrictEqual([
      { kind: FINDING.duplicateExecution, subject: "packages/lib" },
    ]);
  });

  it("D3472: a run at a fingerprint only an older, superseded run held, or after a run stored not fingerprinted, is no duplicate execution", () => {
    const runs = [
      storedAt(0, "packages/lib", digestOf("lib-1")),
      storedAt(1, "packages/lib", digestOf("lib-2")),
      storedAt(2, "packages/ui", UNFINGERPRINTED),
      storedAt(3, "packages/lib", digestOf("lib-1")),
      storedAt(4, "packages/ui", digestOf("ui-1")),
    ];
    const edit = edited(["packages/lib", "packages/ui"]);
    expect(storedRunFindings(edit, runs, 3)).toStrictEqual([]);
  });

  it("D3473: a workspace the baseline runs twice, under two fingerprints, is a run outside the declared set", () => {
    const runs = [
      storedAt(0, "packages/lib", digestOf("lib-1")),
      storedAt(1, "packages/lib", digestOf("lib-2")),
      storedAt(2, "packages/ui", digestOf("ui-1")),
    ];
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

/** A passing run of `path`, stored `index`th, as the store returns it. */
function storedAt(
  index: number,
  path: string,
  inputFingerprint: StoreBindings["inputFingerprint"],
): StoredRun {
  return {
    ...SCOPE,
    inputFingerprint,
    adapterVersion: VITEST_ADAPTER_VERSION,
    runId: `run-${index}`,
    run: ranWorkspace(path),
  };
}
