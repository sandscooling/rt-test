import { isAbsolute, join, posix, resolve, sep } from "node:path";
import type { TestIdentity } from "@rt-test/core";
import {
  POSIX_SEPARATOR,
  realPath,
  type VitestWorkspace,
} from "../vitest/find-workspaces.js";
import {
  REGEXP_FIND,
  STRING_FIND,
  type ReportedAlias,
} from "../vitest/selection-facts.js";
import {
  edge,
  holdersOf,
  normalizeRelativePath,
  owningWorkspace,
  uncertain,
  unlistedWhileIncomplete,
  type Graph,
  type TargetResolution,
  type Unresolved,
} from "./graph-state.js";
import { isLocalPath } from "./package-specs.js";
import {
  EDGE_PRODUCER,
  UNCERTAINTY,
  type SelectableWorkspace,
  type SelectionAlias,
} from "./selection-types.js";

const REPLACEMENT_REFERENCE = /\$(?:\d|&|<|`|'|\$)/;
/** A trailing separator ends a directory name, so the prefix must not also begin a longer sibling name. */
const ENDS_IN_SEPARATOR = /[/\\]$/;
const WINDOWS_PLATFORM = "win32";
const ROOT_FIND = "/";
/** A consumer's own empty find, or what Vite makes of a `/` find whose replacement ends in `/`. */
const EMPTY_FIND = "";
/** Vite reads the rest of an import beginning with it as a file-system path, as its own client aliases use. */
const VITE_FS_PREFIX = "/@fs/";
const VOLUME_PATH = /^[A-Z]:/i;
/** A drive letter, or a drive with no path yet, which a replacement reference can complete to any path on it. */
const PARTIAL_VOLUME = /^[A-Z]:?$/i;
/** Begins every other id Vite serves specially, such as `/@id/`. */
const VITE_SPECIAL_PREFIX = "/@";
const SCHEME_RELATIVE_PREFIX = "//";
const START_ANCHOR = "^";
/** `m` lets `^` match after a line break, and `y` starts a match where the last one ended. */
const MOVED_START_FLAGS = /[my]/;
/** Lets a character class nest another. */
const CLASS_SET_FLAG = "v";
const ESCAPE = "\\";
const CLASS_OPEN = "[";
const CLASS_CLOSE = "]";
const GROUP_OPEN = "(";
const GROUP_CLOSE = ")";
const ALTERNATION = "|";

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
  alias: SelectionAlias,
): void {
  const detail = `config alias ${quotedFind(alias)} to ${JSON.stringify(alias.replacement)}`;
  const unbounded = unboundedAliasCause(alias);
  if (unbounded !== undefined) {
    uncertain(
      graph,
      dependent,
      UNCERTAINTY.unresolvableAlias,
      `${detail} ${unbounded}`,
    );
    return;
  }
  const reference = alias.replacement.search(REPLACEMENT_REFERENCE);
  const prefix =
    reference === -1
      ? alias.replacement
      : alias.replacement.slice(0, reference);
  const resolution = aliasResolution(graph, prefix, alias.viteRoot);
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

/** A RegExp find as a regular expression literal, so it never reads like a string find of the same text. */
function quotedFind(alias: ReportedAlias): string {
  return alias.findKind === REGEXP_FIND
    ? `/${alias.find}/${alias.flags}`
    : JSON.stringify(alias.find);
}

/** Why the alias's find or resolver defeats analysis by its replacement's prefix, or undefined when neither does. */
function unboundedAliasCause(alias: ReportedAlias): string | undefined {
  if (alias.hasCustomResolver) {
    return "has a customResolver, which picks the module after the replacement";
  }
  if (alias.findKind !== STRING_FIND) {
    return anchoredAtStart(alias.find, alias.flags)
      ? undefined
      : "has a RegExp find that can match after the import's start, which keeps the import's text before the match";
  }
  if (alias.find === EMPTY_FIND) {
    return "has an empty find, which rewrites every import that begins with /";
  }
  if (alias.find === ROOT_FIND) {
    return "maps /, which Vite warns against, and rewrites / and every import that begins with //";
  }
  return undefined;
}

/**
 * Every match of the RegExp begins at the import's start: its source opens with `^`, no top-level alternative
 * can match elsewhere, and no flag moves where `^` or a match may start.
 */
function anchoredAtStart(source: string, flags: string): boolean {
  if (!source.startsWith(START_ANCHOR) || MOVED_START_FLAGS.test(flags)) {
    return false;
  }
  return !hasTopLevelAlternative(source, flags.includes(CLASS_SET_FLAG));
}

function hasTopLevelAlternative(
  source: string,
  nestedClasses: boolean,
): boolean {
  let groupDepth = 0;
  let classDepth = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source.charAt(index);
    if (character === ESCAPE) {
      index++;
    } else if (classDepth > 0) {
      classDepth += classDepthChange(character, nestedClasses);
    } else if (character === ALTERNATION && groupDepth === 0) {
      return true;
    } else {
      classDepth = character === CLASS_OPEN ? 1 : 0;
      groupDepth += groupDepthChange(character);
    }
  }
  return false;
}

function classDepthChange(character: string, nestedClasses: boolean): number {
  if (character === CLASS_CLOSE) return -1;
  return nestedClasses && character === CLASS_OPEN ? 1 : 0;
}

function groupDepthChange(character: string): number {
  if (character === GROUP_OPEN) return 1;
  return character === GROUP_CLOSE ? -1 : 0;
}

/**
 * An alias replaces only the part of an import it matched and keeps the rest, and a replacement reference
 * inserts more of the import, so it reaches every workspace whose path or name its fixed prefix begins.
 */
function aliasResolution(
  graph: Graph,
  prefix: string,
  viteRoot: string,
): TargetResolution {
  if (prefix.startsWith(POSIX_SEPARATOR)) {
    return rootAbsoluteResolution(graph, prefix, viteRoot);
  }
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

/** Vite resolves an import beginning with `/` under its root first, and then as a file-system path. */
function rootAbsoluteResolution(
  graph: Graph,
  prefix: string,
  viteRoot: string,
): TargetResolution {
  if (prefix.startsWith(VITE_FS_PREFIX)) {
    return viteFsResolution(graph, prefix.slice(VITE_FS_PREFIX.length));
  }
  if (prefix === POSIX_SEPARATOR) return unboundedPath(prefix);
  if (
    prefix.startsWith(SCHEME_RELATIVE_PREFIX) ||
    prefix.startsWith(VITE_SPECIAL_PREFIX)
  ) {
    return {
      ok: false,
      kind: UNCERTAINTY.unresolvableAlias,
      cause: `begins with ${prefix}, which Vite may read as a URL or an id it serves specially rather than a path under its root`,
    };
  }
  const paths = aliasPathTargets(graph, join(viteRoot, prefix));
  for (const path of aliasPathTargets(graph, prefix)) {
    if (!paths.includes(path)) paths.push(path);
  }
  return { ok: true, paths };
}

function viteFsResolution(graph: Graph, rest: string): TargetResolution {
  if (rest === "" || PARTIAL_VOLUME.test(rest)) {
    return unboundedPath(`${VITE_FS_PREFIX}${rest}`);
  }
  return { ok: true, paths: aliasPathTargets(graph, viteFsPath(rest)) };
}

function unboundedPath(prefix: string): Unresolved {
  return {
    ok: false,
    kind: UNCERTAINTY.unresolvableAlias,
    cause: `fixes only ${prefix} before the rest of the import, which can then name any file`,
  };
}

/** What follows `/@fs/` is absolute already when it names a volume, and otherwise lost its leading `/`. */
function viteFsPath(rest: string): string {
  return rest.startsWith(POSIX_SEPARATOR) || VOLUME_PATH.test(rest)
    ? rest
    : `${POSIX_SEPARATOR}${rest}`;
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

/** The prefix is matched as resolved, so a path without a Windows drive gains the one `resolve` gives it. */
function aliasPathTargets(graph: Graph, prefix: string): string[] {
  const resolved = resolve(prefix);
  const paths = holdersOf(graph, resolved);
  const comparablePrefix = comparable(
    ENDS_IN_SEPARATOR.test(prefix) && !resolved.endsWith(sep)
      ? `${resolved}${sep}`
      : resolved,
  );
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
