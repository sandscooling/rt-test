import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type {
  JsonAssertionResult,
  JsonTestResult,
  JsonTestResults,
} from "vitest-4/reporters";
import { errorText } from "../src/vitest/error-text.js";
import { relativePosixPath } from "../src/vitest/find-workspaces.js";

/** Vitest's exit code for a run whose tests all passed. */
const VITEST_PASSED_EXIT = 0;
/** Vitest's exit code for a run where a test or a module failed. */
const VITEST_FAILED_EXIT = 1;
const VITEST_EXITS: readonly (number | null)[] = [
  VITEST_PASSED_EXIT,
  VITEST_FAILED_EXIT,
];
/** A plain run of one fixture workspace takes about a second; this ends one that hangs. */
const FULL_RUN_BOUND_MS = 60_000;
const LINKED_VITEST = "node_modules/vitest";
const REPORTER_ARGS = ["run", "--reporter=json", "--outputFile"];
/** Vitest's status for a failed test, and for a module with a file error or a failed test. */
export const FAILED = "failed";
/** The JSON reporter's status for a test declared for later, which the daemon records skipped, as it records `skip`. */
const DECLARED_FOR_LATER = "todo";
const SKIPPED = "skipped";

/** A test the full run reports, identified as the daemon identifies it. */
export interface FullRunTest {
  readonly workspacePath: string;
  /** Relative to the workspace's real directory, `/`-separated. */
  readonly modulePath: string;
  readonly names: readonly string[];
  /** Counts earlier tests of the module with the same names. */
  readonly occurrence: number;
  /** Vitest's status, a test declared for later read as skipped. */
  readonly status: string;
}

export interface FullRunModule {
  readonly workspacePath: string;
  readonly modulePath: string;
  readonly message: string;
}

export interface UnusableRun {
  readonly workspacePath: string;
  readonly detail: string;
}

export type FullRun =
  | {
      readonly usable: true;
      readonly tests: readonly FullRunTest[];
      /** Each module the full run failed to load. */
      readonly failedModules: readonly FullRunModule[];
    }
  | { readonly usable: false; readonly unusable: readonly UnusableRun[] };

interface WorkspaceResults {
  readonly tests: readonly FullRunTest[];
  readonly failedModules: readonly FullRunModule[];
}

interface ChildEnd {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly spawnError?: string;
}

/**
 * Runs plain Vitest through its own command line in each workspace under `root`, all at once, each writing its JSON
 * report to `reportFile(workspacePath)`. Usable only when every workspace's run is.
 */
export async function fullRun(
  root: string,
  workspacePaths: readonly string[],
  reportFile: (workspacePath: string) => string,
): Promise<FullRun> {
  const entry = vitestEntry(root);
  const runs = await Promise.all(
    workspacePaths.map((workspacePath) =>
      workspaceRun(root, entry, workspacePath, reportFile(workspacePath)),
    ),
  );
  const unusable = runs.filter((run): run is UnusableRun => "detail" in run);
  if (unusable.length > 0) return { usable: false, unusable };
  const results = runs as WorkspaceResults[];
  return {
    usable: true,
    tests: results.flatMap((run) => run.tests),
    failedModules: results.flatMap((run) => run.failedModules),
  };
}

/** The command line entry of the Vitest linked into the consumer, as its manifest's `bin` names it. */
function vitestEntry(root: string): string {
  const install = join(root, LINKED_VITEST);
  const manifest = JSON.parse(
    readFileSync(join(install, "package.json"), "utf8"),
  ) as { bin?: unknown };
  const { bin } = manifest;
  const entry =
    typeof bin === "string"
      ? bin
      : (bin as Record<string, unknown> | undefined)?.["vitest"];
  if (typeof entry !== "string") {
    throw new Error(`${install} names no vitest command in its manifest`);
  }
  return join(install, entry);
}

async function workspaceRun(
  root: string,
  entry: string,
  workspacePath: string,
  reportFile: string,
): Promise<WorkspaceResults | UnusableRun> {
  const directory = join(root, workspacePath);
  const end = await runVitest(entry, directory, reportFile);
  const unusable = (reason: string): UnusableRun => ({
    workspacePath,
    detail: `${reason} (${endText(end)})\nstdout:\n${end.stdout}\nstderr:\n${end.stderr}`,
  });
  if (end.spawnError !== undefined) return unusable(end.spawnError);
  if (end.signal !== null || !VITEST_EXITS.includes(end.code)) {
    return unusable("Vitest ended other than with its passed or failed exit");
  }
  const report = readReport(reportFile);
  if (typeof report === "string") return unusable(report);
  const results = workspaceResults(
    workspacePath,
    realpathSync(directory),
    report.testResults,
  );
  if (results.tests.length === 0) return unusable("the report holds no test");
  return results;
}

function runVitest(
  entry: string,
  directory: string,
  reportFile: string,
): Promise<ChildEnd> {
  return new Promise((resolve) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const output = (): Pick<ChildEnd, "stdout" | "stderr"> => ({
      stdout: stdout.join(""),
      stderr: stderr.join(""),
    });
    const child = spawn(
      process.execPath,
      [entry, ...REPORTER_ARGS, reportFile],
      { cwd: directory, timeout: FULL_RUN_BOUND_MS, windowsHide: true },
    );
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout.push(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr.push(chunk);
    });
    child.once("error", (error) => {
      resolve({
        code: null,
        signal: null,
        ...output(),
        spawnError: `Vitest could not be started: ${errorText(error)}`,
      });
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal, ...output() });
    });
  });
}

function endText(end: ChildEnd): string {
  return end.signal === null
    ? `exit code ${String(end.code)}`
    : `signal ${end.signal}`;
}

/** The report, or why it cannot be read. */
function readReport(file: string): JsonTestResults | string {
  if (!existsSync(file)) return `Vitest wrote no report at ${file}`;
  let report: unknown;
  try {
    report = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return `the report at ${file} is not JSON: ${errorText(error)}`;
  }
  const results = (report as Partial<JsonTestResults> | null)?.testResults;
  return Array.isArray(results)
    ? (report as JsonTestResults)
    : `the report at ${file} holds no test results`;
}

function workspaceResults(
  workspacePath: string,
  realDirectory: string,
  modules: readonly JsonTestResult[],
): WorkspaceResults {
  const tests: FullRunTest[] = [];
  const failedModules: FullRunModule[] = [];
  for (const module of modules) {
    const modulePath = relativePosixPath(realDirectory, module.name);
    if (failedToLoad(module)) {
      failedModules.push({
        workspacePath,
        modulePath,
        message: module.message,
      });
      continue;
    }
    tests.push(
      ...moduleTests(workspacePath, modulePath, module.assertionResults),
    );
  }
  return { tests, failedModules };
}

/** A module whose file error kept every test from being collected: failed, with a message, and no test reported. */
function failedToLoad(module: JsonTestResult): boolean {
  return (
    module.status === FAILED &&
    module.message !== "" &&
    module.assertionResults.length === 0
  );
}

function moduleTests(
  workspacePath: string,
  modulePath: string,
  assertions: readonly JsonAssertionResult[],
): FullRunTest[] {
  const seen = new Map<string, number>();
  return assertions.map((assertion) => {
    const names = [...assertion.ancestorTitles, assertion.title];
    const key = JSON.stringify(names);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      workspacePath,
      modulePath,
      names,
      occurrence,
      status:
        assertion.status === DECLARED_FOR_LATER ? SKIPPED : assertion.status,
    };
  });
}
