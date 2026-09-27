import {
  lstatSync,
  opendirSync,
  statSync,
  type Dir,
  type Dirent,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { errorText } from "../vitest/error-text.js";
import type { IgnoredPaths } from "./git-ignored.js";
import { UNCERTAINTY, type UncertaintyKind } from "./selection-types.js";

/** Directory levels below the workspace directory the walk descends before it stops and widens. */
export const MAX_WALK_DEPTH = 40;
/** Files and directories one workspace's walk visits before it stops and widens. */
export const MAX_WALKED_ENTRIES = 50_000;

const SOURCE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".mts",
  ".cts",
  ".tsx",
];
const PLUGIN_FORMAT_EXTENSIONS = [".vue", ".svelte", ".astro", ".mdx"];
const GIT_DIRECTORY = ".git";
/** Directory names no walk enters, wherever they lie. */
export const SKIPPED_DIRECTORIES = ["node_modules", GIT_DIRECTORY];
export const CONFIG_FILE_NAME = /^(?:ts|js)config.*\.json$/;

export interface WalkUncertainty {
  readonly kind: UncertaintyKind;
  readonly cause: string;
}

/** What one workspace's directory holds, as absolute paths in walk order. */
export interface WalkedFiles {
  readonly sources: readonly string[];
  readonly configs: readonly string[];
  /** Links met in the walk, never followed as directories. */
  readonly links: readonly string[];
  readonly uncertainties: readonly WalkUncertainty[];
}

interface Pending {
  readonly directory: string;
  readonly depth: number;
}

interface Walk {
  readonly skipped: ReadonlySet<string>;
  readonly ignored: IgnoredPaths;
  readonly label: (path: string) => string;
  readonly pending: Pending[];
  readonly sources: string[];
  readonly configs: string[];
  readonly links: string[];
  readonly uncertainties: WalkUncertainty[];
  visited: number;
}

/**
 * Lists a workspace directory breadth-first without following a directory link, skipping `skipped`
 * (the directories of the package workspaces nested in it), the paths git reports as `ignored`,
 * `node_modules` and `.git`. `label` names a path in an uncertainty's cause.
 */
export function walkWorkspace(
  directory: string,
  skipped: readonly string[],
  ignored: IgnoredPaths,
  label: (path: string) => string,
): WalkedFiles {
  const walk: Walk = {
    skipped: new Set(skipped.map((path) => resolve(path))),
    ignored,
    label,
    pending: [{ directory: resolve(directory), depth: 0 }],
    sources: [],
    configs: [],
    links: [],
    uncertainties: [],
    visited: 0,
  };
  for (const next of walk.pending) {
    if (!walkDirectory(walk, next)) {
      walk.uncertainties.push({
        kind: UNCERTAINTY.walkBoundReached,
        cause: `${label(directory)} holds more than ${MAX_WALKED_ENTRIES} files and directories outside node_modules, .git, gitignored paths and nested package workspaces, so its imports were not all read`,
      });
      break;
    }
  }
  const { sources, configs, links, uncertainties } = walk;
  return { sources, configs, links, uncertainties };
}

/** False once the walk has visited more entries than its limit. */
function walkDirectory(walk: Walk, { directory, depth }: Pending): boolean {
  if (holdsRepository(directory)) walk.ignored.addRepository(directory);
  const listing = listEntries(
    directory,
    (entry) => !isSkipped(walk, join(directory, entry.name), entry.name),
    MAX_WALKED_ENTRIES - walk.visited,
  );
  if (!listing.ok) {
    walk.uncertainties.push({
      kind: UNCERTAINTY.unreadableSource,
      cause: `directory ${walk.label(directory)} cannot be listed, so its imports are not known: ${listing.reason}`,
    });
    return true;
  }
  for (const entry of listing.entries) {
    walk.visited += 1;
    if (walk.visited > MAX_WALKED_ENTRIES) return false;
    visitEntry(walk, join(directory, entry.name), entry, depth);
  }
  return true;
}

function isSkipped(walk: Walk, path: string, name: string): boolean {
  return (
    walk.skipped.has(path) ||
    walk.ignored.has(path) ||
    SKIPPED_DIRECTORIES.includes(name)
  );
}

/** A nested repository or a submodule, whose ignored paths the consumer root's git listing does not reach. */
export function holdsRepository(directory: string): boolean {
  try {
    return (
      lstatSync(join(directory, GIT_DIRECTORY), { throwIfNoEntry: false }) !==
      undefined
    );
  } catch {
    return false;
  }
}

function visitEntry(
  walk: Walk,
  path: string,
  entry: Dirent,
  depth: number,
): void {
  if (entry.isSymbolicLink()) {
    walk.links.push(path);
    if (isFile(path)) classifyFile(walk, path, entry.name);
    return;
  }
  if (entry.isDirectory()) {
    if (depth + 1 > MAX_WALK_DEPTH) {
      walk.uncertainties.push({
        kind: UNCERTAINTY.walkBoundReached,
        cause: `directory ${walk.label(path)} lies more than ${MAX_WALK_DEPTH} levels below its package workspace, so its imports were not read`,
      });
      return;
    }
    walk.pending.push({ directory: path, depth: depth + 1 });
    return;
  }
  if (entry.isFile()) classifyFile(walk, path, entry.name);
}

function classifyFile(walk: Walk, path: string, name: string): void {
  const extension = extname(name);
  if (SOURCE_EXTENSIONS.includes(extension)) {
    walk.sources.push(path);
  } else if (CONFIG_FILE_NAME.test(name)) {
    walk.configs.push(path);
  } else if (PLUGIN_FORMAT_EXTENSIONS.includes(extension)) {
    walk.uncertainties.push({
      kind: UNCERTAINTY.pluginFormatFile,
      cause: `${walk.label(path)} is a ${extension} file the parser cannot read, so its imports are not known`,
    });
  }
}

/** A path that cannot be checked is not a file: a link to it reports its target, and an `extends` through it widens. */
export function isFile(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

/**
 * The entries `keep` accepts, in name order. Reading stops once more than `limit` are kept, so a directory
 * past the walk's remaining budget is never held whole.
 */
function listEntries(
  directory: string,
  keep: (entry: Dirent) => boolean,
  limit: number,
): { ok: true; entries: Dirent[] } | { ok: false; reason: string } {
  let opened: Dir | undefined;
  try {
    opened = opendirSync(directory);
    const entries: Dirent[] = [];
    for (
      let entry = opened.readSync();
      entry !== null && entries.length <= limit;
      entry = opened.readSync()
    ) {
      if (keep(entry)) entries.push(entry);
    }
    entries.sort((left, right) => (left.name < right.name ? -1 : 1));
    return { ok: true, entries };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  } finally {
    opened?.closeSync();
  }
}
