import { lstatSync } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { CONFIG_FILE_NAME as TYPESCRIPT_CONFIG_NAME } from "../selection/source-walk.js";
import { errorText } from "../vitest/error-text.js";
import {
  LOCKFILES,
  objectField,
  PACKAGE_JSON,
  PNPM_WORKSPACE_FILE,
  POSIX_SEPARATOR,
  readJson,
  VITE_CONFIG_FILES,
  VITEST_CONFIG_FILES,
} from "../vitest/find-workspaces.js";

/** The consumer's RT Test settings file, at the consumer root and committed with the project. */
export const NON_INPUTS_FILE = "rt-test.json";
const NON_INPUTS_MEMBER = "nonInputs";
/** Every file of a full reconciliation is tested against every pattern, so this bounds that work. */
const MAX_NON_INPUT_PATTERNS = 256;
const GLOBSTAR = "**";
const ANY_RUN = "*";
const ANY_CHARACTER = "?";
const FORBIDDEN_CHARACTERS = ["\\", "[", "]", "{", "}", "!"];
const INVALID_SEGMENTS = ["", ".", ".."];
const WILDCARD_CHARACTERS = [ANY_RUN, ANY_CHARACTER];

export const NON_INPUTS_ABSENT = "absent";
const NON_INPUTS_DECLARED = "declared";
export const NON_INPUTS_UNUSABLE = "unusable";

/** What `rt-test.json` at the consumer root declares: nothing when it is absent, its patterns, or why it declares nothing. */
export type NonInputsDeclaration =
  | {
      readonly file: typeof NON_INPUTS_FILE;
      readonly state: typeof NON_INPUTS_ABSENT;
    }
  | {
      readonly file: typeof NON_INPUTS_FILE;
      readonly state: typeof NON_INPUTS_DECLARED;
      readonly patterns: readonly string[];
    }
  | {
      readonly file: typeof NON_INPUTS_FILE;
      readonly state: typeof NON_INPUTS_UNUSABLE;
      /** A whole sentence saying that every file stays an input, and why. */
      readonly reason: string;
    };

/** The pattern that makes a root-relative, `/`-separated path a declared non-input, or undefined when it is an input. */
export type NonInputMatch = (path: string) => string | undefined;

const PROTECTED_NAMES: ReadonlySet<string> = new Set([
  PACKAGE_JSON,
  PNPM_WORKSPACE_FILE,
  ...LOCKFILES,
  ...VITEST_CONFIG_FILES,
  ...VITE_CONFIG_FILES,
]);

/** Reads files only. A missing file declares nothing silently; one that cannot be used declares nothing, with the reason. */
export function readNonInputs(consumerRoot: string): NonInputsDeclaration {
  const file = join(consumerRoot, NON_INPUTS_FILE);
  const before = presence(file);
  if (before !== true) return before;
  const read = readJson(file);
  if (!read.ok) {
    const after = presence(file);
    return after === true ? unusable(`it ${read.reason}`) : after;
  }
  const problem = declarationProblem(read.value);
  if (problem !== undefined) return unusable(problem);
  const patterns = objectField(read.value, NON_INPUTS_MEMBER);
  return {
    file: NON_INPUTS_FILE,
    state: NON_INPUTS_DECLARED,
    patterns: patterns === undefined ? [] : (patterns as string[]),
  };
}

/** Whether two declarations would leave the same patterns in effect, or give the same reason. */
export function sameDeclaration(
  first: NonInputsDeclaration,
  second: NonInputsDeclaration,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** The reason every file stays an input, while the declaration cannot be used; undefined otherwise. */
export function unusableReason(
  declaration: NonInputsDeclaration,
): string | undefined {
  return declaration.state === NON_INPUTS_UNUSABLE
    ? declaration.reason
    : undefined;
}

/**
 * Decides declared non-inputs for one declaration and one set of protected test modules. `rt-test.json` itself,
 * every manifest, workspace list, lockfile, Vitest or Vite config, tsconfig or jsconfig file, and each protected
 * test module is never one.
 */
export function declaredNonInputs(
  declaration: NonInputsDeclaration,
  protectedTestModules: ReadonlySet<string>,
): NonInputMatch {
  if (
    declaration.state !== NON_INPUTS_DECLARED ||
    declaration.patterns.length === 0
  ) {
    return () => undefined;
  }
  const compiled = declaration.patterns.map((pattern) => ({
    pattern,
    segments: pattern.split(POSIX_SEPARATOR),
  }));
  return (path) => {
    if (
      path === NON_INPUTS_FILE ||
      TYPESCRIPT_CONFIG_NAME.test(posix.basename(path)) ||
      PROTECTED_NAMES.has(posix.basename(path)) ||
      protectedTestModules.has(path)
    ) {
      return undefined;
    }
    const segments = path.split(POSIX_SEPARATOR);
    return compiled.find((entry) => matchesPath(entry.segments, segments))
      ?.pattern;
  };
}

/** Every test module the discovery lists, named by `testModuleFile`: each workspace's test, failed and typecheck modules. */
export function discoveredTestModules(discovery: TestDiscovery): string[] {
  return [...new Set(discovery.workspaces.flatMap(workspaceTestModules))];
}

/** The test modules the discovery lists for one workspace, named by `testModuleFile`. */
export function workspaceTestModules(entry: WorkspaceDiscovery): string[] {
  if (entry.status !== "discovered") return [];
  const modulePaths = [
    ...entry.tests.map((test) => test.identity.modulePath),
    ...entry.failedModules.map((module) => module.modulePath),
    ...entry.typecheckModules.map((module) => module.modulePath),
  ];
  return [
    ...new Set(
      modulePaths.map((path) => testModuleFile(entry.workspace.path, path)),
    ),
  ];
}

/**
 * A test module's path relative to the consumer root; its module path is relative to its workspace's directory, or
 * absolute when it lies on another Windows drive, where no relative path reaches it.
 */
export function testModuleFile(
  workspacePath: string,
  modulePath: string,
): string {
  if (isAbsolute(modulePath)) return modulePath;
  return posix.normalize(posix.join(workspacePath, modulePath));
}

/** True when the file exists; otherwise the declaration its absence, or the failure to tell, makes. */
function presence(file: string): true | NonInputsDeclaration {
  try {
    return lstatSync(file, { throwIfNoEntry: false }) === undefined
      ? { file: NON_INPUTS_FILE, state: NON_INPUTS_ABSENT }
      : true;
  } catch (error) {
    return unusable(`it cannot be read: ${errorText(error)}`);
  }
}

function unusable(why: string): NonInputsDeclaration {
  return {
    file: NON_INPUTS_FILE,
    state: NON_INPUTS_UNUSABLE,
    reason: `${NON_INPUTS_FILE} declares no non-inputs, so every file stays an input: ${why}`,
  };
}

function declarationProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "its top level is not a JSON object";
  }
  const patterns = objectField(value, NON_INPUTS_MEMBER);
  if (patterns === undefined) return undefined;
  if (
    !Array.isArray(patterns) ||
    !patterns.every((pattern) => typeof pattern === "string")
  ) {
    return `its ${NON_INPUTS_MEMBER} member is not an array of strings`;
  }
  if (patterns.length > MAX_NON_INPUT_PATTERNS) {
    return `its ${NON_INPUTS_MEMBER} member holds ${patterns.length} patterns, more than the ${MAX_NON_INPUT_PATTERNS} allowed`;
  }
  for (const pattern of patterns as string[]) {
    const problem = patternProblem(pattern);
    if (problem !== undefined) {
      return `the pattern ${JSON.stringify(pattern)} ${problem}`;
    }
  }
  return undefined;
}

function patternProblem(pattern: string): string | undefined {
  if (pattern === "") return "is empty";
  if (pattern.startsWith(POSIX_SEPARATOR)) {
    return `begins with ${POSIX_SEPARATOR}; a pattern is relative to the consumer root`;
  }
  const forbidden = FORBIDDEN_CHARACTERS.find((character) =>
    pattern.includes(character),
  );
  if (forbidden !== undefined) return `contains ${forbidden}`;
  const segments = pattern.split(POSIX_SEPARATOR);
  if (segments.some((segment) => INVALID_SEGMENTS.includes(segment))) {
    return "has an empty, . or .. segment";
  }
  if (
    segments.some(
      (segment) => segment !== GLOBSTAR && segment.includes(GLOBSTAR),
    )
  ) {
    return `uses ${GLOBSTAR} inside a segment rather than as a whole one`;
  }
  return undefined;
}

/** Whole segments, `**` standing for any number of them, none included. */
function matchesPath(
  pattern: readonly string[],
  path: readonly string[],
): boolean {
  return matchesSequence(pattern, path, GLOBSTAR, matchesSegment);
}

/** `*` stands for any run of characters within the segment and `?` for one, a leading dot included. */
function matchesSegment(pattern: string, name: string): boolean {
  if (!WILDCARD_CHARACTERS.some((wildcard) => pattern.includes(wildcard))) {
    return pattern === name;
  }
  return matchesSequence(
    Array.from(pattern),
    Array.from(name),
    ANY_RUN,
    (wanted, character) => wanted === ANY_CHARACTER || wanted === character,
  );
}

/**
 * Whether `subject` matches `pattern`, where each `run` element stands for any number of subject elements and
 * every other element for one that `matchesOne` accepts. Only the latest `run` is ever resumed, so the work is at
 * most the product of the two lengths.
 */
function matchesSequence<T>(
  pattern: readonly T[],
  subject: readonly T[],
  run: T,
  matchesOne: (wanted: T, element: T) => boolean,
): boolean {
  let patternIndex = 0;
  let subjectIndex = 0;
  let resumePattern = -1;
  let resumeSubject = 0;
  while (subjectIndex < subject.length) {
    const wanted = pattern[patternIndex];
    if (wanted === run) {
      resumePattern = patternIndex;
      resumeSubject = subjectIndex;
      patternIndex += 1;
    } else if (
      patternIndex < pattern.length &&
      matchesOne(wanted as T, subject[subjectIndex] as T)
    ) {
      patternIndex += 1;
      subjectIndex += 1;
    } else if (resumePattern !== -1) {
      patternIndex = resumePattern + 1;
      resumeSubject += 1;
      subjectIndex = resumeSubject;
    } else {
      return false;
    }
  }
  while (pattern[patternIndex] === run) patternIndex += 1;
  return patternIndex === pattern.length;
}
