import { readlinkSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { errorText } from "../vitest/error-text.js";
import {
  joinPath,
  liesInside,
  objectField,
  PACKAGE_JSON,
  readJson,
  realPath,
  ROOT_PATH,
  type PackageWorkspace,
  type WorkspaceListing,
} from "../vitest/find-workspaces.js";
import { isRecord } from "../json-guards.js";
import {
  edge,
  resolveTarget,
  uncertain,
  unlistedWhileIncomplete,
  holderDirectories,
  type Graph,
  type TargetResolution,
  type Unresolved,
} from "./graph-state.js";
import {
  overrideKeyPackage,
  parseSpec,
  type SpecTarget,
} from "./package-specs.js";
import {
  EDGE_PRODUCER,
  UNCERTAINTY,
  type DependencyInformation,
  type SelectableWorkspace,
  type UncertaintyKind,
} from "./selection-types.js";
import {
  addAliasedSpecifierEdges,
  scanAliases,
  type ScanAlias,
} from "./alias-specifiers.js";
import { ignoredPathsReader, type IgnoredPaths } from "./git-ignored.js";
import { readSourceImports } from "./source-imports.js";
import { walkWorkspace } from "./source-walk.js";
import {
  addPathEdges,
  addSpecifierEdges,
  newScan,
  observedParse,
  rootLabel,
  type ParseObserver,
  type Scan,
} from "./specifier-edges.js";
import { addManifestImportsEdges, addTsconfigEdges } from "./tsconfig-edges.js";
import { addVitestEdges } from "./vitest-edges.js";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const OVERRIDE_FIELDS = [["overrides"], ["resolutions"], ["pnpm", "overrides"]];
const OVERRIDE_FIELD_SEPARATOR = ".";
const NAME_FIELD = "name";
const OVERRIDE_SELF_KEY = ".";

type ManifestRead =
  | { readonly ok: true; readonly manifest: Record<string, unknown> }
  | Unresolved;

interface ReadManifest {
  readonly workspace: PackageWorkspace;
  readonly read: ManifestRead;
}

interface OverrideEntry {
  readonly label: string;
  readonly key: string;
  readonly value: unknown;
}

/** Reads and parses the consumer's manifests, sources and tsconfig files only: no config or project module is loaded or run. */
export function buildDependencyInformation(
  listing: WorkspaceListing,
  vitestWorkspaces: readonly SelectableWorkspace[],
  observer?: ParseObserver,
): DependencyInformation {
  const manifests = listing.workspaces.map((workspace) => ({
    workspace,
    read: readManifest(workspace),
  }));
  const graph: Graph = {
    workspaces: listing.workspaces,
    namesComplete:
      listing.notRead.length === 0 &&
      manifests.every(
        ({ read }) => read.ok || read.kind === UNCERTAINTY.manifestMissing,
      ),
    names: packageNames(manifests),
    holders: listing.workspaces.map(holderDirectories),
    edges: [],
    uncertainties: [],
  };
  for (const { workspace, read } of manifests) {
    if (read.ok) addDependencyEdges(graph, workspace, read.manifest);
    else uncertain(graph, workspace.path, read.kind, read.cause);
  }
  const root = manifests.find(({ workspace }) => workspace.path === ROOT_PATH);
  if (root?.read.ok === true) {
    addOverrideEdges(graph, root.workspace, root.read.manifest);
  }
  const aliases = scanAliases(graph, vitestWorkspaces);
  addUndeclaredEdges(graph, manifests, aliases, observer);
  for (const workspace of vitestWorkspaces) addVitestEdges(graph, workspace);
  return {
    packageWorkspaces: listing.workspaces,
    notRead: listing.notRead,
    withoutManifest: manifests
      .filter(
        ({ read }) => !read.ok && read.kind === UNCERTAINTY.manifestMissing,
      )
      .map(({ workspace }) => workspace.path),
    edges: graph.edges,
    uncertainties: graph.uncertainties,
  };
}

function readManifest(workspace: PackageWorkspace): ManifestRead {
  const manifestPath = joinPath(workspace.path, PACKAGE_JSON);
  const file = join(workspace.directory, PACKAGE_JSON);
  const unknownBecause = (
    kind: UncertaintyKind,
    reason: string,
  ): Unresolved => ({
    ok: false,
    kind,
    cause: `${manifestPath} ${reason}, so the workspace's dependencies are not known`,
  });
  if (isAbsent(file)) {
    return unknownBecause(UNCERTAINTY.manifestMissing, "does not exist");
  }
  const read = readJson(file);
  if (!read.ok) {
    return unknownBecause(UNCERTAINTY.manifestUnreadable, read.reason);
  }
  return isRecord(read.value)
    ? { ok: true, manifest: read.value }
    : unknownBecause(UNCERTAINTY.manifestUnreadable, "is not a JSON object");
}

/** A file that cannot be checked is not absent: reading it then fails as unreadable. */
function isAbsent(file: string): boolean {
  try {
    return statSync(file, { throwIfNoEntry: false }) === undefined;
  } catch {
    return false;
  }
}

function packageNames(
  manifests: readonly ReadManifest[],
): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const { workspace, read } of manifests) {
    if (!read.ok) continue;
    const name = read.manifest[NAME_FIELD];
    if (typeof name !== "string") continue;
    names.set(name, [...(names.get(name) ?? []), workspace.path]);
  }
  return names;
}

function addDependencyEdges(
  graph: Graph,
  workspace: PackageWorkspace,
  manifest: Record<string, unknown>,
): void {
  const manifestPath = joinPath(workspace.path, PACKAGE_JSON);
  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (entries === undefined) continue;
    if (!isRecord(entries)) {
      uncertain(
        graph,
        workspace.path,
        UNCERTAINTY.manifestUnreadable,
        `${manifestPath} ${field} is not an object, so the workspace's dependencies are not known`,
      );
      continue;
    }
    for (const [key, spec] of Object.entries(entries)) {
      const detail = `${manifestPath} ${field} ${JSON.stringify(key)}: ${JSON.stringify(spec)}`;
      addDependency(graph, workspace, { key, spec, detail });
    }
  }
}

function addDependency(
  graph: Graph,
  workspace: PackageWorkspace,
  entry: { key: string; spec: unknown; detail: string },
): void {
  const dependent = workspace.path;
  const byKey = graph.names.get(entry.key) ?? [];
  for (const dependency of byKey) {
    edge(graph, dependent, dependency, EDGE_PRODUCER.manifest, entry.detail);
  }
  const resolution =
    typeof entry.spec === "string"
      ? resolveTarget(
          graph,
          parseSpec(entry.spec),
          entry.key,
          workspace.directory,
        )
      : notAString();
  if (!resolution.ok) {
    uncertain(
      graph,
      dependent,
      resolution.kind,
      `${entry.detail} ${resolution.cause}`,
    );
    return;
  }
  for (const dependency of resolution.paths) {
    if (byKey.includes(dependency)) continue;
    edge(graph, dependent, dependency, EDGE_PRODUCER.manifest, entry.detail);
  }
  const namesNoWorkspace = byKey.length === 0 && resolution.paths.length === 0;
  if (namesNoWorkspace && !graph.namesComplete) {
    const unlisted = unlistedWhileIncomplete(`names ${entry.key}`);
    uncertain(
      graph,
      dependent,
      unlisted.kind,
      `${entry.detail} ${unlisted.cause}`,
    );
  }
}

function notAString(): Unresolved {
  return {
    ok: false,
    kind: UNCERTAINTY.manifestUnreadable,
    cause: "is not a string",
  };
}

/** A root override or resolution can replace a package anywhere in the tree, so every package workspace takes its edge. */
function addOverrideEdges(
  graph: Graph,
  root: PackageWorkspace,
  manifest: Record<string, unknown>,
): void {
  for (const entry of overrideEntries(manifest)) {
    const detail = `${PACKAGE_JSON} ${entry.label}: ${JSON.stringify(entry.value)}`;
    for (const resolution of overrideResolutions(
      graph,
      root,
      manifest,
      entry,
    )) {
      if (resolution.ok) {
        everyWorkspaceDependsOn(graph, resolution.paths, detail);
      } else {
        everyWorkspaceUncertain(graph, resolution, detail);
      }
    }
  }
}

function everyWorkspaceDependsOn(
  graph: Graph,
  dependencies: readonly string[],
  detail: string,
): void {
  for (const dependency of dependencies) {
    for (const { path } of graph.workspaces) {
      edge(graph, path, dependency, EDGE_PRODUCER.override, detail);
    }
  }
}

function everyWorkspaceUncertain(
  graph: Graph,
  unresolved: Unresolved,
  detail: string,
): void {
  for (const { path } of graph.workspaces) {
    uncertain(graph, path, unresolved.kind, `${detail} ${unresolved.cause}`);
  }
}

/** Walks nested override objects by a queue; a parsed JSON value is a finite tree, so the walk ends. */
function overrideEntries(manifest: Record<string, unknown>): OverrideEntry[] {
  const pending: OverrideEntry[] = OVERRIDE_FIELDS.map((fieldPath) => ({
    label: fieldPath.join(OVERRIDE_FIELD_SEPARATOR),
    key: "",
    value: fieldPath.reduce<unknown>(objectField, manifest),
  })).filter(({ value }) => value !== undefined);
  const entries: OverrideEntry[] = [];
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    if (!isRecord(next.value)) {
      entries.push(next);
      continue;
    }
    for (const [key, value] of Object.entries(next.value)) {
      pending.push({
        label: `${next.label} ${JSON.stringify(key)}`,
        key: key === OVERRIDE_SELF_KEY ? next.key : key,
        value,
      });
    }
  }
  return entries;
}

function overrideResolutions(
  graph: Graph,
  root: PackageWorkspace,
  manifest: Record<string, unknown>,
  entry: OverrideEntry,
): TargetResolution[] {
  if (typeof entry.value !== "string") {
    return [
      unresolvedOverride("is neither a string nor an object of overrides"),
    ];
  }
  const target = parseSpec(entry.value);
  const specs =
    target.kind === "reference"
      ? rootDependencySpecs(manifest, target.name)
      : [entry.value];
  if (specs.length === 0) {
    return [
      unresolvedOverride(
        "references a root dependency the root package.json does not declare",
      ),
    ];
  }
  const keyPackage =
    target.kind === "reference" ? target.name : overrideKeyPackage(entry.key);
  return specs.map((spec) =>
    overrideResolution(graph, parseSpec(spec), keyPackage, root.directory),
  );
}

function overrideResolution(
  graph: Graph,
  target: SpecTarget,
  keyPackage: string,
  base: string,
): TargetResolution {
  const resolution = resolveTarget(graph, target, keyPackage, base);
  if (!resolution.ok) return unresolvedOverride(resolution.cause);
  const namesUnlisted =
    target.kind === "package" && resolution.paths.length === 0;
  return namesUnlisted && !graph.namesComplete
    ? unlistedWhileIncomplete(`names ${target.name}`)
    : resolution;
}

function unresolvedOverride(cause: string): Unresolved {
  return { ok: false, kind: UNCERTAINTY.unresolvedOverride, cause };
}

function rootDependencySpecs(
  manifest: Record<string, unknown>,
  name: string,
): string[] {
  return DEPENDENCY_FIELDS.map((field) =>
    objectField(manifest[field], name),
  ).filter((spec): spec is string => typeof spec === "string");
}

/**
 * The dependencies no `package.json` dependency field declares: imports, tsconfig fields, `imports` targets
 * and links, and the imports each Vitest workspace's aliases rewrite.
 */
function addUndeclaredEdges(
  graph: Graph,
  manifests: readonly ReadManifest[],
  aliases: readonly ScanAlias[],
  observer: ParseObserver | undefined,
): void {
  const [root] = graph.workspaces;
  if (root === undefined) return;
  const scan = newScan(graph, root.directory, observer);
  const ignored = ignoredPathsReader(root.directory);
  for (const { workspace, read } of manifests) {
    addWorkspaceSourceEdges(scan, workspace, ignored, aliases);
    if (read.ok) addManifestImportsEdges(scan, workspace, read.manifest);
  }
}

function addWorkspaceSourceEdges(
  scan: Scan,
  workspace: PackageWorkspace,
  ignored: IgnoredPaths,
  aliases: readonly ScanAlias[],
): void {
  const { graph } = scan;
  const directory = resolve(workspace.directory);
  const nested = graph.workspaces
    .filter(
      (other) =>
        other.path !== workspace.path &&
        liesInside(directory, resolve(other.directory)),
    )
    .map((other) => other.directory);
  const walked = walkWorkspace(directory, nested, ignored, (path) =>
    rootLabel(scan, path),
  );
  for (const { kind, cause } of walked.uncertainties) {
    uncertain(graph, workspace.path, kind, cause);
  }
  for (const link of walked.links) addLinkEdges(scan, workspace.path, link);
  for (const file of walked.sources) {
    addSourceFileEdges(scan, workspace.path, file, aliases);
  }
  for (const file of walked.configs) {
    addTsconfigEdges(scan, workspace.path, file);
  }
}

function addLinkEdges(scan: Scan, dependent: string, link: string): void {
  const label = rootLabel(scan, link);
  const target = linkTarget(link);
  if (!target.ok) {
    uncertain(
      scan.graph,
      dependent,
      UNCERTAINTY.unreadableSource,
      `link ${label} cannot be read, so what it links to is not known: ${target.reason}`,
    );
    return;
  }
  const reference = {
    dependent,
    base: dirname(link),
    detail: `link ${label} to ${rootLabel(scan, target.path)}`,
  };
  addPathEdges(scan, reference, target.path, EDGE_PRODUCER.link);
}

/** A link whose target does not exist is taken at the path its text names, where a target created later would lie. */
function linkTarget(
  link: string,
): { ok: true; path: string } | { ok: false; reason: string } {
  const real = realPath(link);
  if (real.ok) return real;
  try {
    return { ok: true, path: resolve(dirname(link), readlinkSync(link)) };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

/**
 * The label when the file's real path has the same one, since the inputs name a file by its real path: a file
 * reached through a link, or listed in another letter case, has no label the declaration can be asked about.
 */
function inputLabel(
  scan: Scan,
  label: string,
  realFile: string,
): string | undefined {
  return rootLabel(scan, realFile) === label ? label : undefined;
}

/** Relative specifiers resolve against the file's real directory, as Node and Vite resolve a linked file's imports. */
function addSourceFileEdges(
  scan: Scan,
  dependent: string,
  file: string,
  aliases: readonly ScanAlias[],
): void {
  const label = rootLabel(scan, file);
  const found = observedParse(scan, label, () => readSourceImports(file));
  const real = realPath(file);
  if (!found.ok) {
    uncertain(
      scan.graph,
      dependent,
      found.kind,
      `${label} ${found.reason}, so its imports are not known`,
      real.ok ? inputLabel(scan, label, real.path) : undefined,
    );
    return;
  }
  const base = dirname(real.ok ? real.path : file);
  for (const specifier of found.specifiers) {
    const detail = `${label} imports ${JSON.stringify(specifier.text)}`;
    addSpecifierEdges(scan, { dependent, base, detail }, specifier);
    addAliasedSpecifierEdges(scan, aliases, { base, label }, specifier);
  }
}
