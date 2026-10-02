import type { TestOutcome } from "@rt-test/core";
import { ProjectInputs } from "../src/inputs/fingerprint.js";
import {
  Narrowing,
  type QueryNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import type { BuildFailureKind } from "../src/query/answer.js";
import type { DiscoveredSelectionInput } from "../src/selection/selection-input.js";
import {
  NO_SELECTION,
  SELECTION_POLICY_VERSION,
  SELECTION_STATE,
  TRIGGER,
  type ChainStep,
  type ChangedPathReport,
  type DependencyInformation,
  type NotRunnableWorkspace,
  type Selection,
  type SelectionOutcome,
} from "../src/selection/selection-types.js";
import type { WorkspaceDiscovery } from "../src/vitest/discover-tests.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import { ABSENT_ROOT, discovered, workspace } from "./scheduling-harness.js";

/** A run of `path` that finished the given outcomes, one test each, in one module, and whose execution ended as `execution`. */
export function ranWorkspace(
  path: string,
  outcomes: readonly TestOutcome[] = ["passed"],
  execution: Extract<
    WorkspaceRun,
    { status: "ran" }
  >["execution"] = "completed",
): WorkspaceRun {
  return {
    status: "ran",
    workspace: workspace(path),
    vitestVersion: "5.0.1",
    execution,
    modules: [
      {
        projectName: "unit",
        modulePath: "a.test.ts",
        state: "ran",
        tests: outcomes.map((outcome, index) => ({
          identity: {
            workspacePath: path,
            projectName: "unit",
            modulePath: "a.test.ts",
            namePath: [`t${index}`],
            occurrence: 0,
          },
          isDuplicate: false,
          execution: "finished",
          outcome,
          errors: [],
        })),
        errors: [],
      },
    ],
    typecheckModules: [],
    unsupportedProjects: [],
    unhandledErrors: [],
    forceStopped: false,
  };
}

/** A run of `path` that ended `failed`, so it holds no test result. */
export function failedRun(path: string): WorkspaceRun {
  return {
    status: "failed",
    workspace: workspace(path),
    vitestVersion: "5.0.1",
    error: "Error: config boom",
  };
}

/** A run of `path` whose executor process died during it, so it holds no test result. */
export function crashedRun(path: string): WorkspaceRun {
  return {
    status: "crashed",
    workspace: workspace(path),
    error: "the executor process 7 exited during the job (exit code 1)",
  };
}

/** A discovered workspace listing one test in each of `modulePaths`. */
export function discoveredIn(
  path: string,
  modulePaths: readonly string[],
): WorkspaceDiscovery {
  return {
    ...discovered(path),
    tests: modulePaths.map((modulePath, index) => ({
      identity: {
        workspacePath: path,
        projectName: "unit",
        modulePath,
        namePath: [`t${index}`],
        occurrence: 0,
      },
      isDuplicate: false,
      mode: "run",
    })),
  };
}

const NOT_BUILT_INPUT = {} as DiscoveredSelectionInput;
const NO_DEPENDENCY_INFORMATION: DependencyInformation = {
  packageWorkspaces: [],
  notRead: [],
  withoutManifest: [],
  edges: [],
  uncertainties: [],
};

/** A dependency build's narrowing that answers every selection with `outcome`, and records the paths it was asked about. */
export class StandInNarrowing extends Narrowing {
  readonly asked: (readonly string[])[] = [];
  readonly #outcome: SelectionOutcome;

  constructor(outcome: SelectionOutcome) {
    super(NOT_BUILT_INPUT, NO_DEPENDENCY_INFORMATION, () => undefined);
    this.#outcome = outcome;
  }

  override select(paths: readonly string[]): SelectionOutcome {
    this.asked.push(paths);
    return this.#outcome;
  }
}

const DISCOVERY_ID = "discovery";

function queryOf(state: QueryNarrowing["state"]): QueryNarrowing {
  return { discoveryId: DISCOVERY_ID, state, buildsEnded: undefined };
}

/** The builds' state after a build over the discovery in effect ended at `revision` and narrowed it. */
export function builtAt(
  revision: number,
  narrowing: Narrowing,
): QueryNarrowing {
  return queryOf({
    discoveryId: DISCOVERY_ID,
    selectionInput: true,
    latest: { revision, built: true, narrowing },
    lastFailure: undefined,
  });
}

/** The builds' state after a build over the discovery in effect ended at `revision` as `kind`. */
export function failedAt(
  revision: number,
  kind: BuildFailureKind,
  reason: string,
): QueryNarrowing {
  return queryOf({
    discoveryId: DISCOVERY_ID,
    selectionInput: true,
    latest: { revision, built: false, kind, reason },
    lastFailure: { kind, reason },
  });
}

/** The builds' state while no build over the discovery in effect has ended at the revision, after one failed at an earlier one. */
export function unbuiltAfter(
  kind: BuildFailureKind,
  reason: string,
): QueryNarrowing {
  return queryOf({
    discoveryId: DISCOVERY_ID,
    selectionInput: true,
    latest: undefined,
    lastFailure: { kind, reason },
  });
}

/** What selection answers when it refuses the changed paths. */
export function refusedSelection(
  path: string,
  reason: string,
): SelectionOutcome {
  return {
    state: SELECTION_STATE.refused,
    policyVersion: SELECTION_POLICY_VERSION,
    path,
    reason,
  };
}

/** The builds' state while no build over the discovery in effect has ended. */
export const NO_BUILD_ENDED: QueryNarrowing = queryOf({
  discoveryId: DISCOVERY_ID,
  selectionInput: true,
  latest: undefined,
  lastFailure: undefined,
});

/** What a path report carries beyond its owner and the workspaces it selected. */
interface PathReportMore {
  /** The chain each selected workspace's reason passed through. */
  readonly steps?: readonly ChainStep[];
  readonly notRunnable?: readonly NotRunnableWorkspace[];
}

/** What selection reports for one changed path: its owner and the workspaces it selected. */
export function pathReport(
  path: string,
  owner: string | undefined,
  selected: readonly string[],
  more: PathReportMore = {},
): ChangedPathReport {
  return {
    path,
    owner,
    triggers: [TRIGGER.changedPath],
    selected: selected.map((workspace) => ({
      workspace,
      reasons: [
        {
          path,
          trigger: TRIGGER.changedPath,
          from: undefined,
          steps: more.steps ?? [],
        },
      ],
    })),
    notRunnable: more.notRunnable ?? [],
    nothingSelected:
      selected.length === 0
        ? {
            kind: NO_SELECTION.noDependentVitestWorkspace,
            detail: "no Vitest workspace depends on it",
          }
        : undefined,
  };
}

/** A selection of `workspaces` for the given path reports, with `counts` when a test gives them. */
export function selectionOf(
  paths: readonly ChangedPathReport[],
  workspaces: readonly string[],
  more: Partial<Selection> = {},
): Selection {
  return {
    state:
      workspaces.length === 0
        ? SELECTION_STATE.nothingSelected
        : SELECTION_STATE.selected,
    policyVersion: SELECTION_POLICY_VERSION,
    tests: [],
    workspaces: workspaces.map((path) => ({
      path,
      tests: { known: true, count: 1 },
      reasons: [],
    })),
    paths,
    fallbacks: [],
    widenings: [],
    wideningsLeftOut: [],
    counts: {
      selectedTests: { count: workspaces.length, complete: true },
      totalTests: { count: 4, complete: true },
      selectedWorkspaces: workspaces.length,
      totalWorkspaces: { count: 4, complete: true },
      notRunnableWorkspaces: 0,
    },
    notRead: [],
    notRunnable: [],
    ...more,
  };
}

/**
 * A dependency build's narrowing whose selection selects, for each changed path, the workspaces `selects` lists for it
 * and none for a path it leaves out, and which narrows each workspace's inputs to the paths `inputs` lists for it.
 */
export function narrowingSelecting(
  selects: Readonly<Record<string, readonly string[]>>,
  inputs: Readonly<Record<string, readonly string[]>>,
): Narrowing {
  const standIn: Pick<Narrowing, "refusal" | "select" | "workspaceInputs"> = {
    refusal: () => undefined,
    select: (paths) => {
      const reports = paths.map((path) =>
        pathReport(path, undefined, selects[path] ?? []),
      );
      return selectionOf(reports, [
        ...new Set(paths.flatMap((path) => selects[path] ?? [])),
      ]);
    },
    workspaceInputs: (project, workspacePath) =>
      new ProjectInputs(
        project.root,
        new Map(
          [...project.digests].filter(([path]) =>
            (inputs[workspacePath] ?? []).includes(path),
          ),
        ),
      ),
  };
  return standIn as Narrowing;
}

/**
 * The committed inputs at `root` holding each path with the given digest, beside the held reads of `listed`, listed
 * files the inputs leave out.
 */
export function inputsOf(
  digests: Readonly<Record<string, string>>,
  listed: Readonly<Record<string, string>> = {},
): ProjectInputs {
  return new ProjectInputs(
    ABSENT_ROOT,
    new Map(Object.entries(digests)),
    new Map(Object.entries(listed)),
  );
}
