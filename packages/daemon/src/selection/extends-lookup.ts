import { basename, dirname, join, resolve } from "node:path";
import {
  objectField,
  PACKAGE_JSON,
  POSIX_SEPARATOR,
  realPath,
} from "../vitest/find-workspaces.js";
import { isRecord } from "./graph-state.js";
import { MAX_JSON_DEPTH, readJsonc } from "./jsonc.js";
import { isFile } from "./source-walk.js";
import {
  isAbsolutePath,
  isRelative,
  KEY_SEPARATOR,
  observedParse,
  rootLabel,
  type Scan,
} from "./specifier-edges.js";

const JSON_EXTENSION = ".json";
/** Extensions TypeScript replaces with `.json` when it looks a config up. */
const JSON_SWAPPED_EXTENSIONS = [".d.ts", ".ts", ".js"];
/** The extensions TypeScript strips whole before reading what is left as the extension. */
const STRIPPED_EXTENSIONS = [
  ".d.ts",
  ".d.mts",
  ".d.cts",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".json",
];
const EXTENSION_MARK = ".";
const WINDOWS_SEPARATOR = "\\";
/** A target TypeScript reads as a directory, loading its `tsconfig` field or index config. */
const DIRECTORY_NAMES = [".", ".."];
const PATH_PREFIXES = ["./", "../"];
const ENDS_IN_SEPARATOR = /[/\\]$/;
const NODE_MODULES = "node_modules";
const INDEX_CONFIG = "tsconfig";
const SUBPATH_IMPORT_PREFIX = "#";
/** A name holding it looks like a URI, which TypeScript does not look for in `node_modules`. */
const URI_MARK = ":";
const SCOPE_PREFIX = "@";
const MAIN_SUBPATH = ".";
const SUBPATH_PREFIX = "./";
const WILDCARD = "*";
const WILDCARDS = /\*/g;
const EXPORTS_FIELD = "exports";
const NAME_FIELD = "name";
const TSCONFIG_FIELD = "tsconfig";
const TYPES_VERSIONS_FIELD = "typesVersions";
const DEFAULT_CONDITION = "default";
/** What TypeScript's config lookup matches besides `default`: NodeNext resolution in CommonJS mode. */
const CONFIG_CONDITIONS = ["require", "types", "node"];
/** Begins a condition TypeScript matches only when its version range holds the compiler's version. */
const VERSIONED_TYPES_CONDITION = "types@";
/** Segments TypeScript refuses in an `exports` target and in the subpath it inserts there. */
const REFUSED_SEGMENTS = [".", "..", NODE_MODULES];
const NOT_FOUND = "which could not be found";

/** Where an `extends` target resolves, or why it cannot be followed and whether no config was found. */
export type ExtendsLookup =
  | { readonly ok: true; readonly file: string }
  | { readonly ok: false; readonly cause: string; readonly missing: boolean };

interface Unfollowed {
  readonly cause: string;
}

/** A `null` export target: the package maps the name to nothing, which ends the search in that package. */
const EXCLUDED = Symbol("excluded");

/** A config file, nothing found, or a lookup that cannot be followed, which ends the search. */
type Located = string | undefined | Unfollowed;

type Found = Located | typeof EXCLUDED;

interface PackageInfo {
  readonly directory: string;
  readonly json: unknown;
  readonly label: string;
}

type PackageRead = PackageInfo | undefined | Unfollowed;

/** The package whose `exports` are read, and whether a `.json` target is read as named. */
interface ExportsScope {
  readonly pkg: PackageInfo;
  readonly readsJson: boolean;
}

/**
 * Locates an `extends` target as TypeScript's config lookup does: a path as given or with `.json` added; a
 * package name through its own package's `exports`, then through the `node_modules` directories above,
 * where a hit is read at its real path.
 */
export function locateExtended(
  scan: Scan,
  target: string,
  directory: string,
): ExtendsLookup {
  const key = [target, directory].join(KEY_SEPARATOR);
  const known = scan.extendsLookups.get(key);
  if (known !== undefined) return known;
  const found = lookup(scan, withForwardSlashes(target), directory);
  const located: ExtendsLookup =
    typeof found === "string"
      ? { ok: true, file: found }
      : {
          ok: false,
          cause: found?.cause ?? NOT_FOUND,
          missing: found === undefined,
        };
  scan.extendsLookups.set(key, located);
  return located;
}

/** A target with each `\` read as `/`, as TypeScript reads an `extends` target and an `exports` target's segments. */
export function withForwardSlashes(target: string): string {
  return target.split(WINDOWS_SEPARATOR).join(POSIX_SEPARATOR);
}

/** Why a `#` subpath import is not followed, or undefined for any other target. */
export function subpathImportCause(target: string): string | undefined {
  return target.startsWith(SUBPATH_IMPORT_PREFIX)
    ? `which is a ${JSON.stringify(SUBPATH_IMPORT_PREFIX)} subpath import, which the scan does not follow`
    : undefined;
}

/** `.` and `..` name a directory; a rooted target or one beginning with `./` or `../` a file; any other a package. */
function lookup(scan: Scan, target: string, directory: string): Located {
  if (target === "") return undefined;
  if (DIRECTORY_NAMES.includes(target)) {
    const candidate = resolve(directory, target);
    const info = readPackage(scan, candidate);
    return isUnfollowed(info) ? info : directoryConfig(candidate, info);
  }
  if (
    isAbsolutePath(target) ||
    PATH_PREFIXES.some((p) => target.startsWith(p))
  ) {
    return pathTarget(resolve(directory, target));
  }
  const subpathImport = subpathImportCause(target);
  if (subpathImport !== undefined) return { cause: subpathImport };
  const own = selfNamed(scan, target, directory);
  if (own === EXCLUDED) return undefined;
  if (own !== undefined || target.includes(URI_MARK)) return own;
  const found = fromNodeModules(scan, target, directory);
  return typeof found === "string" ? realOrGiven(found) : found;
}

/** Whether an `extends` target names a file or directory rather than a package, for the edge it gives. */
export function isPathLike(target: string): boolean {
  return isRelative(target) || isAbsolutePath(target);
}

/** The real path, or the path as given when it has none. */
export function realOrGiven(path: string): string {
  const real = realPath(path);
  return real.ok ? real.path : path;
}

/** Whether a located config lies in an installed package, which no workspace's sources hold. */
export function isInstalled(file: string): boolean {
  return withForwardSlashes(file).split(POSIX_SEPARATOR).includes(NODE_MODULES);
}

/** A config or manifest the lookup reads, parsed once per scan by its real path. */
export function readConfig(
  scan: Scan,
  file: string,
): ReturnType<typeof readJsonc> {
  const key = realOrGiven(file);
  let read = scan.extendedConfigs.get(key);
  if (read === undefined) {
    read = observedParse(scan, rootLabel(scan, file), () => readJsonc(file));
    scan.extendedConfigs.set(key, read);
  }
  return read;
}

function pathTarget(path: string): string | undefined {
  if (isFile(path)) return path;
  const withExtension = `${path}${JSON_EXTENSION}`;
  return !path.endsWith(JSON_EXTENSION) && isFile(withExtension)
    ? withExtension
    : undefined;
}

function isUnfollowed(value: unknown): value is Unfollowed {
  return typeof value === "object" && value !== null && "cause" in value;
}

function firstFound(attempts: readonly (() => Found)[]): Found {
  for (const attempt of attempts) {
    const found = attempt();
    if (found !== undefined) return found;
  }
  return undefined;
}

function readPackage(scan: Scan, directory: string): PackageRead {
  const file = join(directory, PACKAGE_JSON);
  if (!isFile(file)) return undefined;
  const label = rootLabel(scan, file);
  const read = readConfig(scan, file);
  return read.ok
    ? { directory, json: read.value, label }
    : { cause: `which reaches ${label}, which ${read.reason}` };
}

/**
 * A package's own name, through its own `exports`, from inside the package. TypeScript looks twice: first
 * reading no `.json` target, and the first look's answer stands even when it is an excluding `null`.
 */
function selfNamed(scan: Scan, target: string, directory: string): Found {
  const pkg = packageScope(scan, directory);
  if (pkg === undefined || isUnfollowed(pkg)) return pkg;
  const exports = objectField(pkg.json, EXPORTS_FIELD);
  const name = objectField(pkg.json, NAME_FIELD);
  if (!exports || typeof name !== "string") return undefined;
  const nameParts = name.split(POSIX_SEPARATOR);
  const parts = target.split(POSIX_SEPARATOR);
  if (parts.at(-1) === "") parts.pop();
  if (!nameParts.every((part, index) => parts[index] === part)) {
    return undefined;
  }
  const subpath = subpathOf(parts.slice(nameParts.length));
  return firstFound(
    [false, true].map(
      (readsJson) => () => fromExports({ pkg, readsJson }, exports, subpath),
    ),
  );
}

function packageScope(scan: Scan, directory: string): PackageRead {
  for (let current = directory; ; current = dirname(current)) {
    const read = readPackage(scan, current);
    if (read !== undefined || dirname(current) === current) return read;
  }
}

function subpathOf(parts: readonly string[]): string {
  return parts.length === 0
    ? MAIN_SUBPATH
    : `${SUBPATH_PREFIX}${parts.join(POSIX_SEPARATOR)}`;
}

function fromNodeModules(
  scan: Scan,
  target: string,
  directory: string,
): Located {
  for (let current = directory; ; current = dirname(current)) {
    if (basename(current) !== NODE_MODULES) {
      const found = fromPackage(scan, join(current, NODE_MODULES), target);
      if (found !== undefined && found !== EXCLUDED) return found;
    }
    if (dirname(current) === current) return undefined;
  }
}

/** A package's `exports` decides alone; without them, a file, the `tsconfig` field or the index config. */
function fromPackage(scan: Scan, nodeModules: string, target: string): Found {
  const { name, rest } = packageParts(target);
  const packageDirectory = join(nodeModules, name);
  const candidate = join(nodeModules, target);
  const root = readPackage(scan, packageDirectory);
  if (isUnfollowed(root)) return root;
  const exports = objectField(root?.json, EXPORTS_FIELD);
  if (rest !== "" && exports === undefined) {
    // A subpath holding a `package.json` of its own is read as that package, found or not.
    const own = readPackage(scan, candidate);
    if (own !== undefined) {
      return isUnfollowed(own) ? own : fileOrDirectory(candidate, own);
    }
  }
  return root === undefined
    ? fileOrDirectory(candidate, root)
    : fromPackageRoot(root, exports, { candidate, rest });
}

function fromPackageRoot(
  root: PackageInfo,
  exports: unknown,
  { candidate, rest }: { candidate: string; rest: string },
): Found {
  if (exports) {
    const subpath = subpathOf(rest === "" ? [] : [rest]);
    return fromExports({ pkg: root, readsJson: true }, exports, subpath);
  }
  const versioned = rest === "" ? undefined : typesVersionsCause(root);
  return versioned ?? fileOrDirectory(candidate, root);
}

/** `@scope/name/sub` is `@scope/name` and `sub`; `name/sub` is `name` and `sub`. */
function packageParts(target: string): { name: string; rest: string } {
  const first = target.indexOf(POSIX_SEPARATOR);
  const end = target.startsWith(SCOPE_PREFIX)
    ? target.indexOf(POSIX_SEPARATOR, first + 1)
    : first;
  return end === -1
    ? { name: target, rest: "" }
    : { name: target.slice(0, end), rest: target.slice(end + 1) };
}

function typesVersionsCause(info: PackageInfo): Unfollowed | undefined {
  return objectField(info.json, TYPES_VERSIONS_FIELD) === undefined
    ? undefined
    : {
        cause: `which reaches ${info.label}, whose ${TYPES_VERSIONS_FIELD} field the scan does not follow`,
      };
}

/** `info` is the package whose `tsconfig` field applies when `candidate` is its directory. */
function fileOrDirectory(
  candidate: string,
  info: PackageInfo | undefined,
): Located {
  return configFile(candidate) ?? directoryConfig(candidate, info);
}

function directoryConfig(
  candidate: string,
  info: PackageInfo | undefined,
): Located {
  if (info !== undefined) {
    const versioned = typesVersionsCause(info);
    if (versioned !== undefined) return versioned;
  }
  const field =
    info?.directory === candidate
      ? objectField(info.json, TSCONFIG_FIELD)
      : undefined;
  const fromField =
    typeof field === "string" ? fieldConfig(candidate, field) : undefined;
  return fromField ?? indexConfig(candidate);
}

/** A field ending in a separator names a directory, so no file of that name is tried; an empty one names nothing. */
function fieldConfig(directory: string, field: string): string | undefined {
  if (field === "") return undefined;
  const path = resolve(directory, field);
  const file = ENDS_IN_SEPARATOR.test(field) ? undefined : configFile(path);
  return file ?? indexConfig(path);
}

function indexConfig(directory: string): string | undefined {
  return configFile(join(directory, INDEX_CONFIG));
}

/** The file with its extension swapped for `.json` where TypeScript swaps it, else with `.json` added. */
function configFile(path: string): string | undefined {
  const swapped = swappedConfigFile(path);
  if (swapped !== undefined) return swapped;
  const withExtension = `${path}${JSON_EXTENSION}`;
  return isFile(withExtension) ? withExtension : undefined;
}

/** A file named with an extension, read with none added: `.json` as named, and `.ts`, `.d.ts` or `.js` as `.json`. */
function swappedConfigFile(path: string, readsJson = true): string | undefined {
  if (!basename(path).includes(EXTENSION_MARK)) return undefined;
  const extension =
    STRIPPED_EXTENSIONS.find((known) => path.endsWith(known)) ??
    path.slice(path.lastIndexOf(EXTENSION_MARK));
  const stem = path.slice(0, path.length - extension.length);
  const swapped = `${stem}${JSON_EXTENSION}`;
  const swaps =
    (readsJson && extension === JSON_EXTENSION) ||
    JSON_SWAPPED_EXTENSIONS.includes(extension);
  return swaps && isFile(swapped) ? swapped : undefined;
}

function fromExports(
  scope: ExportsScope,
  exports: unknown,
  subpath: string,
): Found {
  if (subpath === MAIN_SUBPATH) {
    const main = mainExport(exports);
    return main
      ? fromTarget(scope, main, { subpath: "", pattern: false })
      : undefined;
  }
  if (!isRecord(exports)) return undefined;
  const keys = Object.keys(exports);
  if (!keys.every((key) => key.startsWith(MAIN_SUBPATH))) return undefined;
  if (
    !subpath.endsWith(POSIX_SEPARATOR) &&
    !subpath.includes(WILDCARD) &&
    Object.hasOwn(exports, subpath)
  ) {
    return fromTarget(scope, exports[subpath], {
      subpath: "",
      pattern: false,
    });
  }
  const expanding = keys
    .filter((key) => hasOneWildcard(key) || key.endsWith(POSIX_SEPARATOR))
    .toSorted(comparePatternKeys);
  for (const key of expanding) {
    const match = keyMatch(key, subpath);
    if (match !== undefined) return fromTarget(scope, exports[key], match);
  }
  return undefined;
}

function mainExport(exports: unknown): unknown {
  const sugar =
    typeof exports === "string" ||
    Array.isArray(exports) ||
    (isRecord(exports) &&
      !Object.keys(exports).some((key) => key.startsWith(MAIN_SUBPATH)));
  return sugar ? exports : objectField(exports, MAIN_SUBPATH);
}

function hasOneWildcard(key: string): boolean {
  const first = key.indexOf(WILDCARD);
  return first !== -1 && first === key.lastIndexOf(WILDCARD);
}

/** The longer fixed text before the wildcard sorts first, then a key with a wildcard, then the longer key. */
function comparePatternKeys(a: string, b: string): number {
  const aWildcard = a.indexOf(WILDCARD);
  const bWildcard = b.indexOf(WILDCARD);
  const aBase = aWildcard === -1 ? a.length : aWildcard + 1;
  const bBase = bWildcard === -1 ? b.length : bWildcard + 1;
  if (aBase !== bBase) return bBase - aBase;
  if (aWildcard === -1) return 1;
  if (bWildcard === -1) return -1;
  return b.length - a.length;
}

interface KeyMatch {
  readonly subpath: string;
  readonly pattern: boolean;
}

function keyMatch(key: string, subpath: string): KeyMatch | undefined {
  const wildcard = key.indexOf(WILDCARD);
  const before = key.slice(0, wildcard);
  const after = key.slice(wildcard + 1);
  if (
    wildcard !== -1 &&
    !key.endsWith(WILDCARD) &&
    subpath.startsWith(before) &&
    subpath.endsWith(after)
  ) {
    const end = subpath.length - after.length;
    return { subpath: subpath.substring(wildcard, end), pattern: true };
  }
  if (key.endsWith(WILDCARD) && subpath.startsWith(before)) {
    return { subpath: subpath.slice(before.length), pattern: true };
  }
  return subpath.startsWith(key)
    ? { subpath: subpath.slice(key.length), pattern: false }
    : undefined;
}

/** A string, the first of an array's entries that resolves, or the first matching condition that resolves. */
function fromTarget(
  scope: ExportsScope,
  target: unknown,
  match: KeyMatch,
  depth = 0,
): Found {
  if (typeof target === "string") {
    return fromStringTarget(scope, target, match);
  }
  if (target === null) return EXCLUDED;
  if (depth >= MAX_JSON_DEPTH) {
    return {
      cause: `which reaches ${scope.pkg.label}, whose exports nest deeper than ${MAX_JSON_DEPTH} levels`,
    };
  }
  if (Array.isArray(target)) {
    return firstFound(
      target.map((entry) => () => fromTarget(scope, entry, match, depth + 1)),
    );
  }
  if (!isRecord(target)) return undefined;
  const attempts: (() => Found)[] = [];
  for (const [condition, value] of Object.entries(target)) {
    if (condition.startsWith(VERSIONED_TYPES_CONDITION)) {
      attempts.push(() => ({
        cause: `which reaches ${scope.pkg.label}, whose exports name the condition ${JSON.stringify(condition)}, which the scan does not follow`,
      }));
    } else if (
      condition === DEFAULT_CONDITION ||
      CONFIG_CONDITIONS.includes(condition)
    ) {
      attempts.push(() => fromTarget(scope, value, match, depth + 1));
    }
  }
  return firstFound(attempts);
}

/**
 * The target's form is checked as written and its segments with each `\` read as `/`. A pattern's wildcard
 * is replaced with `String.prototype.replace` and its `$` patterns, as TypeScript replaces it.
 */
function fromStringTarget(
  { pkg, readsJson }: ExportsScope,
  written: string,
  { subpath, pattern }: KeyMatch,
): string | undefined {
  if (!pattern && subpath !== "" && !written.endsWith(POSIX_SEPARATOR)) {
    return undefined;
  }
  if (!written.startsWith(SUBPATH_PREFIX)) return undefined;
  const target = withForwardSlashes(written);
  const refused = (path: string): boolean =>
    path
      .split(POSIX_SEPARATOR)
      .some((segment) => REFUSED_SEGMENTS.includes(segment));
  if (refused(target.slice(SUBPATH_PREFIX.length)) || refused(subpath)) {
    return undefined;
  }
  const inserted = pattern
    ? target.replace(WILDCARDS, subpath)
    : `${target}${subpath}`;
  return swappedConfigFile(resolve(pkg.directory, inserted), readsJson);
}
