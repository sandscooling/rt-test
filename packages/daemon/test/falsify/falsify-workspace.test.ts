import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { TestIdentity } from "@rt-test/core";
import { describe, expect, it } from "vitest";
import type { TestSpecification, Vitest } from "vitest/node";
import {
  recordRun,
  type DefectExperiment,
  type ExperimentRecord,
  type FalsificationJob,
  type RawError,
  type RecordedRunTest,
  type RunOutcome,
  type RunRecord,
} from "../../src/falsify/experiment-record.js";
import { falsifyWorkspace } from "../../src/falsify/falsify-workspace.js";
import { StaleTransformGuard } from "../../src/falsify/stale-transform-guard.js";
import { wholeDigest } from "../../src/inputs/input-inventory.js";
import { chosenConfigFile } from "../../src/vitest/confirmed-start.js";
import type { VitestWorkspace } from "../../src/vitest/find-workspaces.js";
import { DAEMON_TEST_TIMEOUT_MS, withEnvironment } from "../daemon-harness.js";
import {
  copyFixture,
  HAND_BUILT_ROOT,
  inConsumerCopy,
  inTempDir,
  linkVitest,
  REPO,
  RUN_HOOK,
  runHooks,
  slashed,
  type VitestInstall,
} from "../harness.js";
import {
  judgementOf,
  MISSING,
  onEachLine,
  ranJob,
  type RanJob,
} from "./job-readings.js";

const FIXTURE = "falsify";
const MODULE_CACHE_WORKSPACE = "module-cache";
const NEVER_ABORTED = new AbortController().signal;
/** The fixture declares no assertion error name, so only the two forms Vitest marks itself are assertions. */
const NO_DECLARED_NAMES: readonly string[] = [];
/** What the test writes over the label module when Vite first transforms it, while the baseline runs. */
const EDITED_LABEL = 'export const label = "after";\n';
const LABEL_MODULE = "src/label.mjs";
const MATH_MODULE = "src/math.mjs";
const GREET_MODULE = "src/greet.mjs";
/** The experiments of the job an abort interrupts, in the order the job runs them. */
const ABORTED_JOB_EXPERIMENTS: readonly string[] = ["add", "greet", "lib"];
/** A would-be detection's module is served mutated once in its first run and a second time in its confirming run. */
const CONFIRMING_SERVE = 2;
/** Read by the fixture's `once` test: the file it marks the first time it meets a mutated value. */
const ONCE_MARKER_VARIABLE = "RT_FIXTURE_ONCE_MARKER";
const ONCE_MARKER = "flaked-once";
/** The fields of a serialized error that hold message or source text. */
const ERROR_TEXT_FIELDS = ["message", "stack", "diff"] as const;
/** How many `/`-separated segments of a module's id name it within the fixture, as `src/math.mjs` does. */
const FIXTURE_PATH_SEGMENTS = 2;
/** A test module that imports the math module and that the `add` experiment does not run. */
const LOADED_TEST_MODULE = "test/loaded.test.mjs";
/** What the test appends to that test module while the `add` experiment runs. */
const ADDED_TEST = 'it("was added mid-job", () => {});\n';
/** The fixture's config reports a transformed module whose text holds a reach probe under this prefix. */
const MUTATED_EVENT = "mutated:";
/** The reach probe's call, which only a mutated module's text holds. */
const PROBE_CALL = "globalThis.__rtTestReach?.()";
const TEMP_VARIABLES = ["TMPDIR", "TMP", "TEMP"] as const;
/** The fixture as committed, which is what every job's copy holds when the job starts. */
const FIXTURE_SOURCE = join(REPO, "test/fixtures/daemon", FIXTURE);
/** A module the test writes into a copy of the fixture before a job starts, so the test chooses its exact text. */
const WRITTEN_MODULE = "src/written.mjs";
/** U+FEFF, built from its code so no invisible character sits in this file. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
/** The experiments of the shared job that mutate the math module and are decided without a run, with each one's reason. */
const DECIDED_WITH_TEXT: Readonly<Record<string, string>> = {
  failing: "baseline-not-passed",
  "alone-a": "baseline-not-passed",
  "no-module": "no-module",
  twice: "anchor-count",
  "no-probe": "no-probe-site",
};

interface FalsifiedFixture {
  readonly job: FalsificationJob;
  /** Each file of the consumer's tree the job changed, created or removed, the test's own edit aside. */
  readonly treeChanges: readonly string[];
  /** Each file under the job's temp directory that held a probe's call at any transform while the job ran. */
  readonly mutatedTempFiles: readonly string[];
  /** The module the root's server served mutated at each run that loaded one, in the order the job ran them. */
  readonly mutatedServes: readonly string[];
}

function unitTest(modulePath: string, namePath: string[]): TestIdentity {
  return {
    workspacePath: ".",
    projectName: "unit",
    modulePath,
    namePath,
    occurrence: 0,
  };
}

/** The job's experiments, over the fixture reached at `root`, in the order the job runs them. */
function experiments(root: string): DefectExperiment[] {
  const math = join(root, "src/math.mjs");
  const experiment = (
    defectId: string,
    test: TestIdentity,
    file: string,
    old: string,
    replacement: string,
  ): DefectExperiment => ({
    defectId,
    test,
    mutation: { file: join(root, file), old, new: replacement },
  });
  return [
    experiment(
      "add",
      unitTest("test/math.test.mjs", ["math", "adds"]),
      "src/math.mjs",
      "a + b",
      "a - b",
    ),
    experiment(
      "failing",
      unitTest("test/math.test.mjs", ["math", "fails without adding"]),
      "src/math.mjs",
      "a + b",
      "a * b",
    ),
    experiment(
      "loaded",
      unitTest("test/loaded.test.mjs", ["reads the table"]),
      "src/loaded.mjs",
      "n + 10",
      "n + 11",
    ),
    experiment(
      "prepare",
      unitTest("test/suite.test.mjs", ["prepared", "reads the prepared value"]),
      "src/prepare.mjs",
      "2 + 2",
      "2 + 3",
    ),
    experiment(
      "concurrent",
      unitTest("test/concurrent.test.mjs", ["together", "first"]),
      "src/scale.mjs",
      "n * 10",
      "n * 11",
    ),
    experiment(
      "greet",
      unitTest("test/label.test.mjs", ["greets"]),
      "src/greet.mjs",
      '"hi "',
      '"yo "',
    ),
    experiment(
      "label",
      unitTest("test/label.test.mjs", ["labels"]),
      LABEL_MODULE,
      '"before"',
      '"during"',
    ),
    experiment(
      "once",
      unitTest("test/once.test.mjs", ["flakes once"]),
      "src/once.mjs",
      "6 * 7",
      "6 * 8",
    ),
    experiment(
      "alone-a",
      unitTest("test/alone-a.test.mjs", ["elsewhere", "runs alone"]),
      "src/math.mjs",
      "a + b",
      "a - b",
    ),
    experiment(
      "alone-b",
      unitTest("test/alone-b.test.mjs", ["elsewhere", "runs alone"]),
      "src/math.mjs",
      "a + b",
      "a - b",
    ),
    experiment(
      "no-module",
      unitTest("test/absent.test.mjs", ["adds"]),
      "src/math.mjs",
      "a + b",
      "a - b",
    ),
    experiment(
      "unreadable",
      unitTest("test/math.test.mjs", ["math", "adds"]),
      "src/absent.mjs",
      "a + b",
      "a - b",
    ),
    experiment(
      "twice",
      unitTest("test/math.test.mjs", ["math", "adds"]),
      "src/math.mjs",
      "return a",
      "return b",
    ),
    experiment(
      "no-probe",
      unitTest("test/math.test.mjs", ["math", "adds"]),
      "src/math.mjs",
      readFileSync(math, "utf8"),
      "",
    ),
    {
      defectId: "lib",
      test: {
        workspacePath: ".",
        projectName: "lib",
        modulePath: "packages/lib/test/lib.test.mjs",
        namePath: ["adds in lib"],
        occurrence: 0,
      },
      mutation: { file: math, old: "a + b", new: "a * b" },
    },
  ];
}

/** Each file under `dir` by its `/`-separated path, with its digest; a link is not followed. */
function treeDigests(dir: string): Map<string, string> {
  const digests = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(path);
        continue;
      }
      digests.set(
        slashed(relative(dir, path)),
        createHash("sha256").update(readFileSync(path)).digest("hex"),
      );
    }
  };
  walk(dir);
  return digests;
}

function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function differingPaths(
  expected: ReadonlyMap<string, string>,
  actual: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...expected.keys(), ...actual.keys()]);
  return [...paths].filter((path) => expected.get(path) !== actual.get(path));
}

function filesHolding(dir: string, text: string): string[] {
  return [...treeDigests(dir).keys()].filter((path) =>
    readFileSync(join(dir, path), "utf8").includes(text),
  );
}

/** Runs `body` with the OS temp directory at `dir`, where Vitest's own temp files then go. */
async function withTempDirectory<T>(
  dir: string,
  body: () => Promise<T>,
): Promise<T> {
  const saved = TEMP_VARIABLES.map((key) => process.env[key]);
  for (const key of TEMP_VARIABLES) process.env[key] = dir;
  try {
    return await body();
  } finally {
    TEMP_VARIABLES.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

const jobs = new Map<VitestInstall, Promise<FalsifiedFixture>>();

/**
 * Falsifies the fixture once per Vitest install, through a directory link to its copy, since each job loads Vitest
 * and runs every experiment. The label module is edited as Vite first transforms it, so the runs after the baseline
 * find it changed on disk. A test module that imports the math module is edited while the `add` experiment runs,
 * after the job invalidated the math module for that experiment and before any later run asks for the test module.
 * The `once` experiment's test is told where to keep the marker that makes it fail only once: a file under the job's
 * temp directory, named through `ONCE_MARKER_VARIABLE`.
 */
function falsifiedOn(install: VitestInstall): Promise<FalsifiedFixture> {
  const cached = jobs.get(install);
  if (cached !== undefined) return cached;
  const job = inTempDir(async (dir) => {
    const real = join(dir, "real");
    mkdirSync(real);
    copyFixture(FIXTURE, real);
    linkVitest(real, install);
    const root = join(dir, "link");
    symlinkSync(real, root, "junction");
    const temp = join(dir, "temp");
    mkdirSync(temp);
    const before = treeDigests(real);
    const mutatedTempFiles = new Set<string>();
    const mutatedServes: string[] = [];
    /** Each file the test itself wrote during the job, with the text it wrote. */
    const edits = new Map<string, string>();
    const edit = (path: string, text: string): void => {
      edits.set(path, text);
      writeFileSync(join(real, path), text);
    };
    /** The math module is first served mutated in the `add` experiment, the first to mutate it. */
    const mathFirstMutated = (event: string): boolean =>
      !edits.has(LOADED_TEST_MODULE) &&
      event.startsWith(MUTATED_EVENT) &&
      event.endsWith(`/${MATH_MODULE}`);
    runHooks()[RUN_HOOK] = (event) => {
      for (const file of filesHolding(temp, PROBE_CALL)) {
        mutatedTempFiles.add(file);
      }
      if (event.startsWith(MUTATED_EVENT)) {
        mutatedServes.push(fixturePathOf(event));
      }
      if (!edits.has(LABEL_MODULE) && event.endsWith(`/${LABEL_MODULE}`)) {
        edit(LABEL_MODULE, EDITED_LABEL);
      }
      if (mathFirstMutated(event)) {
        edit(
          LOADED_TEST_MODULE,
          readFileSync(join(real, LOADED_TEST_MODULE), "utf8") + ADDED_TEST,
        );
      }
      return undefined;
    };
    const workspace: VitestWorkspace = { path: ".", directory: root };
    try {
      const falsified = await withTempDirectory(temp, () =>
        withEnvironment(ONCE_MARKER_VARIABLE, join(temp, ONCE_MARKER), () =>
          falsifyWorkspace(
            workspace,
            chosenConfigFile(workspace) ?? "",
            experiments(root),
            NO_DECLARED_NAMES,
            NEVER_ABORTED,
          ),
        ),
      );
      const expected = new Map(before);
      for (const [path, text] of edits) expected.set(path, digestOf(text));
      return {
        job: falsified,
        treeChanges: differingPaths(expected, treeDigests(real)),
        mutatedTempFiles: [...mutatedTempFiles],
        mutatedServes,
      };
    } finally {
      delete runHooks()[RUN_HOOK];
    }
  });
  jobs.set(install, job);
  return job;
}

/** A module's path within the fixture, from a fixture event that ends with the module's id. */
function fixturePathOf(event: string): string {
  return event.split("/").slice(-FIXTURE_PATH_SEGMENTS).join("/");
}

/** What `read` finds in the job on Vitest 5, then on Vitest 4.1. */
function onBothLines(
  read: (fixture: FalsifiedFixture) => unknown,
): Promise<unknown[]> {
  return onEachLine(falsifiedOn, read);
}

function experimentOf(
  fixture: FalsifiedFixture,
  defectId: string,
): ExperimentRecord | undefined {
  return ranJob(fixture.job)?.experiments.find(
    (record) => record.defectId === defectId,
  );
}

function experimentRun(
  fixture: FalsifiedFixture,
  defectId: string,
): RunRecord | undefined {
  const record = experimentOf(fixture, defectId);
  return record?.status === "ran" ? record.run : undefined;
}

function baselineRun(fixture: FalsifiedFixture): RunRecord | undefined {
  const outcome = ranJob(fixture.job)?.baseline;
  return outcome?.ran === true ? outcome.record : undefined;
}

function restoredRun(fixture: FalsifiedFixture): RunRecord | undefined {
  const outcome = ranJob(fixture.job)?.restoredBaseline;
  return outcome?.ran === true ? outcome.record : undefined;
}

function moduleIn(run: RunRecord | undefined, modulePath: string) {
  const module = run?.modules.find((entry) => entry.modulePath === modulePath);
  return module?.collected === true ? module : undefined;
}

function testIn(
  run: RunRecord | undefined,
  modulePath: string,
  name: string,
): RecordedRunTest | undefined {
  return moduleIn(run, modulePath)?.tests.find(
    (test) => test.identity.namePath.at(-1) === name,
  );
}

function reachIn(
  fixture: FalsifiedFixture,
  defectId: string,
  modulePath: string,
  name: string,
): unknown {
  return (
    testIn(experimentRun(fixture, defectId), modulePath, name)?.reach ?? MISSING
  );
}

function stateIn(
  run: RunRecord | undefined,
  modulePath: string,
  name: string,
): unknown {
  return testIn(run, modulePath, name)?.state ?? MISSING;
}

/** What `wholeDigest` gives a fixture module's text read whole as UTF-8, as a query reads the file. */
function startDigest(modulePath: string): string {
  return wholeDigest(readFileSync(join(FIXTURE_SOURCE, modulePath), "utf8"));
}

function digestCarried(fixture: FalsifiedFixture, defectId: string): unknown {
  return experimentOf(fixture, defectId)?.mutationFileDigest ?? MISSING;
}

function mutationLoads(fixture: FalsifiedFixture, defectId: string): unknown {
  const record = experimentOf(fixture, defectId);
  return record?.status === "ran" ? record.mutation : (record ?? MISSING);
}

const PROBED_ADD = {
  applied: true,
  probe: {
    placed: true,
    site: { line: 2, column: 3, nodeKind: "ReturnStatement" },
  },
};

/** Where the `no-probe` experiment's change starts: it removes its module's whole text, leaving no statement to probe. */
const EMPTIED_MODULE_SITE = {
  kind: "position",
  line: 1,
  column: 1,
  nodeKind: "Program",
  role: "root",
};

describe("a falsification job's mutation", () => {
  it(
    "D3621: through a consumer root reached by a directory link, the experiment's record says its mutation was applied once, with its probe site",
    async () => {
      expect(
        await onBothLines((fixture) => mutationLoads(fixture, "add")),
      ).toEqual([[PROBED_ADD], [PROBED_ADD]]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3632: the mutation is served to a project with its own config file, not only the root's",
    async () => {
      expect(
        await onBothLines((fixture) => mutationLoads(fixture, "lib")),
      ).toEqual([[PROBED_ADD], [PROBED_ADD]]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3631: a mutated file edited mid-job so its anchor no longer occurs is served unmutated, and the record says how often the anchor occurred",
    async () => {
      expect(
        await onBothLines((fixture) => mutationLoads(fixture, "label")),
      ).toEqual([
        [{ applied: false, occurrences: 0 }],
        [{ applied: false, occurrences: 0 }],
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("which tests reached the mutated site", () => {
  it(
    "D3622: a test that executed the site in its body reads reached in the test",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(fixture, "add", "test/math.test.mjs", "adds"),
        ),
      ).toEqual([{ executed: "in-test" }, { executed: "in-test" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3623: a test in the same file that failed an assertion without executing the site reads not executed",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(fixture, "add", "test/math.test.mjs", "fails without adding"),
        ),
      ).toEqual([{ executed: "no" }, { executed: "no" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3624: a site executed while the file loaded marks a test of that file that never called it, as reached outside the test",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(
            fixture,
            "loaded",
            "test/loaded.test.mjs",
            "adds beside the table",
          ),
        ),
      ).toEqual([{ executed: "outside-test" }, { executed: "outside-test" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3625: a site executed in a suite's beforeAll marks that suite's test as reached outside the test",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(
            fixture,
            "prepare",
            "test/suite.test.mjs",
            "reads the prepared value",
          ),
        ),
      ).toEqual([{ executed: "outside-test" }, { executed: "outside-test" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3626: a site executed in one suite's beforeAll does not mark a test of another suite",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(
            fixture,
            "prepare",
            "test/suite.test.mjs",
            "does not read it",
          ),
        ),
      ).toEqual([{ executed: "no" }, { executed: "no" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3745: a site executed in an outer suite's beforeAll marks a test of a suite nested in it as reached outside the test",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(
            fixture,
            "prepare",
            "test/suite.test.mjs",
            "reads it from a nested suite",
          ),
        ),
      ).toEqual([{ executed: "outside-test" }, { executed: "outside-test" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3627: a test the reach recorder never observed, since its suite's beforeAll failed, reads reach unknown, never not executed",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(fixture, "prepare", "test/suite.test.mjs", "never starts"),
        ),
      ).toEqual([
        { executed: "unknown", reason: "not-observed" },
        { executed: "unknown", reason: "not-observed" },
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3628: a test whose own afterEach threw is not marked by a site a later suite's beforeAll executes",
    async () => {
      expect(
        await onBothLines((fixture) =>
          reachIn(fixture, "prepare", "test/suite.test.mjs", "passes its body"),
        ),
      ).toEqual([{ executed: "no" }, { executed: "no" }]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3629: a site executed while two tests run concurrently reads reach unknown for each of them",
    async () => {
      const unattributed = { executed: "unknown", reason: "unattributed" };
      expect(
        await onBothLines((fixture) =>
          ["first", "second"].map((name) =>
            reachIn(fixture, "concurrent", "test/concurrent.test.mjs", name),
          ),
        ),
      ).toEqual([
        [unattributed, unattributed],
        [unattributed, unattributed],
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("no run reads what another run left", () => {
  it(
    "D3633: an experiment runs its mutated code, not the transform the baseline left cached for its module",
    async () => {
      expect(
        await onBothLines((fixture) =>
          stateIn(experimentRun(fixture, "add"), "test/math.test.mjs", "adds"),
        ),
      ).toEqual(["failed", "failed"]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3634: the restored baseline runs with no mutation after the last experiment mutated its module",
    async () => {
      expect(
        await onBothLines((fixture) =>
          stateIn(restoredRun(fixture), "test/math.test.mjs", "adds"),
        ),
      ).toEqual(["passed", "passed"]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3630: a source file edited on disk after the baseline read it is served from its new text at the next run",
    async () => {
      expect(
        await onBothLines((fixture) =>
          stateIn(
            experimentRun(fixture, "greet"),
            "test/label.test.mjs",
            "labels",
          ),
        ),
      ).toEqual(["failed", "failed"]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3709: a test module edited on disk after the job invalidated a module it imports is served from its new text at the next run that runs it",
    async () => {
      expect(
        await onBothLines((fixture) =>
          stateIn(
            experimentRun(fixture, "loaded"),
            LOADED_TEST_MODULE,
            "was added mid-job",
          ),
        ),
      ).toEqual(["passed", "passed"]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3635: each test file runs isolated though the workspace turns isolation off, so two files that each pass alone both pass the baseline",
    async () => {
      expect(
        await onBothLines((fixture) =>
          ["test/alone-a.test.mjs", "test/alone-b.test.mjs"].map((modulePath) =>
            stateIn(baselineRun(fixture), modulePath, "runs alone"),
          ),
        ),
      ).toEqual([
        ["passed", "passed"],
        ["passed", "passed"],
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3636: the workspace's bail does not cancel an experiment whose mutation fails a test, so the run ends completed",
    async () => {
      expect(
        await onBothLines((fixture) => {
          const run = experimentRun(fixture, "add");
          return run === undefined
            ? MISSING
            : { execution: run.execution, forceStopped: run.forceStopped };
        }),
      ).toEqual([
        { execution: "completed", forceStopped: false },
        { execution: "completed", forceStopped: false },
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3637: an experiment's record holds only its intended test's module, not the modules earlier runs left",
    async () => {
      expect(
        await onBothLines((fixture) =>
          experimentRun(fixture, "add")?.modules.map(
            (module) => `${module.projectName}:${module.modulePath}`,
          ),
        ),
      ).toEqual([["unit:test/math.test.mjs"], ["unit:test/math.test.mjs"]]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the facts a run records", () => {
  it(
    "D3638: a failed test's error keeps the fields Vitest serialized, such as the constructor marker and assertion name of an extended matcher",
    async () => {
      const read = (fixture: FalsifiedFixture): unknown => {
        const [error] =
          testIn(
            baselineRun(fixture),
            "test/math.test.mjs",
            "fails without adding",
          )?.errors ?? [];
        return error === undefined
          ? MISSING
          : {
              constructor: error["constructor"],
              assertionName: (
                error["__vitest_error_context__"] as
                  { assertionName?: unknown } | undefined
              )?.assertionName,
            };
      };
      const marked = {
        constructor: "Function<JestExtendError>",
        assertionName: "toBeTwo",
      };
      expect(await onBothLines(read)).toEqual([marked, marked]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3639: a test's result keeps the hook states Vitest recorded on it",
    async () => {
      // Vitest marks a hook `run` before it and `pass` after it, so a hook that threw stays `run`.
      const hooks = { beforeEach: "pass", afterEach: "run" };
      expect(
        await onBothLines(
          (fixture) =>
            testIn(
              baselineRun(fixture),
              "test/suite.test.mjs",
              "passes its body",
            )?.hooks ?? MISSING,
        ),
      ).toEqual([hooks, hooks]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3640: a module's record keeps the errors of each suite whose beforeAll failed",
    async () => {
      const suites = [
        ["broken setup", ["setup boom"]],
        ["inner broken", ["inner boom"]],
      ];
      expect(
        await onBothLines(
          (fixture) =>
            moduleIn(
              baselineRun(fixture),
              "test/suite.test.mjs",
            )?.suiteErrors.map((suite) => [
              suite.namePath.at(-1),
              suite.errors.map((error) => error["message"]),
            ]) ?? MISSING,
        ),
      ).toEqual([suites, suites]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3744: a nested suite's errors are recorded under its whole name path, its enclosing suite's name first",
    async () => {
      const namePath = ["outer", "inner broken"];
      expect(
        await onBothLines(
          (fixture) =>
            moduleIn(
              baselineRun(fixture),
              "test/suite.test.mjs",
            )?.suiteErrors.find(
              (suite) => suite.namePath.at(-1) === "inner broken",
            )?.namePath ?? MISSING,
        ),
      ).toEqual([namePath, namePath]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D3743: an error raised in the executor's own process, such as a worker that exited, keeps its name and message", () => {
    const run = recordRun({
      execution: "completed",
      forceStopped: false,
      specifications: [],
      testModules: [],
      queued: [],
      unhandledErrors: [new Error("worker exited")],
      locate: () => {
        throw new Error("a run with no specification locates no module");
      },
    });
    expect(
      run.unhandledErrors.map((error) => [error["name"], error["message"]]),
    ).toEqual([["Error", "worker exited"]]);
  });

  it(
    "D3641: a run's unhandled errors are recorded with the fields Vitest serialized, not reduced to text",
    async () => {
      const leaked = [["Error", "leaked rejection"]];
      expect(
        await onBothLines(
          (fixture) =>
            baselineRun(fixture)?.unhandledErrors.map((error) => [
              error["name"],
              error["message"],
            ]) ?? MISSING,
        ),
      ).toEqual([leaked, leaked]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3779: an unhandled error names the one test module its worker was running, not every module of the run",
    async () => {
      const named = [["unit:test/suite.test.mjs"]];
      expect(
        await onBothLines(
          (fixture) =>
            baselineRun(fixture)?.unhandledErrorModules.map((modules) =>
              modules.map(
                (module) => `${module.projectName}:${module.modulePath}`,
              ),
            ) ?? MISSING,
        ),
      ).toEqual([named, named]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it("D3780: an unhandled error stamped with a file two projects run names that file's module under each project", () => {
    const modulePath = "test/shared.test.mjs";
    const file = slashed(join(HAND_BUILT_ROOT, modulePath));
    const specification = (projectName: string): TestSpecification =>
      ({
        project: { name: projectName },
        moduleId: file,
      }) as unknown as TestSpecification;
    const run = recordRun({
      execution: "completed",
      forceStopped: false,
      specifications: [specification("node"), specification("browser")],
      testModules: [],
      queued: [],
      unhandledErrors: [{ VITEST_TEST_PATH: file }],
      locate: (projectName) => ({
        workspacePath: ".",
        projectName,
        modulePath,
      }),
    });
    expect(run.unhandledErrorModules).toEqual([
      [
        { projectName: "node", modulePath },
        { projectName: "browser", modulePath },
      ],
    ]);
  });
});

describe("experiments decided without running", () => {
  /** Each experiment read through this mutates the math module, whose text the job read. */
  const notRun = (reason: unknown): unknown => ({
    defectId: expect.any(String),
    status: "not-run",
    reason,
    mutationFileDigest: startDigest(MATH_MODULE),
  });

  it(
    "D3642: an experiment whose intended test failed the baseline is not run, naming the state it had",
    async () => {
      const expected = notRun({ kind: "baseline-not-passed", state: "failed" });
      expect(
        await onBothLines((fixture) => experimentOf(fixture, "failing")),
      ).toEqual([expected, expected]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3643: an experiment whose intended test the baseline did not report, found by its full identity, is not run",
    async () => {
      const expected = notRun({
        kind: "baseline-not-passed",
        state: "not-reported",
      });
      expect(
        await onBothLines((fixture) => experimentOf(fixture, "alone-a")),
      ).toEqual([expected, expected]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3644: an experiment whose intended test is in no module of the workspace is not run",
    async () => {
      const expected = notRun({ kind: "no-module" });
      expect(
        await onBothLines((fixture) => experimentOf(fixture, "no-module")),
      ).toEqual([expected, expected]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3645: an experiment whose mutated file cannot be read is not run, and the other experiments still run",
    async () => {
      const read = (fixture: FalsifiedFixture): unknown => {
        const record = experimentOf(fixture, "unreadable");
        return {
          reason:
            record?.status === "not-run" && record.reason.kind === "unreadable"
              ? {
                  kind: record.reason.kind,
                  missing: record.reason.error.includes("ENOENT"),
                }
              : (record ?? fixture.job.status),
          addRan: experimentOf(fixture, "add")?.status,
        };
      };
      const expected = {
        reason: { kind: "unreadable", missing: true },
        addRan: "ran",
      };
      expect(await onBothLines(read)).toEqual([expected, expected]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3646: an experiment whose anchor occurs twice in its file when the job starts is not run, naming the count",
    async () => {
      const expected = notRun({ kind: "anchor-count", count: 2 });
      expect(
        await onBothLines((fixture) => experimentOf(fixture, "twice")),
      ).toEqual([expected, expected]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3647: an experiment whose change has no probe site is not run, naming the position and never quoting source",
    async () => {
      const expected = notRun({
        kind: "no-probe-site",
        site: EMPTIED_MODULE_SITE,
      });
      expect(
        await onBothLines((fixture) => experimentOf(fixture, "no-probe")),
      ).toEqual([expected, expected]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the digest of its mutation file's text a record carries", () => {
  it(
    "D3870: an experiment that ran carries what wholeDigest gives its mutation file's text",
    async () => {
      const digest = startDigest(MATH_MODULE);
      expect(
        await onBothLines((fixture) => digestCarried(fixture, "add")),
      ).toEqual([digest, digest]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3871: an experiment decided without a run, its file's text in hand, carries that text's digest whatever the reason",
    async () => {
      const digest = startDigest(MATH_MODULE);
      const decided = Object.fromEntries(
        Object.entries(DECIDED_WITH_TEXT).map(([defectId, reason]) => [
          defectId,
          [reason, digest],
        ]),
      );
      const read = (fixture: FalsifiedFixture): unknown =>
        Object.fromEntries(
          Object.keys(DECIDED_WITH_TEXT).map((defectId) => {
            const record = experimentOf(fixture, defectId);
            return [
              defectId,
              record?.status === "not-run"
                ? [record.reason.kind, record.mutationFileDigest ?? MISSING]
                : (record ?? MISSING),
            ];
          }),
        );
      expect(await onBothLines(read)).toEqual([decided, decided]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3872: an experiment whose mutation file could not be read carries no digest",
    async () => {
      expect(
        await onBothLines((fixture) => {
          const record = experimentOf(fixture, "unreadable");
          return record === undefined
            ? MISSING
            : "mutationFileDigest" in record;
        }),
      ).toEqual([false, false]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3873: a mutation file edited on disk after the job read it carries the digest of the text the job read, not of the edited text",
    async () => {
      const digest = startDigest(LABEL_MODULE);
      expect(
        await onBothLines((fixture) => digestCarried(fixture, "label")),
      ).toEqual([digest, digest]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3874: a mutation file that starts with a byte order mark carries the digest of its text with the mark kept",
    async () => {
      const text = `${BYTE_ORDER_MARK}export const sum = 1 + 2;\n`;
      const digest = wholeDigest(text);
      expect(
        await onEachLine(digestCarriedOver(text), (carried) => carried),
      ).toEqual([digest, digest]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3875: a mutation file with CRLF line endings carries the digest of its text with those line endings kept",
    async () => {
      const text = "export const sum = 1 + 2;\r\nexport const two = 2;\r\n";
      const digest = wholeDigest(text);
      expect(
        await onEachLine(digestCarriedOver(text), (carried) => carried),
      ).toEqual([digest, digest]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("no mutated text on disk", () => {
  it(
    "D3648: a job writes no mutated text to the OS temp directory and leaves every file of the consumer's tree as it was",
    async () => {
      expect(
        await onBothLines(({ treeChanges, mutatedTempFiles }) => ({
          treeChanges,
          mutatedTempFiles,
        })),
      ).toEqual([
        { treeChanges: [], mutatedTempFiles: [] },
        { treeChanges: [], mutatedTempFiles: [] },
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3649: on Vitest 4.1, a workspace whose project sets the on-disk module cache itself runs nothing, naming the project and the setting",
    async () => {
      expect(refusalOf(await moduleCacheJob("vitest-4"))).toEqual({
        status: "refused",
        refusal: {
          kind: "module-cache",
          caches: [
            { projectName: "cached", setting: "experimental.fsModuleCache" },
          ],
        },
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3650: on Vitest 5, a project's deprecated experimental module cache setting, which the session's override turns off, is not refused",
    async () => {
      expect(refusalOf(await moduleCacheJob("vitest"))).toEqual({
        status: "ran",
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a job aborted before its turn", () => {
  it(
    "D3742: a job whose signal is already aborted loads nothing and answers interrupted before load",
    async () => {
      const answered = await inTempDir(async (dir) => {
        copyFixture(FIXTURE, dir);
        linkVitest(dir, "vitest");
        const workspace: VitestWorkspace = { path: ".", directory: dir };
        const job = await falsifyWorkspace(
          workspace,
          chosenConfigFile(workspace) ?? "",
          experiments(dir),
          NO_DECLARED_NAMES,
          AbortSignal.abort(),
        );
        return { job, workspace };
      });
      expect(answered.job).toEqual({
        status: "interrupted-before-load",
        workspace: answered.workspace,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the judgement each experiment reads", () => {
  const DETECTED = { verdict: "detected" };

  it(
    "D3774: a detection stands beside a baseline's unhandled error that names another test module",
    async () => {
      expect(
        await onBothLines((fixture) => judgementOf(fixture.job, "add")),
      ).toEqual([DETECTED, DETECTED]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3775: an experiment whose test's own module leaked an unhandled error in the baseline reads baseline not clean",
    async () => {
      const notClean = {
        verdict: "invalid-experiment",
        reason: "baseline-not-clean",
      };
      expect(
        await onBothLines((fixture) => judgementOf(fixture.job, "prepare")),
      ).toEqual([notClean, notClean]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3776: a would-be detection reads next run unclean when the run started next, another experiment's or the restored baseline, recorded an unhandled error",
    async () => {
      const unclean = { verdict: "unclear", reason: "next-run-unclean" };
      expect(
        await onBothLines((fixture) =>
          ["loaded", "lib"].map((defectId) =>
            judgementOf(fixture.job, defectId),
          ),
        ),
      ).toEqual([
        [unclean, unclean],
        [unclean, unclean],
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3777: a would-be detection whose confirming run passed reads unclear, naming what the confirming run alone read",
    async () => {
      const differed = {
        verdict: "unclear",
        reason: "confirming-run-differed",
        detail: { confirming: { verdict: "survived" } },
      };
      expect(
        await onBothLines((fixture) => judgementOf(fixture.job, "once")),
      ).toEqual([differed, differed]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3785: an experiment the job's own check decided before any run has no verdict for an unreadable file or an anchor count, naming the count, and reads invalid experiment for no probe site, naming its position, or no module",
    async () => {
      const decided = {
        unreadable: { reason: "mutation-file-unreadable" },
        twice: { reason: "anchor-count", detail: { count: 2 } },
        "no-probe": {
          verdict: "invalid-experiment",
          reason: "no-probe-site",
          detail: { site: EMPTIED_MODULE_SITE },
        },
        "no-module": { verdict: "invalid-experiment", reason: "no-module" },
      };
      expect(
        await onBothLines((fixture) =>
          Object.fromEntries(
            Object.keys(decided).map((defectId) => [
              defectId,
              judgementOf(fixture.job, defectId),
            ]),
          ),
        ),
      ).toEqual([decided, decided]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3781: a job's judgements, with the facts they rest on, hold no error's message, stack or diff",
    async () => {
      const none = { compared: true, held: [] };
      expect(await onBothLines(errorTextsInJudgements)).toEqual([none, none]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3782: a job's reply reads falsifier version 3, above the version whose records held no mutation file digest",
    async () => {
      expect(
        await onBothLines(
          (fixture) => ranJob(fixture.job)?.falsifierVersion ?? MISSING,
        ),
      ).toEqual([3, 3]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3783: a job refused before any run carries no judgement",
    async () => {
      const job = await moduleCacheJob("vitest-4");
      expect({ status: job.status, judged: "judgements" in job }).toEqual({
        status: "refused",
        judged: false,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("a confirming run", () => {
  it(
    "D3778: only an experiment whose run would be a detection runs a second time, at once, before the next experiment's run",
    async () => {
      const serves = [
        "src/math.mjs",
        "src/math.mjs",
        "src/loaded.mjs",
        "src/loaded.mjs",
        "src/prepare.mjs",
        "src/scale.mjs",
        "src/greet.mjs",
        "src/greet.mjs",
        "src/once.mjs",
        "src/once.mjs",
      ];
      expect(await onBothLines((fixture) => fixture.mutatedServes)).toEqual([
        serves,
        serves,
      ]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3784: an abort during a confirming run ends the job there, so that experiment and each one the job did not finish have no verdict and no restored baseline runs",
    async () => {
      const ended = {
        interrupted: true,
        experiments: [
          ["add", "ran", "ran"],
          ["greet", "ran", "interrupted"],
          ["lib", "not-run", "interrupted"],
        ],
        restored: false,
        judgements: [
          { reason: "restored-baseline-unrecorded" },
          { reason: "confirming-run-unrecorded" },
          { reason: "interrupted" },
        ],
      };
      expect(
        await onEachLine(abortedInConfirmingRun, runsAndJudgements),
      ).toEqual([ended, ended]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

describe("the stale-transform guard before a run", () => {
  it("D3735: a module of the mutated file that has no cached result yet is invalidated, so a transform of it still running is discarded", () => {
    const file = slashed(join(HAND_BUILT_ROOT, MATH_MODULE));
    /** A module node as Vite holds it while its first transform runs: known by id and file, with no result. */
    const transforming = { id: file, file, transformResult: null };
    const invalidated: unknown[] = [];
    const environment = {
      name: "ssr",
      pluginContainer: { transform: () => undefined },
      moduleGraph: {
        idToModuleMap: new Map([[file, transforming]]),
        invalidateModule: (module: unknown) => {
          invalidated.push(module);
        },
      },
    };
    const instance = {
      vite: { environments: { ssr: environment } },
      projects: [],
    } as unknown as Vitest;
    StaleTransformGuard.install(instance, (code) => code).freshen([
      join(HAND_BUILT_ROOT, MATH_MODULE),
    ]);
    expect(invalidated).toEqual([transforming]);
  });
});

/** A job with no experiments over the fixture's module-cache workspace. */
function moduleCacheJob(install: VitestInstall): Promise<FalsificationJob> {
  return inTempDir((dir) => {
    copyFixture(FIXTURE, dir);
    linkVitest(dir, install);
    const workspace: VitestWorkspace = {
      path: MODULE_CACHE_WORKSPACE,
      directory: join(dir, MODULE_CACHE_WORKSPACE),
    };
    return falsifyWorkspace(
      workspace,
      chosenConfigFile(workspace) ?? "",
      [],
      NO_DECLARED_NAMES,
      NEVER_ABORTED,
    );
  });
}

/**
 * The digest carried by the one experiment of a job over a copy of the fixture whose written module holds `text`. The
 * experiment names a test in no module, so the job decides it from the text it read and runs nothing. A reply that
 * holds no such digest is returned whole.
 */
function digestCarriedOver(
  text: string,
): (install: VitestInstall) => Promise<unknown> {
  return (install) =>
    inConsumerCopy(FIXTURE, install, async (root) => {
      const file = join(root, WRITTEN_MODULE);
      writeFileSync(file, text);
      const workspace: VitestWorkspace = { path: ".", directory: root };
      const job = await falsifyWorkspace(
        workspace,
        chosenConfigFile(workspace) ?? "",
        [
          {
            defectId: "written",
            test: unitTest("test/absent.test.mjs", ["adds"]),
            mutation: { file, old: "1 + 2", new: "1 - 2" },
          },
        ],
        NO_DECLARED_NAMES,
        NEVER_ABORTED,
      );
      return ranJob(job)?.experiments[0]?.mutationFileDigest ?? job;
    });
}

/** A job as its status and any refusal. */
function refusalOf(job: FalsificationJob): unknown {
  return job.status === "refused"
    ? { status: job.status, refusal: job.refusal }
    : { status: job.status };
}

/**
 * The fixture's `add`, `greet` and `lib` experiments, in that order, aborted as the greet module is served mutated a
 * second time, which is during the `greet` experiment's confirming run.
 */
function abortedInConfirmingRun(
  install: VitestInstall,
): Promise<FalsificationJob> {
  return inConsumerCopy(FIXTURE, install, async (root) => {
    const controller = new AbortController();
    let greetServes = 0;
    runHooks()[RUN_HOOK] = (event) => {
      if (
        event.startsWith(MUTATED_EVENT) &&
        event.endsWith(`/${GREET_MODULE}`)
      ) {
        greetServes += 1;
        if (greetServes === CONFIRMING_SERVE) controller.abort();
      }
      return undefined;
    };
    const workspace: VitestWorkspace = { path: ".", directory: root };
    try {
      return await falsifyWorkspace(
        workspace,
        chosenConfigFile(workspace) ?? "",
        experiments(root).filter(({ defectId }) =>
          ABORTED_JOB_EXPERIMENTS.includes(defectId),
        ),
        NO_DECLARED_NAMES,
        controller.signal,
      );
    } finally {
      delete runHooks()[RUN_HOOK];
    }
  });
}

/** Which runs a job's reply holds for each experiment, with each experiment's judgement; a job that ran nothing whole. */
function runsAndJudgements(job: FalsificationJob): unknown {
  const ran = ranJob(job);
  if (ran === undefined) return job;
  return {
    interrupted: ran.interrupted,
    experiments: ran.experiments.map((record) =>
      record.status === "ran"
        ? [record.defectId, record.status, record.confirming?.status ?? MISSING]
        : [record.defectId, record.status, record.reason.kind],
    ),
    restored: ran.restoredBaseline !== undefined,
    judgements: ran.experiments.map((record) =>
      judgementOf(job, record.defectId),
    ),
  };
}

function recordedRuns(
  outcomes: readonly (RunOutcome | undefined)[],
): RunRecord[] {
  return outcomes.flatMap((outcome) =>
    outcome?.ran === true ? [outcome.record] : [],
  );
}

/** Every run record of the job: both baselines, and each experiment's run and confirming run. */
function runRecordsOf(job: RanJob): RunRecord[] {
  return [
    ...recordedRuns([job.baseline, job.restoredBaseline]),
    ...job.experiments.flatMap((record) => {
      if (record.status !== "ran") return [];
      const { confirming } = record;
      return confirming?.status === "ran"
        ? [record.run, confirming.run]
        : [record.run];
    }),
  ];
}

function errorsOf(run: RunRecord): RawError[] {
  return [
    ...run.unhandledErrors,
    ...run.modules.flatMap((module) =>
      module.collected
        ? [
            ...module.errors,
            ...module.suiteErrors.flatMap((suite) => suite.errors),
            ...module.tests.flatMap((test) => test.errors),
          ]
        : [],
    ),
  ];
}

/** An error's text fields as JSON spells each inside a string, so a text holding a line break is still found. */
function textsOf(error: RawError): string[] {
  return ERROR_TEXT_FIELDS.flatMap((field) => {
    const text = error[field];
    return typeof text === "string" && text !== ""
      ? [JSON.stringify(text).slice(1, -1)]
      : [];
  });
}

/**
 * Each message, stack or diff of any error of any run of the job that its judgements, serialized, hold, and whether
 * the runs held any such text to compare.
 */
function errorTextsInJudgements(fixture: FalsifiedFixture): unknown {
  const job = ranJob(fixture.job);
  if (job === undefined) return fixture.job.status;
  const serialized = JSON.stringify(job.judgements);
  const texts = new Set(runRecordsOf(job).flatMap(errorsOf).flatMap(textsOf));
  return {
    compared: texts.size > 0,
    held: [...texts].filter((text) => serialized.includes(text)),
  };
}
