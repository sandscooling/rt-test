import { readFile, stat } from "node:fs/promises";
import { countAnchor } from "../falsify/anchor-match.js";
import { testModuleFile, workspaceTestModules } from "../inputs/non-inputs.js";
import type {
  DiscoveredTest,
  TestDiscovery,
} from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import type { CheckedDefinition, DefinitionTest } from "./definitions.js";

export const DEFECT_STATE = {
  invalidDefinition: "invalid-definition",
  anchorMissing: "anchor-missing",
  neverVerified: "never-verified",
} as const;

export type DefectState = (typeof DEFECT_STATE)[keyof typeof DEFECT_STATE];

/** Every state a definition can hold before any evidence is stored, those that withhold verified for a problem first. */
export const DEFECT_STATES: readonly DefectState[] = [
  DEFECT_STATE.invalidDefinition,
  DEFECT_STATE.anchorMissing,
  DEFECT_STATE.neverVerified,
];

const PROBLEM_SEPARATOR = "; ";
const FIELD_SEPARATOR = " and ";
const LIST_SEPARATOR = ", ";
const ANCHOR_OCCURRENCES_WANTED = 1;
const FIELD = { project: "project", occurrence: "occurrence" } as const;

/** A checked definition with its test resolved and its one state. */
export interface ResolvedDefinition extends CheckedDefinition {
  /** The one discovered test its well-formed test names, whatever its other problems; undefined when none. */
  readonly resolved: DiscoveredTest | undefined;
  readonly state: DefectState;
  /** Why it is invalid or its anchor is missing; absent for never verified. */
  readonly reason?: string;
}

/** What the latest stored discovery holds, as a definition's test is resolved against it. */
interface DiscoveryIndex {
  /** Each discovered test by its module's root-relative path. */
  readonly tests: ReadonlyMap<string, readonly DiscoveredTest[]>;
  /** Every module the discovery lists, a failed or typecheck module included. */
  readonly modules: ReadonlySet<string>;
  readonly current: boolean;
}

type TestResolution =
  { readonly test: DiscoveredTest } | { readonly problem: string } | undefined;

type FileText = { readonly text: string } | { readonly unreadable: string };

/**
 * Resolves each definition's test against the latest stored discovery, then reads the anchor of each definition that
 * is valid and resolved in its mutation's file as it is now, reading each file once and one at a time, so a large
 * catalog never holds more than one file open.
 */
export async function resolveDefinitions(
  definitions: readonly CheckedDefinition[],
  discovery: TestDiscovery,
  discoveryCurrent: boolean,
  signal: AbortSignal,
): Promise<ResolvedDefinition[]> {
  const index = discoveryIndex(discovery, discoveryCurrent);
  const files = new Map<string, FileText>();
  const resolvedDefinitions: ResolvedDefinition[] = [];
  for (const definition of definitions) {
    signal.throwIfAborted();
    resolvedDefinitions.push(await resolveDefinition(definition, index, files));
  }
  return resolvedDefinitions;
}

async function resolveDefinition(
  definition: CheckedDefinition,
  index: DiscoveryIndex,
  files: Map<string, FileText>,
): Promise<ResolvedDefinition> {
  const resolution = resolveTest(definition, index);
  const resolved =
    resolution !== undefined && "test" in resolution
      ? resolution.test
      : undefined;
  const problems =
    resolution !== undefined && "problem" in resolution
      ? [...definition.problems, resolution.problem]
      : definition.problems;
  if (problems.length > 0 || resolved === undefined) {
    return {
      ...definition,
      resolved,
      state: DEFECT_STATE.invalidDefinition,
      reason: problems.join(PROBLEM_SEPARATOR),
    };
  }
  const missing = await anchorProblem(definition, files);
  return missing === undefined
    ? { ...definition, resolved, state: DEFECT_STATE.neverVerified }
    : {
        ...definition,
        resolved,
        state: DEFECT_STATE.anchorMissing,
        reason: missing,
      };
}

function discoveryIndex(
  discovery: TestDiscovery,
  current: boolean,
): DiscoveryIndex {
  const tests = new Map<string, DiscoveredTest[]>();
  const modules = new Set<string>();
  for (const entry of discovery.workspaces) {
    for (const module of workspaceTestModules(entry)) modules.add(module);
    if (entry.status !== "discovered") continue;
    for (const test of entry.tests) {
      const file = testModuleFile(
        entry.workspace.path,
        test.identity.modulePath,
      );
      const group = tests.get(file);
      if (group === undefined) tests.set(file, [test]);
      else group.push(test);
    }
  }
  return { tests, modules, current };
}

/** Undefined when the definition names no usable module, which is already one of its problems. */
function resolveTest(
  definition: CheckedDefinition,
  index: DiscoveryIndex,
): TestResolution {
  const { test, modulePath } = definition;
  if (test === undefined || modulePath === undefined) return undefined;
  const matches = (index.tests.get(modulePath) ?? []).filter((candidate) =>
    namesTest(test, candidate),
  );
  const [only] = matches;
  if (only !== undefined && matches.length === 1) return { test: only };
  if (matches.length === 0) {
    return { problem: notDiscoveredReason(test, modulePath, index) };
  }
  return { problem: ambiguousReason(test, matches) };
}

function namesTest(test: DefinitionTest, candidate: DiscoveredTest): boolean {
  const { identity } = candidate;
  return (
    identity.namePath.length === test.name.length &&
    identity.namePath.every((name, index) => name === test.name[index]) &&
    (test.project === undefined || identity.projectName === test.project) &&
    (test.occurrence === undefined || identity.occurrence === test.occurrence)
  );
}

function notDiscoveredReason(
  test: DefinitionTest,
  modulePath: string,
  index: DiscoveryIndex,
): string {
  const listing = index.modules.has(modulePath)
    ? "the latest discovery lists that module"
    : "the latest discovery does not list that module";
  const currency = index.current
    ? ""
    : ", and that discovery is not current, so a test added since it was stored is not discovered until the next one is";
  return `its test is not discovered: no discovered test in ${modulePath} has the name path ${JSON.stringify(test.name)}${narrowingText(test)}; ${listing}${currency}`;
}

function narrowingText(test: DefinitionTest): string {
  const given = [
    ...(test.project === undefined
      ? []
      : [`${FIELD.project} ${JSON.stringify(test.project)}`]),
    ...(test.occurrence === undefined
      ? []
      : [`${FIELD.occurrence} ${test.occurrence}`]),
  ];
  return given.length === 0 ? "" : ` with ${given.join(FIELD_SEPARATOR)}`;
}

/** Names the fields the definition leaves out that tell the matches apart, or says that none of the format's does. */
function ambiguousReason(
  test: DefinitionTest,
  matches: readonly DiscoveredTest[],
): string {
  const differ = (read: (identity: DiscoveredTest["identity"]) => unknown) =>
    new Set(matches.map((match) => read(match.identity))).size > 1;
  const fields = [
    ...(test.project === undefined && differ((identity) => identity.projectName)
      ? [FIELD.project]
      : []),
    ...(test.occurrence === undefined &&
    differ((identity) => identity.occurrence)
      ? [FIELD.occurrence]
      : []),
  ];
  const lead = `its test is ambiguous: it names ${matches.length} discovered tests`;
  if (fields.length > 0) {
    return `${lead}; give its ${fields.join(FIELD_SEPARATOR)} to tell them apart`;
  }
  const workspaces = [
    ...new Set(matches.map((match) => match.identity.workspacePath)),
  ];
  return `${lead}, which lie in the Vitest workspaces ${workspaces.join(LIST_SEPARATOR)}, and no field of the definition format tells them apart`;
}

/** Why the definition's anchor is missing, or undefined when its `old` occurs exactly once in the file as it is now. */
async function anchorProblem(
  definition: CheckedDefinition,
  files: Map<string, FileText>,
): Promise<string | undefined> {
  const { mutation, mutationPath } = definition;
  if (mutation === undefined || mutationPath === undefined) return undefined;
  let content = files.get(mutationPath);
  if (content === undefined) {
    content = await readMutationFile(mutationPath);
    files.set(mutationPath, content);
  }
  if ("unreadable" in content) {
    return `its mutation's file ${mutation.file} cannot be read: ${content.unreadable}`;
  }
  const count = countAnchor(content.text, mutation.old);
  if (count === ANCHOR_OCCURRENCES_WANTED) return undefined;
  return `its mutation's old text occurs ${count} times in ${mutation.file}, not once`;
}

/** Only a regular file is read, since a FIFO's read can block. */
async function readMutationFile(path: string): Promise<FileText> {
  try {
    if (!(await stat(path)).isFile()) {
      return { unreadable: "it is not a regular file" };
    }
    return { text: await readFile(path, "utf8") };
  } catch (error) {
    return { unreadable: errorText(error) };
  }
}
