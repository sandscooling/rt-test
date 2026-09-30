import { posix, relative, resolve, sep } from "node:path";
import {
  climbsOut,
  liesInside,
  POSIX_SEPARATOR,
  realPath,
  ROOT_PATH,
  type PackageWorkspace,
} from "../vitest/find-workspaces.js";
import type { SpecTarget } from "./package-specs.js";
import {
  UNCERTAINTY,
  type DependencyEdge,
  type DependencyUncertainty,
  type EdgeProducerKind,
  type UncertaintyKind,
} from "./selection-types.js";

const HOME_PATH_PREFIX = "~/";
const TRAILING_SEPARATORS = /\/+$/;

/** The dependency information while it is built: the listing it reads against and the records it has produced. */
export interface Graph {
  readonly workspaces: readonly PackageWorkspace[];
  /** False while the listing is incomplete or a listed workspace's name could not be read. */
  readonly namesComplete: boolean;
  readonly names: ReadonlyMap<string, readonly string[]>;
  readonly holders: readonly WorkspaceDirectories[];
  readonly edges: DependencyEdge[];
  readonly uncertainties: DependencyUncertainty[];
}

/** A workspace's directory as listed and as resolved, since a link can make either the one a path is given in. */
export interface WorkspaceDirectories {
  readonly path: string;
  readonly directories: readonly string[];
}

export interface Unresolved {
  readonly ok: false;
  readonly kind: UncertaintyKind;
  readonly cause: string;
}

/** The package workspaces a spec installs; an empty list is an external package. */
export type TargetResolution =
  { readonly ok: true; readonly paths: readonly string[] } | Unresolved;

/** A root-relative path in one spelling: `./a//b/` is `a/b`, and an empty path is the root. */
export function normalizeRelativePath(path: string): string {
  const normalized = posix.normalize(path).replace(TRAILING_SEPARATORS, "");
  return normalized === "" ? ROOT_PATH : normalized;
}

/** The deepest package workspace holding a root-relative `/`-separated path, compared by whole segments. */
export function owningWorkspace(
  path: string,
  workspaces: readonly PackageWorkspace[],
): PackageWorkspace | undefined {
  let owner: PackageWorkspace | undefined;
  for (const workspace of workspaces) {
    if (!holdsRelativePath(workspace.path, path)) continue;
    if (owner === undefined || depth(workspace.path) > depth(owner.path)) {
      owner = workspace;
    }
  }
  return owner;
}

function holdsRelativePath(workspacePath: string, path: string): boolean {
  if (workspacePath === ROOT_PATH) {
    return !climbsOut(path, POSIX_SEPARATOR);
  }
  return (
    path === workspacePath ||
    path.startsWith(`${workspacePath}${POSIX_SEPARATOR}`)
  );
}

function depth(workspacePath: string): number {
  return workspacePath === ROOT_PATH
    ? 0
    : workspacePath.split(POSIX_SEPARATOR).length;
}

export function holderDirectories(
  workspace: PackageWorkspace,
): WorkspaceDirectories {
  const listed = resolve(workspace.directory);
  const real = realPath(workspace.directory);
  const directories =
    real.ok && real.path !== listed ? [listed, real.path] : [listed];
  return { path: workspace.path, directories };
}

/**
 * The package workspace nearest above an absolute path, and the one nearest above its real path when a link
 * carries it into another workspace, matching listed and resolved directories alike.
 */
export function holdersOf(graph: Graph, absolute: string): string[] {
  const real = realPath(absolute);
  const targets = real.ok ? [absolute, real.path] : [absolute];
  const holders: string[] = [];
  for (const target of targets) {
    const holder = nearestHolder(graph, target);
    if (holder !== undefined && !holders.includes(holder)) holders.push(holder);
  }
  return holders;
}

function nearestHolder(graph: Graph, target: string): string | undefined {
  let best: { path: string; distance: number } | undefined;
  for (const { path, directories } of graph.holders) {
    const distance = nearestDistance(directories, target);
    if (distance === undefined) continue;
    if (best === undefined || distance < best.distance) {
      best = { path, distance };
    }
  }
  return best?.path;
}

function nearestDistance(
  directories: readonly string[],
  target: string,
): number | undefined {
  const distances = directories
    .filter((directory) => liesInside(directory, target))
    .map((directory) => {
      const fromDirectory = relative(directory, target);
      return fromDirectory === "" ? 0 : fromDirectory.split(sep).length;
    });
  return distances.length === 0 ? undefined : Math.min(...distances);
}

export function resolveTarget(
  graph: Graph,
  target: SpecTarget,
  keyPackage: string,
  base: string,
): TargetResolution {
  switch (target.kind) {
    case "path":
      return resolvePathTarget(graph, target.path, base);
    case "package":
      return { ok: true, paths: graph.names.get(target.name) ?? [] };
    case "workspace-key":
      return workspaceNamed(graph, keyPackage);
    case "workspace-package":
      return workspaceNamed(graph, target.name);
    case "reference":
    case "registry":
      return { ok: true, paths: [] };
  }
}

/** The workspace protocol installs only a workspace, so a name no listed workspace has is unresolved. */
function workspaceNamed(graph: Graph, name: string): TargetResolution {
  const paths = graph.names.get(name);
  return paths === undefined
    ? {
        ok: false,
        kind: UNCERTAINTY.unresolvedLocalDependency,
        cause: `uses the workspace protocol for ${name}, which names no listed package workspace`,
      }
    : { ok: true, paths };
}

function resolvePathTarget(
  graph: Graph,
  path: string,
  base: string,
): TargetResolution {
  const holders = path.startsWith(HOME_PATH_PREFIX)
    ? []
    : holdersOf(graph, resolve(base, path));
  return holders.length === 0
    ? {
        ok: false,
        kind: UNCERTAINTY.unresolvedLocalDependency,
        cause: `points to ${path}, which lies in no listed package workspace`,
      }
    : { ok: true, paths: holders };
}

export function unlistedWhileIncomplete(what: string): Unresolved {
  return {
    ok: false,
    kind: UNCERTAINTY.unlistedPackage,
    cause: `${what}, which no listed package workspace is named, while the package workspace listing is incomplete or a listed workspace's name could not be read`,
  };
}

export function edge(
  graph: Graph,
  dependent: string,
  dependency: string,
  producer: EdgeProducerKind,
  detail: string,
): void {
  if (dependent === dependency) return;
  graph.edges.push({ dependent, dependency, producer, detail });
}

export function uncertain(
  graph: Graph,
  dependent: string,
  kind: UncertaintyKind,
  cause: string,
): void {
  graph.uncertainties.push({ dependent, kind, cause });
}
