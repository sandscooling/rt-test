import { statSync, type Stats } from "node:fs";
import { posix } from "node:path";
import { testModuleFile } from "../inputs/non-inputs.js";
import type { CurrentInputs } from "../inputs/input-tracker.js";
import type { LatestResults } from "../store/open-store.js";
import { POSIX_SEPARATOR, ROOT_PATH } from "../vitest/find-workspaces.js";
import {
  FAILED_MODULE,
  FILE_PATH,
  FOLDER_PATH,
  SOURCE_NOT_READ,
  TYPECHECK_MODULE,
  WORKSPACE_DISCOVERY_FAILED,
  WORKSPACE_NOT_CONFIRMED,
  WORKSPACE_UNHANDLED_ERRORS,
  WORKSPACE_UNSUPPORTED_VITEST,
  UNSUPPORTED_PROJECT,
  type FileCounts,
  type NoAnswer,
  type NotDiscoveredEntry,
  type PathStatusAnswer,
} from "./answer.js";
import type { CallerPath } from "./caller-paths.js";
import { queryBasis, type DaemonView } from "./summary.js";
import { countStandings, type TestStanding } from "./test-states.js";

const ENTRY_SEPARATOR = ", ";

/** Answers for the discovered tests and not-discovered entries at or under `target`, a path inside the consumer root. */
export function pathStatusAnswer(
  target: CallerPath,
  results: LatestResults,
  daemon: DaemonView,
  inputs: CurrentInputs,
): PathStatusAnswer | NoAnswer {
  const absolutePath = target.given;
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
    case WORKSPACE_UNHANDLED_ERRORS:
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
