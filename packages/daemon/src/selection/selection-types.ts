import type { TestIdentity } from "@rt-test/core";
import type { NonInputsDeclaration } from "../inputs/non-inputs.js";
import type { Protection } from "../inputs/protection.js";
import type {
  PackageWorkspace,
  UnreadWorkspaceSource,
  VitestWorkspace,
} from "../vitest/find-workspaces.js";
import type { ReportedAlias } from "../vitest/selection-facts.js";

/** Raise whenever a rule change can select a different set for the same inputs. */
export const SELECTION_POLICY_VERSION = 10;

export const EDGE_PRODUCER = {
  manifest: "manifest",
  override: "override",
  testModule: "test-module",
  setupFile: "setup-file",
  alias: "alias",
  relativeImport: "relative-import",
  bareImport: "bare-import",
  tsconfig: "tsconfig",
  manifestImports: "manifest-imports",
  link: "link",
} as const;

export type EdgeProducerKind =
  (typeof EDGE_PRODUCER)[keyof typeof EDGE_PRODUCER];

export const UNCERTAINTY = {
  manifestMissing: "manifest-missing",
  manifestUnreadable: "manifest-unreadable",
  unresolvedLocalDependency: "unresolved-local-dependency",
  unlistedPackage: "unlisted-package",
  unresolvedOverride: "unresolved-override",
  unresolvableAlias: "unresolvable-alias",
  unresolvableSpecifier: "unresolvable-specifier",
  testsNotKnown: "tests-not-known",
  unreadableSource: "unreadable-source",
  unparsedSource: "unparsed-source",
  pluginFormatFile: "plugin-format-file",
  walkBoundReached: "walk-bound-reached",
  extendsUnfollowed: "extends-unfollowed",
  malformedConfig: "malformed-config",
} as const;

export type UncertaintyKind = (typeof UNCERTAINTY)[keyof typeof UNCERTAINTY];

/** `dependent` depends on `dependency`: a change in `dependency` can change `dependent`'s results. */
export interface DependencyEdge {
  readonly dependent: string;
  readonly dependency: string;
  readonly producer: EdgeProducerKind;
  /** Quotes what produced the edge: the manifest field and key, test module, setup file, alias, import, tsconfig field or link. */
  readonly detail: string;
}

/** `dependent` depends on every package workspace, because what it depends on could not be told. */
export interface DependencyUncertainty {
  readonly dependent: string;
  readonly kind: UncertaintyKind;
  readonly cause: string;
  /**
   * Root-relative and `/`-separated, as the inputs name it: the one source file whose failed read or parse is the
   * whole cause. Absent for any other cause, and for a file the scan reached by a path that is not its real one.
   */
  readonly file?: string;
}

/** A widening selection does not follow: the file that raised it is a declared non-input, which no test reads. */
export interface LeftOutWidening extends DependencyUncertainty {
  readonly file: string;
  /** The `rt-test.json` pattern that declares `file` a non-input. */
  readonly pattern: string;
}

/** A dependent reached from a workspace, through an edge or a widening that makes it depend on every workspace. */
export interface DependentLink {
  readonly workspace: string;
  readonly step: ChainStep;
  readonly widening: DependencyUncertainty | undefined;
}

export interface DependencyInformation {
  /** In listing order: the consumer root first. */
  readonly packageWorkspaces: readonly PackageWorkspace[];
  /** The package workspace listing's sources not read; any entry makes the listing incomplete. */
  readonly notRead: readonly UnreadWorkspaceSource[];
  /** Listed package workspaces with no `package.json`, which no package manager treats as a package. */
  readonly withoutManifest: readonly string[];
  readonly edges: readonly DependencyEdge[];
  readonly uncertainties: readonly DependencyUncertainty[];
}

export type WorkspaceTests =
  | { readonly known: true; readonly tests: readonly TestIdentity[] }
  | { readonly known: false; readonly reason: string };

export interface SelectableWorkspace {
  readonly workspace: VitestWorkspace;
  readonly tests: WorkspaceTests;
  /** Root-relative and `/`-separated. */
  readonly setupFiles: readonly string[];
  /** Root-relative and `/`-separated. */
  readonly globalSetupFiles: readonly string[];
  /** As discovery reports them, each with its project's Vite root: a replacement may be any string, and a find may be a RegExp's source. */
  readonly aliases: readonly SelectionAlias[];
}

export interface SelectionAlias extends ReportedAlias {
  /** Absolute: the Vite root of the project whose config holds the alias. */
  readonly viteRoot: string;
}

export interface NotRunnableWorkspace {
  readonly workspace: VitestWorkspace;
  readonly reason: string;
}

export const TRIGGER = {
  changedPath: "changed-path",
  lockfile: "lockfile",
  manifest: "manifest",
  rootOwnedPath: "root-owned-path",
  ownerWithoutManifest: "owner-without-manifest",
  configOutsideWorkspace: "config-outside-workspace",
  workspaceConfig: "workspace-config",
  setupFile: "setup-file",
  globalSetupFile: "global-setup-file",
  nonInputsFile: "non-inputs-file",
} as const;

export type TriggerKind = (typeof TRIGGER)[keyof typeof TRIGGER];

export const FALLBACK_SCOPE = {
  project: "project",
  workspace: "workspace",
} as const;

export type FallbackScope =
  (typeof FALLBACK_SCOPE)[keyof typeof FALLBACK_SCOPE];

export const NO_SELECTION = {
  noDependentVitestWorkspace: "no-dependent-vitest-workspace",
  onlyNotRunnable: "only-not-runnable",
  declaredNonInput: "declared-non-input",
} as const;

export type NoSelectionKind = (typeof NO_SELECTION)[keyof typeof NO_SELECTION];

export const SELECTION_STATE = {
  selected: "selected",
  nothingSelected: "nothing-selected",
  refused: "refused",
} as const;

export interface SelectionInput {
  /**
   * Root-relative `/`-separated paths of the files added, edited or deleted. A deleted directory is named by the
   * files it held, since a declared pattern that matches the directory need not match each of them.
   */
  readonly change: readonly string[];
  readonly dependencies: DependencyInformation;
  readonly workspaces: readonly SelectableWorkspace[];
  readonly notRunnable: readonly NotRunnableWorkspace[];
  /** `findVitestWorkspaces`'s sources not read: a candidate it could not check may be a Vitest workspace. */
  readonly vitestListingNotRead: readonly UnreadWorkspaceSource[];
  readonly nonInputs: SelectionNonInputs;
}

/** The consumer's declaration, and the files no declared pattern may remove. */
export interface SelectionNonInputs {
  readonly declaration: NonInputsDeclaration;
  /** Built by `protection` over the discovery the tracker reads, so selection and the tracker decide alike. */
  readonly protection: Protection;
}

/** One step from a workspace to a dependent of it, through an edge's producer or a widening's cause. */
export interface ChainStep {
  readonly workspace: string;
  readonly via: EdgeProducerKind | UncertaintyKind;
  readonly detail: string;
}

export interface SelectionReason {
  readonly path: string;
  readonly trigger: TriggerKind;
  /** The workspace the trigger started at; absent for a project-wide fallback, which selects every workspace. */
  readonly from: string | undefined;
  /** One shortest chain of dependents from `from` to the selected workspace. */
  readonly steps: readonly ChainStep[];
}

export interface BroadFallback {
  readonly path: string;
  readonly trigger: TriggerKind;
  readonly scope: FallbackScope;
  /**
   * The Vitest workspaces it starts from, whose dependents it also selects; every one for the project scope.
   * A not-runnable workspace among them is reported, never selected.
   */
  readonly workspaces: readonly string[];
}

export type WorkspaceTestCount =
  | { readonly known: true; readonly count: number }
  | { readonly known: false; readonly reason: string };

export interface SelectedWorkspace {
  readonly path: string;
  readonly tests: WorkspaceTestCount;
  readonly reasons: readonly SelectionReason[];
}

export interface SelectedTest {
  readonly identity: TestIdentity;
  readonly reasons: readonly SelectionReason[];
}

export interface PathSelection {
  readonly workspace: string;
  readonly reasons: readonly SelectionReason[];
}

export interface ChangedPathReport {
  readonly path: string;
  /** The deepest package workspace holding the path. */
  readonly owner: string | undefined;
  readonly triggers: readonly TriggerKind[];
  readonly selected: readonly PathSelection[];
  readonly notRunnable: readonly NotRunnableWorkspace[];
  readonly nothingSelected:
    { readonly kind: NoSelectionKind; readonly detail: string } | undefined;
}

/**
 * `count` counts known tests. `complete` is false while any workspace it covers has tests not known, and for
 * the total also while either listing reports a source not read, since a workspace missing from it has tests.
 */
export interface TestCount {
  readonly count: number;
  readonly complete: boolean;
}

export interface SelectionCounts {
  readonly selectedTests: TestCount;
  readonly totalTests: TestCount;
  readonly selectedWorkspaces: number;
  /** Runnable Vitest workspaces; incomplete while either listing reports a source not read. */
  readonly totalWorkspaces: {
    readonly count: number;
    readonly complete: boolean;
  };
  readonly notRunnableWorkspaces: number;
}

export interface Selection {
  readonly state:
    typeof SELECTION_STATE.selected | typeof SELECTION_STATE.nothingSelected;
  readonly policyVersion: number;
  readonly tests: readonly SelectedTest[];
  readonly workspaces: readonly SelectedWorkspace[];
  readonly paths: readonly ChangedPathReport[];
  readonly fallbacks: readonly BroadFallback[];
  /** The uncertainties some selection reason passed through. */
  readonly widenings: readonly DependencyUncertainty[];
  /** The uncertainties no selection reason could pass through, each with the pattern that declares its file. */
  readonly wideningsLeftOut: readonly LeftOutWidening[];
  readonly counts: SelectionCounts;
  readonly notRead: readonly UnreadWorkspaceSource[];
  readonly notRunnable: readonly NotRunnableWorkspace[];
}

export interface RefusedSelection {
  readonly state: typeof SELECTION_STATE.refused;
  readonly policyVersion: number;
  readonly path: string;
  readonly reason: string;
}

export type SelectionOutcome = Selection | RefusedSelection;
