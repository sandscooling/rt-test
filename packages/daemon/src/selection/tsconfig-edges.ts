import { dirname, join, resolve } from "node:path";
import {
  joinPath,
  objectField,
  PACKAGE_JSON,
  type PackageWorkspace,
} from "../vitest/find-workspaces.js";
import { isRecord, uncertain } from "./graph-state.js";
import { MAX_JSON_DEPTH, readJsonc } from "./jsonc.js";
import { isFile } from "./source-walk.js";
import {
  addPackageEdges,
  addPathEdges,
  addPatternEdges,
  isAbsolutePath,
  isBare,
  isRelative,
  rootLabel,
  type Reference,
  type Scan,
} from "./specifier-edges.js";
import { EDGE_PRODUCER, UNCERTAINTY } from "./selection-types.js";

/** Configs an `extends` chain may pass through while its `baseUrl` or `paths` is sought. */
const MAX_EXTENDS_DEPTH = 32;
const JSON_EXTENSION = ".json";
const NODE_MODULES = "node_modules";
const DEFAULT_TSCONFIG = "tsconfig.json";
const EXTENDS_FIELD = "extends";
const REFERENCES_FIELD = "references";
const REFERENCE_PATH_FIELD = "path";
const COMPILER_OPTIONS_FIELD = "compilerOptions";
const BASE_URL_FIELD = "baseUrl";
const PATHS_FIELD = "paths";
const IMPORTS_FIELD = "imports";

type Checked<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** The directory `paths` targets resolve against, or why the `extends` chain holding it could not be followed. */
type BaseDirectory =
  | { readonly ok: true; readonly directory: string | undefined }
  | { readonly ok: false; readonly reason: string };

/** Reads one tsconfig or jsconfig as JSONC; executes nothing it names. */
export function addTsconfigEdges(
  scan: Scan,
  dependent: string,
  file: string,
): void {
  const label = rootLabel(scan, file);
  const read = readJsonc(file);
  if (!read.ok) {
    uncertain(
      scan.graph,
      dependent,
      read.kind,
      `${label} ${read.reason}, so the package workspaces it points to are not known`,
    );
    return;
  }
  const config = read.value;
  const directory = dirname(file);
  const at = (detail: string): Reference => ({
    dependent,
    base: directory,
    detail: `${label} ${detail}`,
  });
  const malformed = (reason: string): void => {
    uncertain(
      scan.graph,
      dependent,
      UNCERTAINTY.malformedConfig,
      `${label} ${reason}, so the package workspaces it points to are not known`,
    );
  };
  const extended = extendsEntries(config);
  if (extended.ok) {
    for (const target of extended.value) {
      addExtendsEdges(scan, at(`extends ${JSON.stringify(target)}`), target);
    }
  } else {
    malformed(extended.reason);
  }
  const references = referencePaths(config);
  if (references.ok) {
    for (const path of references.value) {
      const reference = at(`references ${JSON.stringify(path)}`);
      addPathEdges(scan, reference, path, EDGE_PRODUCER.tsconfig);
    }
  } else {
    malformed(references.reason);
  }
  const paths = pathTargets(config);
  if (!paths.ok) malformed(paths.reason);
  else if (paths.value !== undefined) {
    addPathsEdges(scan, dependent, file, config, paths.value);
  } else addInheritedPathsEdges(scan, dependent, file, config);
}

/** A config with no `paths` of its own takes the nearest one along its `extends` chain, as TypeScript does. */
function addInheritedPathsEdges(
  scan: Scan,
  dependent: string,
  file: string,
  config: unknown,
): void {
  const inherited = nearestAlongExtends(scan, file, config, pathTargets);
  if (!inherited.ok) {
    uncertain(
      scan.graph,
      dependent,
      UNCERTAINTY.extendsUnfollowed,
      `${rootLabel(scan, file)} may inherit compilerOptions.paths, but ${inherited.reason}, so the package workspaces they point to are not known`,
    );
    return;
  }
  const { found } = inherited;
  if (found === undefined) return;
  addPathsEdges(scan, dependent, file, config, found.value, found.file);
}

function addExtendsEdges(
  scan: Scan,
  reference: Reference,
  target: string,
): void {
  if (isPathLike(target)) {
    addPathEdges(scan, reference, target, EDGE_PRODUCER.tsconfig);
  } else {
    addPackageEdges(scan, reference, target, EDGE_PRODUCER.tsconfig);
  }
}

function referencePaths(config: unknown): Checked<string[]> {
  const references = objectField(config, REFERENCES_FIELD);
  if (references === undefined) return { ok: true, value: [] };
  const paths: unknown = Array.isArray(references)
    ? references.map((entry) => objectField(entry, REFERENCE_PATH_FIELD))
    : undefined;
  return isStringArray(paths)
    ? { ok: true, value: paths }
    : {
        ok: false,
        reason: "has references that are not an array of { path } objects",
      };
}

/** Each `compilerOptions.paths` key with its targets, or undefined when the config sets no `paths`. */
function pathTargets(
  config: unknown,
): Checked<[string, string[]][] | undefined> {
  const paths = objectField(
    objectField(config, COMPILER_OPTIONS_FIELD),
    PATHS_FIELD,
  );
  if (paths === undefined) return { ok: true, value: undefined };
  const entries = isRecord(paths) ? Object.entries(paths) : [];
  const typed = entries.filter((entry): entry is [string, string[]] =>
    isStringArray(entry[1]),
  );
  return isRecord(paths) && typed.length === entries.length
    ? { ok: true, value: typed }
    : {
        ok: false,
        reason:
          "has compilerOptions.paths that is not an object of string arrays",
      };
}

/**
 * `leaf` is the walked config, whose `extends` chain holds the `baseUrl`; `file` is the config that sets the
 * `paths`, whose directory the targets resolve against when no `baseUrl` is found.
 */
function addPathsEdges(
  scan: Scan,
  dependent: string,
  leaf: string,
  config: unknown,
  paths: readonly (readonly [string, readonly string[]])[],
  file = leaf,
): void {
  if (paths.length === 0) return;
  const label = rootLabel(scan, file);
  const base = pathsBase(scan, leaf, config);
  if (!base.ok) {
    uncertain(
      scan.graph,
      dependent,
      UNCERTAINTY.extendsUnfollowed,
      `${rootLabel(scan, leaf)} has compilerOptions.paths but ${base.reason}, so the directory its targets resolve against is not known`,
    );
    return;
  }
  for (const [key, targets] of paths) {
    for (const target of targets) {
      const reference = {
        dependent,
        base: base.directory ?? dirname(file),
        detail: `${label} compilerOptions.paths ${JSON.stringify(key)}: ${JSON.stringify(target)}`,
      };
      addPatternEdges(scan, reference, target, EDGE_PRODUCER.tsconfig);
    }
  }
}

function pathsBase(scan: Scan, file: string, config: unknown): BaseDirectory {
  const nearest = nearestAlongExtends(scan, file, config, baseUrlOf);
  return nearest.ok
    ? { ok: true, directory: nearest.found?.value }
    : { ok: false, reason: nearest.reason };
}

function baseUrlOf(config: unknown, file: string): Checked<string | undefined> {
  const own = objectField(
    objectField(config, COMPILER_OPTIONS_FIELD),
    BASE_URL_FIELD,
  );
  if (own === undefined) return { ok: true, value: undefined };
  return typeof own === "string"
    ? { ok: true, value: resolve(dirname(file), own) }
    : {
        ok: false,
        reason: "has a compilerOptions.baseUrl that is not a string",
      };
}

type Nearest<T> =
  | {
      readonly ok: true;
      readonly found: { readonly value: T; readonly file: string } | undefined;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The value `pick` finds first in the file's own options and then along its `extends` chain, later entries
 * first. A config two entries share is searched once, and only a config already on the current chain is a cycle.
 */
function nearestAlongExtends<T>(
  scan: Scan,
  file: string,
  config: unknown,
  pick: (config: unknown, file: string) => Checked<T | undefined>,
): Nearest<T> {
  const chain = new Set([resolve(file)]);
  const searched = new Set<string>();
  const seek = (
    current: unknown,
    currentFile: string,
    depth: number,
  ): Nearest<T> => {
    const invalid = (reason: string): Nearest<T> => ({
      ok: false,
      reason: `${rootLabel(scan, currentFile)} ${reason}`,
    });
    const own = pick(current, currentFile);
    if (!own.ok) return invalid(own.reason);
    if (own.value !== undefined) {
      return { ok: true, found: { value: own.value, file: currentFile } };
    }
    const extended = extendsEntries(current);
    if (!extended.ok) return invalid(extended.reason);
    for (const target of extended.value.toReversed()) {
      const next = followExtends(
        scan,
        target,
        dirname(currentFile),
        chain,
        depth,
      );
      if (!next.ok) return next;
      if (searched.has(next.file)) continue;
      chain.add(next.file);
      const found = seek(next.value, next.file, depth + 1);
      chain.delete(next.file);
      if (!found.ok || found.found !== undefined) return found;
      searched.add(next.file);
    }
    return { ok: true, found: undefined };
  };
  return seek(config, file, 0);
}

function followExtends(
  scan: Scan,
  target: string,
  directory: string,
  chain: ReadonlySet<string>,
  depth: number,
): { ok: true; value: unknown; file: string } | { ok: false; reason: string } {
  if (depth >= MAX_EXTENDS_DEPTH) {
    return {
      ok: false,
      reason: `its extends chain is longer than ${MAX_EXTENDS_DEPTH} configs`,
    };
  }
  const located = locateExtended(target, directory);
  if (located === undefined) {
    return {
      ok: false,
      reason: `extends ${JSON.stringify(target)}, which could not be found`,
    };
  }
  if (chain.has(located)) {
    return {
      ok: false,
      reason: `its extends chain returns to ${rootLabel(scan, located)}`,
    };
  }
  const read = readJsonc(located);
  return read.ok
    ? { ok: true, value: read.value, file: located }
    : { ok: false, reason: `${rootLabel(scan, located)} ${read.reason}` };
}

/** A path as given or with `.json` added; a package through the `node_modules` directories above. */
function locateExtended(target: string, directory: string): string | undefined {
  if (isPathLike(target)) {
    const path = resolve(directory, target);
    return [path, `${path}${JSON_EXTENSION}`].find(isFile);
  }
  for (let current = directory; ; current = dirname(current)) {
    const path = join(current, NODE_MODULES, target);
    const found = [
      path,
      `${path}${JSON_EXTENSION}`,
      join(path, DEFAULT_TSCONFIG),
    ].find(isFile);
    if (found !== undefined) return found;
    if (dirname(current) === current) return undefined;
  }
}

function isPathLike(target: string): boolean {
  return isRelative(target) || isAbsolutePath(target);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function extendsEntries(config: unknown): Checked<string[]> {
  const value = objectField(config, EXTENDS_FIELD);
  if (value === undefined) return { ok: true, value: [] };
  if (typeof value === "string") return { ok: true, value: [value] };
  return isStringArray(value)
    ? { ok: true, value }
    : {
        ok: false,
        reason: "has extends that is neither a string nor an array of strings",
      };
}

/** Each string target of a `package.json` `imports` entry, under conditions or in an array, as a dependency. */
export function addManifestImportsEdges(
  scan: Scan,
  workspace: PackageWorkspace,
  manifest: Record<string, unknown>,
): void {
  const imports = manifest[IMPORTS_FIELD];
  if (imports === undefined) return;
  const label = joinPath(workspace.path, PACKAGE_JSON);
  const unreadable = (reason: string): void => {
    uncertain(
      scan.graph,
      workspace.path,
      UNCERTAINTY.manifestUnreadable,
      `${label} imports ${reason}, so the workspace's dependencies are not known`,
    );
  };
  if (!isRecord(imports)) {
    unreadable("is not an object");
    return;
  }
  for (const [key, value] of Object.entries(imports)) {
    const targets = stringLeaves(value);
    if (targets === undefined) {
      unreadable(
        `${JSON.stringify(key)} nests deeper than ${MAX_JSON_DEPTH} levels`,
      );
      continue;
    }
    for (const target of targets) {
      const reference = {
        dependent: workspace.path,
        base: workspace.directory,
        detail: `${label} imports ${JSON.stringify(key)}: ${JSON.stringify(target)}`,
      };
      if (isRelative(target)) {
        addPatternEdges(scan, reference, target, EDGE_PRODUCER.manifestImports);
      } else if (isBare(target)) {
        addPackageEdges(scan, reference, target, EDGE_PRODUCER.manifestImports);
      }
    }
  }
}

/** Every string in a parsed JSON value, or undefined past the nesting bound. */
function stringLeaves(value: unknown, depth = 0): string[] | undefined {
  if (typeof value === "string") return [value];
  if (depth >= MAX_JSON_DEPTH) return undefined;
  const children = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : [];
  const leaves: string[] = [];
  for (const child of children) {
    const found = stringLeaves(child, depth + 1);
    if (found === undefined) return undefined;
    leaves.push(...found);
  }
  return leaves;
}
