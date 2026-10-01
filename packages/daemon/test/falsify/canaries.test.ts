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
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import { takeCanaryReading } from "../../src/daemon/canary-reading.js";
import { Executor, type JobOutcome } from "../../src/daemon/executor.js";
import {
  BUNDLED_CANARY_DIRECTORY,
  type CanaryReading,
} from "../../src/falsify/canary-set.js";
import { FALSIFIER_VERSION } from "../../src/falsify/experiment-record.js";
import type { ExperimentFacts } from "../../src/falsify/fact-types.js";
import type { Judgement } from "../../src/falsify/verdict.js";
import { takeStartEnvironment } from "../../src/inputs/environment-digest.js";
import { resolveWorkspaceVitest } from "../../src/vitest/load-vitest.js";
import { memoryLog, settled, type Settled } from "../daemon-harness.js";
import { fakeVitest } from "../harness.js";

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
    "D3809: a test its suite gave repeats, whose setup assertion failed on the first repeat alone, reads test repeated, naming how many, never detected",
    async () => {
      const read = {
        "suite-repeats-setup-assertion": {
          verdict: "invalid-experiment",
          reason: "test-repeated",
          detail: { repeats: 2 },
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
    "D3810: a test that declares one repeat of its own, whose setup assertion failed on its first run alone, reads test repeated, never detected",
    async () => {
      const read = {
        "test-repeats-setup-assertion": {
          verdict: "invalid-experiment",
          reason: "test-repeated",
          detail: { repeats: 1 },
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

type Install = Parameters<typeof takeCanaryReading>[1];
type Falsify = Parameters<typeof takeCanaryReading>[0]["falsify"];
type Outcome = JobOutcome<FalsificationJob>;

const STAND_IN_VERSION = "5.0.1";
/** The version of another line, which a stand-in root or a reply holds. */
const OTHER_VERSION = "4.1.11";
const MODULES = "node_modules";
const VITEST = "vitest";
/** The one file a state directory holds before a reading, which is all it may hold once the reading is taken. */
const KEPT_STATE_FILE = "store.keep";
const EXECUTOR_DIED =
  "the executor process 4711 exited during the job (exit code 1)";
const OTHER_LINE: Record<VitestInstall, VitestInstall> = {
  vitest: "vitest-4",
  "vitest-4": "vitest",
};

interface ConsumerRoot {
  readonly root: string;
  readonly stateDirectory: string;
}

/** A consumer root and its state directory, beside the install a reading there is taken of. */
interface Place extends ConsumerRoot {
  readonly dir: string;
  readonly install: Install;
}

/** A consumer root under `dir` that holds a file of its own, and its state directory, which holds one too. */
function consumerRoot(dir: string): ConsumerRoot {
  const root = join(dir, "consumer");
  const stateDirectory = join(root, ".rt-test");
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(join(stateDirectory, KEPT_STATE_FILE), "the store");
  writeFileSync(join(root, "consumer.txt"), "a consumer file");
  return { root, stateDirectory };
}

/** A consumer root beside a stand-in Vitest install: a manifest and one file in a directory of its own, and no runner. */
function standInPlace(dir: string): Place {
  const installed = join(dir, "installed");
  fakeVitest(installed, STAND_IN_VERSION);
  return {
    ...consumerRoot(dir),
    dir,
    install: {
      directory: join(installed, MODULES, VITEST),
      version: STAND_IN_VERSION,
    },
  };
}

function entryLine(root: string, path: string): string {
  const entry = relative(root, path);
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return `${entry} link ${readlinkSync(path)}`;
  if (stat.isDirectory()) return `${entry} directory`;
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  return `${entry} file ${digest}`;
}

/** One line for each entry beneath `root`, but `skipped` and what it holds: its path, and a file's digest or a link's target. */
function treeLines(root: string, skipped?: string): string[] {
  const lines: string[] = [];
  const pending = [root];
  for (
    let directory = pending.pop();
    directory !== undefined;
    directory = pending.pop()
  ) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (path === skipped) continue;
      lines.push(entryLine(root, path));
      if (lstatSync(path).isDirectory()) pending.push(path);
    }
  }
  return lines.sort();
}

/** The consumer's files outside its state directory, the install's, and those of each directory in `also`. */
function outsideLines(place: Place, also: readonly string[] = []): string[] {
  const trees: (readonly [root: string, skipped?: string])[] = [
    [place.root, place.stateDirectory],
    [place.install.directory],
    ...also.map((directory) => [directory] as const),
  ];
  return trees.flatMap(([root, skipped]) =>
    treeLines(root, skipped).map((line) => `${root}: ${line}`),
  );
}

/** Each line that one of the two holds and the other does not. */
function changedLines(
  before: readonly string[],
  after: readonly string[],
): string[] {
  return [
    ...before.filter((line) => !after.includes(line)),
    ...after.filter((line) => !before.includes(line)),
  ];
}

/** How a job ends when its executor's process died: with no reply, and the reason. */
function died(reason = EXECUTOR_DIED): Promise<Outcome> {
  return Promise.resolve({ ended: false, reason });
}

function replying(reply: FalsificationJob): Falsify {
  return () => Promise.resolve({ ended: true, value: reply });
}

/** What a case hands a reading in place of the bundled set, the place's state directory and a job whose executor died. */
interface Arranged {
  readonly falsify?: Falsify;
  readonly canaryDirectory?: string;
  readonly stateDirectory?: string;
  /** Read once the reading is taken, before the place is removed. */
  readonly afterwards?: () => unknown;
}

interface Taken {
  readonly place: Place;
  readonly reading: Settled<CanaryReading>;
  readonly log: readonly string[];
  /** How many jobs the reading sent. */
  readonly sent: number;
  /** What the place's state directory holds once the reading is taken. */
  readonly left: readonly string[];
  /** Each line outside the state directory that the reading added, removed or altered. */
  readonly changed: readonly string[];
  readonly afterwards: unknown;
}

/** Takes a reading of the place's install, watching the directories in `also` beside the place's own. */
async function takenAt(
  place: Place,
  arranged: Arranged = {},
  also: readonly string[] = [],
): Promise<Taken> {
  const log = memoryLog();
  const falsify = arranged.falsify ?? (() => died());
  let sent = 0;
  const before = outsideLines(place, also);
  const reading = await settled(
    takeCanaryReading(
      {
        falsify: (...job) => {
          sent += 1;
          return falsify(...job);
        },
        stateDirectory: arranged.stateDirectory ?? place.stateDirectory,
        log,
        canaryDirectory: arranged.canaryDirectory ?? BUNDLED_CANARY_DIRECTORY,
      },
      place.install,
    ),
  );
  return {
    place,
    reading,
    log: log.entries,
    sent,
    left: readdirSync(place.stateDirectory).sort(),
    changed: changedLines(before, outsideLines(place, also)),
    afterwards: arranged.afterwards?.(),
  };
}

/** Takes a reading of a stand-in install in a place of its own, as `arrange` sets it up. */
function taken(
  arrange: (place: Place) => Arranged = () => ({}),
): Promise<Taken> {
  return inTempDir((dir) => {
    const place = standInPlace(dir);
    return takenAt(place, arrange(place));
  });
}

/**
 * A reading of one of this repository's installs through an executor of its own, from a state directory under a root
 * that links the other line. What the reading left is read while that executor is still open.
 */
function readThroughExecutor(install: VitestInstall): Promise<unknown> {
  return inTempDir(async (dir) => {
    const { root, stateDirectory } = consumerRoot(dir);
    linkVitest(root, OTHER_LINE[install]);
    const workspace = join(dir, "workspace");
    mkdirSync(workspace);
    linkVitest(workspace, install);
    const resolved = resolveWorkspaceVitest(workspace);
    const nearest = resolveWorkspaceVitest(stateDirectory);
    if (!resolved.supported || !nearest.supported) return { resolved, nearest };
    const executor = new Executor(memoryLog(), takeStartEnvironment());
    try {
      const { reading, log, sent, left, changed } = await takenAt(
        { dir, root, stateDirectory, install: resolved },
        { falsify: (...job) => executor.falsify(...job) },
        [nearest.directory],
      );
      return {
        reading,
        nearestVitest: nearest.version,
        log,
        sent,
        left,
        changed,
      };
    } finally {
      await executor.close();
    }
  });
}

function confirmedUnder(vitestVersion: string, nearestVitest: string): unknown {
  return {
    reading: { status: "confirmed", vitestVersion },
    nearestVitest,
    log: [],
    sent: 1,
    left: [KEPT_STATE_FILE],
    changed: [],
  };
}

interface SentJob {
  readonly workspace: VitestWorkspace;
  readonly configFile: string;
  readonly experiments: readonly DefectExperiment[];
  readonly assertionErrors: readonly string[];
}

/** What the one job of a reading over the bundled set was sent. */
async function sentToJob(): Promise<SentJob> {
  const jobs: SentJob[] = [];
  await taken(() => ({
    falsify: (workspace, configFile, sentExperiments, assertionErrors) => {
      jobs.push({
        workspace,
        configFile,
        experiments: sentExperiments,
        assertionErrors,
      });
      return died();
    },
  }));
  const [job] = jobs;
  if (job === undefined) throw new Error("the reading sent no job");
  return job;
}

function noReading(kind: string, detail?: unknown): unknown {
  return {
    status: "no-reading",
    kind,
    ...(detail === undefined ? {} : { detail }),
  };
}

/** A reading that is no reading since its reply did not read ran: its detail holds `words` in turn and nothing else. */
function notRan(...words: readonly string[]): unknown {
  return noReading(
    "not-ran",
    expect.stringMatching(new RegExp(`^${words.join("\\W+")}$`)),
  );
}

/** The workspace a hand-built reply names, which a reading never looks at. */
const PLACED: VitestWorkspace = { path: ".", directory: "placed" };
/** The facts of an experiment its job gave no run, which a reading never looks at either. */
const SOME_FACTS: ExperimentFacts = {
  job: { unhandledErrorCount: 0, closed: true },
  notRun: { kind: "interrupted" },
};

type Read = readonly [canaryId: string, judgement: Judgement];

const READ_DETECTED: Judgement = { verdict: "detected" };
const READ_SURVIVED: Judgement = { verdict: "survived" };
const READ_NOT_AN_ASSERTION: Judgement = {
  verdict: "unclear",
  reason: "not-an-assertion",
};
const READ_UNHANDLED_ERROR: Judgement = {
  verdict: "unclear",
  reason: "unhandled-error",
};
const READ_INTERRUPTED: Judgement = { reason: "interrupted" };
const READ_HOOK_NOT_PASSED: Judgement = {
  verdict: "invalid-experiment",
  reason: "hook-not-passed",
  detail: { hook: "beforeEach", state: "run" },
};

/** A reply that read ran with one judgement for each of `read`, in that order, under the stand-in install's version. */
function ranReply(
  read: readonly Read[],
  over: { vitestVersion?: string; interrupted?: boolean } = {},
): FalsificationJob {
  return {
    status: "ran",
    workspace: PLACED,
    vitestVersion: over.vitestVersion ?? STAND_IN_VERSION,
    falsifierVersion: FALSIFIER_VERSION,
    unhandledErrors: [],
    interrupted: over.interrupted ?? false,
    experiments: [],
    judgements: read.map(([defectId, judgement]) => ({
      ...judgement,
      defectId,
      facts: SOME_FACTS,
    })),
  };
}

/** A canary with a test and a mutation of its own, which the canary file names `judgement` for. */
function namedCanary(id: string, judgement: Canary["judgement"]): Canary {
  return {
    id,
    test: { modulePath: `${id}.canary.mjs`, namePath: [id] },
    mutation: { file: `src/${id}.mjs`, old: "1", new: "2" },
    judgement,
  };
}

const STAND_IN_PROJECT = "stand-in";

function setOf(canaries: readonly unknown[]): string {
  return JSON.stringify({
    projectName: STAND_IN_PROJECT,
    assertionErrors: [],
    canaries,
  });
}

/** A canary directory under `dir` that holds a canary file of `text` and nothing else, or nothing at all. */
function canaryDirectoryOf(dir: string, text: string | undefined): string {
  const directory = join(dir, "stand-in-set");
  mkdirSync(directory);
  if (text !== undefined) writeFileSync(join(directory, CANARY_FILE), text);
  return directory;
}

/** The reading of the stand-in install over a set that names `named`, when its job replies `reply`. */
async function readingOf(
  named: readonly Canary[],
  reply: FalsificationJob,
): Promise<unknown> {
  const { reading } = await taken((place) => ({
    canaryDirectory: canaryDirectoryOf(place.dir, setOf(named)),
    falsify: replying(reply),
  }));
  return reading;
}

async function readingsOf(
  named: readonly Canary[],
  replies: readonly FalsificationJob[],
): Promise<unknown[]> {
  const readings: unknown[] = [];
  for (const reply of replies) readings.push(await readingOf(named, reply));
  return readings;
}

/** For each text in turn, what a reading gave, sent and left over a canary directory whose canary file holds it. */
async function overCanaryFiles(
  texts: readonly (string | undefined)[],
): Promise<unknown[]> {
  const read: unknown[] = [];
  for (const text of texts) {
    const { reading, sent, left } = await taken((place) => ({
      canaryDirectory: canaryDirectoryOf(place.dir, text),
    }));
    read.push({ reading, sent, left });
  }
  return read;
}

/** A set that cannot be used: no job is sent, and the state directory holds what it held. */
const UNUSABLE = {
  reading: noReading("set-unusable", expect.any(String)),
  sent: 0,
  left: [KEPT_STATE_FILE],
};
/** A set that can be used: its one job is sent, and here that job's executor died. */
const USED = {
  reading: noReading("no-reply", EXECUTOR_DIED),
  sent: 1,
  left: [KEPT_STATE_FILE],
};
const VALID_CANARY = namedCanary("a", { verdict: "detected" });

/** A canary directory under the place that holds the bundled set and a `node_modules` of its own. */
function setWithOwnModules(place: Place): string {
  const directory = join(place.dir, "set-with-modules");
  cpSync(CANARIES, directory, { recursive: true });
  mkdirSync(join(directory, MODULES));
  return directory;
}

/** What a reading has placed at `directory`, read while its job runs. */
function placedAt(place: Place, directory: string): Record<string, unknown> {
  const modules = join(directory, MODULES);
  const link = join(modules, VITEST);
  return {
    in: dirname(directory),
    beside: readdirSync(place.stateDirectory).filter(
      (name) => join(place.stateDirectory, name) !== directory,
    ),
    copy: treeLines(directory, modules),
    modules: readdirSync(modules),
    linkTo: lstatSync(link).isSymbolicLink()
      ? realpathSync.native(link)
      : "no link",
  };
}

/** A reading by its status, or by its kind when it is no reading. */
function endingOf(reading: Settled<CanaryReading>): unknown {
  if ("thrown" in reading) return reading;
  return reading.status === "no-reading" ? reading.kind : reading.status;
}

describe("a canary reading of each Vitest install this repository holds", () => {
  it(
    "D4116: a reading through an executor is confirmed under the install's own version, from a state directory whose nearest Vitest is the other line, and leaves both installs and the consumer's files as they were",
    async () => {
      expect(await onEachLine(readThroughExecutor, (read) => read)).toEqual([
        confirmedUnder("5.0.1", "4.1.11"),
        confirmedUnder("4.1.11", "5.0.1"),
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("what a canary reading sends its job", () => {
  it("D4117: the job's workspace resolves the install the reading was given, though the nearest Vitest above the state directory is another", async () => {
    const resolved: unknown[] = [];
    const { place } = await taken((at) => {
      fakeVitest(at.root, OTHER_VERSION);
      return {
        falsify: (workspace) => {
          resolved.push(resolveWorkspaceVitest(workspace.directory));
          return died();
        },
      };
    });
    expect(resolved).toMatchObject([
      {
        supported: true,
        directory: place.install.directory,
        version: STAND_IN_VERSION,
      },
    ]);
  });

  it("D4118: the job's experiments are the bundled set's canaries in the order the canary file lists them", async () => {
    const sent = await sentToJob();
    expect(sent.experiments.map(({ defectId }) => defectId)).toEqual(
      canarySet().canaries.map(({ id }) => id),
    );
  });

  it("D4119: each experiment names its canary's test in the copy's one workspace, under the canary file's project name, as the first test of its name path", async () => {
    const sent = await sentToJob();
    expect(sent.experiments.map(({ test }) => test)).toEqual(
      canarySet().canaries.map(({ test }) => ({
        workspacePath: ".",
        projectName: "canaries",
        modulePath: test.modulePath,
        namePath: test.namePath,
        occurrence: 0,
      })),
    );
  });

  it("D4120: each experiment's mutation names its file inside the copy the job runs over, with the canary file's old and new text", async () => {
    const sent = await sentToJob();
    expect(sent.experiments.map(({ mutation }) => mutation)).toEqual(
      canarySet().canaries.map(({ mutation }) => ({
        ...mutation,
        file: join(sent.workspace.directory, mutation.file),
      })),
    );
  });

  it("D4121: the job is sent the canary file's assertion error names, for the copy as its one workspace and the config file the copy holds", async () => {
    const sent = await sentToJob();
    expect({
      assertionErrors: sent.assertionErrors,
      workspacePath: sent.workspace.path,
      configFile: sent.configFile,
    }).toEqual({
      assertionErrors: ["CanaryAssertionError"],
      workspacePath: ".",
      configFile: "vitest.config.mjs",
    });
  });
});

describe("a reply that read ran, uninterrupted, under the install's version", () => {
  it("D4122: a canary whose judgement holds another verdict than the canary file names reads disagreed, naming the canary with what was read and what is named", async () => {
    expect(
      await readingOf(
        [namedCanary("a", { verdict: "detected" })],
        ranReply([["a", READ_SURVIVED]]),
      ),
    ).toEqual({
      status: "disagreed",
      vitestVersion: STAND_IN_VERSION,
      canaries: [
        {
          id: "a",
          read: { verdict: "survived" },
          named: { verdict: "detected" },
        },
      ],
    });
  });

  it("D4123: a canary whose judgement holds the named verdict with another reason reads disagreed", async () => {
    const named = { verdict: "unclear", reason: "not-an-assertion" };
    expect(
      await readingOf(
        [namedCanary("a", named)],
        ranReply([["a", READ_UNHANDLED_ERROR]]),
      ),
    ).toEqual({
      status: "disagreed",
      vitestVersion: STAND_IN_VERSION,
      canaries: [
        {
          id: "a",
          read: { verdict: "unclear", reason: "unhandled-error" },
          named,
        },
      ],
    });
  });

  it("D4124: a judgement with no reason where the canary file names one, and one with a reason where it names none, each read disagreed", async () => {
    const withReason = { verdict: "detected", reason: "named-reason" };
    const withoutReason = { verdict: "unclear" };
    expect(
      await readingOf(
        [namedCanary("a", withReason), namedCanary("b", withoutReason)],
        ranReply([
          ["a", READ_DETECTED],
          ["b", READ_NOT_AN_ASSERTION],
        ]),
      ),
    ).toEqual({
      status: "disagreed",
      vitestVersion: STAND_IN_VERSION,
      canaries: [
        { id: "a", read: { verdict: "detected" }, named: withReason },
        {
          id: "b",
          read: { verdict: "unclear", reason: "not-an-assertion" },
          named: withoutReason,
        },
      ],
    });
  });

  it("D4125: a canary the reply holds no judgement of reads disagreed, with nothing read", async () => {
    expect(
      await readingOf(
        [
          namedCanary("a", { verdict: "detected" }),
          namedCanary("b", { verdict: "detected" }),
        ],
        ranReply([["a", READ_DETECTED]]),
      ),
    ).toEqual({
      status: "disagreed",
      vitestVersion: STAND_IN_VERSION,
      canaries: [{ id: "b", read: {}, named: { verdict: "detected" } }],
    });
  });

  it("D4126: the canaries that disagree are named in the canary file's order, whatever order the reply holds their judgements in", async () => {
    const unclear = { verdict: "unclear", reason: "not-an-assertion" };
    expect(
      await readingOf(
        [
          namedCanary("c", { verdict: "detected" }),
          namedCanary("a", { verdict: "survived" }),
          namedCanary("b", unclear),
        ],
        ranReply([
          ["a", READ_SURVIVED],
          ["b", READ_INTERRUPTED],
          ["c", READ_SURVIVED],
        ]),
      ),
    ).toEqual({
      status: "disagreed",
      vitestVersion: STAND_IN_VERSION,
      canaries: [
        {
          id: "c",
          read: { verdict: "survived" },
          named: { verdict: "detected" },
        },
        { id: "b", read: { reason: "interrupted" }, named: unclear },
      ],
    });
  });

  it("D4127: a judgement that holds the named verdict and reason beside a detail and facts the canary file does not name reads confirmed", async () => {
    expect(
      await readingOf(
        [
          namedCanary("a", {
            verdict: "invalid-experiment",
            reason: "hook-not-passed",
          }),
        ],
        ranReply([["a", READ_HOOK_NOT_PASSED]]),
      ),
    ).toEqual({ status: "confirmed", vitestVersion: STAND_IN_VERSION });
  });
});

describe("a canary reading that is no reading", () => {
  it("D4128: a canary directory with no canary file, or one that is not JSON, is a set that cannot be used, and no job is sent", async () => {
    expect(await overCanaryFiles([undefined, "{ not json"])).toEqual([
      UNUSABLE,
      UNUSABLE,
    ]);
  });

  it("D4129: a canary file with no project name, with assertion error names that are not all strings, or with no canary is a set that cannot be used", async () => {
    const whole = {
      projectName: STAND_IN_PROJECT,
      assertionErrors: [],
      canaries: [VALID_CANARY],
    };
    const broken = [
      { ...whole, projectName: undefined },
      { ...whole, projectName: 1 },
      { ...whole, assertionErrors: undefined },
      { ...whole, assertionErrors: ["CanaryAssertionError", 1] },
      { ...whole, canaries: undefined },
      { ...whole, canaries: {} },
      { ...whole, canaries: [] },
    ];
    expect(
      await overCanaryFiles(
        [whole, ...broken].map((file) => JSON.stringify(file)),
      ),
    ).toEqual([USED, ...broken.map(() => UNUSABLE)]);
  });

  it("D4130: a canary with an id, a test, a mutation or a judgement that is missing or of another type makes its set one that cannot be used", async () => {
    const { test, mutation } = VALID_CANARY;
    const broken = [
      { ...VALID_CANARY, id: 1 },
      { ...VALID_CANARY, test: undefined },
      { ...VALID_CANARY, test: { ...test, modulePath: 1 } },
      { ...VALID_CANARY, test: { ...test, namePath: ["a", 1] } },
      { ...VALID_CANARY, mutation: undefined },
      { ...VALID_CANARY, mutation: { ...mutation, file: undefined } },
      { ...VALID_CANARY, mutation: { ...mutation, old: 1 } },
      { ...VALID_CANARY, mutation: { ...mutation, new: undefined } },
      { ...VALID_CANARY, judgement: undefined },
      { ...VALID_CANARY, judgement: { reason: "named-reason" } },
      { ...VALID_CANARY, judgement: { verdict: "detected", reason: 1 } },
    ];
    expect(
      await overCanaryFiles(
        [VALID_CANARY, ...broken].map((canary) => setOf([canary])),
      ),
    ).toEqual([USED, ...broken.map(() => UNUSABLE)]);
  });

  it("D4131: a state directory that does not exist is a set that could not be placed, with the error's text, and no job is sent", async () => {
    const { reading, sent } = await taken((place) => ({
      stateDirectory: join(place.dir, "no-such-state"),
    }));
    expect({ reading, sent }).toEqual({
      reading: noReading("set-not-placed", expect.stringContaining("ENOENT")),
      sent: 0,
    });
  });

  it("D4132: a canary directory that already holds a node_modules is a set that could not be placed, with the error's text, and no job is sent", async () => {
    const { reading, sent } = await taken((place) => ({
      canaryDirectory: setWithOwnModules(place),
    }));
    expect({ reading, sent }).toEqual({
      reading: noReading("set-not-placed", expect.stringContaining("EEXIST")),
      sent: 0,
    });
  });

  it("D4133: a placement that fails after its directory was made leaves the state directory holding what it held, and logs nothing", async () => {
    const { left, log, changed } = await taken((place) => ({
      canaryDirectory: setWithOwnModules(place),
    }));
    expect({ left, log, changed }).toEqual({
      left: [KEPT_STATE_FILE],
      log: [],
      changed: [],
    });
  });

  it("D4134: a job that ended with no reply is no reading, with the reason its outcome gives", async () => {
    const { reading } = await taken(() => ({
      falsify: () => died(EXECUTOR_DIED),
    }));
    expect(reading).toEqual(noReading("no-reply", EXECUTOR_DIED));
  });

  it("D4135: a call that throws is a job that ended with no reply, with the error's text, and the reading does not reject", async () => {
    const { reading } = await taken(() => ({
      falsify: () =>
        Promise.reject(new Error("the executor could not be reached")),
    }));
    expect(reading).toEqual(
      noReading("no-reply", "the executor could not be reached"),
    );
  });

  it("D4136: an ended outcome whose value is no object is a job that ended with no reply", async () => {
    const { reading } = await taken(() => ({
      falsify: () =>
        Promise.resolve({ ended: true, value: "no job" } as unknown as Outcome),
    }));
    expect(reading).toEqual(noReading("no-reply", expect.any(String)));
  });

  it("D4137: a reply that did not read ran is no reading, with its status and then its own text where it has one", async () => {
    const loaded = {
      workspace: PLACED,
      vitestVersion: STAND_IN_VERSION,
      falsifierVersion: FALSIFIER_VERSION,
      unhandledErrors: [],
    };
    const replies: readonly FalsificationJob[] = [
      {
        status: "failed",
        workspace: PLACED,
        vitestVersion: STAND_IN_VERSION,
        error: "the config threw",
      },
      {
        ...loaded,
        status: "refused",
        refusal: { kind: "module-cache", caches: [] },
      },
      {
        ...loaded,
        status: "refused",
        refusal: { kind: "not-prepared", error: "no setup file" },
      },
      {
        status: "unsupported",
        workspace: PLACED,
        vitest: {
          supported: false,
          supportedRange: "4.1.x || 5.x",
          reason: "no Vitest resolves",
        },
      },
      {
        status: "not-confirmed",
        workspace: PLACED,
        reason: "the config file is no longer the one confirmed",
      },
      { status: "interrupted-before-load", workspace: PLACED },
    ];
    expect(await readingsOf([VALID_CANARY], replies)).toEqual([
      notRan("failed", "the config threw"),
      notRan("refused", "module-cache"),
      notRan("refused", "not-prepared", "no setup file"),
      notRan("unsupported", "no Vitest resolves"),
      notRan("not-confirmed", "the config file is no longer the one confirmed"),
      noReading("not-ran", "interrupted-before-load"),
    ]);
  });

  it("D4138: a reply that did not read ran and carries another Vitest version than the install's is a reply that did not run, the kind that holds first", async () => {
    expect(
      await readingOf([VALID_CANARY], {
        status: "failed",
        workspace: PLACED,
        vitestVersion: OTHER_VERSION,
        error: "the config threw",
      }),
    ).toEqual(notRan("failed", "the config threw"));
  });

  it("D4139: an interrupted reply is no reading of the interrupted kind, with no detail, also when it carries another Vitest version than the install's", async () => {
    const interrupted = { interrupted: true };
    expect(
      await readingsOf(
        [VALID_CANARY],
        [
          ranReply([["a", READ_INTERRUPTED]], interrupted),
          ranReply([["a", READ_INTERRUPTED]], {
            ...interrupted,
            vitestVersion: OTHER_VERSION,
          }),
        ],
      ),
    ).toEqual([noReading("interrupted"), noReading("interrupted")]);
  });

  it("D4140: a reply that carries another Vitest version than the install's is no reading, with the version it carried, though every canary reads as named", async () => {
    expect(
      await readingOf(
        [VALID_CANARY],
        ranReply([["a", READ_DETECTED]], { vitestVersion: OTHER_VERSION }),
      ),
    ).toEqual(noReading("other-vitest-version", OTHER_VERSION));
  });
});

describe("where a canary reading's files lie, and what it leaves", () => {
  it("D4141: while its job runs, a reading's files are a copy of the canary directory and one directory link to the install, in one directory of its own in the state directory", async () => {
    const placed: unknown[] = [];
    const { place } = await taken((at) => {
      const before = outsideLines(at);
      return {
        falsify: (workspace) => {
          placed.push({
            ...placedAt(at, workspace.directory),
            outside: changedLines(before, outsideLines(at)),
          });
          return died();
        },
      };
    });
    expect(placed).toEqual([
      {
        in: place.stateDirectory,
        beside: [KEPT_STATE_FILE],
        copy: treeLines(CANARIES),
        modules: [VITEST],
        linkTo: place.install.directory,
        outside: [],
      },
    ]);
  });

  it("D4142: two readings whose jobs run at one time from one state directory each have a directory of their own", async () => {
    const readings = await inTempDir(async (dir) => {
      const place = standInPlace(dir);
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = takenAt(place, {
        falsify: () => held.then(() => died("the first job's executor died")),
      });
      const second = await takenAt(place, {
        falsify: () => died("the second job's executor died"),
      });
      release();
      return [(await first).reading, second.reading];
    });
    expect(readings).toEqual([
      noReading("no-reply", "the first job's executor died"),
      noReading("no-reply", "the second job's executor died"),
    ]);
  });

  it("D4143: however a reading ended, its directory is gone, nothing is logged, and the install and the consumer's files outside the state directory are as they were", async () => {
    const asNamed = canarySet().canaries.map(({ id, judgement }): Read => [
      id,
      judgement as Judgement,
    ]);
    const endings: readonly Falsify[] = [
      replying(ranReply(asNamed)),
      replying(ranReply([])),
      replying(ranReply([], { interrupted: true })),
      () => died(),
      () => Promise.reject(new Error("the executor could not be reached")),
    ];
    const ended: unknown[] = [];
    for (const falsify of endings) {
      const { reading, left, log, changed } = await taken(() => ({ falsify }));
      ended.push({ as: endingOf(reading), left, log, changed });
    }
    const gone = (as: string): unknown => ({
      as,
      left: [KEPT_STATE_FILE],
      log: [],
      changed: [],
    });
    expect(ended).toEqual([
      gone("confirmed"),
      gone("disagreed"),
      gone("interrupted"),
      gone("no-reply"),
      gone("no-reply"),
    ]);
  });

  it("D4144: a reading's directory that resolves elsewhere when the reading ends is left alone and named in the log with where it leads, and the reading is what its job gave", async () => {
    let placed = "no job was sent";
    const { place, reading, log, afterwards } = await taken((at) => {
      const sibling = join(at.stateDirectory, "store");
      mkdirSync(sibling);
      writeFileSync(join(sibling, "rows"), "the store's rows");
      return {
        falsify: (workspace) => {
          placed = workspace.directory;
          renameSync(placed, `${placed}-moved`);
          symlinkSync(sibling, placed, "junction");
          return died();
        },
        afterwards: () => readFileSync(join(sibling, "rows"), "utf8"),
      };
    });
    const sibling = join(place.stateDirectory, "store");
    expect({
      reading,
      kept: afterwards,
      log: log.map((entry) => ({
        namesTheDirectory: entry.includes(placed),
        namesWhereItLeads: entry.includes(sibling),
      })),
    }).toEqual({
      reading: noReading("no-reply", EXECUTOR_DIED),
      kept: "the store's rows",
      log: [{ namesTheDirectory: true, namesWhereItLeads: true }],
    });
  });

  it("D4145: a reading's directory whose link to the install cannot be unlinked is left whole and named in the log, and the reading is what its job gave", async () => {
    let placed = "no job was sent";
    const { reading, log, afterwards } = await taken(() => ({
      falsify: (workspace) => {
        placed = workspace.directory;
        const link = join(placed, MODULES, VITEST);
        unlinkSync(link);
        mkdirSync(link);
        writeFileSync(join(link, "kept.txt"), "kept");
        return died();
      },
      afterwards: () => ({
        inTheLinksPlace: existsSync(join(placed, MODULES, VITEST, "kept.txt")),
        canaryFile: existsSync(join(placed, CANARY_FILE)),
      }),
    }));
    expect({
      reading,
      kept: afterwards,
      log: log.map((entry) => entry.includes(placed)),
    }).toEqual({
      reading: noReading("no-reply", EXECUTOR_DIED),
      kept: { inTheLinksPlace: true, canaryFile: true },
      log: [true],
    });
  });

  it("D4146: a reading's directory that is already gone when the reading ends is no failure, and nothing is logged", async () => {
    const { reading, log } = await taken(() => ({
      falsify: (workspace) => {
        unlinkSync(join(workspace.directory, MODULES, VITEST));
        rmSync(workspace.directory, { recursive: true });
        return died();
      },
    }));
    expect({ reading, log }).toEqual({
      reading: noReading("no-reply", EXECUTOR_DIED),
      log: [],
    });
  });

  it("D4147: a reading's directory whose link to the install is already gone is removed, and nothing is logged", async () => {
    const { left, log } = await taken(() => ({
      falsify: (workspace) => {
        unlinkSync(join(workspace.directory, MODULES, VITEST));
        return died();
      },
    }));
    expect({ left, log }).toEqual({ left: [KEPT_STATE_FILE], log: [] });
  });
});
