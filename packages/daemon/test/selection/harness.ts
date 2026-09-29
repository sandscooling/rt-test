import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TestIdentity } from "@rt-test/core";
import { expect } from "vitest";
import { ProjectInputs } from "../../src/inputs/fingerprint.js";
import {
  Narrowing,
  type PathPlacement,
} from "../../src/inputs/narrowed-inputs.js";
import { readNonInputs } from "../../src/inputs/non-inputs.js";
import { protection } from "../../src/inputs/protection.js";
import { selectTests } from "../../src/selection/select-tests.js";
import { buildSelectionInput } from "../../src/selection/selection-input.js";
import type { ParseObserver } from "../../src/selection/specifier-edges.js";
import type {
  DependencyInformation,
  SelectableWorkspace,
  SelectionAlias,
  SelectionOutcome,
} from "../../src/selection/selection-types.js";
import { buildDependencyInformation } from "../../src/selection/workspace-graph.js";
import type { ReportedAlias } from "../../src/vitest/selection-facts.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../../src/vitest/discover-tests.js";
import {
  findPackageWorkspaces,
  type UnreadWorkspaceSource,
} from "../../src/vitest/find-workspaces.js";
import {
  DISCOVERED_VITEST_VERSION,
  discoveredWorkspace,
  inTempDir,
  projectFacts,
  settle,
  type FactsCase,
} from "../harness.js";

const DEFAULT_MODULES = ["unit.test.ts"];

/** A Vitest workspace as discovery would hand it to selection. */
export interface TreeWorkspace {
  readonly path: string;
  /** Module paths relative to the workspace, one test each; a string is the reason its tests are not known. */
  readonly tests?: readonly string[] | string;
  readonly setupFiles?: readonly string[];
  readonly globalSetupFiles?: readonly string[];
  /** Given the consumer root selection sees, so a replacement can be an absolute path into it. */
  readonly aliases?: (root: string) => readonly TreeAlias[];
  /** The reason the caller will not run it. */
  readonly notRunnable?: string;
  /** Its one project's test file patterns, matched from the workspace's directory unless they name another. */
  readonly patterns?: Pick<
    FactsCase,
    "directory" | "include" | "exclude" | "includeSource"
  >;
  /** Its discovery reports no selection facts, as one stored before the store kept them does. */
  readonly factsUnreported?: boolean;
}

/** An alias as its project reports it, under the workspace's own directory as its Vite root unless it names one. */
export type TreeAlias = ReportedAlias &
  Partial<Pick<SelectionAlias, "viteRoot">>;

export interface TreeCase {
  readonly files: Readonly<Record<string, string>>;
  readonly workspaces: readonly TreeWorkspace[];
  readonly change?: readonly string[];
  readonly vitestListingNotRead?: readonly UnreadWorkspaceSource[];
  /** Hands selection the consumer root through a directory link to it. */
  readonly throughLink?: boolean | undefined;
  /** Directory links inside the tree, each path to its target, both root-relative. */
  readonly links?: Readonly<Record<string, string>>;
  /** Runs on the written tree before selection reads it, given the root selection sees. */
  readonly prepare?: (root: string) => void;
}

export type Settled<T> = T | { thrown: string };

export function manifest(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(fields);
}

/** A consumer root `package.json` listing `packages/*`, plus any other root fields. */
export function rootManifest(
  fields: Readonly<Record<string, unknown>> = {},
): string {
  return manifest({ name: "consumer", workspaces: ["packages/*"], ...fields });
}

export function writeTree(
  dir: string,
  files: Readonly<Record<string, string>>,
): void {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
}

function identity(workspacePath: string, modulePath: string): TestIdentity {
  return {
    workspacePath,
    projectName: "",
    modulePath,
    namePath: [modulePath],
    occurrence: 0,
  };
}

/** A workspace whose tests are not known failed its discovery, which reports no selection facts. */
function selectable(root: string, tree: TreeWorkspace): SelectableWorkspace {
  const tests = tree.tests ?? DEFAULT_MODULES;
  const workspace = { path: tree.path, directory: join(root, tree.path) };
  if (typeof tests === "string") {
    return {
      workspace,
      tests: { known: false, reason: tests },
      setupFiles: [],
      globalSetupFiles: [],
      aliases: [],
    };
  }
  return {
    workspace,
    tests: {
      known: true,
      tests: tests.map((module) => identity(tree.path, module)),
    },
    setupFiles: tree.setupFiles ?? [],
    globalSetupFiles: tree.globalSetupFiles ?? [],
    aliases: (tree.aliases?.(root) ?? []).map((alias) => ({
      viteRoot: join(root, tree.path),
      ...alias,
    })),
  };
}

/** Writes the tree into a temp directory and hands `body` the root selection sees. */
function inTree<T>(
  tree: TreeCase,
  body: (root: string) => T,
): Promise<Settled<T>> {
  return inTempDir((dir) => {
    const real = join(dir, "real");
    writeTree(real, tree.files);
    mkdirSync(real, { recursive: true });
    for (const [path, target] of Object.entries(tree.links ?? {})) {
      mkdirSync(dirname(join(real, path)), { recursive: true });
      symlinkSync(join(real, target), join(real, path), "junction");
    }
    const root = tree.throughLink === true ? join(dir, "link") : real;
    if (tree.throughLink === true) symlinkSync(real, root, "junction");
    return settle(() => {
      tree.prepare?.(root);
      return body(root);
    });
  });
}

function runnable(
  root: string,
  tree: TreeCase,
  observer?: ParseObserver,
): { selectable: SelectableWorkspace[]; information: DependencyInformation } {
  const workspaces = tree.workspaces
    .filter((workspace) => workspace.notRunnable === undefined)
    .map((workspace) => selectable(root, workspace));
  return {
    selectable: workspaces,
    information: buildDependencyInformation(
      findPackageWorkspaces(root),
      workspaces,
      observer,
    ),
  };
}

/** What the dependency build over the tree tells its parse observer, in order: `parsing <label>` and `parsed`. */
export function parsesInTree(tree: TreeCase): Promise<Settled<string[]>> {
  return inTree(tree, (root) => {
    const events: string[] = [];
    runnable(root, tree, {
      parsing: (label) => events.push(`parsing ${label}`),
      parsed: () => events.push("parsed"),
    });
    return events;
  });
}

/** Why no selection input was built, in place of a selection. */
export interface NotBuilt {
  readonly notBuilt: string;
}

/**
 * Builds selection's input from the discovery `discover` gives for the tree's root, as the daemon will, then the
 * dependency information over its selectable workspaces, and selects the tree's change over both.
 */
export function selectFromDiscovery(
  tree: Omit<TreeCase, "workspaces">,
  discover: (root: string) => TestDiscovery | undefined,
): Promise<Settled<SelectionOutcome | NotBuilt>> {
  return inTree({ ...tree, workspaces: [] }, (root) => {
    const build = buildSelectionInput(
      discover(root),
      root,
      readNonInputs(root),
    );
    if (!build.built) return { notBuilt: build.reason };
    return selectTests({
      ...build.input,
      change: tree.change ?? [],
      dependencies: buildDependencyInformation(
        findPackageWorkspaces(root),
        build.input.workspaces,
      ),
    });
  });
}

/** The dependency information the caller builds from the tree's package workspaces and runnable Vitest workspaces. */
export function graphInTree(
  tree: TreeCase,
): Promise<Settled<DependencyInformation>> {
  return inTree(tree, (root) => runnable(root, tree).information);
}

/** Builds the dependency information over the tree, then hands `inspect` the root and that information before the tree is removed. */
export function inspectTree<T>(
  tree: TreeCase,
  inspect: (root: string, information: DependencyInformation) => T,
): Promise<Settled<T>> {
  return inTree(tree, (root) =>
    inspect(root, runnable(root, tree).information),
  );
}

/** Lists, builds and selects over the tree as the daemon's caller will: not-runnable workspaces passed with their reason. */
export function selectInTree(
  tree: TreeCase,
): Promise<Settled<SelectionOutcome>> {
  return inTree(tree, (root) => {
    const { selectable: workspaces, information } = runnable(root, tree);
    return selectTests({
      change: tree.change ?? [],
      dependencies: information,
      workspaces,
      notRunnable: tree.workspaces.flatMap((workspace) =>
        workspace.notRunnable === undefined
          ? []
          : [
              {
                workspace: {
                  path: workspace.path,
                  directory: join(root, workspace.path),
                },
                reason: workspace.notRunnable,
              },
            ],
      ),
      vitestListingNotRead: tree.vitestListingNotRead ?? [],
      nonInputs: {
        declaration: readNonInputs(root),
        protection: protection(treeDiscovery(root, tree), root),
      },
    });
  });
}

/** The narrowing the daemon builds from the tree's discovery and dependency information. */
function narrowingIn(root: string, tree: TreeCase): Narrowing {
  const build = buildSelectionInput(
    treeDiscovery(root, tree),
    root,
    readNonInputs(root),
  );
  if (!build.built) throw new Error(build.reason);
  return new Narrowing(
    build.input,
    buildDependencyInformation(
      findPackageWorkspaces(root),
      build.input.workspaces,
    ),
    () => undefined,
  );
}

/** The Vitest workspaces the tree's narrowing selects for the root-relative `change`. */
export function selectedByNarrowing(
  tree: TreeCase,
  change: readonly string[],
): Promise<Settled<string[] | SelectionOutcome>> {
  return inTree(tree, (root) =>
    selectedPaths(narrowingIn(root, tree).select(change)),
  );
}

/**
 * Each Vitest workspace's narrowed inputs, sorted, when the tracker holds `inputs` over the tree, or why selection
 * refused them: the narrowing is built from the tree's discovery and dependency information, as the daemon builds it.
 */
export function narrowedInTree(
  tree: TreeCase,
  inputs: readonly string[],
): Promise<Settled<Record<string, string[]> | { refused: string }>> {
  return inTree(tree, (root) => {
    const narrowing = narrowingIn(root, tree);
    const project = new ProjectInputs(
      root,
      new Map(inputs.map((path) => [path, `${path}-digest`])),
    );
    const refused = narrowing.refusal(project);
    if (refused !== undefined) return { refused };
    return Object.fromEntries(
      tree.workspaces.map(({ path }) => [
        path,
        [...narrowing.workspaceInputs(project, path).digests.keys()].sort(),
      ]),
    );
  });
}

/**
 * Where the tree's narrowing places the root-relative `paths` for the workspace at `workspacePath`, as a run's
 * judgment asks it, after the same placement was asked about each of `earlier`, as the judgments before it were. The
 * narrowing is built from the tree's discovery and dependency information, as the daemon builds it.
 */
export function placedInTree(
  tree: TreeCase,
  paths: readonly string[],
  workspacePath: string,
  earlier: readonly (readonly string[])[] = [],
): Promise<Settled<PathPlacement>> {
  return inTree(tree, (root) => {
    const { placement } = narrowingIn(root, tree);
    for (const batch of earlier) placement.place(batch, workspacePath);
    return placement.place(paths, workspacePath);
  });
}

/**
 * The discovery the tree's workspaces stand for: a workspace the caller will not run was not confirmed, and one
 * whose tests are not known failed its discovery.
 */
function treeDiscovery(root: string, tree: TreeCase): TestDiscovery {
  return {
    workspaces: tree.workspaces.map((entry): WorkspaceDiscovery => {
      const workspace = { path: entry.path, directory: join(root, entry.path) };
      if (entry.notRunnable !== undefined) {
        return {
          status: "not-confirmed",
          workspace,
          reason: entry.notRunnable,
        };
      }
      const tests = entry.tests ?? DEFAULT_MODULES;
      if (typeof tests === "string") {
        return {
          status: "failed",
          workspace,
          vitestVersion: DISCOVERED_VITEST_VERSION,
          error: tests,
        };
      }
      return discoveredWorkspace(
        workspace,
        tests,
        entry.factsUnreported === true
          ? { reported: false }
          : {
              reported: true,
              projects: [
                projectFacts({
                  root,
                  directory: entry.path,
                  ...entry.patterns,
                  setupFiles: entry.setupFiles ?? [],
                  globalSetupFiles: entry.globalSetupFiles ?? [],
                }),
              ],
            },
      );
    }),
    notRead: [],
  };
}

/** The selected Vitest workspace paths, or the outcome itself when nothing was selected that way. */
export function selectedPaths(
  outcome: Settled<SelectionOutcome>,
): string[] | Settled<SelectionOutcome> {
  return "workspaces" in outcome
    ? outcome.workspaces.map(({ path }) => path)
    : outcome;
}

export const APP = "packages/app";

export function pkg(
  name: string,
  fields: Readonly<Record<string, unknown>> = {},
): string {
  return manifest({ name, ...fields });
}

/** `packages/<name>/package.json` named `@x/<name>` for each name. */
export function plainPackages(...names: string[]): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => [`packages/${name}/package.json`, pkg(`@x/${name}`)]),
  );
}

export interface AppCase {
  readonly app?: Readonly<Record<string, unknown>>;
  readonly root?: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly vitest?: Omit<TreeWorkspace, "path">;
  readonly change: string;
  readonly throughLink?: boolean;
  readonly links?: Readonly<Record<string, string>>;
}

/** A consumer whose only Vitest workspace is `packages/app`, beside plain packages `b` and `c`. */
export function appTree({
  app = {},
  root = {},
  files = {},
  vitest = {},
}: AppCase): TreeCase {
  return {
    files: {
      "package.json": rootManifest(root),
      "packages/app/package.json": pkg("@x/app", app),
      ...plainPackages("b", "c"),
      ...files,
    },
    workspaces: [{ path: APP, ...vitest }],
  };
}

/** The dependency information over the app tree holding `files`, with any other tree options. */
export function scanApp(
  files: Readonly<Record<string, string>>,
  options: Pick<AppCase, "app" | "root"> &
    Omit<TreeCase, "files" | "workspaces"> = {},
): Promise<Settled<DependencyInformation>> {
  const { app, root, ...tree } = options;
  return graphInTree({
    ...appTree({
      files,
      change: "",
      ...(app && { app }),
      ...(root && { root }),
    }),
    ...tree,
  });
}

/** The app's edges as `<producer> <dependency>`, sorted. */
export function appEdges(
  information: Settled<DependencyInformation>,
): string[] | Settled<DependencyInformation> {
  return "edges" in information
    ? information.edges
        .filter(({ dependent }) => dependent === APP)
        .map(({ producer, dependency }) => `${producer} ${dependency}`)
        .sort()
    : information;
}

/** The app's widenings, each as its kind and cause. */
export function appWidenings(
  information: Settled<DependencyInformation>,
): { kind: string; cause: string }[] | Settled<DependencyInformation> {
  return "uncertainties" in information
    ? information.uncertainties
        .filter(({ dependent }) => dependent === APP)
        .map(({ kind, cause }) => ({ kind, cause }))
    : information;
}

/** The app's edges beside its widening kinds, for a defect that could move either. */
export function appScan(
  information: Settled<DependencyInformation>,
):
  | { edges: string[] | Settled<DependencyInformation>; widenings: string[] }
  | Settled<DependencyInformation> {
  return "edges" in information
    ? {
        edges: appEdges(information),
        widenings: information.uncertainties
          .filter(({ dependent }) => dependent === APP)
          .map(({ kind }) => kind),
      }
    : information;
}

/** The one widening of the app a test expects: its kind, and a cause naming `path`. */
export function widenedAt(
  kind: string,
  path: string,
): { kind: string; cause: unknown }[] {
  return [{ kind, cause: expect.stringContaining(path) }];
}

/** Each selected workspace's reasons as `via` chains, by workspace path. */
export function reasonVias(
  outcome: Settled<SelectionOutcome>,
): Record<string, string[][]> | Settled<SelectionOutcome> {
  return "workspaces" in outcome
    ? Object.fromEntries(
        outcome.workspaces.map(({ path, reasons }) => [
          path,
          reasons.map(({ steps }) => steps.map(({ via }) => via)),
        ]),
      )
    : outcome;
}
