import { lstatSync, type Stats } from "node:fs";
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
import { variableEntryProblem } from "./environment-digest.js";
import { liesInsideOnHost } from "./input-filter.js";
import type { Protection } from "./protection.js";

/** The consumer's RT Test settings file, at the consumer root and committed with the project. */
export const NON_INPUTS_FILE = "rt-test.json";
const NON_INPUTS_MEMBER = "nonInputs";
const NON_INPUT_VARIABLES_MEMBER = "nonInputVariables";
/** Every file of a full reconciliation is tested against every pattern, so this bounds that work. */
const MAX_NON_INPUT_PATTERNS = 256;
/** Every environment variable is tested against every entry at each reconciliation, so this bounds that work. */
const MAX_NON_INPUT_VARIABLES = 256;
const NO_VARIABLES: readonly string[] = [];
const GLOBSTAR = "**";
const ANY_RUN = "*";
const ANY_CHARACTER = "?";
const FORBIDDEN_CHARACTERS = ["\\", "[", "]", "{", "}", "!"];
const INVALID_SEGMENTS = ["", ".", ".."];
const SYMBOLIC_LINK_PROBLEM =
  "it is a symbolic link, and only a regular file at the consumer root is read";
const NOT_A_FILE_PROBLEM = "it is not a regular file";
const WILDCARD_CHARACTERS = [ANY_RUN, ANY_CHARACTER];

export const NON_INPUTS_ABSENT = "absent";
export const NON_INPUTS_DECLARED = "declared";
export const NON_INPUTS_UNUSABLE = "unusable";

/**
 * What `rt-test.json` at the consumer root declares: nothing when it is absent, its patterns and variable entries, or
 * why it declares nothing.
 */
export type NonInputsDeclaration =
  | {
      readonly file: typeof NON_INPUTS_FILE;
      readonly state: typeof NON_INPUTS_ABSENT;
    }
  | {
      readonly file: typeof NON_INPUTS_FILE;
      readonly state: typeof NON_INPUTS_DECLARED;
      readonly patterns: readonly string[];
      /** Present only when the file has the member: names, or prefixes ending in `*`, counted only as set. */
      readonly variables?: readonly string[];
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
  const variables = objectField(read.value, NON_INPUT_VARIABLES_MEMBER);
  return {
    file: NON_INPUTS_FILE,
    state: NON_INPUTS_DECLARED,
    patterns: patterns === undefined ? [] : (patterns as string[]),
    ...(variables === undefined ? {} : { variables: variables as string[] }),
  };
}

/** The variable entries the declaration adds to the session list; none while it is absent or cannot be used. */
export function declaredVariables(
  declaration: NonInputsDeclaration,
): readonly string[] {
  return declaration.state === NON_INPUTS_DECLARED
    ? (declaration.variables ?? NO_VARIABLES)
    : NO_VARIABLES;
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
 * Whether a root-relative, `/`-separated path is `rt-test.json` or lies under it, its name compared as the host
 * compares names. Both are anchored at `/`, so on POSIX the comparison never reads the working directory, which may
 * no longer exist, and on Windows both sides take the same drive from it.
 */
export function namesDeclarationFile(path: string): boolean {
  return liesInsideOnHost(
    `${POSIX_SEPARATOR}${NON_INPUTS_FILE}`,
    `${POSIX_SEPARATOR}${path}`,
  );
}

/**
 * Decides declared non-inputs for one declaration and one protection. No pattern applies while the protection says
 * none does. `rt-test.json` itself or a path under it, every manifest, workspace list, lockfile, Vitest or Vite
 * config, tsconfig or jsconfig file, and each file the protection protects is never one.
 */
export function declaredNonInputs(
  declaration: NonInputsDeclaration,
  protection: Protection,
): NonInputMatch {
  if (
    declaration.state !== NON_INPUTS_DECLARED ||
    declaration.patterns.length === 0 ||
    !protection.applies
  ) {
    return () => undefined;
  }
  const compiled = declaration.patterns.map((pattern) => ({
    pattern,
    segments: pattern.split(POSIX_SEPARATOR),
  }));
  return (path) => {
    if (
      namesDeclarationFile(path) ||
      TYPESCRIPT_CONFIG_NAME.test(posix.basename(path)) ||
      PROTECTED_NAMES.has(posix.basename(path))
    ) {
      return undefined;
    }
    const segments = path.split(POSIX_SEPARATOR);
    const pattern = compiled.find((entry) =>
      matchesPath(entry.segments, segments),
    )?.pattern;
    return pattern === undefined || protection.protects(path)
      ? undefined
      : pattern;
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

/**
 * True when a regular file is there; otherwise the declaration its absence, another kind of entry, or the failure
 * to tell, makes. A symbolic link is never followed, and a FIFO or device is never read, since its read can block.
 */
function presence(file: string): true | NonInputsDeclaration {
  let stats: Stats | undefined;
  try {
    stats = lstatSync(file, { throwIfNoEntry: false });
  } catch (error) {
    return unusable(`it cannot be read: ${errorText(error)}`);
  }
  if (stats === undefined) {
    return { file: NON_INPUTS_FILE, state: NON_INPUTS_ABSENT };
  }
  if (stats.isSymbolicLink()) return unusable(SYMBOLIC_LINK_PROBLEM);
  return stats.isFile() ? true : unusable(NOT_A_FILE_PROBLEM);
}

function unusable(why: string): NonInputsDeclaration {
  return {
    file: NON_INPUTS_FILE,
    state: NON_INPUTS_UNUSABLE,
    reason: `${NON_INPUTS_FILE} declares no non-inputs, so every file stays an input: ${why}`,
  };
}

/** How one list member of `rt-test.json` is checked, and the words its refusal uses. */
interface ListMember {
  readonly member: string;
  readonly max: number;
  /** The plural and singular nouns for an item. */
  readonly items: string;
  readonly item: string;
  readonly problem: (item: string) => string | undefined;
}

const PATTERNS_MEMBER: ListMember = {
  member: NON_INPUTS_MEMBER,
  max: MAX_NON_INPUT_PATTERNS,
  items: "patterns",
  item: "pattern",
  problem: patternProblem,
};

const VARIABLES_MEMBER: ListMember = {
  member: NON_INPUT_VARIABLES_MEMBER,
  max: MAX_NON_INPUT_VARIABLES,
  items: "entries",
  item: "variable entry",
  problem: variableEntryProblem,
};

function declarationProblem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "its top level is not a JSON object";
  }
  return (
    listProblem(value, PATTERNS_MEMBER) ?? listProblem(value, VARIABLES_MEMBER)
  );
}

/** A member the file does not have is no problem; one it has must be an array of strings, each usable. */
function listProblem(value: object, rule: ListMember): string | undefined {
  const list = objectField(value, rule.member);
  if (list === undefined) return undefined;
  if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
    return `its ${rule.member} member is not an array of strings`;
  }
  if (list.length > rule.max) {
    return `its ${rule.member} member holds ${list.length} ${rule.items}, more than the ${rule.max} allowed`;
  }
  for (const item of list as string[]) {
    const problem = rule.problem(item);
    if (problem !== undefined) {
      return `the ${rule.item} ${JSON.stringify(item)} ${problem}`;
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
