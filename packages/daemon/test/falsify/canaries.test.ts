import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  DefectExperiment,
  FalsificationJob,
} from "../../src/falsify/experiment-record.js";
import { falsifyWorkspace } from "../../src/falsify/falsify-workspace.js";
import { chosenConfigFile } from "../../src/vitest/confirmed-start.js";
import type { VitestWorkspace } from "../../src/vitest/find-workspaces.js";
import { DAEMON_TEST_TIMEOUT_MS } from "../daemon-harness.js";
import { inTempDir, linkVitest, type VitestInstall } from "../harness.js";
import {
  errorMarkersOf,
  judgementOf,
  MISSING,
  onEachLine,
  ranJob,
} from "./job-readings.js";

/** RT Test's canary fixtures: a Vitest project, and the file naming each canary's test, mutation and judgement. */
const CANARIES = fileURLToPath(new URL("../../canaries/", import.meta.url));
const CANARY_FILE = "canaries.json";
const NEVER_ABORTED = new AbortController().signal;

interface Canary {
  readonly id: string;
  readonly test: {
    readonly modulePath: string;
    readonly namePath: readonly string[];
  };
  readonly mutation: {
    readonly file: string;
    readonly old: string;
    readonly new: string;
  };
  readonly judgement: { readonly verdict?: string; readonly reason?: string };
}

interface CanarySet {
  readonly projectName: string;
  readonly assertionErrors: readonly string[];
  readonly canaries: readonly Canary[];
}

function canarySet(): CanarySet {
  return JSON.parse(
    readFileSync(join(CANARIES, CANARY_FILE), "utf8"),
  ) as CanarySet;
}

/** The set's canaries as a job's experiments over the copy at `root`, in the order the file lists them. */
function experiments(set: CanarySet, root: string): DefectExperiment[] {
  return set.canaries.map((canary) => ({
    defectId: canary.id,
    test: {
      workspacePath: ".",
      projectName: set.projectName,
      modulePath: canary.test.modulePath,
      namePath: [...canary.test.namePath],
      occurrence: 0,
    },
    mutation: { ...canary.mutation, file: join(root, canary.mutation.file) },
  }));
}

const jobs = new Map<VitestInstall, Promise<FalsificationJob>>();

/** Falsifies a copy of the canary set once per Vitest install, since each job loads Vitest and runs every canary. */
function falsifiedOn(install: VitestInstall): Promise<FalsificationJob> {
  const cached = jobs.get(install);
  if (cached !== undefined) return cached;
  const job = inTempDir((dir) => {
    const root = join(dir, "canaries");
    mkdirSync(root);
    cpSync(CANARIES, root, { recursive: true });
    linkVitest(root, install);
    const set = canarySet();
    const workspace: VitestWorkspace = { path: ".", directory: root };
    return falsifyWorkspace(
      workspace,
      chosenConfigFile(workspace) ?? "",
      experiments(set, root),
      set.assertionErrors,
      NEVER_ABORTED,
    );
  });
  jobs.set(install, job);
  return job;
}

/** What `read` finds in the canary job on Vitest 5, then on Vitest 4.1. */
function onBothLines(
  read: (job: FalsificationJob) => unknown,
): Promise<unknown[]> {
  return onEachLine(falsifiedOn, read);
}

/** Each named canary's judgement in the job, by canary id. */
function judgementsOf(
  ids: readonly string[],
): (job: FalsificationJob) => unknown {
  return (job) =>
    Object.fromEntries(ids.map((id) => [id, judgementOf(job, id)]));
}

/** A canary's judgement with the kinds of its intended test's errors, an assertion as the marker that made it one. */
function judgementAndErrorsOf(id: string): (job: FalsificationJob) => unknown {
  return (job) => ({
    judgement: judgementOf(job, id),
    errors: errorMarkersOf(job, id),
  });
}

/** A canary's verdict and reason alone, as the canary file names a judgement. */
function namedJudgements(job: FalsificationJob): unknown {
  return (
    ranJob(job)?.judgements.map((judgement) => ({
      id: judgement.defectId,
      judgement: {
        ...("verdict" in judgement ? { verdict: judgement.verdict } : {}),
        ...("reason" in judgement ? { reason: judgement.reason } : {}),
      },
    })) ?? job
  );
}

function reachOf(id: string): (job: FalsificationJob) => unknown {
  return (job) => {
    const facts = ranJob(job)?.judgements.find(
      (judgement) => judgement.defectId === id,
    )?.facts;
    return {
      judgement: judgementOf(job, id),
      reach:
        facts !== undefined && "run" in facts
          ? (facts.run.test?.reach ?? MISSING)
          : MISSING,
    };
  };
}

const DETECTED = { verdict: "detected" };
const NOT_AN_ASSERTION = { verdict: "unclear", reason: "not-an-assertion" };
const SITE_NOT_EXECUTED = {
  verdict: "invalid-experiment",
  reason: "site-not-executed",
};

describe("the canary set", () => {
  it(
    "D3786: a job over the set reads for every canary exactly the judgement the canary file names",
    async () => {
      const named = canarySet().canaries.map(({ id, judgement }) => ({
        id,
        judgement,
      }));
      expect(await onBothLines(namedJudgements)).toEqual([named, named]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a canary whose failure is an assertion in the intended test", () => {
  it(
    "D3787: an expect failure in the test body reads detected, by the AssertionError name",
    async () => {
      const read = { judgement: DETECTED, errors: ["assertion-error-name"] };
      expect(await onBothLines(judgementAndErrorsOf("body-expect"))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3788: a failing matcher added by expect.extend reads detected, by Vitest's marker and assertion name",
    async () => {
      const read = { judgement: DETECTED, errors: ["extended-matcher"] };
      expect(
        await onBothLines(judgementAndErrorsOf("extended-matcher")),
      ).toEqual([read, read]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3789: an error whose name the set declares reads detected, by the declared name",
    async () => {
      const read = { judgement: DETECTED, errors: ["declared-name"] };
      expect(
        await onBothLines(judgementAndErrorsOf("declared-error-name")),
      ).toEqual([read, read]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3790: an assertion after a site that executes while its module loads reads detected, the site reached outside the test",
    async () => {
      const read = {
        judgement: DETECTED,
        reach: { executed: "outside-test" },
      };
      expect(await onBothLines(reachOf("load-time-site"))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a canary whose run cannot say whether its test rejects the mutation", () => {
  it(
    "D3791: an assertion that fails in a beforeEach and an afterEach that throws each read hook not passed, naming the hook, never detected",
    async () => {
      const hookNotPassed = (hook: string): unknown => ({
        verdict: "invalid-experiment",
        reason: "hook-not-passed",
        detail: { hook, state: "run" },
      });
      const read = {
        "before-each-assertion": hookNotPassed("beforeEach"),
        "after-each-throw": hookNotPassed("afterEach"),
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3792: a beforeAll that throws reads suite error, naming the suite",
    async () => {
      const read = {
        "before-all-throw": {
          verdict: "invalid-experiment",
          reason: "suite-error",
          detail: { suite: ["before all"] },
        },
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3793: a mutated module that throws while it loads reads module failed",
    async () => {
      const read = {
        "module-load-throw": {
          verdict: "invalid-experiment",
          reason: "module-failed",
        },
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3794: a test that passes or fails an assertion without executing the site, or never loads the mutated module, reads site not executed, never detected or survived",
    async () => {
      const read = {
        "site-not-called": SITE_NOT_EXECUTED,
        "site-called-by-another-test": SITE_NOT_EXECUTED,
        "module-never-loaded": {
          ...SITE_NOT_EXECUTED,
          detail: { mutation: "never-transformed" },
        },
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3795: a site executed while tests run concurrently reads reach unknown, never detected",
    async () => {
      const read = {
        "concurrent-site": {
          verdict: "invalid-experiment",
          reason: "reach-unknown",
          detail: { cause: "unattributed" },
        },
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a canary whose test failed in its body, not at an assertion alone", () => {
  it(
    "D3796: a thrown TypeError, a timeout, an assertion count failure, a snapshot mismatch and an error of an undeclared name each read unclear, never detected",
    async () => {
      const read = {
        "type-error": NOT_AN_ASSERTION,
        timeout: NOT_AN_ASSERTION,
        "assertion-count": NOT_AN_ASSERTION,
        "snapshot-mismatch": NOT_AN_ASSERTION,
        "undeclared-error-name": NOT_AN_ASSERTION,
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3797: an assertion error beside an error of another kind reads unclear, never detected",
    async () => {
      const read = {
        judgement: NOT_AN_ASSERTION,
        errors: ["assertion-error-name", "other"],
      };
      expect(
        await onBothLines(judgementAndErrorsOf("mixed-error-kinds")),
      ).toEqual([read, read]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3798: an assertion failure beside an unhandled rejection in its own run reads unclear, never detected",
    async () => {
      const read = {
        "leaked-rejection": { verdict: "unclear", reason: "unhandled-error" },
      };
      expect(await onBothLines(judgementsOf(Object.keys(read)))).toEqual([
        read,
        read,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
