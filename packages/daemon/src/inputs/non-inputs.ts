import { lstatSync, type Stats } from "node:fs";
import { isAbsolute, join, posix } from "node:path";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import { isRecord, isStringArray } from "../json-guards.js";
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
/**
 * Every environment variable is tested against every entry at each reconciliation, and again for each set of
 * variables a workspace counts by value, so this bounds that work.
 */
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
      /**
       * Present only when the file has the member: names, or prefixes ending in `*`, counted only as set, except for a
       * workspace whose tests Vite can carry one to.
       */
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
  const before = presenceDeclaration(file);
  if (before !== true) return before;
  const read = readJson(file);
  if (!read.ok) {
    const after = presenceDeclaration(file);
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

export const PRESENCE = {
  file: "file",
  absent: "absent",
  link: "link",
  other: "other",
  unreadable: "unreadable",
} as const;

/** What is at a path, read without following a link. */
export type Presence =
  | {
      readonly kind: Exclude<
        (typeof PRESENCE)[keyof typeof PRESENCE],
        typeof PRESENCE.unreadable
      >;
    }
  | { readonly kind: typeof PRESENCE.unreadable; readonly reason: string };

/**
 * Only a regular file is read: a symbolic link is never followed, and a FIFO or device is never read, since its read
 * can block.
 */
export function presence(file: string): Presence {
  let stats: Stats | undefined;
  try {
    stats = lstatSync(file, { throwIfNoEntry: false });
  } catch (error) {
    return { kind: PRESENCE.unreadable, reason: errorText(error) };
  }
  if (stats === undefined) return { kind: PRESENCE.absent };
  if (stats.isSymbolicLink()) return { kind: PRESENCE.link };
  return { kind: stats.isFile() ? PRESENCE.file : PRESENCE.other };
}

/** True when a regular file is there; otherwise the declaration its absence, another kind of entry, or the failure to tell, makes. */
function presenceDeclaration(file: string): true | NonInputsDeclaration {
  const found = presence(file);
  switch (found.kind) {
    case PRESENCE.file:
      return true;
    case PRESENCE.absent:
      return { file: NON_INPUTS_FILE, state: NON_INPUTS_ABSENT };
    case PRESENCE.link:
      return unusable(SYMBOLIC_LINK_PROBLEM);
    case PRESENCE.other:
      return unusable(NOT_A_FILE_PROBLEM);
    case PRESENCE.unreadable:
      return unusable(`it cannot be read: ${found.reason}`);
  }
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
  if (!isRecord(value)) return "its top level is not a JSON object";
  return (
    listProblem(value, PATTERNS_MEMBER) ?? listProblem(value, VARIABLES_MEMBER)
  );
}

/** A member the file does not have is no problem; one it has must be an array of strings, each usable. */
function listProblem(value: object, rule: ListMember): string | undefined {
  const list = objectField(value, rule.member);
  if (list === undefined) return undefined;
  if (!isStringArray(list)) {
    return `its ${rule.member} member is not an array of strings`;
  }
  if (list.length > rule.max) {
    return `its ${rule.member} member holds ${list.length} ${rule.items}, more than the ${rule.max} allowed`;
  }
  for (const item of list) {
    const problem = rule.problem(item);
    if (problem !== undefined) {
      return `the ${rule.item} ${JSON.stringify(item)} ${problem}`;
    }
  }
  return undefined;
}

/** Why a root-relative pattern cannot be used, or undefined when it can. */
export function patternProblem(pattern: string): string | undefined {
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
export function matchesPath(
  pattern: readonly string[],
  path: readonly string[],
): boolean {
  return matchesSequence(pattern, path, GLOBSTAR, matchesSegment);
}

/** Whether the pattern could match a path below the directory `directory` names, a segment or more deeper. */
export function matchesBelow(
  pattern: readonly string[],
  directory: readonly string[],
): boolean {
  const reached = new Set<number>([0]);
  for (const name of directory) {
    const next = new Set<number>();
    for (const index of withGlobstarSkips(pattern, reached)) {
      const wanted = pattern[index];
      if (wanted === GLOBSTAR) next.add(index);
      else if (wanted !== undefined && matchesSegment(wanted, name)) {
        next.add(index + 1);
      }
    }
    if (next.size === 0) return false;
    reached.clear();
    for (const index of next) reached.add(index);
  }
  return [...withGlobstarSkips(pattern, reached)].some(
    (index) => index < pattern.length,
  );
}

/** Each pattern position reached, and each one past the `**` runs it stands on, which may match no segment. */
function withGlobstarSkips(
  pattern: readonly string[],
  reached: ReadonlySet<number>,
): Set<number> {
  const all = new Set<number>();
  for (let index of reached) {
    all.add(index);
    while (pattern[index] === GLOBSTAR) {
      index += 1;
      all.add(index);
    }
  }
  return all;
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
