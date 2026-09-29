import { isAbsolute, posix } from "node:path";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import {
  climbsOut,
  POSIX_SEPARATOR,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";
import type {
  ProjectSelectionFacts,
  SpelledDirectory,
} from "../vitest/selection-facts.js";
import { absoluteInputPath } from "./input-filter.js";
import { discoveredTestModules, NON_INPUTS_FILE } from "./non-inputs.js";
import {
  BACKSLASHES,
  directoryPrefix,
  globCall,
  type CompiledGlob,
  type GlobRefusal,
  type PathMatcher,
} from "./vitest-glob.js";

const PATTERNS_DO_NOT_APPLY = `${NON_INPUTS_FILE}'s patterns do not apply, so every file stays an input`;
const NO_DISCOVERY_REASON = `${PATTERNS_DO_NOT_APPLY}: no discovery in effect reports which files they may not remove`;
const NOT_REPORTED_REASON = `${PATTERNS_DO_NOT_APPLY}: the discovery in effect does not report which files they may not remove for the workspace`;
/** How a reason names the workspace at the consumer root, whose path is `.`. */
const ROOT_WORKSPACE = "at the consumer root";
const REFUSED_REASON = `${PATTERNS_DO_NOT_APPLY}: picomatch cannot compile the test file pattern`;
const REFUSED_CONSEQUENCE = "so the files it finds are not known";
const UNKNOWN_LINKS_REASON = `${PATTERNS_DO_NOT_APPLY}: the directory links Vitest's crawl follows are not known for the project`;
/** A refused pattern can be longer than picomatch's input limit, and its quote goes into every answer. */
const MAX_QUOTED_PATTERN_LENGTH = 200;
const TRUNCATION_MARK = "...";

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

type Refused = { readonly ok: false; readonly reason: string };

type Compiled = { readonly ok: true; readonly matches: PathMatcher } | Refused;

/** A workspace as a reason names it: by its path, or as the one at the consumer root. */
export function workspaceName(path: string): string {
  return path === ROOT_PATH ? ROOT_WORKSPACE : path;
}

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
        reason: `${NOT_REPORTED_REASON} ${workspaceName(entry.workspace.path)}`,
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
 * on its own with `exclude` as the ignore list. A path is found from the pattern directory's real path or by a
 * spelling Vitest's glob reaches it through, so a root started by another spelling only adds what is found.
 */
function projectMatcher(
  project: ProjectSelectionFacts,
  consumerRoot: string,
): Compiled {
  const fromRealPath = realPathMatcher(project, consumerRoot);
  if (!fromRealPath.ok) return fromRealPath;
  const { crawledLinks } = project.testFilePatterns;
  const links = crawledLinks.complete ? crawledLinks.links : [];
  const bySpelling = spelledMatcher(project, links, consumerRoot);
  if (!bySpelling.ok) return bySpelling;
  if (!crawledLinks.complete) {
    return {
      ok: false,
      reason: `${UNKNOWN_LINKS_REASON} ${JSON.stringify(project.projectName)}: ${crawledLinks.reason}`,
    };
  }
  return {
    ok: true,
    matches: (path) => fromRealPath.matches(path) || bySpelling.matches(path),
  };
}

/** Normalizes the patterns against the real path of the project's pattern directory. */
function realPathMatcher(
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
    const call = globCall(patterns, exclude, cwd);
    if (!call.ok) return refusedPattern(call, project);
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
 * Normalizes the patterns against Vitest's own spelling of the pattern directory, and names a file by each spelling
 * the crawl can reach it through: that directory's, the one a pattern writes for its own directories, or a directory
 * link the crawl follows below them.
 */
function spelledMatcher(
  project: ProjectSelectionFacts,
  links: readonly SpelledDirectory[],
  consumerRoot: string,
): Compiled {
  const {
    vitestDirectory,
    directory,
    patternBases,
    include,
    exclude,
    includeSource,
  } = project.testFilePatterns;
  const spellings: readonly Spelling[] = [
    { spelled: vitestDirectory, directory },
    ...patternBases,
    ...links,
  ].map((base: SpelledDirectory) => ({
    spelled: base.spelled,
    real: absoluteInputPath(consumerRoot, base.directory),
  }));
  const globbed = [include, includeSource];
  const globs: Extract<CompiledGlob, { ok: true }>[] = [];
  for (const patterns of globbed) {
    const glob = globCall(patterns, exclude, vitestDirectory);
    if (!glob.ok) return refusedPattern(glob, project);
    globs.push(glob);
  }
  return {
    ok: true,
    matches: (path) => {
      const file = absoluteInputPath(consumerRoot, path);
      return spellings.some((base) => {
        const spelled = spelledPath(base, file);
        if (spelled === undefined) return false;
        const fromCwd = posix.relative(vitestDirectory, spelled);
        return globs.some(
          (glob) => glob.reaches(spelled) && glob.matches(fromCwd),
        );
      });
    },
  };
}

/** A spelling the glob may name files by, with the absolute path it resolves to. */
interface Spelling {
  readonly spelled: string;
  readonly real: string;
}

/**
 * `file`, an absolute path, named through `base`'s spelling, or undefined when `base` neither holds it nor names it:
 * a pattern with no glob segment names its file whole.
 */
function spelledPath(base: Spelling, file: string): string | undefined {
  const below = relativePosixPath(base.real, file);
  if (isAbsolute(below) || climbsOut(below, POSIX_SEPARATOR)) return undefined;
  return below === ""
    ? base.spelled
    : `${directoryPrefix(base.spelled)}${below}`;
}

function refusedPattern(
  refusal: GlobRefusal,
  project: ProjectSelectionFacts,
): Refused {
  return {
    ok: false,
    reason: `${REFUSED_REASON} ${quotedPattern(refusal.written)} of the project ${JSON.stringify(project.projectName)}, ${REFUSED_CONSEQUENCE}: ${errorText(refusal.error)}`,
  };
}

function quotedPattern(pattern: string): string {
  return pattern.length <= MAX_QUOTED_PATTERN_LENGTH
    ? JSON.stringify(pattern)
    : `${JSON.stringify(pattern.slice(0, MAX_QUOTED_PATTERN_LENGTH))}${TRUNCATION_MARK}`;
}

/** Whether a root-relative path names a file under the consumer root, where every input lies. */
export function liesUnderRoot(path: string): boolean {
  return !isAbsolute(path) && !climbsOut(path, POSIX_SEPARATOR);
}
