import {
  listProblem,
  NON_INPUTS_FILE,
  patternProblem,
  type ListMember,
} from "../inputs/non-inputs.js";
import { isRecord } from "../json-guards.js";
import { objectField } from "../vitest/find-workspaces.js";

const DEFINITION_FILES_MEMBER = "defects";
/** Every entry the walk reaches is tested against every pattern, so this bounds that work. */
const MAX_DEFECT_PATTERNS = 256;
const DEFECTS_RULE: ListMember = {
  member: DEFINITION_FILES_MEMBER,
  max: MAX_DEFECT_PATTERNS,
  items: "patterns",
  item: "pattern",
  problem: patternProblem,
};
const ASSERTION_ERRORS_MEMBER = "assertionErrors";
/** Every error of a judged test is compared with every name, so this bounds that work. */
const MAX_ASSERTION_ERRORS = 256;
/** The name an error carries unless it is given one of its own. */
const PLAIN_ERROR_NAME = "Error";
const PLAIN_ERROR_PROBLEM =
  "is carried by every plain thrown error, a setup failure among them, and an error must carry a name of its own to be declared; throw an error with a name of its own and declare that name, or fail through expect";
const ASSERTION_ERRORS_RULE: ListMember = {
  member: ASSERTION_ERRORS_MEMBER,
  max: MAX_ASSERTION_ERRORS,
  items: "names",
  item: "name",
  problem: nameProblem,
};
const NAMES_NO_FILES = "names no definition files";
const DECLARES_NO_NAMES = "declares no assertion error names";
const NOT_AN_OBJECT = "its top level is not a JSON object";

/** What `rt-test.json` declares for the defects query. */
export interface DeclaredSettings {
  /** The patterns its `defects` member names definition files by. */
  readonly patterns: readonly string[];
  /** The error names its `assertionErrors` member declares as assertions, as it writes them. */
  readonly assertionErrors: readonly string[];
  /** Why a member declares nothing, each a whole sentence, the `defects` member's first. */
  readonly problems: readonly string[];
}

interface DeclaredList {
  readonly items: readonly string[];
  readonly problems: readonly string[];
}

export const NOTHING_DECLARED: DeclaredSettings = {
  patterns: [],
  assertionErrors: [],
  problems: [],
};

/**
 * What a parsed `rt-test.json` declares. A member it does not have declares nothing, and each member is checked apart
 * from the other, so a problem in one leaves the other read.
 */
export function declaredSettings(value: unknown): DeclaredSettings {
  if (!isRecord(value)) return unreadSettings(NOT_AN_OBJECT);
  const patterns = declaredList(value, DEFECTS_RULE, NAMES_NO_FILES);
  const names = declaredList(value, ASSERTION_ERRORS_RULE, DECLARES_NO_NAMES);
  return {
    patterns: patterns.items,
    assertionErrors: names.items,
    problems: [...patterns.problems, ...names.problems],
  };
}

/** A file none of which can be read declares nothing and is one problem, never one for each member. */
export function unreadSettings(why: string): DeclaredSettings {
  return { ...NOTHING_DECLARED, problems: [problemText(NAMES_NO_FILES, why)] };
}

function declaredList(
  value: object,
  rule: ListMember,
  declaresNothing: string,
): DeclaredList {
  const problem = listProblem(value, rule);
  if (problem !== undefined) {
    return { items: [], problems: [problemText(declaresNothing, problem)] };
  }
  const member = objectField(value, rule.member);
  return {
    items: member === undefined ? [] : (member as string[]),
    problems: [],
  };
}

function problemText(declaresNothing: string, why: string): string {
  return `${NON_INPUTS_FILE} ${declaresNothing}: ${why}`;
}

/** Why a declared error name cannot be used, or undefined when it can. */
function nameProblem(name: string): string | undefined {
  if (name === "") return "is empty";
  return name === PLAIN_ERROR_NAME ? PLAIN_ERROR_PROBLEM : undefined;
}
