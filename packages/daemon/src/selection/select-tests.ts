import { posix, win32 } from "node:path";
import {
  climbsOut,
  LOCKFILES,
  PACKAGE_JSON,
  ROOT_PATH,
  VITE_CONFIG_FILES,
  VITEST_CONFIG_FILES,
} from "../vitest/find-workspaces.js";
import {
  declaredNonInputs,
  NON_INPUTS_FILE,
  type NonInputMatch,
} from "../inputs/non-inputs.js";
import { normalizeRelativePath, owningWorkspace } from "./graph-state.js";
import {
  FALLBACK_SCOPE,
  NO_SELECTION,
  SELECTION_POLICY_VERSION,
  SELECTION_STATE,
  TRIGGER,
  type BroadFallback,
  type ChangedPathReport,
  type ChainStep,
  type DependencyUncertainty,
  type FallbackScope,
  type NotRunnableWorkspace,
  type PathSelection,
  type SelectableWorkspace,
  type SelectedTest,
  type SelectedWorkspace,
  type SelectionCounts,
  type SelectionInput,
  type SelectionOutcome,
  type SelectionReason,
  type TriggerKind,
} from "./selection-types.js";

const CONFIG_FILES = new Set([...VITEST_CONFIG_FILES, ...VITE_CONFIG_FILES]);
const CHANGE_PATH_SEPARATORS = [posix.sep, win32.sep];
const WALK_KEY_SEPARATOR = "\0";

/** A dependent reached from a workspace, through an edge or a widening that makes it depend on every workspace. */
interface DependentLink {
  readonly workspace: string;
  readonly step: ChainStep;
  readonly widening: DependencyUncertainty | undefined;
}

interface Chain {
  readonly from: string;
  readonly links: readonly DependentLink[];
}

interface SelectionContext {
  readonly input: SelectionInput;
  readonly dependents: ReadonlyMap<string, readonly DependentLink[]>;
  readonly wideningLinks: readonly DependentLink[];
  /** Runnable and not runnable, in input order. */
  readonly vitestPaths: readonly string[];
  readonly notRunnable: ReadonlyMap<string, NotRunnableWorkspace>;
  readonly usedWidenings: Set<DependencyUncertainty>;
  /** Each walk by its starts, since every changed path in one workspace walks from the same one. */
  readonly walks: Map<string, Map<string, Chain>>;
  readonly declared: NonInputMatch;
}

interface PathTrigger {
  readonly kind: TriggerKind;
  /** Absent for a plain change, which selects its owner and the owner's dependents. */
  readonly scope: FallbackScope | undefined;
  readonly starts: readonly string[];
}

interface PathOutcome {
  readonly report: ChangedPathReport;
  readonly reasons: ReadonlyMap<string, readonly SelectionReason[]>;
  readonly fallbacks: readonly BroadFallback[];
}

/** Selects from the given inputs alone: no stored result, prior run or coverage takes part. */
export function selectTests(input: SelectionInput): SelectionOutcome {
  const paths = new Set<string>();
  for (const raw of input.change) {
    const refusal = refusalReason(raw);
    if (refusal !== undefined) {
      return {
        state: SELECTION_STATE.refused,
        policyVersion: SELECTION_POLICY_VERSION,
        path: raw,
        reason: refusal,
      };
    }
    paths.add(normalizeRelativePath(raw));
  }
  const context = selectionContext(input);
  const outcomes = [...paths].map((path) => selectForPath(context, path));
  return assemble(context, outcomes);
}

/** A Windows root includes a drive-relative `C:foo`, which resolves against that drive's own directory. */
function refusalReason(path: string): string | undefined {
  if (posix.isAbsolute(path) || win32.parse(path).root !== "") {
    return `${path} is absolute; a changed path is relative to the consumer root`;
  }
  const escapes = [posix.normalize(path), win32.normalize(path)].some(
    (normalized) =>
      CHANGE_PATH_SEPARATORS.some((separator) =>
        climbsOut(normalized, separator),
      ),
  );
  return escapes ? `${path} leaves the consumer root` : undefined;
}

function selectionContext(input: SelectionInput): SelectionContext {
  const dependents = new Map<string, DependentLink[]>();
  for (const edge of input.dependencies.edges) {
    const links = dependents.get(edge.dependency) ?? [];
    links.push({
      workspace: edge.dependent,
      step: {
        workspace: edge.dependent,
        via: edge.producer,
        detail: edge.detail,
      },
      widening: undefined,
    });
    dependents.set(edge.dependency, links);
  }
  const wideningLinks = input.dependencies.uncertainties.map((widening) => ({
    workspace: widening.dependent,
    step: {
      workspace: widening.dependent,
      via: widening.kind,
      detail: widening.cause,
    },
    widening,
  }));
  return {
    input,
    dependents,
    wideningLinks,
    vitestPaths: [
      ...input.workspaces.map(({ workspace }) => workspace.path),
      ...input.notRunnable.map(({ workspace }) => workspace.path),
    ],
    notRunnable: new Map(
      input.notRunnable.map((entry) => [entry.workspace.path, entry]),
    ),
    usedWidenings: new Set(),
    walks: new Map(),
    declared: declaredNonInputs(
      input.nonInputs.declaration,
      input.nonInputs.protectedTestModules,
    ),
  };
}

function selectForPath(context: SelectionContext, path: string): PathOutcome {
  const owner = owningWorkspace(
    path,
    context.input.dependencies.packageWorkspaces,
  )?.path;
  const pattern = context.declared(path);
  if (pattern !== undefined) return declaredOutcome(path, owner, pattern);
  const triggers = pathTriggers(context, path, owner);
  const reasons = new Map<string, SelectionReason[]>();
  for (const trigger of triggers) {
    for (const [workspace, reason] of triggerReasons(context, path, trigger)) {
      reasons.set(workspace, [...(reasons.get(workspace) ?? []), reason]);
    }
  }
  const fallbacks = triggers.flatMap(({ kind, scope, starts }) =>
    scope === undefined
      ? []
      : [{ path, trigger: kind, scope, workspaces: starts }],
  );
  return {
    report: pathReport(context, path, owner, triggers, reasons),
    reasons,
    fallbacks,
  };
}

/** A declared non-input no test reads, so it selects nothing and raises no trigger. */
function declaredOutcome(
  path: string,
  owner: string | undefined,
  pattern: string,
): PathOutcome {
  return {
    report: {
      path,
      owner,
      triggers: [],
      selected: [],
      notRunnable: [],
      nothingSelected: {
        kind: NO_SELECTION.declaredNonInput,
        detail: `${NON_INPUTS_FILE} declares it a non-input through the pattern ${pattern}`,
      },
    },
    reasons: new Map(),
    fallbacks: [],
  };
}

function pathTriggers(
  context: SelectionContext,
  path: string,
  owner: string | undefined,
): PathTrigger[] {
  const { input, vitestPaths } = context;
  const triggers: PathTrigger[] = projectWideKinds(context, path, owner).map(
    (kind) => ({ kind, scope: FALLBACK_SCOPE.project, starts: vitestPaths }),
  );
  const directory = posix.dirname(path);
  if (
    CONFIG_FILES.has(posix.basename(path)) &&
    vitestPaths.includes(directory)
  ) {
    triggers.push({
      kind: TRIGGER.workspaceConfig,
      scope: FALLBACK_SCOPE.workspace,
      starts: [directory],
    });
  }
  const setupTriggers: [
    TriggerKind,
    (workspace: SelectableWorkspace) => readonly string[],
  ][] = [
    [TRIGGER.setupFile, (workspace) => workspace.setupFiles],
    [TRIGGER.globalSetupFile, (workspace) => workspace.globalSetupFiles],
  ];
  for (const [kind, files] of setupTriggers) {
    const starts = input.workspaces
      .filter((workspace) =>
        files(workspace).some((file) => normalizeRelativePath(file) === path),
      )
      .map(({ workspace }) => workspace.path);
    if (starts.length > 0) {
      triggers.push({ kind, scope: FALLBACK_SCOPE.workspace, starts });
    }
  }
  if (owner !== undefined) {
    triggers.push({
      kind: TRIGGER.changedPath,
      scope: undefined,
      starts: [owner],
    });
  }
  return triggers;
}

function projectWideKinds(
  context: SelectionContext,
  path: string,
  owner: string | undefined,
): TriggerKind[] {
  const { dependencies } = context.input;
  const name = posix.basename(path);
  const ownerIsVitest =
    owner !== undefined && context.vitestPaths.includes(owner);
  const kinds: TriggerKind[] = [];
  if (LOCKFILES.includes(name)) kinds.push(TRIGGER.lockfile);
  if (name === PACKAGE_JSON) kinds.push(TRIGGER.manifest);
  if (path === NON_INPUTS_FILE) kinds.push(TRIGGER.nonInputsFile);
  if (owner === ROOT_PATH && dependencies.packageWorkspaces.length > 1) {
    kinds.push(TRIGGER.rootOwnedPath);
  }
  const ownerIsNoPackage =
    owner !== undefined && dependencies.withoutManifest.includes(owner);
  if (ownerIsNoPackage && !ownerIsVitest) {
    kinds.push(TRIGGER.ownerWithoutManifest);
  }
  const configDirectory = posix.dirname(path);
  if (
    CONFIG_FILES.has(name) &&
    !context.vitestPaths.includes(configDirectory)
  ) {
    kinds.push(TRIGGER.configOutsideWorkspace);
  }
  return kinds;
}

function triggerReasons(
  context: SelectionContext,
  path: string,
  trigger: PathTrigger,
): [string, SelectionReason][] {
  if (trigger.scope === FALLBACK_SCOPE.project) {
    return context.vitestPaths.map((workspace) => [
      workspace,
      { path, trigger: trigger.kind, from: undefined, steps: [] },
    ]);
  }
  const reached = [...walkDependents(context, trigger.starts)];
  return reached
    .filter(([workspace]) => context.vitestPaths.includes(workspace))
    .map(([workspace, chain]) => {
      if (!context.notRunnable.has(workspace)) {
        recordWidenings(context, chain);
      }
      return [
        workspace,
        {
          path,
          trigger: trigger.kind,
          from: chain.from,
          steps: chain.links.map(({ step }) => step),
        },
      ];
    });
}

function recordWidenings(context: SelectionContext, chain: Chain): void {
  for (const { widening } of chain.links) {
    if (widening !== undefined) context.usedWidenings.add(widening);
  }
}

/** Breadth-first from every start at once, so each workspace keeps one shortest chain and a cycle ends at the visited set. */
function walkDependents(
  context: SelectionContext,
  starts: readonly string[],
): Map<string, Chain> {
  const key = starts.join(WALK_KEY_SEPARATOR);
  const walked = context.walks.get(key);
  if (walked !== undefined) return walked;
  const chains = new Map<string, Chain>();
  context.walks.set(key, chains);
  const queue: string[] = [];
  for (const start of starts) {
    if (chains.has(start)) continue;
    chains.set(start, { from: start, links: [] });
    queue.push(start);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const chain = current === undefined ? undefined : chains.get(current);
    if (current === undefined || chain === undefined) continue;
    const links = [
      ...(context.dependents.get(current) ?? []),
      ...context.wideningLinks,
    ];
    for (const link of links) {
      if (chains.has(link.workspace)) continue;
      chains.set(link.workspace, {
        from: chain.from,
        links: [...chain.links, link],
      });
      queue.push(link.workspace);
    }
  }
  return chains;
}

function pathReport(
  context: SelectionContext,
  path: string,
  owner: string | undefined,
  triggers: readonly PathTrigger[],
  reasons: ReadonlyMap<string, readonly SelectionReason[]>,
): ChangedPathReport {
  const selected: PathSelection[] = [];
  const notRunnable: NotRunnableWorkspace[] = [];
  for (const workspace of context.vitestPaths) {
    const workspaceReasons = reasons.get(workspace);
    if (workspaceReasons === undefined) continue;
    const excluded = context.notRunnable.get(workspace);
    if (excluded === undefined) {
      selected.push({ workspace, reasons: workspaceReasons });
    } else {
      notRunnable.push(excluded);
    }
  }
  return {
    path,
    owner,
    triggers: triggers.map(({ kind }) => kind),
    selected,
    notRunnable,
    nothingSelected:
      selected.length > 0
        ? undefined
        : nothingSelectedReason(context, owner, notRunnable),
  };
}

function nothingSelectedReason(
  context: SelectionContext,
  owner: string | undefined,
  notRunnable: readonly NotRunnableWorkspace[],
): NonNullable<ChangedPathReport["nothingSelected"]> {
  if (notRunnable.length > 0) {
    const excluded = notRunnable
      .map(({ workspace, reason }) => `${workspace.path} (${reason})`)
      .join(", ");
    return {
      kind: NO_SELECTION.onlyNotRunnable,
      detail: `every Vitest workspace it reaches will not run: ${excluded}`,
    };
  }
  return {
    kind: NO_SELECTION.noDependentVitestWorkspace,
    detail: `it lies in package workspace ${owner ?? ROOT_PATH}, which is not a Vitest workspace, and no listed Vitest workspace depends on it${unlistedNote(context)}`,
  };
}

/** A workspace in a source the listings did not read may depend on the path, so the detail names those sources. */
function unlistedNote(context: SelectionContext): string {
  const { dependencies, vitestListingNotRead } = context.input;
  const sources = [...dependencies.notRead, ...vitestListingNotRead].map(
    ({ source }) => source,
  );
  return sources.length === 0
    ? ""
    : `; the workspace listings did not read ${sources.join(", ")}, so a workspace there may depend on it`;
}

function assemble(
  context: SelectionContext,
  outcomes: readonly PathOutcome[],
): SelectionOutcome {
  const { input } = context;
  const reasons = new Map<string, SelectionReason[]>();
  for (const outcome of outcomes) {
    for (const [workspace, workspaceReasons] of outcome.reasons) {
      if (context.notRunnable.has(workspace)) continue;
      reasons.set(workspace, [
        ...(reasons.get(workspace) ?? []),
        ...workspaceReasons,
      ]);
    }
  }
  const workspaces = selectedWorkspaces(input.workspaces, reasons);
  const tests = selectedTests(input.workspaces, reasons);
  const counts = selectionCounts(input, workspaces, tests.length);
  const nothingSelected =
    tests.length === 0 && workspaces.every(({ tests }) => tests.known);
  return {
    state: nothingSelected
      ? SELECTION_STATE.nothingSelected
      : SELECTION_STATE.selected,
    policyVersion: SELECTION_POLICY_VERSION,
    tests,
    workspaces,
    paths: outcomes.map(({ report }) => report),
    fallbacks: outcomes.flatMap(({ fallbacks }) => fallbacks),
    widenings: input.dependencies.uncertainties.filter((widening) =>
      context.usedWidenings.has(widening),
    ),
    counts,
    notRead: [...input.dependencies.notRead, ...input.vitestListingNotRead],
    notRunnable: input.notRunnable,
  };
}

function selectedWorkspaces(
  workspaces: readonly SelectableWorkspace[],
  reasons: ReadonlyMap<string, readonly SelectionReason[]>,
): SelectedWorkspace[] {
  return workspaces.flatMap(({ workspace, tests }) => {
    const workspaceReasons = reasons.get(workspace.path);
    if (workspaceReasons === undefined) return [];
    return [
      {
        path: workspace.path,
        tests: tests.known
          ? { known: true, count: tests.tests.length }
          : { known: false, reason: tests.reason },
        reasons: workspaceReasons,
      },
    ];
  });
}

function selectedTests(
  workspaces: readonly SelectableWorkspace[],
  reasons: ReadonlyMap<string, readonly SelectionReason[]>,
): SelectedTest[] {
  return workspaces.flatMap(({ workspace, tests }) => {
    const workspaceReasons = reasons.get(workspace.path);
    if (workspaceReasons === undefined || !tests.known) return [];
    return tests.tests.map((identity) => ({
      identity,
      reasons: workspaceReasons,
    }));
  });
}

function selectionCounts(
  input: SelectionInput,
  workspaces: readonly SelectedWorkspace[],
  selectedTestCount: number,
): SelectionCounts {
  const knownTotal = input.workspaces.reduce(
    (total, { tests }) => total + (tests.known ? tests.tests.length : 0),
    0,
  );
  const listingsComplete =
    input.dependencies.notRead.length === 0 &&
    input.vitestListingNotRead.length === 0;
  return {
    selectedTests: {
      count: selectedTestCount,
      complete: workspaces.every(({ tests }) => tests.known),
    },
    totalTests: {
      count: knownTotal,
      complete:
        listingsComplete && input.workspaces.every(({ tests }) => tests.known),
    },
    selectedWorkspaces: workspaces.length,
    totalWorkspaces: {
      count: input.workspaces.length,
      complete: listingsComplete,
    },
    notRunnableWorkspaces: input.notRunnable.length,
  };
}
