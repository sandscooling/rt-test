import { isAbsolute, posix, resolve } from "node:path";
import picomatch from "picomatch";
import { WINDOWS } from "../daemon/endpoint.js";
import { POSIX_SEPARATOR } from "../vitest/find-workspaces.js";

/** The options tinyglobby gives picomatch for Vitest's glob of a project's test files, which sets only `dot`. */
const DISCOVERY_MATCH_OPTIONS = {
  dot: true,
  nobrace: false,
  nocase: false,
  noextglob: false,
  noglobstar: false,
  posix: true,
} as const;
const NEGATION = "!";
const EXTGLOB_OPEN = "(";
export const BACKSLASHES = /\\/g;
const PARENT_DIRECTORY = /^(\/?\.\.)+/;
const DRIVE_RELATIVE_PATH = /^[A-Za-z]:$/;
const UNC_PREFIX = "//";
const GLOBSTAR = "**";
const PARENT_STEP_LENGTH = 3;
const ESCAPING_BACKSLASHES = /\\(?=[()[\]{}!*+?@|])/g;
const POSIX_UNESCAPED_GLOB_SYMBOLS =
  /(?<!\\)([()[\]{}*?|]|^!|[!+@](?=\()|\\(?![()[\]{}!*+?@|]))/g;
const WIN32_UNESCAPED_GLOB_SYMBOLS = /(?<!\\)([()[\]{}]|^!|[!+@](?=\())/g;
const ESCAPED_SYMBOL = "\\$&";
const CURRENT_DIRECTORY = ".";

export type PathMatcher = (path: string) => boolean;

/** A pattern picomatch refuses to compile, as written, with its error. */
export interface GlobRefusal {
  readonly ok: false;
  readonly written: string;
  readonly error: unknown;
}

export type CompiledGlob =
  | {
      readonly ok: true;
      /** Takes a path relative to the glob's `cwd`, as the crawl names it. */
      readonly matches: PathMatcher;
      /** Whether an absolute path lies below the crawl's root by its spelling, so the crawl can reach it. */
      readonly reaches: PathMatcher;
      /** Whether the crawl passes over a directory, by its absolute path as the crawl spells it. */
      readonly prunes: PathMatcher;
    }
  | GlobRefusal;

/**
 * One crawl of Vitest's glob: each pattern's base, below which alone it can find a file, as the glob spells it, and
 * which directories the glob prunes.
 */
export interface Crawl {
  readonly bases: readonly string[];
  /** Takes a directory's absolute path as the crawl spells it. */
  readonly prunes: (directory: string) => boolean;
}

/** The directory Vitest's glob matches from, spelled as tinyglobby resolves its `cwd`. */
export function globCwd(directory: string): string {
  return resolve(directory).replace(BACKSLASHES, POSIX_SEPARATOR);
}

/**
 * The directory a test file pattern's crawl passes through by the pattern's own spelling: the directories before its
 * first glob segment, or the file a pattern with none names, absolute from `cwd` and normalized as the glob
 * normalizes the pattern, so `S://src` is `S:/src` and the `S:` of `S:/**` is the drive's root. Undefined for an
 * empty or negated pattern, which finds no file.
 */
export function patternBase(pattern: string, cwd: string): string | undefined {
  if (pattern === "" || isNegated(pattern)) return undefined;
  const base = picomatch.scan(pattern).base.replace(ESCAPING_BACKSLASHES, "");
  const driveRoot = nonDriveRelative(base);
  if (isAbsolute(driveRoot)) return spelledJoin(driveRoot);
  return spelledJoin(cwd, base);
}

/** `posix.join`, keeping the `//` that begins a Windows UNC path, which it would collapse onto the current drive. */
function spelledJoin(first: string, ...rest: string[]): string {
  const joined = posix.join(first, ...rest);
  const collapsedUnc =
    process.platform === WINDOWS &&
    first.startsWith(UNC_PREFIX) &&
    !joined.startsWith(UNC_PREFIX);
  return collapsedUnc ? `${POSIX_SEPARATOR}${joined}` : joined;
}

/**
 * What each of a project's globs from `cwd`, Vitest's spelling of its pattern directory, can find a file below: each
 * pattern's base, for each pattern list that is not empty, or the first pattern picomatch refuses.
 */
export function projectCrawls(
  globbed: readonly (readonly string[])[],
  exclude: readonly string[],
  cwd: string,
): { readonly ok: true; readonly crawls: readonly Crawl[] } | GlobRefusal {
  const crawls: Crawl[] = [];
  for (const patterns of globbed) {
    if (patterns.length === 0) continue;
    const glob = globCall(patterns, exclude, cwd);
    if (!glob.ok) return glob;
    crawls.push({
      bases: patterns.flatMap((pattern) => patternBase(pattern, cwd) ?? []),
      prunes: glob.prunes,
    });
  }
  return { ok: true, crawls };
}

/**
 * One tinyglobby glob as Vitest calls it: patterns sorted into match and ignore lists as its `processPatterns`
 * does, and every directory below the crawl's root that the ignore list matches pruned with what it holds.
 */
export function globCall(
  patterns: readonly string[],
  exclude: readonly string[],
  cwd: string,
): CompiledGlob {
  const crawl: CrawlRoot = { root: cwd, depthOffset: 0 };
  const match: PathMatcher[] = [];
  const ignore: PathMatcher[] = [];
  for (const { written, pattern, isIgnore } of sortedPatterns(
    patterns,
    exclude,
  )) {
    try {
      const normalized = normalizePattern(pattern, cwd, crawl, isIgnore);
      (isIgnore ? ignore : match).push(
        picomatch(normalized, DISCOVERY_MATCH_OPTIONS),
      );
    } catch (error) {
      return {
        ok: false,
        written,
        error,
      };
    }
  }
  const crawlRoot = crawl.root.replace(BACKSLASHES, "");
  const below = directoryPrefix(crawlRoot);
  const respell = rootRespelling(cwd, crawlRoot);
  const ignored = (path: string): boolean =>
    ignore.some((matches) => matches(path));
  return {
    ok: true,
    matches: (onDisk) => {
      const path = respell(onDisk);
      return (
        match.some((matches) => matches(path)) &&
        !ignored(path) &&
        !parentDirectories(path).some(
          (directory) =>
            posix.join(cwd, directory).startsWith(below) && ignored(directory),
        )
      );
    },
    reaches: (spelled) => spelled.startsWith(below),
    prunes: (directory) => ignored(posix.relative(cwd, directory)),
  };
}

/**
 * How the crawl names a path relative to `cwd`: it opens its root by the patterns' spelling, and a case-folding
 * Windows file system opens a directory whose on-disk case differs, so the root's segments take the patterns'
 * case while every entry below keeps its own.
 */
function rootRespelling(
  cwd: string,
  crawlRoot: string,
): (path: string) => string {
  const prefix = directoryPrefix(cwd);
  if (process.platform !== WINDOWS || !crawlRoot.startsWith(prefix)) {
    return (path) => path;
  }
  const rootSegments = crawlRoot
    .slice(prefix.length)
    .split(POSIX_SEPARATOR)
    .filter((segment) => segment !== "");
  return (path) => {
    const segments = path.split(POSIX_SEPARATOR);
    if (segments.length <= rootSegments.length) return path;
    const folds = rootSegments.every(
      (segment, index) =>
        segment.toLowerCase() === segments[index]?.toLowerCase(),
    );
    return folds
      ? [...rootSegments, ...segments.slice(rootSegments.length)].join(
          POSIX_SEPARATOR,
        )
      : path;
  };
}

interface SortedPattern {
  readonly written: string;
  readonly pattern: string;
  readonly isIgnore: boolean;
}

/** `processPatterns`' order and sorting: `exclude` first, each `!` one dropped, then each include, a `!` one ignored. */
function sortedPatterns(
  patterns: readonly string[],
  exclude: readonly string[],
): SortedPattern[] {
  const sorted: SortedPattern[] = [];
  for (const pattern of exclude) {
    if (pattern !== "" && !isNegated(pattern)) {
      sorted.push({ written: pattern, pattern, isIgnore: true });
    }
  }
  for (const pattern of patterns) {
    if (pattern === "") continue;
    const rest = pattern.slice(NEGATION.length);
    if (!isNegated(pattern)) {
      sorted.push({ written: pattern, pattern, isIgnore: false });
    } else if (!isNegated(rest)) {
      sorted.push({ written: pattern, pattern: rest, isIgnore: true });
    }
  }
  return sorted;
}

/** A leading `!` negates, unless it opens an extglob such as `!(a|b)`. */
function isNegated(pattern: string): boolean {
  return pattern.startsWith(NEGATION) && pattern[1] !== EXTGLOB_OPEN;
}

/** Where tinyglobby's crawl starts, which its `normalizePattern` moves as each pattern of one glob is normalized. */
interface CrawlRoot {
  root: string;
  depthOffset: number;
  commonPath?: readonly string[];
}

/**
 * tinyglobby's `normalizePattern` with directory expansion off, as Vitest globs: a trailing `/` dropped, an
 * absolute pattern made relative to `cwd`, and a leading climb that re-enters `cwd` by name removed. It moves the
 * crawl's root up for a climb, and down to the static directories every match pattern shares.
 */
function normalizePattern(
  pattern: string,
  cwd: string,
  crawl: CrawlRoot,
  isIgnore: boolean,
): string {
  let result = pattern.endsWith(POSIX_SEPARATOR)
    ? pattern.slice(0, -POSIX_SEPARATOR.length)
    : pattern;
  const escapedCwd = escapePath(cwd);
  result = isAbsolute(result.replace(ESCAPING_BACKSLASHES, ""))
    ? posix.relative(escapedCwd, result)
    : posix.normalize(result);
  const parentDirectory = PARENT_DIRECTORY.exec(result)?.[0];
  const parts = splitPattern(result);
  if (parentDirectory !== undefined) {
    result = collapseClimb(result, parentDirectory, parts, cwd, crawl);
  }
  if (!isIgnore && crawl.depthOffset >= 0) narrowCrawl(parts, cwd, crawl);
  return result;
}

function collapseClimb(
  pattern: string,
  parentDirectory: string,
  parts: readonly string[],
  cwd: string,
  crawl: CrawlRoot,
): string {
  let result = pattern;
  const climbs = (parentDirectory.length + 1) / PARENT_STEP_LENGTH;
  const cwdParts = escapePath(cwd).split(POSIX_SEPARATOR);
  let step = 0;
  for (; step < climbs; step += 1) {
    const part = parts[step + climbs];
    if (
      part === undefined ||
      part !== cwdParts[cwdParts.length + step - climbs]
    )
      break;
    result =
      result.slice(0, (climbs - step - 1) * PARENT_STEP_LENGTH) +
        result.slice((climbs - step) * PARENT_STEP_LENGTH + part.length + 1) ||
      CURRENT_DIRECTORY;
  }
  const potentialRoot = posix.join(
    cwd,
    parentDirectory.slice(step * PARENT_STEP_LENGTH),
  );
  if (
    !potentialRoot.startsWith(CURRENT_DIRECTORY) &&
    crawl.root.length > potentialRoot.length
  ) {
    crawl.root = nonDriveRelative(potentialRoot);
    crawl.depthOffset = -climbs + step;
  }
  return result;
}

function narrowCrawl(
  parts: readonly string[],
  cwd: string,
  crawl: CrawlRoot,
): void {
  const commonPath = crawl.commonPath ?? parts;
  const shared: string[] = [];
  const length = Math.min(commonPath.length, parts.length);
  for (let index = 0; index < length; index += 1) {
    const part = parts[index] as string;
    if (part === GLOBSTAR && parts[index + 1] === undefined) {
      shared.pop();
      break;
    }
    if (
      index === parts.length - 1 ||
      part !== commonPath[index] ||
      isDynamicPattern(part)
    ) {
      break;
    }
    shared.push(part);
  }
  crawl.depthOffset = shared.length;
  crawl.commonPath = shared;
  crawl.root = nonDriveRelative(
    shared.length > 0 ? posix.join(cwd, ...shared) : cwd,
  );
}

function isDynamicPattern(part: string): boolean {
  const scanned = picomatch.scan(part);
  return scanned.isGlob || scanned.negated;
}

/** What every path strictly below a `/`-separated directory begins with, a drive root such as `C:/` included. */
export function directoryPrefix(directory: string): string {
  return directory.endsWith(POSIX_SEPARATOR)
    ? directory
    : `${directory}${POSIX_SEPARATOR}`;
}

function nonDriveRelative(path: string): string {
  return path.replace(
    DRIVE_RELATIVE_PATH,
    (drive) => `${drive}${POSIX_SEPARATOR}`,
  );
}

function escapePath(path: string): string {
  return path.replace(
    process.platform === WINDOWS
      ? WIN32_UNESCAPED_GLOB_SYMBOLS
      : POSIX_UNESCAPED_GLOB_SYMBOLS,
    ESCAPED_SYMBOL,
  );
}

function splitPattern(pattern: string): readonly string[] {
  const parts = picomatch.scan(pattern, { parts: true }).parts;
  return parts !== undefined && parts.length > 0 ? parts : [pattern];
}

/** Each directory above a path relative to the pattern directory. */
function parentDirectories(path: string): string[] {
  const segments = path.split(POSIX_SEPARATOR);
  const directories: string[] = [];
  for (let end = 1; end < segments.length; end += 1) {
    directories.push(segments.slice(0, end).join(POSIX_SEPARATOR));
  }
  return directories;
}
