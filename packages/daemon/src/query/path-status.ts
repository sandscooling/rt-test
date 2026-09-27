import { statSync, type Stats } from "node:fs";
import { basename, dirname, join, posix } from "node:path";
import { testModuleFile } from "../inputs/non-inputs.js";
import type { CurrentInputs } from "../inputs/input-tracker.js";
import type { LatestResults } from "../store/open-store.js";
import {
  liesInside,
  POSIX_SEPARATOR,
  realPath,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";
import {
  FAILED_MODULE,
  FILE_PATH,
  FOLDER_PATH,
  SOURCE_NOT_READ,
  TYPECHECK_MODULE,
  WORKSPACE_DISCOVERY_FAILED,
  WORKSPACE_NOT_CONFIRMED,
  WORKSPACE_UNSUPPORTED_VITEST,
  UNSUPPORTED_PROJECT,
  type FileCounts,
  type NoAnswer,
  type NotDiscoveredEntry,
  type PathStatusAnswer,
} from "./answer.js";
import { queryBasis, type DaemonView } from "./summary.js";
import { countStandings, type TestStanding } from "./test-states.js";

const ENTRY_SEPARATOR = ", ";

type Resolved =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

/** Answers for the discovered tests and not-discovered entries at or under `absolutePath`, a path inside the consumer root. */
export function pathStatusAnswer(
  absolutePath: string,
  results: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): PathStatusAnswer | NoAnswer {
  const target = rootRelativePath(absolutePath, daemon.consumerRoot);
  if (!target.ok) return { noAnswer: target.reason };
  const basis = queryBasis(results, daemon, inputs);
  if ("noAnswer" in basis) return basis;
  const standings = basis.standings.filter((standing) =>
    liesAtOrUnder(testFile(standing), target.path),
  );
  const notDiscovered = basis.notDiscovered.filter((entry) =>
    liesAtOrUnder(entryPath(entry), target.path),
  );
  const enclosing = basis.notDiscovered.filter((entry) =>
    encloses(entry, target.path),
  );
  if (standings.length === 0 && notDiscovered.length === 0) {
    return { noAnswer: nothingAtPathReason(absolutePath, enclosing) };
  }
  const pathKind = kindOf(target.path, absolutePath, standings, notDiscovered);
  return {
    ...basis.context,
    path: target.path,
    pathKind,
    counts: countStandings(standings),
    files: pathKind === FOLDER_PATH ? fileCounts(standings) : [],
    notDiscovered,
    enclosingNotDiscovered: enclosing,
  };
}

function nothingAtPathReason(
  absolutePath: string,
  enclosing: readonly NotDiscoveredEntry[],
): string {
  const nothing = `no discovered test and no entry RT Test could not discover lies at or under ${absolutePath}`;
  if (enclosing.length === 0) return nothing;
  const named = enclosing.map((entry) => `${entry.kind} ${entryPath(entry)}`);
  return `${nothing}; it lies in ${named.join(ENTRY_SEPARATOR)}`;
}

/** A workspace, project or source entry above the path leaves part of what lies under the path undiscovered. */
function encloses(entry: NotDiscoveredEntry, target: string): boolean {
  if (isModuleEntry(entry)) return false;
  const path = entryPath(entry);
  return liesAtOrUnder(target, path) && !liesAtOrUnder(path, target);
}

function isModuleEntry(entry: NotDiscoveredEntry): boolean {
  return entry.kind === FAILED_MODULE || entry.kind === TYPECHECK_MODULE;
}

/** The path relative to the root's canonical real path; a missing path resolves through its nearest existing ancestor. */
function rootRelativePath(
  absolutePath: string,
  consumerRoot: string,
): Resolved {
  const root = realPath(consumerRoot);
  if (!root.ok) {
    return {
      ok: false,
      reason: `the consumer root ${consumerRoot} ${root.reason}`,
    };
  }
  const path = canonicalPath(absolutePath);
  if (!path.ok) {
    return { ok: false, reason: `${absolutePath} ${path.reason}` };
  }
  if (!liesInside(root.path, path.path)) {
    return {
      ok: false,
      reason: `${absolutePath} lies outside the consumer root ${consumerRoot}`,
    };
  }
  const relative = relativePosixPath(root.path, path.path);
  return { ok: true, path: relative === "" ? ROOT_PATH : relative };
}

function canonicalPath(path: string): Resolved {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    const real = realPath(current);
    if (real.ok) return { ok: true, path: join(real.path, ...missing) };
    const parent = dirname(current);
    if (parent === current) return real;
    missing.unshift(basename(current));
    current = parent;
  }
}

/** Both relative to the consumer root, `/`-separated. */
function liesAtOrUnder(path: string, target: string): boolean {
  return (
    target === ROOT_PATH ||
    path === target ||
    path.startsWith(`${target}${POSIX_SEPARATOR}`)
  );
}

function testFile(standing: TestStanding): string {
  const { workspacePath, modulePath } = standing.test.identity;
  return testModuleFile(workspacePath, modulePath);
}

function entryPath(entry: NotDiscoveredEntry): string {
  switch (entry.kind) {
    case SOURCE_NOT_READ:
      return posix.normalize(entry.source);
    case WORKSPACE_UNSUPPORTED_VITEST:
    case WORKSPACE_DISCOVERY_FAILED:
    case WORKSPACE_NOT_CONFIRMED:
    case UNSUPPORTED_PROJECT:
      return entry.workspacePath;
    default:
      return testModuleFile(entry.workspacePath, entry.modulePath);
  }
}

/** A path that no longer exists is a file when a discovered test's or a not-discovered module's file is exactly it. */
function kindOf(
  target: string,
  absolutePath: string,
  standings: readonly TestStanding[],
  notDiscovered: readonly NotDiscoveredEntry[],
): PathStatusAnswer["pathKind"] {
  if (target === ROOT_PATH) return FOLDER_PATH;
  const stats = statsOf(absolutePath);
  if (stats !== undefined) return stats.isDirectory() ? FOLDER_PATH : FILE_PATH;
  const isFile =
    standings.some((standing) => testFile(standing) === target) ||
    notDiscovered.some(
      (entry) => isModuleEntry(entry) && entryPath(entry) === target,
    );
  return isFile ? FILE_PATH : FOLDER_PATH;
}

/** Undefined for a path that cannot be statted for any reason, not only a missing one. */
function statsOf(absolutePath: string): Stats | undefined {
  try {
    return statSync(absolutePath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

function fileCounts(standings: readonly TestStanding[]): FileCounts[] {
  const byFile = new Map<string, TestStanding[]>();
  for (const standing of standings) {
    const file = testFile(standing);
    const group = byFile.get(file);
    if (group === undefined) byFile.set(file, [standing]);
    else group.push(standing);
  }
  return [...byFile.keys()]
    .sort()
    .map((file) => ({ file, counts: countStandings(byFile.get(file) ?? []) }));
}
