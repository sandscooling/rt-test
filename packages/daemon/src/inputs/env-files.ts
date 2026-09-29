import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  statSync,
  type Stats,
} from "node:fs";
import { posix } from "node:path";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import type {
  EnvSource,
  ProjectSelectionFacts,
} from "../vitest/selection-facts.js";
import { DIGEST_ALGORITHM, DIGEST_ENCODING } from "./input-inventory.js";

const ENV_FILE = ".env";
const LOCAL_SUFFIX = ".local";
/**
 * Why opening an entry found a moment earlier as a regular file failed when it has since gone or turned into one Vite
 * skips: a directory, a socket or a device with no driver.
 */
const ABSENT_CODES: ReadonlySet<string> = new Set([
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ENXIO",
]);
/** Windows has no `O_NONBLOCK` and no FIFO a file path names. */
const OPEN_WITHOUT_BLOCKING = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);
const FIFO_REASON = "it is a FIFO, whose read could block";
const NOTHING_READ: EnvFileDigest = { ok: true, digest: undefined };

/** Root-relative, `/`-separated env files, or the discovered workspace whose projects do not report their sources. */
export type ListedEnvFiles =
  | { readonly known: true; readonly files: readonly string[] }
  | { readonly known: false; readonly unreportedWorkspace: string };

/** A digest of what Vite reads at a path, undefined when it reads nothing there, or why it cannot be read. */
export type EnvFileDigest =
  | { readonly ok: true; readonly digest: string | undefined }
  | { readonly ok: false; readonly reason: string };

/** Every env file each of the project's sources names, named as its env directory is. */
export function projectEnvFiles(project: ProjectSelectionFacts): string[] {
  return [...new Set(project.envSources.flatMap(sourceEnvFiles))];
}

/** The files Vite's `getEnvFilesForMode` names, in its order. */
function sourceEnvFiles(source: EnvSource): string[] {
  const { envDirectory, mode } = source;
  if (envDirectory === null) return [];
  return [
    ENV_FILE,
    `${ENV_FILE}${LOCAL_SUFFIX}`,
    `${ENV_FILE}.${mode}`,
    `${ENV_FILE}.${mode}${LOCAL_SUFFIX}`,
  ].map((name) => posix.join(envDirectory, name));
}

/** A workspace that was not discovered loaded no config, so it names none. */
export function workspaceEnvFiles(entry: WorkspaceDiscovery): ListedEnvFiles {
  if (entry.status !== "discovered") return { known: true, files: [] };
  if (!entry.selectionFacts.reported) {
    return { known: false, unreportedWorkspace: entry.workspace.path };
  }
  return {
    known: true,
    files: [...new Set(entry.selectionFacts.projects.flatMap(projectEnvFiles))],
  };
}

/** Every env file the discovery's workspaces name, unknown when any discovered workspace's are. */
export function discoveryEnvFiles(discovery: TestDiscovery): ListedEnvFiles {
  const files = new Set<string>();
  for (const entry of discovery.workspaces) {
    const listed = workspaceEnvFiles(entry);
    if (!listed.known) return listed;
    for (const file of listed.files) files.add(file);
  }
  return { known: true, files: [...files] };
}

/**
 * The digest of what Vite reads at `path`, an absolute path. Vite reads a file or a FIFO and skips anything else. Only
 * a regular file is opened, since opening a FIFO releases a writer waiting on it, and its content is read only when
 * the opened handle is still a regular file.
 */
export function envFileDigest(path: string): EnvFileDigest {
  let stats: Stats | undefined;
  try {
    stats = statSync(path, { throwIfNoEntry: false });
  } catch (error) {
    return refusal(error);
  }
  const kind = readableKind(stats);
  if (kind !== undefined) return kind;
  let descriptor: number;
  try {
    descriptor = openSync(path, OPEN_WITHOUT_BLOCKING);
  } catch (error) {
    return ABSENT_CODES.has((error as NodeJS.ErrnoException).code ?? "")
      ? NOTHING_READ
      : refusal(error);
  }
  let read: EnvFileDigest;
  try {
    read = readableKind(fstatSync(descriptor)) ?? contentDigest(descriptor);
  } catch (error) {
    read = refusal(error);
  }
  try {
    closeSync(descriptor);
  } catch (error) {
    return refusal(error);
  }
  return read;
}

/** What Vite reads of an entry that is not a regular file; undefined for a regular file, whose content it reads. */
function readableKind(stats: Stats | undefined): EnvFileDigest | undefined {
  if (stats?.isFIFO() === true) return { ok: false, reason: FIFO_REASON };
  return stats?.isFile() === true ? undefined : NOTHING_READ;
}

function contentDigest(descriptor: number): EnvFileDigest {
  return {
    ok: true,
    digest: createHash(DIGEST_ALGORITHM)
      .update(readFileSync(descriptor))
      .digest(DIGEST_ENCODING),
  };
}

function refusal(error: unknown): EnvFileDigest {
  return { ok: false, reason: errorText(error) };
}
