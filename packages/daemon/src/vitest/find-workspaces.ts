import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { isRecord } from "../json-guards.js";
import { errorText } from "./error-text.js";

const CONFIG_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
export const VITEST_CONFIG_FILES = CONFIG_EXTENSIONS.map(
  (ext) => `vitest.config${ext}`,
);
export const VITE_CONFIG_FILES = CONFIG_EXTENSIONS.map(
  (ext) => `vite.config${ext}`,
);
const VITEST_PACKAGE = "vitest";
const VITEST_DEPENDENCY_FIELDS = ["dependencies", "devDependencies"];
const SCRIPTS_FIELD = "scripts";
const TEST_SCRIPT = "test";
const WORKSPACES_FIELD = "workspaces";
const WORKSPACE_PACKAGES_FIELD = "packages";
export const POSIX_SEPARATOR = "/";
export const PACKAGE_JSON = "package.json";
/** The lockfile names of the package managers a consumer may use; each can change every workspace's dependencies. */
export const LOCKFILES: readonly string[] = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];
export const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";
const CHILDREN_SUFFIX = "/*";
const NEGATION_PREFIX = "!";
/** Some Windows editors begin a UTF-8 file with it, and `JSON.parse` refuses it. */
export const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const WILDCARD = "*";
export const ROOT_PATH = ".";
const PARENT_SEGMENT = "..";

export interface VitestWorkspace {
  /** Relative to the consumer root, `/`-separated, `.` for the root. */
  readonly path: string;
  readonly directory: string;
}

/** The consumer root or a directory the root `workspaces` patterns list, whether or not it holds a Vitest config. */
export type PackageWorkspace = VitestWorkspace;

export interface UnreadWorkspaceSource {
  /** The file or `workspaces` pattern that was not searched. */
  readonly source: string;
  readonly reason: string;
}

export interface WorkspaceListing {
  readonly workspaces: readonly VitestWorkspace[];
  readonly notRead: readonly UnreadWorkspaceSource[];
}

/** A listed package workspace other than the root whose tests RT Test does not run, since it is not a Vitest workspace. */
export interface NotCoveredWorkspace {
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
  readonly reason: string;
}

export interface VitestWorkspaceListing extends WorkspaceListing {
  /** Candidates only: a discovery drops each one it finds a test module in. */
  readonly notCovered: readonly NotCoveredWorkspace[];
}

type RealPath =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

type JsonRead =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

export function findVitestWorkspaces(
  consumerRoot: string,
): VitestWorkspaceListing {
  const notCovered: NotCoveredWorkspace[] = [];
  const listing = listWorkspaces(consumerRoot, (directory, path, notRead) =>
    holdsVitestConfig(directory, path, notRead, notCovered),
  );
  return { ...listing, notCovered };
}

export function findPackageWorkspaces(consumerRoot: string): WorkspaceListing {
  return listWorkspaces(consumerRoot, () => true);
}

type WorkspaceFilter = (
  directory: string,
  path: string,
  notRead: UnreadWorkspaceSource[],
) => boolean;

function listWorkspaces(
  consumerRoot: string,
  keep: WorkspaceFilter,
): WorkspaceListing {
  const notRead: UnreadWorkspaceSource[] = [];
  if (existsSync(join(consumerRoot, PNPM_WORKSPACE_FILE))) {
    notRead.push({
      source: PNPM_WORKSPACE_FILE,
      reason: "pnpm workspaces are not read, so its packages were not searched",
    });
  }
  const candidates = [
    consumerRoot,
    ...workspaceDirectories(consumerRoot, notRead),
  ];
  const workspaces = new Map<string, VitestWorkspace>();
  const listedByRealPath = new Map<string, string>();
  const visited = new Set<string>();
  for (const directory of candidates) {
    const path = workspacePath(consumerRoot, directory);
    if (visited.has(path)) continue;
    visited.add(path);
    if (!keep(directory, path, notRead)) continue;
    const duplicate = duplicateReason(listedByRealPath, directory, path);
    if (duplicate !== undefined) {
      notRead.push({ source: path, reason: duplicate });
      continue;
    }
    workspaces.set(path, { path, directory });
  }
  return { workspaces: [...workspaces.values()], notRead };
}

/** Records the workspace under its real path, or names the workspace listed first for that directory, so no directory loads twice. */
function duplicateReason(
  listedByRealPath: Map<string, string>,
  directory: string,
  path: string,
): string | undefined {
  const real = realPath(directory);
  const key = real.ok ? real.path : directory;
  const listed = listedByRealPath.get(key);
  if (listed === undefined) {
    listedByRealPath.set(key, path);
    return undefined;
  }
  return `resolves to ${key}, the directory of workspace ${listed}, which is listed in its place`;
}

function workspaceDirectories(
  root: string,
  notRead: UnreadWorkspaceSource[],
): string[] {
  const patterns = workspacePatterns(root, notRead);
  if (patterns.length === 0) return [];
  const realRoot = realPath(root);
  return patterns.flatMap((pattern) =>
    expandPattern(root, pattern, notRead).filter((directory) => {
      const refusal = outsideRootReason(realRoot, directory);
      if (refusal !== undefined)
        notRead.push({ source: pattern, reason: refusal });
      return refusal === undefined;
    }),
  );
}

/** `..` or a link can carry a pattern's directory out of the consumer root, and only the root is the project that was started. */
function outsideRootReason(
  realRoot: RealPath,
  directory: string,
): string | undefined {
  if (!realRoot.ok) {
    return `the consumer root ${realRoot.reason}, so ${directory} could not be checked to lie inside it and was not searched`;
  }
  const real = realPath(directory);
  if (!real.ok) {
    return `${directory} ${real.reason}, so it could not be checked to lie inside the consumer root and was not searched`;
  }
  return liesInside(realRoot.path, real.path)
    ? undefined
    : `${directory} resolves to ${real.path}, outside the consumer root ${realRoot.path}, so it was not searched`;
}

/** Whether `path` is `directory` or lies beneath it; both absolute. */
export function liesInside(directory: string, path: string): boolean {
  const fromDirectory = relative(directory, path);
  return !(climbsOut(fromDirectory, sep) || isAbsolute(fromDirectory));
}

/** Whether a relative path, split by `separator`, climbs above the directory it is relative to. */
export function climbsOut(relativePath: string, separator: string): boolean {
  return (
    relativePath === PARENT_SEGMENT ||
    relativePath.startsWith(`${PARENT_SEGMENT}${separator}`)
  );
}

export function realPath(path: string): RealPath {
  try {
    return { ok: true, path: realpathSync.native(path) };
  } catch (error) {
    return {
      ok: false,
      reason: `cannot resolve its real path: ${errorText(error)}`,
    };
  }
}

function workspacePatterns(
  root: string,
  notRead: UnreadWorkspaceSource[],
): string[] {
  if (!existsSync(join(root, PACKAGE_JSON))) return [];
  const manifest = readJson(join(root, PACKAGE_JSON));
  if (!manifest.ok) {
    notRead.push({ source: PACKAGE_JSON, reason: `it ${manifest.reason}` });
    return [];
  }
  const field = objectField(manifest.value, WORKSPACES_FIELD);
  if (field === undefined) return [];
  const patterns = Array.isArray(field)
    ? field
    : objectField(field, WORKSPACE_PACKAGES_FIELD);
  if (!Array.isArray(patterns)) {
    notRead.push({
      source: `${PACKAGE_JSON} workspaces`,
      reason: "workspaces is neither an array nor { packages: [...] }",
    });
    return [];
  }
  return patterns.filter((pattern): pattern is string => {
    if (typeof pattern === "string") return true;
    notRead.push({
      source: `${PACKAGE_JSON} workspaces`,
      reason: `pattern ${JSON.stringify(pattern)} is not a string`,
    });
    return false;
  });
}

function expandPattern(
  root: string,
  pattern: string,
  notRead: UnreadWorkspaceSource[],
): string[] {
  const parent = pattern.endsWith(CHILDREN_SUFFIX)
    ? pattern.slice(0, -CHILDREN_SUFFIX.length)
    : undefined;
  const expandable = parent ?? pattern;
  if (pattern.startsWith(NEGATION_PREFIX)) {
    notRead.push({
      source: pattern,
      reason:
        "exclusion patterns are not applied, so the directories it excludes are still searched",
    });
    return [];
  }
  if (expandable.includes(WILDCARD)) {
    notRead.push({
      source: pattern,
      reason:
        "only a literal directory or a parent/* pattern is expanded, so the directories it matches were not searched",
    });
    return [];
  }
  const isDirectory = (path: string): boolean =>
    isReadableDirectory(path, pattern, notRead);
  if (parent === undefined) {
    return isDirectory(join(root, pattern)) ? [join(root, pattern)] : [];
  }
  const parentDirectory = join(root, parent);
  if (!isDirectory(parentDirectory)) return [];
  const listing = listDirectory(parentDirectory);
  if (!listing.ok) {
    notRead.push({ source: pattern, reason: listing.reason });
    return [];
  }
  return listing.names
    .sort()
    .map((name) => join(parentDirectory, name))
    .filter(isDirectory);
}

function holdsVitestConfig(
  directory: string,
  path: string,
  notRead: UnreadWorkspaceSource[],
  notCovered: NotCoveredWorkspace[],
): boolean {
  const listing = listDirectory(directory);
  if (!listing.ok) {
    notRead.push({ source: path, reason: listing.reason });
    return false;
  }
  const files = new Set(listing.names);
  if (VITEST_CONFIG_FILES.some((file) => files.has(file))) return true;
  if (!files.has(PACKAGE_JSON)) return false;
  const manifest = readJson(join(directory, PACKAGE_JSON));
  if (!manifest.ok) {
    notRead.push({
      source: joinPath(path, PACKAGE_JSON),
      reason: `it ${manifest.reason}, so it was not checked for a Vitest dependency`,
    });
    return false;
  }
  if (!dependsOnVitest(manifest.value)) {
    const notVitest = notCoveredCandidate(path, manifest.value);
    if (notVitest !== undefined) notCovered.push(notVitest);
    return false;
  }
  if (VITE_CONFIG_FILES.some((file) => files.has(file))) return true;
  notRead.push({
    source: path,
    reason:
      "depends on Vitest but holds no Vitest or Vite config file, so it is not a Vitest workspace and its tests were not discovered",
  });
  return false;
}

/** The root is left out: a root with no Vitest workspace is refused at start, and a monorepo root's test script runs its workspaces'. */
function notCoveredCandidate(
  path: string,
  manifest: unknown,
): NotCoveredWorkspace | undefined {
  const script = objectField(objectField(manifest, SCRIPTS_FIELD), TEST_SCRIPT);
  if (path === ROOT_PATH || typeof script !== "string") return undefined;
  return {
    path,
    reason: `has a test script, ${JSON.stringify(script)}, but is not a Vitest workspace: it holds no Vitest config file and does not depend on Vitest, so RT Test does not discover or run its tests`,
  };
}

function dependsOnVitest(manifest: unknown): boolean {
  return VITEST_DEPENDENCY_FIELDS.some((field) => {
    const dependencies = objectField(manifest, field);
    return objectField(dependencies, VITEST_PACKAGE) !== undefined;
  });
}

/** A failed read's reason completes a sentence whose subject is the file: "cannot be read: ..." or "is not valid JSON: ...". */
export function readJson(file: string): JsonRead {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return { ok: false, reason: `cannot be read: ${errorText(error)}` };
  }
  try {
    const json = text.startsWith(BYTE_ORDER_MARK)
      ? text.slice(BYTE_ORDER_MARK.length)
      : text;
    return { ok: true, value: JSON.parse(json) };
  } catch (error) {
    return { ok: false, reason: `is not valid JSON: ${errorText(error)}` };
  }
}

export function objectField(value: unknown, key: string): unknown {
  if (!isRecord(value)) return undefined;
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

function listDirectory(
  directory: string,
): { ok: true; names: string[] } | { ok: false; reason: string } {
  try {
    return { ok: true, names: readdirSync(directory) };
  } catch (error) {
    return { ok: false, reason: `cannot list: ${errorText(error)}` };
  }
}

function isReadableDirectory(
  path: string,
  pattern: string,
  notRead: UnreadWorkspaceSource[],
): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
  } catch (error) {
    notRead.push({
      source: pattern,
      reason: `cannot stat: ${errorText(error)}`,
    });
    return false;
  }
}

export function relativePosixPath(from: string, to: string): string {
  return relative(from, to).split(sep).join(POSIX_SEPARATOR);
}

function workspacePath(root: string, directory: string): string {
  const path = relativePosixPath(root, directory);
  return path === "" ? ROOT_PATH : path;
}

export function joinPath(workspace: string, file: string): string {
  return workspace === ROOT_PATH
    ? file
    : `${workspace}${POSIX_SEPARATOR}${file}`;
}
