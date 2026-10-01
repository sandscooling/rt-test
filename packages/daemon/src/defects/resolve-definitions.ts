import { readFile, stat } from "node:fs/promises";
import { countAnchor } from "../falsify/anchor-match.js";
import { wholeDigest } from "../inputs/input-inventory.js";
import { testModuleFile, workspaceTestModules } from "../inputs/non-inputs.js";
import type {
  DiscoveredTest,
  TestDiscovery,
} from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import { DEFECT_STATE } from "./defect-states.js";
import type { CheckedDefinition, DefinitionTest } from "./definitions.js";

/** What a definition reads from the files and the discovery alone, before any stored evidence is read for it. */
type ResolvedState =
  | typeof DEFECT_STATE.invalidDefinition
  | typeof DEFECT_STATE.anchorMissing
  | typeof DEFECT_STATE.neverVerified;

const PROBLEM_SEPARATOR = "; ";
const FIELD_SEPARATOR = " and ";
const LIST_SEPARATOR = ", ";
const ANCHOR_OCCURRENCES_WANTED = 1;
const ANCHOR_NOT_READ = "its mutation's file was not read";
const LISTED_MODULE = "the latest discovery lists that module";
const UNLISTED_MODULE = "the latest discovery does not list that module";
const FAILED_MODULE =
  "that module failed to collect in the latest discovery, so none of its tests is discovered";
/** A module can fail to collect in one project and hold discovered tests in another. */
const FAILED_IN_A_PROJECT =
  "that module failed to collect in a project of the latest discovery, so none of its tests there is discovered";
const FIELD = { project: "project", occurrence: "occurrence" } as const;

/** What reading one definition's anchor found: why it is missing, or nothing when its `old` occurs exactly once. */
interface AnchorRead {
  readonly missing: string | undefined;
  /** The digest of the mutation file's text as this read took it; absent when the file was not read. */
  readonly fileDigest?: string;
}

/** The anchor read of each definition no check found a problem in. */
export type AnchorReads = ReadonlyMap<CheckedDefinition, AnchorRead>;

const UNREAD_ANCHOR: AnchorRead = { missing: ANCHOR_NOT_READ };

/** A checked definition with its test resolved and its one state. */
export interface ResolvedDefinition extends CheckedDefinition {
  /** The one discovered test its well-formed test names, whatever its other problems; undefined when none. */
  readonly resolved: DiscoveredTest | undefined;
  /** Its test's module when the latest discovery lists that module; without one no scope can place it. */
  readonly discoveredModule: string | undefined;
  readonly state: ResolvedState;
  /** Why it is invalid or its anchor is missing; absent for never verified. */
  readonly reason?: string;
  /** The digest of its mutation file's text as its anchor was read; absent when that file was not read. */
  readonly mutationFileDigest?: string;
}

/** What the latest stored discovery holds, as a definition's test is resolved against it. */
interface DiscoveryIndex {
  /** Each discovered test by its module's root-relative path. */
  readonly tests: ReadonlyMap<string, readonly DiscoveredTest[]>;
  /** Every module the discovery lists, a failed or typecheck module included. */
  readonly modules: ReadonlySet<string>;
  /** Each module the discovery lists as failed to collect, in any project. */
  readonly failedModules: ReadonlySet<string>;
  readonly current: boolean;
}

type TestResolution =
  { readonly test: DiscoveredTest } | { readonly problem: string } | undefined;

type FileText =
  | { readonly text: string; readonly digest: string }
  | { readonly unreadable: string };

/**
 * Reads the anchor of each definition no check found a problem in, in its mutation's file as it is now, reading each
 * file once and one at a time, so a large catalog never holds more than one file open. It reads no discovery, so a
 * caller can take the discovery once these reads have ended.
 */
export async function readAnchors(
  definitions: readonly CheckedDefinition[],
  signal: AbortSignal,
): Promise<AnchorReads> {
  const files = new Map<string, FileText>();
  const anchors = new Map<CheckedDefinition, AnchorRead>();
  for (const definition of definitions) {
    signal.throwIfAborted();
    if (definition.problems.length > 0) continue;
    anchors.set(definition, await readAnchor(definition, files));
  }
  return anchors;
}

async function readAnchor(
  definition: CheckedDefinition,
  files: Map<string, FileText>,
): Promise<AnchorRead> {
  const content = await mutationFileText(definition, files);
  const missing = anchorProblem(definition, content);
  return content !== undefined && "digest" in content
    ? { missing, fileDigest: content.digest }
    : { missing };
}

/** The mutation's file, read once however many definitions name it; undefined when the definition names no file to read. */
async function mutationFileText(
  definition: CheckedDefinition,
  files: Map<string, FileText>,
): Promise<FileText | undefined> {
  const { mutationPath } = definition;
  if (mutationPath === undefined) return undefined;
  let content = files.get(mutationPath);
  if (content === undefined) {
    content = await readMutationFile(mutationPath);
    files.set(mutationPath, content);
  }
  return content;
}

/** Resolves each definition's test against the latest stored discovery and gives it its one state, reading no file. */
export function resolveDefinitions(
  definitions: readonly CheckedDefinition[],
  anchors: AnchorReads,
  discovery: TestDiscovery,
  discoveryCurrent: boolean,
): ResolvedDefinition[] {
  const index = discoveryIndex(discovery, discoveryCurrent);
  return definitions.map((definition) =>
    resolveDefinition(definition, index, anchors),
  );
}

/** A valid, resolved definition whose anchor was not read reads anchor missing, never as never verified. */
function resolveDefinition(
  definition: CheckedDefinition,
  index: DiscoveryIndex,
  anchors: AnchorReads,
): ResolvedDefinition {
  const { modulePath } = definition;
  const discoveredModule =
    modulePath !== undefined && index.modules.has(modulePath)
      ? modulePath
      : undefined;
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
      discoveredModule,
      state: DEFECT_STATE.invalidDefinition,
      reason: problems.join(PROBLEM_SEPARATOR),
    };
  }
  const { missing, fileDigest } = anchors.get(definition) ?? UNREAD_ANCHOR;
  const read = {
    ...definition,
    resolved,
    discoveredModule,
    ...(fileDigest === undefined ? {} : { mutationFileDigest: fileDigest }),
  };
  return missing === undefined
    ? { ...read, state: DEFECT_STATE.neverVerified }
    : { ...read, state: DEFECT_STATE.anchorMissing, reason: missing };
}

function discoveryIndex(
  discovery: TestDiscovery,
  current: boolean,
): DiscoveryIndex {
  const tests = new Map<string, DiscoveredTest[]>();
  const modules = new Set<string>();
  const failedModules = new Set<string>();
  for (const entry of discovery.workspaces) {
    for (const module of workspaceTestModules(entry)) modules.add(module);
    if (entry.status !== "discovered") continue;
    for (const failed of entry.failedModules) {
      failedModules.add(
        testModuleFile(entry.workspace.path, failed.modulePath),
      );
    }
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
  return { tests, modules, failedModules, current };
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
    ? listedModuleText(modulePath, index)
    : UNLISTED_MODULE;
  const currency = index.current
    ? ""
    : ", and that discovery is not current, so a test added since it was stored is not discovered until the next one is";
  return `its test is not discovered: no discovered test in ${modulePath} has the name path ${JSON.stringify(test.name)}${narrowingText(test)}; ${listing}${currency}`;
}

function listedModuleText(modulePath: string, index: DiscoveryIndex): string {
  if (!index.failedModules.has(modulePath)) return LISTED_MODULE;
  return index.tests.has(modulePath) ? FAILED_IN_A_PROJECT : FAILED_MODULE;
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
function anchorProblem(
  definition: CheckedDefinition,
  content: FileText | undefined,
): string | undefined {
  const { mutation } = definition;
  if (mutation === undefined || content === undefined) {
    return ANCHOR_NOT_READ;
  }
  if ("unreadable" in content) {
    return `its mutation's file ${mutation.file} cannot be read: ${content.unreadable}`;
  }
  const count = countAnchor(content.text, mutation.old);
  if (count === ANCHOR_OCCURRENCES_WANTED) return undefined;
  return `its mutation's old text occurs ${count} times in ${mutation.file}, not once`;
}

/** Only a regular file is read, since a FIFO's read can block. The digest is of the text as decoded, a byte order mark kept. */
async function readMutationFile(path: string): Promise<FileText> {
  try {
    if (!(await stat(path)).isFile()) {
      return { unreadable: "it is not a regular file" };
    }
    const text = await readFile(path, "utf8");
    return { text, digest: wholeDigest(text) };
  } catch (error) {
    return { unreadable: errorText(error) };
  }
}
