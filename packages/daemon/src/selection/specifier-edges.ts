import { posix, resolve, win32 } from "node:path";
import {
  climbsOut,
  liesInside,
  POSIX_SEPARATOR,
  realPath,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";
import {
  edge,
  holdersOf,
  uncertain,
  unlistedWhileIncomplete,
  type Graph,
} from "./graph-state.js";
import type { readJsonc } from "./jsonc.js";
import { SPECIFIER_FORM, type FoundSpecifier } from "./source-imports.js";
import { EDGE_PRODUCER, type EdgeProducerKind } from "./selection-types.js";

const URL_SCHEME = /^[A-Za-z][A-Za-z\d+.-]+:/;
const SUBPATH_IMPORT_PREFIX = "#";
const QUERY_PREFIX = "?";
const HASH_PREFIX = "#";
const SCOPE_PREFIX = "@";
const SCOPED_NAME_SEGMENTS = 2;
/** A backslash prefix is relative to CommonJS `require` on Windows. */
const RELATIVE_PREFIXES = ["./", "../", ".\\", "..\\"];
const RELATIVE_NAMES = [".", ".."];
const GLOB_SYNTAX = /[*?[\]{}()]/;
const CURRENT_DIRECTORY = ".";
const KEY_SEPARATOR = "\0";

/** Told which file the parser is reading, so a process the parser ends can still name it. */
export interface ParseObserver {
  /** The file's root-relative label, just before its parse starts. */
  parsing(label: string): void;
  /** Its parse returned. */
  parsed(): void;
}

/**
 * One scan of the consumer: the graph it adds to, the records already added, the consumer root as listed and
 * as resolved, the workspaces holding each absolute path already resolved, each config an `extends` chain
 * reached, read once by its real path, and who is told of each parse.
 */
export interface Scan {
  readonly graph: Graph;
  readonly added: Set<string>;
  readonly roots: readonly string[];
  readonly holders: Map<string, readonly string[]>;
  readonly extendedConfigs: Map<string, ReturnType<typeof readJsonc>>;
  readonly observer: ParseObserver | undefined;
}

/** Where a specifier was found: the workspace it makes a dependent, the directory it resolves against, and its quote. */
export interface Reference {
  readonly dependent: string;
  readonly base: string;
  readonly detail: string;
}

export function newScan(
  graph: Graph,
  root: string,
  observer: ParseObserver | undefined,
): Scan {
  const real = realPath(root);
  const roots = real.ok && real.path !== root ? [root, real.path] : [root];
  return {
    graph,
    added: new Set(),
    roots,
    holders: new Map(),
    extendedConfigs: new Map(),
    observer,
  };
}

/** Runs one read that parses the file `label` names, with the scan's observer told of it before and after. */
export function observedParse<T>(scan: Scan, label: string, read: () => T): T {
  scan.observer?.parsing(label);
  try {
    return read();
  } finally {
    scan.observer?.parsed();
  }
}

/**
 * Root-relative and `/`-separated, as every detail and cause quotes a path. A real path is relative to the
 * root's real path, which a link or a short name can spell differently from the listed root.
 */
export function rootLabel(scan: Scan, path: string): string {
  const labels = scan.roots.map((root) => relativePosixPath(root, path));
  const label =
    labels.find((candidate) => !climbsOut(candidate, POSIX_SEPARATOR)) ??
    labels[0] ??
    path;
  return label === "" ? ROOT_PATH : label;
}

/**
 * A relative or absolute specifier depends on the workspace it resolves into, a bare one on the workspace its
 * package name names; a URL scheme or a subpath import names no workspace.
 */
export function addSpecifierEdges(
  scan: Scan,
  reference: Reference,
  { text, form }: FoundSpecifier,
): void {
  if (text === "" || URL_SCHEME.test(text)) return;
  const producer = EDGE_PRODUCER.relativeImport;
  if (form === SPECIFIER_FORM.fileRelative) {
    addPathEdges(scan, reference, withoutSuffix(text), producer);
  } else if (isBare(text)) {
    const specifier = form === SPECIFIER_FORM.glob ? text : withoutSuffix(text);
    addPackageEdges(scan, reference, specifier, EDGE_PRODUCER.bareImport);
  } else if (text.startsWith(SUBPATH_IMPORT_PREFIX)) {
    return;
  } else if (form === SPECIFIER_FORM.glob) {
    addPatternEdges(scan, reference, text, producer);
  } else {
    addPathEdges(scan, reference, withoutSuffix(text), producer);
  }
}

/** A package name and its subpath: not relative, not absolute, no URL scheme and no subpath import. */
export function isBare(text: string): boolean {
  return (
    text !== "" &&
    !URL_SCHEME.test(text) &&
    !text.startsWith(SUBPATH_IMPORT_PREFIX) &&
    !isRelative(text) &&
    !isAbsolutePath(text)
  );
}

export function isRelative(text: string): boolean {
  return (
    RELATIVE_NAMES.includes(text) ||
    RELATIVE_PREFIXES.some((prefix) => text.startsWith(prefix))
  );
}

export function isAbsolutePath(text: string): boolean {
  return posix.isAbsolute(text) || win32.isAbsolute(text);
}

/** A query or hash suffix selects a variant of the same file. */
function withoutSuffix(text: string): string {
  const query = text.indexOf(QUERY_PREFIX);
  const hash = text.indexOf(HASH_PREFIX);
  const ends = [query, hash].filter((index) => index !== -1);
  return ends.length === 0 ? text : text.slice(0, Math.min(...ends));
}

/** The workspaces holding `path`, resolved against the reference's base; a path outside the consumer root adds none. */
export function addPathEdges(
  scan: Scan,
  reference: Reference,
  path: string,
  producer: EdgeProducerKind,
): void {
  const absolute = resolve(reference.base, path);
  let holders = scan.holders.get(absolute);
  if (holders === undefined) {
    holders = holdersOf(scan.graph, absolute);
    scan.holders.set(absolute, holders);
  }
  for (const holder of holders) addEdge(scan, reference, holder, producer);
}

/**
 * A pattern reaches the workspace owning the directory before its first wildcard and every workspace nested
 * under that directory; a pattern with no wildcard is a path.
 */
export function addPatternEdges(
  scan: Scan,
  reference: Reference,
  pattern: string,
  producer: EdgeProducerKind,
): void {
  const wildcard = pattern.search(GLOB_SYNTAX);
  if (wildcard === -1) {
    addPathEdges(scan, reference, pattern, producer);
    return;
  }
  const beforeWildcard = pattern.slice(0, wildcard);
  const separator = beforeWildcard.lastIndexOf(POSIX_SEPARATOR);
  const directory = resolve(
    reference.base,
    separator === -1
      ? CURRENT_DIRECTORY
      : beforeWildcard.slice(0, separator + 1),
  );
  const reached = new Set([
    ...holdersOf(scan.graph, directory),
    ...workspacesUnder(scan.graph, directory),
  ]);
  for (const dependency of reached) {
    addEdge(scan, reference, dependency, producer);
  }
}

function workspacesUnder(graph: Graph, directory: string): string[] {
  const real = realPath(directory);
  const roots = real.ok ? [directory, real.path] : [directory];
  return graph.holders
    .filter(({ directories }) =>
      directories.some((held) => roots.some((root) => liesInside(root, held))),
    )
    .map(({ path }) => path);
}

/**
 * The workspaces named by a specifier's package name. While the listing is incomplete, a name no listed
 * workspace has may be one it missed, so the dependent depends on every workspace.
 */
export function addPackageEdges(
  scan: Scan,
  reference: Reference,
  specifier: string,
  producer: EdgeProducerKind,
): void {
  const name = packageName(specifier);
  const named = scan.graph.names.get(name) ?? [];
  for (const dependency of named) {
    addEdge(scan, reference, dependency, producer);
  }
  if (named.length > 0 || scan.graph.namesComplete) return;
  const key = [reference.dependent, name].join(KEY_SEPARATOR);
  if (!once(scan, key)) return;
  const unlisted = unlistedWhileIncomplete(`names ${name}`);
  uncertain(
    scan.graph,
    reference.dependent,
    unlisted.kind,
    `${reference.detail} ${unlisted.cause}`,
  );
}

/** `@scope/name/sub` is `@scope/name`; `name/sub` is `name`. */
function packageName(specifier: string): string {
  const segments = specifier.split(POSIX_SEPARATOR);
  const count = specifier.startsWith(SCOPE_PREFIX) ? SCOPED_NAME_SEGMENTS : 1;
  return segments.slice(0, count).join(POSIX_SEPARATOR);
}

/** Each dependency pair keeps the first quote that produced it through a given producer. */
function addEdge(
  scan: Scan,
  reference: Reference,
  dependency: string,
  producer: EdgeProducerKind,
): void {
  const key = [reference.dependent, dependency, producer].join(KEY_SEPARATOR);
  if (!once(scan, key)) return;
  edge(scan.graph, reference.dependent, dependency, producer, reference.detail);
}

function once(scan: Scan, key: string): boolean {
  if (scan.added.has(key)) return false;
  scan.added.add(key);
  return true;
}
