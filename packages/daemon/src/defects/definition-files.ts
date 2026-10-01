import type { Dirent } from "node:fs";
import { opendir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "../json-guards.js";
import {
  listProblem,
  matchesBelow,
  matchesPath,
  NON_INPUTS_FILE,
  patternProblem,
  presence,
  PRESENCE,
  type ListMember,
} from "../inputs/non-inputs.js";
import {
  readCheckedIgnored,
  readIgnoredPaths,
} from "../selection/git-ignored.js";
import {
  holdsRepository,
  MAX_WALK_DEPTH,
  SKIPPED_DIRECTORIES,
} from "../selection/source-walk.js";
import { errorText } from "../vitest/error-text.js";
import {
  BYTE_ORDER_MARK,
  objectField,
  POSIX_SEPARATOR,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";

const DEFECTS_MEMBER = "defects";
/** Every entry the walk reaches is tested against every pattern, so this bounds that work. */
const MAX_DEFECT_PATTERNS = 256;
const DEFECTS_RULE: ListMember = {
  member: DEFECTS_MEMBER,
  max: MAX_DEFECT_PATTERNS,
  items: "patterns",
  item: "pattern",
  problem: patternProblem,
};
const MISSING_CODES = ["ENOENT", "ENOTDIR"];
/**
 * The numbers V8 ends its message with for where a parse failed, when it gives any. Its message may quote the file's
 * text before them, so only the end is read.
 */
const JSON_POSITION =
  / JSON at position (\d+)(?: \(line (\d+) column (\d+)\))?$/;
const PATTERN_SEPARATOR = ", ";
const LINKS_TO_DIRECTORY =
  "it links to a directory, which the walk never enters";

const INVALID_ENTRY = {
  settingsUnusable: "settings-unusable",
  patternMatchedNothing: "pattern-matched-nothing",
  depthBoundPassed: "depth-bound-passed",
  directoryLink: "directory-link",
  directoryNotListed: "directory-not-listed",
  notARegularFile: "not-a-regular-file",
  unreadable: "unreadable",
  notJson: "not-json",
  noDefectsArray: "no-defects-array",
} as const;

export type InvalidEntryKind =
  (typeof INVALID_ENTRY)[keyof typeof INVALID_ENTRY];

/** A problem that keeps the definitions a file or directory may hold from being read; each counts in the total. */
export interface InvalidEntry {
  readonly kind: InvalidEntryKind;
  /** Relative to the consumer root, `/`-separated; `ROOT_PATH` for the root itself. */
  readonly path: string;
  readonly reason: string;
}

/** One element of a definition file's `defects` array, unchecked. */
export interface DefinitionSource {
  /** Relative to the consumer root, `/`-separated. */
  readonly file: string;
  /** Its index in the file's `defects` array. */
  readonly position: number;
  readonly value: unknown;
}

export interface DefinitionFiles {
  readonly definitions: readonly DefinitionSource[];
  readonly invalidEntries: readonly InvalidEntry[];
}

interface Pattern {
  readonly text: string;
  readonly segments: readonly string[];
}

interface Walk {
  readonly root: string;
  readonly patterns: readonly Pattern[];
  readonly ignored: Set<string>;
  /**
   * Each directory git listed as holding only ignored entries without ignoring it itself, by its repository: an entry
   * under it is asked about before it counts, since one created after the listing may not be ignored.
   */
  readonly unconfirmed: Map<string, string>;
  readonly stateDirectory: string;
  readonly signal: AbortSignal;
  readonly files: string[];
  /** Each pattern some entry the walk met matches. */
  readonly matched: Set<Pattern>;
  readonly invalidEntries: InvalidEntry[];
}

interface Pending {
  readonly directory: string;
  readonly segments: readonly string[];
}

/** A file gone is absent, never an invalid entry. */
type Parsed =
  | { readonly state: "parsed"; readonly value: unknown }
  | { readonly state: "absent" }
  | { readonly state: "invalid"; readonly entry: InvalidEntry };

const ABSENT: Parsed = { state: "absent" };

/**
 * The definitions in the files the `defects` member of `rt-test.json` names, and each problem that keeps some from
 * being read. Reads JSON files only, and never follows a directory link.
 */
export async function readDefinitionFiles(
  consumerRoot: string,
  stateDirectory: string,
  signal: AbortSignal,
): Promise<DefinitionFiles> {
  const declared = await declaredPatterns(consumerRoot);
  if ("entry" in declared) {
    return { definitions: [], invalidEntries: [declared.entry] };
  }
  if (declared.patterns.length === 0) {
    return { definitions: [], invalidEntries: [] };
  }
  const walk: Walk = {
    root: resolve(consumerRoot),
    patterns: declared.patterns,
    ignored: new Set(),
    unconfirmed: new Map(),
    stateDirectory: resolve(stateDirectory),
    signal,
    files: [],
    matched: new Set(),
    invalidEntries: [],
  };
  await walkRoot(walk);
  walk.invalidEntries.push(...unmatchedPatterns(walk));
  const definitions: DefinitionSource[] = [];
  for (const file of walk.files) {
    signal.throwIfAborted();
    const read = await readDefinitions(walk.root, file);
    if ("entry" in read) walk.invalidEntries.push(read.entry);
    else definitions.push(...read.definitions);
  }
  return { definitions, invalidEntries: walk.invalidEntries };
}

/** No patterns when there is no `rt-test.json` or it has no `defects` member. */
async function declaredPatterns(
  consumerRoot: string,
): Promise<
  { readonly patterns: Pattern[] } | { readonly entry: InvalidEntry }
> {
  const settings = await readJsonFile(consumerRoot, NON_INPUTS_FILE);
  if (settings.state === "absent") return { patterns: [] };
  if (settings.state === "invalid") {
    return { entry: settingsEntry(settings.entry.reason) };
  }
  if (!isRecord(settings.value)) {
    return { entry: settingsEntry("its top level is not a JSON object") };
  }
  const problem = listProblem(settings.value, DEFECTS_RULE);
  if (problem !== undefined) return { entry: settingsEntry(problem) };
  const member = objectField(settings.value, DEFECTS_MEMBER);
  if (member === undefined) return { patterns: [] };
  return {
    patterns: (member as string[]).map((text) => ({
      text,
      segments: text.split(POSIX_SEPARATOR),
    })),
  };
}

function settingsEntry(problem: string): InvalidEntry {
  return {
    kind: INVALID_ENTRY.settingsUnusable,
    path: NON_INPUTS_FILE,
    reason: `${NON_INPUTS_FILE} names no definition files: ${problem}`,
  };
}

/**
 * Walks breadth-first from the root, entering only a directory below which some pattern could match, and skipping
 * `node_modules`, `.git`, the state directory and what git reports as ignored.
 */
async function walkRoot(walk: Walk): Promise<void> {
  await addIgnored(walk, walk.root);
  const pending: Pending[] = [{ directory: walk.root, segments: [] }];
  for (const next of pending) {
    walk.signal.throwIfAborted();
    if (next.segments.length > 0 && holdsRepository(next.directory)) {
      await addIgnored(walk, next.directory);
    }
    const entries = await listDirectory(walk, next);
    await checkUnconfirmed(walk, next.directory, entries);
    for (const entry of entries) {
      const segments = [...next.segments, entry.name];
      const path = join(next.directory, entry.name);
      if (isSkipped(walk, path, entry.name)) continue;
      const directory = await visitEntry(walk, entry, path, segments);
      if (directory !== undefined) pending.push(directory);
    }
  }
}

/**
 * One entry for each pattern no entry the walk met matches: a mistyped pattern or a renamed folder would otherwise
 * drop every definition file it named from the total with no entry.
 */
function unmatchedPatterns(walk: Walk): InvalidEntry[] {
  return walk.patterns
    .filter((pattern) => !walk.matched.has(pattern))
    .map((pattern) => ({
      kind: INVALID_ENTRY.patternMatchedNothing,
      path: NON_INPUTS_FILE,
      reason: `the pattern ${JSON.stringify(pattern.text)} matches no file, so no definition file it was written to name is read; the walk skips node_modules, .git, the state directory and what git ignores`,
    }));
}

/** Outside a git repository, or when git fails, nothing is skipped as ignored. */
async function addIgnored(walk: Walk, repository: string): Promise<void> {
  const listing = await readIgnoredPaths(repository, walk.signal);
  if (!listing.ok) return;
  for (const path of listing.paths) walk.ignored.add(path);
  for (const directory of listing.unconfirmed) {
    walk.unconfirmed.set(directory, repository);
  }
}

/** Asks git which of a directory's entries it ignores, when the directory lies at or under an unconfirmed one. */
async function checkUnconfirmed(
  walk: Walk,
  directory: string,
  entries: readonly Dirent[],
): Promise<void> {
  const repository = unconfirmedRepository(walk, directory);
  if (repository === undefined || entries.length === 0) return;
  const checked = await readCheckedIgnored(
    repository,
    entries.map((entry) =>
      relativePosixPath(repository, join(directory, entry.name)),
    ),
    walk.signal,
  );
  if (!checked.ok) return;
  for (const path of checked.paths) walk.ignored.add(path);
}

function unconfirmedRepository(
  walk: Walk,
  directory: string,
): string | undefined {
  for (let current = directory; ; current = dirname(current)) {
    const repository = walk.unconfirmed.get(current);
    if (repository !== undefined) return repository;
    if (current === walk.root || dirname(current) === current) {
      return undefined;
    }
  }
}

function isSkipped(walk: Walk, path: string, name: string): boolean {
  return (
    SKIPPED_DIRECTORIES.includes(name) ||
    walk.ignored.has(path) ||
    path === walk.stateDirectory
  );
}

/** A missing directory holds nothing; one that cannot be listed is an invalid entry. */
async function listDirectory(walk: Walk, next: Pending): Promise<Dirent[]> {
  try {
    const entries: Dirent[] = [];
    for await (const entry of await opendir(next.directory)) {
      entries.push(entry);
    }
    return entries.sort((left, right) => (left.name < right.name ? -1 : 1));
  } catch (error) {
    if (!isMissing(error)) {
      walk.invalidEntries.push({
        kind: INVALID_ENTRY.directoryNotListed,
        path: relativePath(next.segments),
        reason: `the directory cannot be listed, so the definition files it may hold are not read: ${errorText(error)}`,
      });
    }
    return [];
  }
}

/** The directory to walk next, when the entry is one some pattern could match below. */
async function visitEntry(
  walk: Walk,
  entry: Dirent,
  path: string,
  segments: readonly string[],
): Promise<Pending | undefined> {
  const matching = walk.patterns.filter((pattern) =>
    matchesPath(pattern.segments, segments),
  );
  const below = walk.patterns.filter((pattern) =>
    matchesBelow(pattern.segments, segments),
  );
  for (const pattern of matching) walk.matched.add(pattern);
  if (entry.isSymbolicLink()) {
    await visitLink(walk, path, segments, matching, below);
    return undefined;
  }
  if (entry.isDirectory()) {
    if (matching.some((pattern) => !below.includes(pattern))) {
      walk.invalidEntries.push(notAFile(segments, "it is a directory"));
    }
    return belowDirectory(walk, path, segments, below);
  }
  if (matching.length === 0) return undefined;
  if (entry.isFile()) walk.files.push(relativePath(segments));
  else walk.invalidEntries.push(notAFile(segments, "it is not a regular file"));
  return undefined;
}

async function visitLink(
  walk: Walk,
  path: string,
  segments: readonly string[],
  matching: readonly Pattern[],
  below: readonly Pattern[],
): Promise<void> {
  if (matching.length > 0) {
    walk.invalidEntries.push(
      notAFile(segments, "it is a symbolic link, which is never followed"),
    );
    return;
  }
  if (below.length === 0) return;
  const problem = await directoryLinkProblem(path);
  if (problem === undefined) return;
  walk.invalidEntries.push({
    kind: INVALID_ENTRY.directoryLink,
    path: relativePath(segments),
    reason: `${problem}, so the definition files ${patternsText(below)} may match below it are not read; narrow the pattern or move the files`,
  });
}

function belowDirectory(
  walk: Walk,
  path: string,
  segments: readonly string[],
  below: readonly Pattern[],
): Pending | undefined {
  if (below.length === 0) return undefined;
  if (segments.length > MAX_WALK_DEPTH) {
    walk.invalidEntries.push({
      kind: INVALID_ENTRY.depthBoundPassed,
      path: relativePath(segments),
      reason: `it lies more than ${MAX_WALK_DEPTH} levels below the consumer root, so the definition files ${patternsText(below)} may match below it are not read`,
    });
    return undefined;
  }
  return { directory: path, segments };
}

/**
 * Why a link is reported: it leads to a directory, or its target cannot be checked, which may hide one. A link to a
 * file or to nothing is not reported.
 */
async function directoryLinkProblem(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).isDirectory() ? LINKS_TO_DIRECTORY : undefined;
  } catch (error) {
    return isMissing(error)
      ? undefined
      : `it is a link whose target cannot be checked (${errorText(error)}), and the walk never follows a link`;
  }
}

function notAFile(segments: readonly string[], why: string): InvalidEntry {
  return {
    kind: INVALID_ENTRY.notARegularFile,
    path: relativePath(segments),
    reason: `a pattern matches it, but ${why}, and only a regular file is read as a definition file`,
  };
}

function patternsText(patterns: readonly Pattern[]): string {
  return patterns
    .map((pattern) => JSON.stringify(pattern.text))
    .join(PATTERN_SEPARATOR);
}

/** The file's definitions, or the one invalid entry it makes; a file gone since the walk holds none. */
async function readDefinitions(
  root: string,
  file: string,
): Promise<
  | { readonly definitions: DefinitionSource[] }
  | { readonly entry: InvalidEntry }
> {
  const read = await readJsonFile(root, file);
  if (read.state === "absent") return { definitions: [] };
  if (read.state === "invalid") return read;
  const defects = objectField(read.value, DEFECTS_MEMBER);
  if (!Array.isArray(defects)) {
    return {
      entry: {
        kind: INVALID_ENTRY.noDefectsArray,
        path: file,
        reason: `it holds no ${DEFECTS_MEMBER} array at its top level`,
      },
    };
  }
  return {
    definitions: (defects as unknown[]).map((value, position) => ({
      file,
      position,
      value,
    })),
  };
}

/** A regular file's JSON, its byte order mark dropped. */
async function readJsonFile(root: string, file: string): Promise<Parsed> {
  const path = join(root, file);
  const found = presence(path);
  switch (found.kind) {
    case PRESENCE.absent:
      return ABSENT;
    case PRESENCE.link:
      return invalid(
        INVALID_ENTRY.notARegularFile,
        file,
        "it is a symbolic link, which is never followed",
      );
    case PRESENCE.other:
      return invalid(
        INVALID_ENTRY.notARegularFile,
        file,
        "it is not a regular file",
      );
    case PRESENCE.unreadable:
      return invalid(
        INVALID_ENTRY.unreadable,
        file,
        `it cannot be read: ${found.reason}`,
      );
    case PRESENCE.file:
      return readRegularFile(path, file);
  }
}

async function readRegularFile(path: string, file: string): Promise<Parsed> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return ABSENT;
    return invalid(
      INVALID_ENTRY.unreadable,
      file,
      `it cannot be read: ${errorText(error)}`,
    );
  }
  return parseJson(file, text);
}

function invalid(kind: InvalidEntryKind, path: string, reason: string): Parsed {
  return { state: "invalid", entry: { kind, path, reason } };
}

function parseJson(file: string, text: string): Parsed {
  const json = text.startsWith(BYTE_ORDER_MARK)
    ? text.slice(BYTE_ORDER_MARK.length)
    : text;
  try {
    return { state: "parsed", value: JSON.parse(json) as unknown };
  } catch (error) {
    return {
      state: "invalid",
      entry: {
        kind: INVALID_ENTRY.notJson,
        path: file,
        reason: `it is not valid JSON${positionText(error)}`,
      },
    };
  }
}

/** Only the numbers are taken from the parser's message. */
function positionText(error: unknown): string {
  const found = JSON_POSITION.exec(errorText(error));
  if (found === null) return "";
  const [, position, line, column] = found;
  const where =
    line === undefined ? "" : ` (line ${line}, column ${column ?? ""})`;
  return ` at position ${position ?? ""}${where}`;
}

function isMissing(error: unknown): boolean {
  const code: unknown =
    error instanceof Error ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && MISSING_CODES.includes(code);
}

function relativePath(segments: readonly string[]): string {
  return segments.length === 0 ? ROOT_PATH : segments.join(POSIX_SEPARATOR);
}
