import {
  DEPENDENCY_BUILDS_ENDED,
  NO_SELECTION_INPUT,
  type BuildFailureKind,
  type InputsNotNarrowed,
} from "../query/answer.js";
import { normalizeRelativePath } from "../selection/graph-state.js";
import { selectTests } from "../selection/select-tests.js";
import type { DiscoveredSelectionInput } from "../selection/selection-input.js";
import {
  NO_SELECTION,
  SELECTION_STATE,
  type ChangedPathReport,
  type DependencyInformation,
  type Selection,
  type SelectionOutcome,
} from "../selection/selection-types.js";
import { ProjectInputs } from "./fingerprint.js";

export const NARROWING = {
  narrowed: "narrowed",
  building: "building",
  widened: "widened",
} as const;

/** A dependency build over one discovery that ended at one input revision: with no input moving while it ran, or at the bound. */
export type EndedBuild =
  | {
      readonly revision: number;
      readonly built: true;
      readonly narrowing: Narrowing;
    }
  | {
      readonly revision: number;
      readonly built: false;
      /** Failed or timed out, each answered as its own not-narrowed kind. */
      readonly kind: BuildFailureKind;
      readonly reason: string;
    };

/** What the dependency builds know of the discovery in effect. */
export type NarrowingState =
  | {
      readonly discoveryId: string;
      readonly selectionInput: false;
      readonly reason: string;
    }
  | {
      readonly discoveryId: string;
      readonly selectionInput: true;
      /** The latest build that ended over the discovery; undefined before the first one ends. */
      readonly latest: EndedBuild | undefined;
      /** How the last ended build over the discovery failed; undefined once one succeeds. */
      readonly lastFailure:
        | { readonly kind: BuildFailureKind; readonly reason: string }
        | undefined;
    };

/** The dependency builds' state beside the discovery an answer or a run reads. */
export interface QueryNarrowing {
  /** Undefined when no discovery is stored. */
  readonly discoveryId: string | undefined;
  /** Undefined before the builds are given a discovery. */
  readonly state: NarrowingState | undefined;
  /** Why the builds stopped working for a cause other than a stop; undefined while they work and when a stop ended them. */
  readonly buildsEnded: string | undefined;
}

/** How a view of the inputs at one revision takes each discovered workspace's inputs. */
export type WorkspaceNarrowing =
  | { readonly kind: typeof NARROWING.narrowed; readonly narrowing: Narrowing }
  | {
      readonly kind: typeof NARROWING.building;
      readonly reason: string;
      readonly notNarrowed: InputsNotNarrowed | undefined;
    }
  | {
      readonly kind: typeof NARROWING.widened;
      readonly notNarrowed: InputsNotNarrowed;
    };

/**
 * Narrowed only from a build over the discovery the view reads, at the view's own revision; building while that
 * build has not ended; widened over a failed or timed-out build, a discovery that yields no selection input, or
 * builds that ended, whatever the discovery.
 */
export function narrowingAt(
  query: QueryNarrowing,
  revision: number,
): WorkspaceNarrowing {
  const { state, buildsEnded } = query;
  if (buildsEnded !== undefined) {
    return {
      kind: NARROWING.widened,
      notNarrowed: { kind: DEPENDENCY_BUILDS_ENDED, reason: buildsEnded },
    };
  }
  if (state === undefined || state.discoveryId !== query.discoveryId) {
    return building(revision, undefined);
  }
  if (!state.selectionInput) {
    return {
      kind: NARROWING.widened,
      notNarrowed: { kind: NO_SELECTION_INPUT, reason: state.reason },
    };
  }
  const { latest } = state;
  if (latest === undefined || latest.revision !== revision) {
    return building(revision, state.lastFailure);
  }
  if (latest.built) {
    return { kind: NARROWING.narrowed, narrowing: latest.narrowing };
  }
  return {
    kind: NARROWING.widened,
    notNarrowed: { kind: latest.kind, reason: latest.reason },
  };
}

function building(
  revision: number,
  notNarrowed: InputsNotNarrowed | undefined,
): WorkspaceNarrowing {
  return {
    kind: NARROWING.building,
    reason: `the dependency build that decides its inputs at input revision ${revision} has not ended`,
    notNarrowed,
  };
}

/** Where one build places some root-relative paths for one workspace. */
export interface PathPlacement {
  /** The paths the workspace's selection includes, each as it was given. */
  readonly inside: readonly string[];
  /**
   * The paths this build cannot place for the workspace, each inside it by widening: selection refused them, or the
   * workspace is missing from the build's selection input, which gives it every input.
   */
  readonly widened: readonly string[];
}

const REFUSED = "refused";

/**
 * Places changed paths over one build's selection input and dependency information alone, remembering where each
 * placed path lies, so no path is selected twice over the build and holding it holds no narrowed set.
 */
export class BuildPlacement {
  readonly #input: DiscoveredSelectionInput;
  readonly #dependencies: DependencyInformation;
  readonly #placed = new Map<string, readonly string[] | typeof REFUSED>();

  constructor(
    input: DiscoveredSelectionInput,
    dependencies: DependencyInformation,
  ) {
    this.#input = input;
    this.#dependencies = dependencies;
  }

  /** What selection picks for the root-relative `paths`, over this build's dependency information. */
  select(paths: readonly string[]): SelectionOutcome {
    return selectTests({
      ...this.#input,
      change: paths,
      dependencies: this.#dependencies,
    });
  }

  /**
   * Which of the root-relative `paths` lie among the workspace's inputs by this build, whether or not each exists at
   * its revision, by the rule the narrowed sets apply. A refused path is set apart and the rest are selected again,
   * so one refusable path never hides where the others lie.
   */
  place(paths: readonly string[], workspacePath: string): PathPlacement {
    const selectable = this.#input.workspaces.some(
      ({ workspace }) => workspace.path === workspacePath,
    );
    if (!selectable) return { inside: [], widened: [...paths] };
    this.#placeUnplaced(paths.filter((path) => !this.#placed.has(path)));
    const inside: string[] = [];
    const widened: string[] = [];
    for (const path of paths) {
      const workspaces = this.#placed.get(path);
      if (workspaces === REFUSED) widened.push(path);
      else if (workspaces?.includes(workspacePath) === true) inside.push(path);
    }
    return { inside, widened };
  }

  #placeUnplaced(paths: readonly string[]): void {
    let unplaced = paths;
    while (unplaced.length > 0) {
      const outcome = this.select(unplaced);
      if (outcome.state !== SELECTION_STATE.refused) {
        const including = includingByPath(outcome, unplaced, this.#input);
        for (const path of unplaced) {
          this.#placed.set(path, including.get(path) ?? []);
        }
        return;
      }
      const rest = unplaced.filter((path) => path !== outcome.path);
      if (rest.length === unplaced.length) {
        // A refusal naming no path given would refuse the next call alike.
        for (const path of unplaced) this.#placed.set(path, REFUSED);
        return;
      }
      this.#placed.set(outcome.path, REFUSED);
      unplaced = rest;
    }
  }
}

/**
 * The inputs each discovered workspace's selection includes, as `selectTests` decides each path alone over one
 * build's dependency information, so staleness and selection never disagree. Every `project` given must be the
 * inputs at the build's revision: the sets are computed once, from the first one.
 */
export class Narrowing {
  /**
   * How this build places changed paths, which a run holds apart from the sets. It cannot see a refusal of the
   * revision's own inputs, which widens every workspace, so it serves only a view whose inputs selection took.
   */
  readonly placement: BuildPlacement;
  readonly #input: DiscoveredSelectionInput;
  readonly #refused: (reason: string) => void;
  #sets: NarrowedSets | undefined;

  /** `refused` hears why selection refused the inputs' paths, once, when the sets are computed. */
  constructor(
    input: DiscoveredSelectionInput,
    dependencies: DependencyInformation,
    refused: (reason: string) => void,
  ) {
    this.placement = new BuildPlacement(input, dependencies);
    this.#input = input;
    this.#refused = refused;
  }

  /** Why selection refused `project`'s paths, so no workspace's inputs narrow; undefined when it selected. */
  refusal(project: ProjectInputs): string | undefined {
    const sets = this.#setsFor(project);
    return sets.refused ? sets.reason : undefined;
  }

  /** What selection picks for the root-relative `paths`, over this build's dependency information. */
  select(paths: readonly string[]): SelectionOutcome {
    return this.placement.select(paths);
  }

  /**
   * The workspace's inputs among `project`'s, the inputs at the build's revision, computed for every workspace on
   * first use. A workspace missing from the build's selection input gets every input of the project.
   */
  workspaceInputs(
    project: ProjectInputs,
    workspacePath: string,
  ): ProjectInputs {
    const sets = this.#setsFor(project);
    return sets.refused ? project : (sets.sets.get(workspacePath) ?? project);
  }

  #setsFor(project: ProjectInputs): NarrowedSets {
    if (this.#sets !== undefined) return this.#sets;
    this.#sets = narrowedSets(project, this.#input, (paths) =>
      this.select(paths),
    );
    if (this.#sets.refused) this.#refused(this.#sets.reason);
    return this.#sets;
  }
}

type NarrowedSets =
  | {
      readonly refused: false;
      readonly sets: ReadonlyMap<string, ProjectInputs>;
    }
  | { readonly refused: true; readonly reason: string };

/** `select` is the narrowing's own, so a workspace's inputs and a round's selection ask selection alike. */
function narrowedSets(
  project: ProjectInputs,
  input: DiscoveredSelectionInput,
  select: (paths: readonly string[]) => SelectionOutcome,
): NarrowedSets {
  const paths = [...project.digests.keys()];
  const outcome = select(paths);
  if (outcome.state === SELECTION_STATE.refused) {
    return { refused: true, reason: outcome.reason };
  }
  const members = new Map(
    input.workspaces.map(({ workspace }) => [
      workspace.path,
      new Map<string, string>(),
    ]),
  );
  for (const [path, workspaces] of includingByPath(outcome, paths, input)) {
    const digest = project.digests.get(path);
    if (digest === undefined) continue;
    for (const workspace of workspaces)
      members.get(workspace)?.set(path, digest);
  }
  return {
    refused: false,
    sets: new Map(
      [...members].map(([workspace, digests]) => [
        workspace,
        new ProjectInputs(project.root, digests),
      ]),
    ),
  };
}

/** The workspaces each of `paths` lies in by `selection` of them, keyed by each path as given; selection reports it normalized. */
function includingByPath(
  selection: Selection,
  paths: readonly string[],
  input: DiscoveredSelectionInput,
): Map<string, readonly string[]> {
  const byReportedPath = new Map<string, string[]>();
  for (const path of paths) {
    const reported = normalizeRelativePath(path);
    byReportedPath.set(reported, [
      ...(byReportedPath.get(reported) ?? []),
      path,
    ]);
  }
  const everyWorkspace = input.workspaces.map(
    ({ workspace }) => workspace.path,
  );
  const including = new Map<string, readonly string[]>();
  for (const report of selection.paths) {
    const workspaces = includingWorkspaces(report, everyWorkspace);
    for (const path of byReportedPath.get(report.path) ?? []) {
      including.set(path, workspaces);
    }
  }
  return including;
}

/** An input selection calls declared lies in every set: the tracker holds it, so the two disagree about it. */
function includingWorkspaces(
  report: ChangedPathReport,
  everyWorkspace: readonly string[],
): readonly string[] {
  return report.nothingSelected?.kind === NO_SELECTION.declaredNonInput
    ? everyWorkspace
    : report.selected.map(({ workspace }) => workspace);
}
