import { isAbsolute, normalize, posix, resolve, sep } from "node:path";
import type { TestIdentity } from "@rt-test/core";
import {
  POSIX_SEPARATOR,
  realPath,
  type VitestWorkspace,
} from "../vitest/find-workspaces.js";
import {
  edge,
  holdersOf,
  normalizeRelativePath,
  owningWorkspace,
  uncertain,
  unlistedWhileIncomplete,
  type Graph,
  type TargetResolution,
} from "./graph-state.js";
import { isLocalPath } from "./package-specs.js";
import {
  EDGE_PRODUCER,
  UNCERTAINTY,
  type ResolvedAlias,
  type SelectableWorkspace,
} from "./selection-types.js";

const REPLACEMENT_REFERENCE = /\$(?:\d|&|<|`|')/;
const WINDOWS_PLATFORM = "win32";

export function addVitestEdges(
  graph: Graph,
  selectable: SelectableWorkspace,
): void {
  const { workspace, tests } = selectable;
  if (tests.known) {
    addTestModuleEdges(graph, workspace, tests.tests);
  } else {
    uncertain(
      graph,
      workspace.path,
      UNCERTAINTY.testsNotKnown,
      `the tests of Vitest workspace ${workspace.path} are not known, so its test modules may lie in any package workspace: ${tests.reason}`,
    );
  }
  for (const file of selectable.setupFiles) {
    addSetupEdge(graph, workspace.path, file, `setup file ${file}`);
  }
  for (const file of selectable.globalSetupFiles) {
    addSetupEdge(graph, workspace.path, file, `global setup file ${file}`);
  }
  for (const alias of selectable.aliases) {
    addAliasEdges(graph, workspace.path, alias);
  }
}

/**
 * A module path is relative to the workspace's real directory, as discovery records it. Modules sharing a
 * directory share its holder, so each directory is resolved once and each holder quotes its first module.
 */
function addTestModuleEdges(
  graph: Graph,
  workspace: VitestWorkspace,
  tests: readonly TestIdentity[],
): void {
  const real = realPath(workspace.directory);
  const base = real.ok ? real.path : workspace.directory;
  const firstModuleByDirectory = new Map<string, string>();
  for (const { modulePath } of tests) {
    const directory = posix.dirname(modulePath);
    if (!firstModuleByDirectory.has(directory)) {
      firstModuleByDirectory.set(directory, modulePath);
    }
  }
  const quoted = new Set<string>();
  for (const [directory, modulePath] of firstModuleByDirectory) {
    for (const holder of holdersOf(graph, resolve(base, directory))) {
      if (quoted.has(holder)) continue;
      quoted.add(holder);
      edge(
        graph,
        workspace.path,
        holder,
        EDGE_PRODUCER.testModule,
        `test module ${modulePath}`,
      );
    }
  }
}

function addSetupEdge(
  graph: Graph,
  dependent: string,
  file: string,
  detail: string,
): void {
  const owner = owningWorkspace(normalizeRelativePath(file), graph.workspaces);
  if (owner === undefined) return;
  edge(graph, dependent, owner.path, EDGE_PRODUCER.setupFile, detail);
}

function addAliasEdges(
  graph: Graph,
  dependent: string,
  alias: ResolvedAlias,
): void {
  const detail = `config alias ${JSON.stringify(alias.find)} to ${JSON.stringify(alias.replacement)}`;
  const reference = alias.replacement.search(REPLACEMENT_REFERENCE);
  const prefix =
    reference === -1
      ? alias.replacement
      : alias.replacement.slice(0, reference);
  const resolution = aliasResolution(graph, prefix);
  if (!resolution.ok) {
    uncertain(
      graph,
      dependent,
      resolution.kind,
      `${detail} ${resolution.cause}`,
    );
    return;
  }
  for (const dependency of resolution.paths) {
    edge(graph, dependent, dependency, EDGE_PRODUCER.alias, detail);
  }
}

/**
 * An alias replaces only the part of an import it matched and keeps the rest, and a replacement reference
 * inserts more of the import, so it reaches every workspace whose path or name its fixed prefix begins.
 */
function aliasResolution(graph: Graph, prefix: string): TargetResolution {
  if (isAbsolute(prefix)) {
    return { ok: true, paths: aliasPathTargets(graph, prefix) };
  }
  if (prefix === "" || isLocalPath(prefix)) {
    return {
      ok: false,
      kind: UNCERTAINTY.unresolvableAlias,
      cause: "is neither an absolute path nor a bare package name",
    };
  }
  const paths = namesBegunBy(graph, prefix);
  if (paths.length === 0 && !graph.namesComplete) {
    return unlistedWhileIncomplete(`names ${prefix}`);
  }
  return { ok: true, paths };
}

function namesBegunBy(graph: Graph, prefix: string): string[] {
  return [...graph.names]
    .filter(
      ([name]) =>
        name.startsWith(prefix) ||
        prefix.startsWith(`${name}${POSIX_SEPARATOR}`),
    )
    .flatMap(([, workspaces]) => workspaces);
}

function aliasPathTargets(graph: Graph, prefix: string): string[] {
  const paths = holdersOf(graph, resolve(prefix));
  const comparablePrefix = comparable(normalize(prefix));
  for (const { path, directories } of graph.holders) {
    const begun = directories.some((directory) =>
      comparable(directory).startsWith(comparablePrefix),
    );
    if (begun && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

/** `/`-separated, and lower-cased where the file system ignores case, as `path.relative` compares on Windows. */
function comparable(path: string): string {
  const posixPath = path.split(sep).join(POSIX_SEPARATOR);
  return process.platform === WINDOWS_PLATFORM
    ? posixPath.toLowerCase()
    : posixPath;
}
