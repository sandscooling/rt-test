import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { SELECTION_POLICY_VERSION } from "../selection/selection-types.js";
import { VITEST_ADAPTER_VERSION } from "../vitest/adapter-version.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import { resolveWorkspaceVitest } from "../vitest/load-vitest.js";
import {
  discoveryEnvFiles,
  envFileDigest,
  workspaceEnvFiles,
  type ListedEnvFiles,
} from "./env-files.js";
import { countEnvironment } from "./environment-digest.js";
import { absoluteInputPath } from "./input-filter.js";
import {
  DIGEST_ALGORITHM,
  DIGEST_ENCODING,
  holdsFileContent,
  MODIFIED_TIME_RESOLUTION_MS,
  wholeDigest,
  type InputDigests,
} from "./input-inventory.js";
import { discoveredTestModules, workspaceTestModules } from "./non-inputs.js";
import {
  protectedFiles,
  protectedModules,
  workspaceName,
} from "./protection.js";

const ENTRY_SEPARATOR = "\n";
const MISSING_CODE = "ENOENT";
/** Stands for a listed test module or env file that does not exist, so its creation or deletion changes the digest. */
const ABSENT_FILE = "absent";
const NO_DECLARED_VARIABLES: readonly string[] = [];
/** A path `statSync` finds no entry at, a missing file or one below a file. */
const NOTHING_THERE = null;
const ENV_FILES_UNKNOWN = "are not known";
const ENV_SOURCES_UNREPORTED =
  "its discovery does not report the env sources of its projects";

export type FingerprintResult =
  | { readonly ok: true; readonly digest: string }
  | { readonly ok: false; readonly reason: string };

/** The project's inputs at one revision; their digest is computed once, on first use. */
export class ProjectInputs {
  readonly root: string;
  readonly digests: InputDigests;
  #digest: string | undefined;

  constructor(root: string, digests: InputDigests) {
    this.root = root;
    this.digests = digests;
  }

  /** One digest over every input's path and content digest, in path order, whatever order they were read in. */
  digest(): string {
    this.#digest ??= digestOfEntries(this.digests);
    return this.#digest;
  }
}

/**
 * The inputs of one Vitest workspace: those of the project its results can depend on, and its own test modules and
 * env files.
 */
interface WorkspaceInputs {
  readonly selected: ProjectInputs;
  /** Every input of the project, among which `selected` lies. */
  readonly project: ProjectInputs;
  /** Root-relative, `/`-separated. */
  readonly testModules: readonly string[];
  /** Named as `testModules` are. */
  readonly envFiles: readonly string[];
}

/**
 * Maps a Vitest workspace to its inputs: `narrowed`, those its selection includes, when a narrowing is given, and
 * every input of the project otherwise. Either way it returns each test module the latest discovery lists for the
 * workspace, whatever git ignores, so a stored result can match only while its tests' positions in their modules
 * are unchanged, and each env file Vite loads for its tests, whatever git ignores.
 */
function workspaceInputs(
  project: ProjectInputs,
  listed: {
    readonly testModules: readonly string[];
    readonly envFiles: readonly string[];
  },
  narrowed: ProjectInputs | undefined,
): WorkspaceInputs {
  return { selected: narrowed ?? project, project, ...listed };
}

/**
 * What one snapshot of the inputs reads outside them, each read at most once, so every answer from the snapshot
 * reads the same files and versions. A later snapshot takes a new one, since it must read them again.
 */
export class SnapshotReads {
  readonly #root: string;
  /** The environment's digest, as `countEnvironment` gives it; by default with no declared variable entry. */
  readonly environment: string;
  /** By test module path, as `testModuleFile` names it. */
  readonly #modules = new Map<string, FingerprintResult>();
  /** By env file path, named as a test module's is. */
  readonly #envFiles = new Map<string, FingerprintResult>();
  /** By workspace directory. */
  readonly #versions = new Map<string, string | null>();

  constructor(
    root: string,
    environment = countEnvironment(process.env, NO_DECLARED_VARIABLES).digest,
  ) {
    this.#root = root;
    this.environment = environment;
  }

  /** The digest of the test module at `path`, as `testModuleFile` names it. */
  moduleDigest(path: string): FingerprintResult {
    return readOnce(this.#modules, path, () =>
      moduleDigest(absoluteInputPath(this.#root, path)),
    );
  }

  /** The digest of what Vite reads at the env file `path`, named as a test module's is. */
  envFileDigest(path: string): FingerprintResult {
    return readOnce(this.#envFiles, path, () => {
      const read = envFileDigest(absoluteInputPath(this.#root, path));
      return read.ok ? { ok: true, digest: read.digest ?? ABSENT_FILE } : read;
    });
  }

  /** Absent when no Vitest resolves from the directory, which is itself a state the digest must tell apart. */
  readonly vitestVersion = (directory: string): string | null => {
    if (!this.#versions.has(directory)) {
      this.#versions.set(
        directory,
        resolveWorkspaceVitest(directory).version ?? null,
      );
    }
    return this.#versions.get(directory) ?? null;
  };
}

/**
 * A Vitest workspace's current input fingerprint, or why none can be computed. `narrowed` is the workspace's
 * narrowed inputs among `project`'s; without it, the fingerprint covers every input of the project.
 */
export function workspaceFingerprint(
  project: ProjectInputs,
  entry: WorkspaceDiscovery,
  reads = new SnapshotReads(project.root),
  narrowed?: ProjectInputs,
): FingerprintResult {
  const { vitestVersion } = reads;
  const envFiles = workspaceEnvFiles(entry);
  if (!envFiles.known) return envFilesUnknown(envFiles);
  const inputs = workspaceInputs(
    project,
    { testModules: workspaceTestModules(entry), envFiles: envFiles.files },
    narrowed,
  );
  const listed = listedDigests(inputs, reads);
  if (!listed.ok) return listed;
  return {
    ok: true,
    digest: digestOf({
      ...sharedParts(reads.environment),
      inputs: inputs.selected.digest(),
      testModules: listed.testModules,
      envFiles: listed.envFiles,
      vitestVersion: vitestVersion(entry.workspace.directory),
    }),
  };
}

/** The discovery's current fingerprint: a workspace's parts, with every listed workspace's Vitest version. */
export function discoveryFingerprint(
  project: ProjectInputs,
  discovery: TestDiscovery,
  reads = new SnapshotReads(project.root),
): FingerprintResult {
  const { vitestVersion } = reads;
  const envFiles = discoveryEnvFiles(discovery);
  if (!envFiles.known) return envFilesUnknown(envFiles);
  const inputs = workspaceInputs(
    project,
    {
      testModules: discoveredTestModules(discovery),
      envFiles: envFiles.files,
    },
    undefined,
  );
  const listed = listedDigests(inputs, reads);
  if (!listed.ok) return listed;
  return {
    ok: true,
    digest: digestOf({
      ...sharedParts(reads.environment),
      inputs: inputs.selected.digest(),
      testModules: listed.testModules,
      envFiles: listed.envFiles,
      vitestVersions: discovery.workspaces.map((entry) => [
        entry.workspace.path,
        vitestVersion(entry.workspace.directory),
      ]),
    }),
  };
}

function envFilesUnknown(
  listed: Extract<ListedEnvFiles, { known: false }>,
): FingerprintResult {
  return {
    ok: false,
    reason: `the env files of the workspace ${workspaceName(listed.workspace)} ${ENV_FILES_UNKNOWN}: ${listed.reason ?? ENV_SOURCES_UNREPORTED}`,
  };
}

type Digests = readonly (readonly string[])[];

type PathDigests =
  | { readonly ok: true; readonly digests: Digests }
  | { readonly ok: false; readonly reason: string };

type ListedDigests =
  | {
      readonly ok: true;
      readonly testModules: Digests;
      readonly envFiles: Digests;
    }
  | { readonly ok: false; readonly reason: string };

function listedDigests(
  inputs: WorkspaceInputs,
  reads: SnapshotReads,
): ListedDigests {
  const modules = unselectedModuleDigests(inputs, reads);
  if (!modules.ok) return modules;
  const envFiles = envFileDigests(inputs, reads);
  if (!envFiles.ok) return envFiles;
  return {
    ok: true,
    testModules: modules.digests,
    envFiles: envFiles.digests,
  };
}

/**
 * Digests each listed env file: from the project's inputs when they hold its content, or not at all when the
 * selected inputs count it, and otherwise as Vite reads it, since the inputs hold a FIFO or a link to anything but a
 * file by its type or target, which does not change with what Vite reads.
 */
function envFileDigests(
  inputs: WorkspaceInputs,
  reads: SnapshotReads,
): PathDigests {
  const digests: string[][] = [];
  for (const path of [...new Set(inputs.envFiles)].sort()) {
    const held = heldEnvDigest(inputs.project, path);
    if (held !== undefined) {
      if (!inputs.selected.digests.has(path)) digests.push([path, held]);
      continue;
    }
    const read = reads.envFileDigest(path);
    if (!read.ok) {
      return {
        ok: false,
        reason: `the env file ${path} cannot be read: ${read.reason}`,
      };
    }
    digests.push([path, read.digest]);
  }
  return { ok: true, digests };
}

/**
 * Digests each listed test module the selected inputs leave out: from the project's inputs when they hold it, and
 * otherwise from disk, such as one git ignores, since no watch covers it.
 */
function unselectedModuleDigests(
  inputs: WorkspaceInputs,
  reads: SnapshotReads,
): PathDigests {
  const digests: string[][] = [];
  for (const path of [...new Set(inputs.testModules)].sort()) {
    if (inputs.selected.digests.has(path)) continue;
    const read = heldDigest(inputs.project, path) ?? reads.moduleDigest(path);
    if (!read.ok) {
      return {
        ok: false,
        reason: `the test module ${path} cannot be read: ${read.reason}`,
      };
    }
    digests.push([path, read.digest]);
  }
  return { ok: true, digests };
}

/** The digest the inputs hold for an env file, only when it is of the content Vite reads there. */
function heldEnvDigest(
  project: ProjectInputs,
  path: string,
): string | undefined {
  const held = project.digests.get(path);
  return held !== undefined && holdsFileContent(held) ? held : undefined;
}

/** The digest the snapshot holds for an input, so a module a narrowed set leaves out is never read again. */
function heldDigest(
  project: ProjectInputs,
  path: string,
): FingerprintResult | undefined {
  const digest = project.digests.get(path);
  return digest === undefined ? undefined : { ok: true, digest };
}

function moduleDigest(path: string): FingerprintResult {
  try {
    return { ok: true, digest: wholeDigest(readFileSync(path)) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === MISSING_CODE) {
      return { ok: true, digest: ABSENT_FILE };
    }
    return { ok: false, reason: errorText(error) };
  }
}

function readOnce(
  reads: Map<string, FingerprintResult>,
  path: string,
  read: () => FingerprintResult,
): FingerprintResult {
  let result = reads.get(path);
  if (result === undefined) {
    result = read();
    reads.set(path, result);
  }
  return result;
}

/**
 * Why a file the discovery protects by path that the inputs leave out may have changed at or after `since`, a time in
 * ms, or undefined when none did: a listed test module, setup file, global setup file or env file. No watch covers
 * such a file, so a job reading it cannot learn of an edit any other way. A listed env file with nothing there is
 * unchanged, since most never exist.
 */
export function protectedFileChangedSince(
  project: ProjectInputs,
  discovery: TestDiscovery,
  since: number,
): string | undefined {
  const modules = protectedModules(discovery);
  const watched = (path: string): boolean =>
    modules.has(path)
      ? project.digests.has(path)
      : heldEnvDigest(project, path) !== undefined;
  for (const path of protectedFiles(discovery)) {
    if (watched(path)) continue;
    const modified = modifiedAt(absoluteInputPath(project.root, path));
    if (modified === NOTHING_THERE && !modules.has(path)) continue;
    if (
      modified === NOTHING_THERE ||
      modified === undefined ||
      modified >= since - MODIFIED_TIME_RESOLUTION_MS
    ) {
      return `${path}, which the discovery protects and no watch covers, may have changed while the job ran`;
    }
  }
  return undefined;
}

/** Undefined when it cannot be read, which cannot vouch that it held still. */
function modifiedAt(path: string): number | typeof NOTHING_THERE | undefined {
  try {
    return statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? NOTHING_THERE;
  } catch {
    return undefined;
  }
}

/** The parts every fingerprint shares; the environment enters as a digest, never as values. */
function sharedParts(environmentDigest: string): Record<string, unknown> {
  return {
    environment: environmentDigest,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    adapterVersion: VITEST_ADAPTER_VERSION,
    selectionPolicyVersion: SELECTION_POLICY_VERSION,
  };
}

function digestOfEntries(entries: ReadonlyMap<string, string>): string {
  const hash = createHash(DIGEST_ALGORITHM);
  for (const key of [...entries.keys()].sort()) {
    hash.update(`${JSON.stringify([key, entries.get(key)])}${ENTRY_SEPARATOR}`);
  }
  return hash.digest(DIGEST_ENCODING);
}

/** Each part is named, so no two part lists can produce the same text by concatenation. */
function digestOf(parts: Record<string, unknown>): string {
  return wholeDigest(JSON.stringify(parts));
}
