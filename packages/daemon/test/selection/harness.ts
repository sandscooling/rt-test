import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TestIdentity } from "@rt-test/core";
import { selectTests } from "../../src/selection/select-tests.js";
import type {
  DependencyInformation,
  ResolvedAlias,
  SelectableWorkspace,
  SelectionOutcome,
} from "../../src/selection/selection-types.js";
import { buildDependencyInformation } from "../../src/selection/workspace-graph.js";
import {
  findPackageWorkspaces,
  type UnreadWorkspaceSource,
} from "../../src/vitest/find-workspaces.js";
import { inTempDir, settle } from "../harness.js";

const DEFAULT_MODULES = ["unit.test.ts"];

/** A Vitest workspace as discovery would hand it to selection. */
export interface TreeWorkspace {
  readonly path: string;
  /** Module paths relative to the workspace, one test each; a string is the reason its tests are not known. */
  readonly tests?: readonly string[] | string;
  readonly setupFiles?: readonly string[];
  readonly globalSetupFiles?: readonly string[];
  /** Given the consumer root selection sees, so a replacement can be an absolute path into it. */
  readonly aliases?: (root: string) => readonly ResolvedAlias[];
  /** The reason the caller will not run it. */
  readonly notRunnable?: string;
}

export interface TreeCase {
  readonly files: Readonly<Record<string, string>>;
  readonly workspaces: readonly TreeWorkspace[];
  readonly change?: readonly string[];
  readonly vitestListingNotRead?: readonly UnreadWorkspaceSource[];
  /** Hands selection the consumer root through a directory link to it. */
  readonly throughLink?: boolean | undefined;
  /** Directory links inside the tree, each path to its target, both root-relative. */
  readonly links?: Readonly<Record<string, string>>;
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

function writeTree(dir: string, files: Readonly<Record<string, string>>): void {
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

function selectable(root: string, tree: TreeWorkspace): SelectableWorkspace {
  const tests = tree.tests ?? DEFAULT_MODULES;
  return {
    workspace: { path: tree.path, directory: join(root, tree.path) },
    tests:
      typeof tests === "string"
        ? { known: false, reason: tests }
        : {
            known: true,
            tests: tests.map((module) => identity(tree.path, module)),
          },
    setupFiles: tree.setupFiles ?? [],
    globalSetupFiles: tree.globalSetupFiles ?? [],
    aliases: tree.aliases?.(root) ?? [],
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
    return settle(() => body(root));
  });
}

function runnable(
  root: string,
  tree: TreeCase,
): { selectable: SelectableWorkspace[]; information: DependencyInformation } {
  const workspaces = tree.workspaces
    .filter((workspace) => workspace.notRunnable === undefined)
    .map((workspace) => selectable(root, workspace));
  return {
    selectable: workspaces,
    information: buildDependencyInformation(
      findPackageWorkspaces(root),
      workspaces,
    ),
  };
}

/** The dependency information the caller builds from the tree's package workspaces and runnable Vitest workspaces. */
export function graphInTree(
  tree: TreeCase,
): Promise<Settled<DependencyInformation>> {
  return inTree(tree, (root) => runnable(root, tree).information);
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
    });
  });
}

/** The selected Vitest workspace paths, or the outcome itself when nothing was selected that way. */
export function selectedPaths(
  outcome: Settled<SelectionOutcome>,
): string[] | Settled<SelectionOutcome> {
  return "workspaces" in outcome
    ? outcome.workspaces.map(({ path }) => path)
    : outcome;
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
