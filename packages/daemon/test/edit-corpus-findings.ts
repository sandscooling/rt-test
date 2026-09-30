import { posix } from "node:path";
import type { FileCounts, WorkspaceExecution } from "../src/client.js";
import { CURRENT, EXECUTION_STATE } from "../src/query/answer.js";
import { FINGERPRINT_DIGEST } from "../src/store/schema.js";
import type { StoredRun } from "../src/store/stored-records.js";
import type { RecordedModule } from "../src/vitest/run-states.js";
import {
  FAILED,
  type FullRunModule,
  type FullRunTest,
} from "./edit-corpus-full-run.js";
import type { CorpusEdit, DeclaredFailures } from "./edit-corpus-sequences.js";

export const FINDING = {
  /** A failure the full run finds that the daemon's current results do not. */
  selectionMiss: "selection-miss",
  /** Any other difference between the full run and the daemon's results. */
  disagreement: "disagreement",
  duplicateExecution: "duplicate-execution",
  runOutsideDeclaredSet: "run-outside-declared-set",
  declaredRunMissing: "declared-run-missing",
  waitNotSettled: "wait-not-settled",
  daemonNotIdle: "daemon-not-idle",
  fullRunUnusable: "full-run-unusable",
  declaredFailuresNotMatched: "declared-failures-not-matched",
  inputRevisionMoved: "input-revision-moved",
} as const;

export type FindingKind = (typeof FINDING)[keyof typeof FINDING];

export interface Finding {
  readonly kind: FindingKind;
  /** The edit's name, or the baseline's. */
  readonly edit: string;
  /** The test, module or workspace involved. */
  readonly subject: string;
  /** What each side reported. */
  readonly detail: string;
}

/** A state or outcome the daemon holds for a test or module, and whether its answers read it current. */
interface DaemonResult {
  readonly state: string;
  readonly current: boolean;
}

/** Each workspace's latest stored run, by test and by module. */
export interface DaemonSide {
  readonly tests: ReadonlyMap<string, DaemonResult>;
  readonly modules: ReadonlyMap<string, DaemonResult>;
}

interface ModuleLocation {
  readonly workspacePath: string;
  readonly modulePath: string;
}

type TestLocation = ModuleLocation & Pick<FullRunTest, "names" | "occurrence">;

/** A stored module's state when none of its tests could be collected. */
const FAILED_MODULE: RecordedModule["state"] = "failed";
const NAME_SEPARATOR = " > ";

export function finding(
  kind: FindingKind,
  edit: string,
  subject: string,
  detail: string,
): Finding {
  return { kind, edit, subject, detail };
}

/**
 * The runs stored since the step began, `runs[storedBefore]` onward: each workspace run that the edit does not declare,
 * each declared workspace with no run, and each run stored under the fingerprint and adapter version its workspace's
 * previous stored run was stored under.
 */
export function storedRunFindings(
  edit: CorpusEdit,
  runs: readonly StoredRun[],
  storedBefore: number,
): Finding[] {
  const added = runs.slice(storedBefore);
  const ran = added.map(({ run }) => run.workspace.path);
  const declared = edit.declaredRuns;
  const outside = [...new Set(ran)]
    .filter((path) => !declared.includes(path))
    .map((path) =>
      finding(
        FINDING.runOutsideDeclaredSet,
        edit.name,
        path,
        `${ran.filter((run) => run === path).length} run(s) stored; the edit declares ${declared.join(", ") || "none"}`,
      ),
    );
  const missing = declared
    .filter((path) => !ran.includes(path))
    .map((path) =>
      finding(
        FINDING.declaredRunMissing,
        edit.name,
        path,
        "declared, but no run of it was stored",
      ),
    );
  const repeated =
    edit.declaredRunsOnce === true
      ? declared
          .map(
            (path) => [path, ran.filter((run) => run === path).length] as const,
          )
          .filter(([, count]) => count > 1)
          .map(([path, count]) =>
            finding(
              FINDING.runOutsideDeclaredSet,
              edit.name,
              path,
              `${count} runs stored; the edit declares one`,
            ),
          )
      : [];
  const duplicates = added.flatMap((stored, offset) =>
    duplicateFinding(edit.name, stored, runs.slice(0, storedBefore + offset)),
  );
  return [...outside, ...missing, ...repeated, ...duplicates];
}

function duplicateFinding(
  edit: string,
  stored: StoredRun,
  earlierRuns: readonly StoredRun[],
): Finding[] {
  const path = stored.run.workspace.path;
  const previous = earlierRuns.findLast(
    ({ run }) => run.workspace.path === path,
  );
  if (previous === undefined) return [];
  const earlier = previous.inputFingerprint;
  const later = stored.inputFingerprint;
  const duplicate =
    earlier.kind === FINGERPRINT_DIGEST &&
    later.kind === FINGERPRINT_DIGEST &&
    earlier.digest === later.digest &&
    previous.adapterVersion === stored.adapterVersion;
  if (!duplicate) return [];
  return [
    finding(
      FINDING.duplicateExecution,
      edit,
      path,
      `run ${stored.runId} stored under fingerprint ${later.digest} and adapter version ${stored.adapterVersion}, as its previous run ${previous.runId} was`,
    ),
  ];
}

/** Each failure the edit declares that the full run does not find, and each it finds that the edit does not declare. */
export function declaredFailureFindings(
  edit: CorpusEdit,
  tests: readonly FullRunTest[],
  failedModules: readonly FullRunModule[],
): Finding[] {
  const produced = new Map<string, string>([
    ...tests
      .filter((test) => test.status === FAILED)
      .map((test) => [testKey(test), testSubject(test)] as const),
    ...failedModules.map(
      (module) => [moduleKey(module), moduleSubject(module)] as const,
    ),
  ]);
  const declared = declaredFailureSubjects(edit.declaredFailures);
  const notFound = [...declared]
    .filter(([key]) => !produced.has(key))
    .map(([, subject]) =>
      finding(
        FINDING.declaredFailuresNotMatched,
        edit.name,
        subject,
        "declared failing, but the full run does not fail it",
      ),
    );
  const notDeclared = [...produced]
    .filter(([key]) => !declared.has(key))
    .map(([, subject]) =>
      finding(
        FINDING.declaredFailuresNotMatched,
        edit.name,
        subject,
        "the full run fails it, but the edit does not declare it",
      ),
    );
  return [...notFound, ...notDeclared];
}

function declaredFailureSubjects(
  failures: DeclaredFailures,
): Map<string, string> {
  return new Map([
    ...failures.tests.map((test) => {
      const identified = { ...test, occurrence: 0 };
      return [testKey(identified), testSubject(identified)] as const;
    }),
    ...failures.modules.map(
      (module) => [moduleKey(module), moduleSubject(module)] as const,
    ),
  ]);
}

/**
 * The daemon's side from each workspace's latest stored run: a test reads current when every test its file holds
 * does, by the path status's counts, and a module when its workspace is idle with nothing keeping it from current.
 */
export function daemonSide(
  runs: readonly StoredRun[],
  files: readonly FileCounts[],
  schedule: readonly WorkspaceExecution[],
): DaemonSide {
  const currentFiles = new Set(
    files
      .filter(
        ({ counts }) =>
          counts.tests > 0 && counts.freshness[CURRENT] === counts.tests,
      )
      .map(({ file }) => file),
  );
  const currentWorkspaces = new Set(
    schedule
      .filter(
        (workspace) =>
          workspace.state === EXECUTION_STATE.idle &&
          workspace.notRunning === undefined,
      )
      .map((workspace) => workspace.workspacePath),
  );
  const tests = new Map<string, DaemonResult>();
  const modules = new Map<string, DaemonResult>();
  for (const stored of latestRuns(runs)) {
    if (stored.run.status !== "ran") continue;
    const workspacePath = stored.run.workspace.path;
    for (const module of stored.run.modules) {
      const location = { workspacePath, modulePath: module.modulePath };
      modules.set(moduleKey(location), {
        state: module.state,
        current: currentWorkspaces.has(workspacePath),
      });
      const current = currentFiles.has(moduleSubject(location));
      for (const [key, result] of moduleResults(location, module, current)) {
        tests.set(key, result);
      }
    }
  }
  return { tests, modules };
}

/** The run stored last for each workspace. */
function latestRuns(runs: readonly StoredRun[]): StoredRun[] {
  const latest = new Map<string, StoredRun>();
  for (const stored of runs) latest.set(stored.run.workspace.path, stored);
  return [...latest.values()];
}

function moduleResults(
  location: ModuleLocation,
  module: RecordedModule,
  current: boolean,
): [string, DaemonResult][] {
  if (module.state !== "ran") return [];
  return module.tests.map((test) => [
    testKey({
      ...location,
      names: test.identity.namePath,
      occurrence: test.identity.occurrence,
    }),
    {
      state: test.execution === "finished" ? test.outcome : test.execution,
      current,
    },
  ]);
}

/**
 * Compares the daemon's side with the full run test by test and module by module. A failure the full run finds that
 * the daemon does not hold as a current failure is a selection miss; every other difference is a disagreement.
 */
export function daemonFindings(
  edit: string,
  tests: readonly FullRunTest[],
  failedModules: readonly FullRunModule[],
  daemon: DaemonSide,
): Finding[] {
  return [
    ...reportedTestFindings(edit, tests, daemon),
    ...heldTestFindings(edit, tests, failedModules, daemon),
    ...moduleFindings(edit, failedModules, daemon),
  ];
}

function reportedTestFindings(
  edit: string,
  tests: readonly FullRunTest[],
  daemon: DaemonSide,
): Finding[] {
  return tests.flatMap((test) => {
    const held = daemon.tests.get(testKey(test));
    if (held?.current === true && held.state === test.status) return [];
    const module = daemon.modules.get(moduleKey(test));
    return [
      finding(
        test.status === FAILED ? FINDING.selectionMiss : FINDING.disagreement,
        edit,
        testSubject(test),
        `the full run reports ${test.status}; the daemon holds ${heldText(held, module)}`,
      ),
    ];
  });
}

/** Each test the daemon holds that the full run does not report, unless the full run failed to load its module. */
function heldTestFindings(
  edit: string,
  tests: readonly FullRunTest[],
  failedModules: readonly FullRunModule[],
  daemon: DaemonSide,
): Finding[] {
  const reported = new Set(tests.map(testKey));
  const unloaded = new Set(failedModules.map(moduleKey));
  return [...daemon.tests]
    .filter(
      ([key]) => !reported.has(key) && !unloaded.has(moduleKeyOfTest(key)),
    )
    .map(([key, held]) =>
      finding(
        FINDING.disagreement,
        edit,
        subjectOfKey(key),
        `the daemon holds ${heldText(held)}; the full run reports no such test`,
      ),
    );
}

function moduleFindings(
  edit: string,
  failedModules: readonly FullRunModule[],
  daemon: DaemonSide,
): Finding[] {
  const unloaded = new Set(failedModules.map(moduleKey));
  const missed = failedModules
    .filter((module) => {
      const held = daemon.modules.get(moduleKey(module));
      return held?.current !== true || held.state !== FAILED_MODULE;
    })
    .map((module) =>
      finding(
        FINDING.selectionMiss,
        edit,
        moduleSubject(module),
        `the full run fails to load it (${firstLine(module.message)}); the daemon holds ${heldText(daemon.modules.get(moduleKey(module)))}`,
      ),
    );
  const loaded = [...daemon.modules]
    .filter(([key, held]) => held.state === FAILED_MODULE && !unloaded.has(key))
    .map(([key]) =>
      finding(
        FINDING.disagreement,
        edit,
        subjectOfKey(key),
        "the daemon holds it failed to load; the full run loads it",
      ),
    );
  return [...missed, ...loaded];
}

/** Keys a test so its module's key is recoverable from it, as `moduleKeyOfTest` reads it. */
function testKey(test: TestLocation): string {
  return JSON.stringify([
    test.workspacePath,
    test.modulePath,
    test.names,
    test.occurrence,
  ]);
}

function moduleKey(module: ModuleLocation): string {
  return JSON.stringify([module.workspacePath, module.modulePath]);
}

function moduleKeyOfTest(key: string): string {
  const [workspacePath, modulePath] = JSON.parse(key) as [string, string];
  return moduleKey({ workspacePath, modulePath });
}

/** A test's or module's subject, from either kind of key. */
function subjectOfKey(key: string): string {
  const [workspacePath, modulePath, names] = JSON.parse(key) as [
    string,
    string,
    string[] | undefined,
  ];
  const module = moduleSubject({ workspacePath, modulePath });
  return names === undefined
    ? module
    : `${module}${NAME_SEPARATOR}${names.join(NAME_SEPARATOR)}`;
}

function testSubject(test: TestLocation): string {
  return `${moduleSubject(test)}${NAME_SEPARATOR}${test.names.join(NAME_SEPARATOR)}`;
}

function moduleSubject(module: ModuleLocation): string {
  return posix.join(module.workspacePath, module.modulePath);
}

function heldText(
  held: DaemonResult | undefined,
  module?: DaemonResult,
): string {
  if (held !== undefined) {
    return held.current ? held.state : `${held.state}, not current`;
  }
  if (module !== undefined) {
    return `no such test; its module is ${heldText(module)}`;
  }
  return "nothing for it";
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? "";
}
