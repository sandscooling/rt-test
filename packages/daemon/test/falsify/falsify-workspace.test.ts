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
import type {
  DefectExperiment,
  ExperimentRecord,
  FalsificationJob,
  RecordedRunTest,
  RunRecord,
} from "../../src/falsify/experiment-record.js";
import { falsifyWorkspace } from "../../src/falsify/falsify-workspace.js";
import { chosenConfigFile } from "../../src/vitest/confirmed-start.js";
import type { VitestWorkspace } from "../../src/vitest/find-workspaces.js";
import { DAEMON_TEST_TIMEOUT_MS } from "../daemon-harness.js";
import {
  copyFixture,
  inTempDir,
  linkVitest,
  RUN_HOOK,
  runHooks,
  slashed,
  type VitestInstall,
} from "../harness.js";

const FIXTURE = "falsify";
const MODULE_CACHE_WORKSPACE = "module-cache";
const NEVER_ABORTED = new AbortController().signal;
/** What the test writes over the label module when Vite first transforms it, while the baseline runs. */
const EDITED_LABEL = 'export const label = "after";\n';
const LABEL_MODULE = "src/label.mjs";
const MATH_MODULE = "src/math.mjs";
/** A test module that imports the math module and that the `add` experiment does not run. */
const LOADED_TEST_MODULE = "test/loaded.test.mjs";
/** What the test appends to that test module while the `add` experiment runs. */
const ADDED_TEST = 'it("was added mid-job", () => {});\n';
/** The math module's second transform is the `add` experiment's: the baseline's is its first. */
const ADD_EXPERIMENT_TRANSFORM = 2;
/** The reach probe's call, which only a mutated module's text holds. */
const PROBE_CALL = "globalThis.__rtTestReach?.()";
const TEMP_VARIABLES = ["TMPDIR", "TMP", "TEMP"] as const;

type RanJob = Extract<FalsificationJob, { status: "ran" }>;

interface FalsifiedFixture {
  readonly job: FalsificationJob;
  /** Each file of the consumer's tree the job changed, created or removed, the test's own edit aside. */
  readonly treeChanges: readonly string[];
  /** Each file under the job's temp directory that held a probe's call at any transform while the job ran. */
  readonly mutatedTempFiles: readonly string[];
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
      "function add(",
      "function sum(",
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
    /** Each file the test itself wrote during the job, with the text it wrote. */
    const edits = new Map<string, string>();
    const edit = (path: string, text: string): void => {
      edits.set(path, text);
      writeFileSync(join(real, path), text);
    };
    let mathTransforms = 0;
    runHooks()[RUN_HOOK] = (event) => {
      for (const file of filesHolding(temp, PROBE_CALL)) {
        mutatedTempFiles.add(file);
      }
      if (!edits.has(LABEL_MODULE) && event.endsWith(`/${LABEL_MODULE}`)) {
        edit(LABEL_MODULE, EDITED_LABEL);
      }
      if (event.endsWith(`/${MATH_MODULE}`)) {
        mathTransforms += 1;
        if (mathTransforms === ADD_EXPERIMENT_TRANSFORM) {
          edit(
            LOADED_TEST_MODULE,
            readFileSync(join(real, LOADED_TEST_MODULE), "utf8") + ADDED_TEST,
          );
        }
      }
      return undefined;
    };
    const workspace: VitestWorkspace = { path: ".", directory: root };
    try {
      const falsified = await withTempDirectory(temp, () =>
        falsifyWorkspace(
          workspace,
          chosenConfigFile(workspace) ?? "",
          experiments(root),
          NEVER_ABORTED,
        ),
      );
      const expected = new Map(before);
      for (const [path, text] of edits) expected.set(path, digestOf(text));
      return {
        job: falsified,
        treeChanges: differingPaths(expected, treeDigests(real)),
        mutatedTempFiles: [...mutatedTempFiles],
      };
    } finally {
      delete runHooks()[RUN_HOOK];
    }
  });
  jobs.set(install, job);
  return job;
}

/** What `read` finds in the job on Vitest 5, then on Vitest 4.1. */
async function onBothLines(
  read: (fixture: FalsifiedFixture) => unknown,
): Promise<unknown[]> {
  return [
    read(await falsifiedOn("vitest")),
    read(await falsifiedOn("vitest-4")),
  ];
}

function ranJob(job: FalsificationJob): RanJob | undefined {
  return job.status === "ran" ? job : undefined;
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

const MISSING = "missing";

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

function mutationLoads(fixture: FalsifiedFixture, defectId: string): unknown {
  const record = experimentOf(fixture, defectId);
  return record?.status === "ran" ? record.mutation : (record ?? MISSING);
}

const PROBED_ADD = {
  applied: true,
  probe: {
    placed: true,
    site: { line: 2, column: 10, nodeKind: "BinaryExpression" },
  },
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
    "D3640: a module's record keeps each suite's errors under that suite's name path",
    async () => {
      const suites = [[["broken setup"], ["setup boom"]]];
      expect(
        await onBothLines(
          (fixture) =>
            moduleIn(
              baselineRun(fixture),
              "test/suite.test.mjs",
            )?.suiteErrors.map((suite) => [
              suite.namePath,
              suite.errors.map((error) => error["message"]),
            ]) ?? MISSING,
        ),
      ).toEqual([suites, suites]);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

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
});

describe("experiments decided without running", () => {
  const notRun = (reason: unknown): unknown => ({
    defectId: expect.any(String),
    status: "not-run",
    reason,
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
        site: {
          kind: "position",
          line: 1,
          column: 17,
          nodeKind: "Identifier",
          role: "FunctionDeclaration.id",
        },
      });
      expect(
        await onBothLines((fixture) => experimentOf(fixture, "no-probe")),
      ).toEqual([expected, expected]);
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
      expect(await moduleCacheJob("vitest-4")).toEqual({
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
      expect(await moduleCacheJob("vitest")).toEqual({ status: "ran" });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});

/** A job with no experiments over the fixture's module-cache workspace, as its status and any refusal. */
function moduleCacheJob(install: VitestInstall): Promise<unknown> {
  return inTempDir(async (dir) => {
    copyFixture(FIXTURE, dir);
    linkVitest(dir, install);
    const workspace: VitestWorkspace = {
      path: MODULE_CACHE_WORKSPACE,
      directory: join(dir, MODULE_CACHE_WORKSPACE),
    };
    const job = await falsifyWorkspace(
      workspace,
      chosenConfigFile(workspace) ?? "",
      [],
      NEVER_ABORTED,
    );
    return job.status === "refused"
      ? { status: job.status, refusal: job.refusal }
      : { status: job.status };
  });
}
