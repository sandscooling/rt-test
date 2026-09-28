import { isAbsolute, posix } from "node:path";
import picomatch from "picomatch";
import { WINDOWS } from "../daemon/endpoint.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import {
  climbsOut,
  POSIX_SEPARATOR,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";
import type { ProjectSelectionFacts } from "../vitest/selection-facts.js";
import { absoluteInputPath } from "./input-filter.js";
import { discoveredTestModules, NON_INPUTS_FILE } from "./non-inputs.js";

const PATTERNS_DO_NOT_APPLY = `${NON_INPUTS_FILE}'s patterns do not apply, so every file stays an input`;
const NO_DISCOVERY_REASON = `${PATTERNS_DO_NOT_APPLY}: no discovery in effect reports which files they may not remove`;
const NOT_REPORTED_REASON = `${PATTERNS_DO_NOT_APPLY}: the discovery in effect does not report which files they may not remove for the workspace`;
/** How a reason names the workspace at the consumer root, whose path is `.`. */
export const ROOT_WORKSPACE = "at the consumer root";
const REFUSED_REASON = `${PATTERNS_DO_NOT_APPLY}: picomatch cannot compile the test file pattern`;
const REFUSED_CONSEQUENCE = "so the files it finds are not known";
/** A refused pattern can be longer than picomatch's input limit, and its quote goes into every answer. */
const MAX_QUOTED_PATTERN_LENGTH = 200;
const TRUNCATION_MARK = "...";

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
const BACKSLASHES = /\\/g;
const PARENT_DIRECTORY = /^(\/?\.\.)+/;
const DRIVE_RELATIVE_PATH = /^[A-Za-z]:$/;
const GLOBSTAR = "**";
const PARENT_STEP_LENGTH = 3;
const ESCAPING_BACKSLASHES = /\\(?=[()[\]{}!*+?@|])/g;
const POSIX_UNESCAPED_GLOB_SYMBOLS =
  /(?<!\\)([()[\]{}*?|]|^!|[!+@](?=\()|\\(?![()[\]{}!*+?@|]))/g;
const WIN32_UNESCAPED_GLOB_SYMBOLS = /(?<!\\)([()[\]{}]|^!|[!+@](?=\())/g;
const ESCAPED_SYMBOL = "\\$&";
const CURRENT_DIRECTORY = ".";

/**
 * Which files no declared pattern may remove from the inputs, built from the discovery in effect, or why no
 * declared pattern applies at all.
 */
export type Protection =
  | { readonly applies: false; readonly reason: string }
  | {
      readonly applies: true;
      /** Root-relative: every test module, setup file and global setup file the discovery lists. */
      readonly files: ReadonlySet<string>;
      /** Equal for two values whose discovered projects match the same files by pattern. */
      readonly patternKey: string;
      /** Whether a root-relative path is a listed file or one a discovered project's test file patterns find. */
      readonly protects: (path: string) => boolean;
    };

type PathMatcher = (path: string) => boolean;

type Compiled =
  | { readonly ok: true; readonly matches: PathMatcher }
  | { readonly ok: false; readonly reason: string };

/**
 * The one producer of protection, for the tracker and for selection alike. A workspace the discovery did not
 * discover contributes nothing; one that does not report its selection facts, or a pattern picomatch refuses,
 * makes no pattern apply. `consumerRoot` is the consumer root's real path.
 */
export function protection(
  discovery: TestDiscovery | undefined,
  consumerRoot: string,
): Protection {
  if (discovery === undefined) {
    return { applies: false, reason: NO_DISCOVERY_REASON };
  }
  const projects: ProjectSelectionFacts[] = [];
  for (const entry of discovery.workspaces) {
    if (entry.status !== "discovered") continue;
    if (!entry.selectionFacts.reported) {
      return {
        applies: false,
        reason: `${NOT_REPORTED_REASON} ${entry.workspace.path === ROOT_PATH ? ROOT_WORKSPACE : entry.workspace.path}`,
      };
    }
    projects.push(...entry.selectionFacts.projects);
  }
  const matchers: PathMatcher[] = [];
  for (const project of projects) {
    const compiled = projectMatcher(project, consumerRoot);
    if (!compiled.ok) return { applies: false, reason: compiled.reason };
    matchers.push(compiled.matches);
  }
  const files = protectedFiles(discovery);
  return {
    applies: true,
    files,
    patternKey: JSON.stringify(
      projects.map((project) => project.testFilePatterns),
    ),
    protects: (path) =>
      files.has(path) || matchers.some((matches) => matches(path)),
  };
}

/** Root-relative: every test module the discovery lists, and every setup and global setup file its projects report. */
export function protectedFiles(discovery: TestDiscovery): ReadonlySet<string> {
  const files = new Set(discoveredTestModules(discovery));
  for (const entry of discovery.workspaces) {
    if (entry.status !== "discovered" || !entry.selectionFacts.reported) {
      continue;
    }
    for (const project of entry.selectionFacts.projects) {
      for (const file of project.setupFiles) files.add(file);
      for (const file of project.globalSetupFiles) files.add(file);
    }
  }
  return files;
}

/**
 * Finds what Vitest's discovery globs for the project: its `include` and its `includeSource` patterns, each globbed
 * on its own with `exclude` as the ignore list, from the project's pattern directory.
 */
function projectMatcher(
  project: ProjectSelectionFacts,
  consumerRoot: string,
): Compiled {
  const { directory, include, exclude, includeSource } =
    project.testFilePatterns;
  if (isAbsolute(directory)) return { ok: true, matches: () => false };
  const absoluteDirectory = absoluteInputPath(consumerRoot, directory);
  const cwd = absoluteDirectory.replace(BACKSLASHES, POSIX_SEPARATOR);
  const calls: PathMatcher[] = [];
  for (const patterns of [include, includeSource]) {
    const call = globCall(patterns, exclude, cwd, project);
    if (!call.ok) return call;
    calls.push(call.matches);
  }
  return {
    ok: true,
    matches: (path) => {
      const fromDirectory = relativePosixPath(
        absoluteDirectory,
        absoluteInputPath(consumerRoot, path),
      );
      if (fromDirectory === "" || isAbsolute(fromDirectory)) return false;
      return calls.some((matches) => matches(fromDirectory));
    },
  };
}

/**
 * One tinyglobby glob as Vitest calls it: patterns sorted into match and ignore lists as its `processPatterns`
 * does, and every directory below the crawl's root that the ignore list matches pruned with what it holds.
 */
function globCall(
  patterns: readonly string[],
  exclude: readonly string[],
  cwd: string,
  project: ProjectSelectionFacts,
): Compiled {
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
        reason: `${REFUSED_REASON} ${quotedPattern(written)} of the project ${JSON.stringify(project.projectName)}, ${REFUSED_CONSEQUENCE}: ${errorText(error)}`,
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

function quotedPattern(pattern: string): string {
  return pattern.length <= MAX_QUOTED_PATTERN_LENGTH
    ? JSON.stringify(pattern)
    : `${JSON.stringify(pattern.slice(0, MAX_QUOTED_PATTERN_LENGTH))}${TRUNCATION_MARK}`;
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
function directoryPrefix(directory: string): string {
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

/** Whether a root-relative path names a file under the consumer root, where every input lies. */
export function liesUnderRoot(path: string): boolean {
  return !isAbsolute(path) && !climbsOut(path, POSIX_SEPARATOR);
}
