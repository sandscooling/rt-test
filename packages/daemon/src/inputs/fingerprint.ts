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
import { absoluteInputPath } from "./input-filter.js";
import {
  DIGEST_ALGORITHM,
  DIGEST_ENCODING,
  MODIFIED_TIME_RESOLUTION_MS,
  type InputDigests,
} from "./input-inventory.js";
import { discoveredTestModules, workspaceTestModules } from "./non-inputs.js";
import { protectedFiles } from "./protection.js";

const ENTRY_SEPARATOR = "\n";
const MISSING_CODE = "ENOENT";
/** Stands for a listed test module that no longer exists, so its deletion changes the digest. */
const ABSENT_MODULE = "absent";

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

/** The inputs of one Vitest workspace: those of the project its results can depend on, and its own test modules. */
interface WorkspaceInputs {
  readonly selected: ProjectInputs;
  /** Every input of the project, among which `selected` lies. */
  readonly project: ProjectInputs;
  /** Root-relative, `/`-separated. */
  readonly testModules: readonly string[];
}

/**
 * Maps a Vitest workspace to its inputs: `narrowed`, those its selection includes, when a narrowing is given, and
 * every input of the project otherwise. Either way it returns each test module the latest discovery lists for the
 * workspace, whatever git ignores, so a stored result can match only while its tests' positions in their modules
 * are unchanged.
 */
function workspaceInputs(
  project: ProjectInputs,
  testModules: readonly string[],
  narrowed: ProjectInputs | undefined,
): WorkspaceInputs {
  return { selected: narrowed ?? project, project, testModules };
}

/**
 * What one snapshot of the inputs reads outside them, each read at most once, so every answer from the snapshot
 * reads the same files and versions. A later snapshot takes a new one, since it must read them again.
 */
export class SnapshotReads {
  readonly #root: string;
  /** By test module path, as `testModuleFile` names it. */
  readonly #modules = new Map<string, FingerprintResult>();
  /** By workspace directory. */
  readonly #versions = new Map<string, string | null>();

  constructor(root: string) {
    this.#root = root;
  }

  /** The digest of the test module at `path`, as `testModuleFile` names it. */
  moduleDigest(path: string): FingerprintResult {
    let read = this.#modules.get(path);
    if (read === undefined) {
      read = moduleDigest(absoluteInputPath(this.#root, path));
      this.#modules.set(path, read);
    }
    return read;
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
  const inputs = workspaceInputs(
    project,
    workspaceTestModules(entry),
    narrowed,
  );
  const modules = unselectedModuleDigests(inputs, reads);
  if (!modules.ok) return modules;
  return {
    ok: true,
    digest: digestOf({
      ...sharedParts(),
      inputs: inputs.selected.digest(),
      testModules: modules.digests,
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
  const inputs = workspaceInputs(
    project,
    discoveredTestModules(discovery),
    undefined,
  );
  const modules = unselectedModuleDigests(inputs, reads);
  if (!modules.ok) return modules;
  return {
    ok: true,
    digest: digestOf({
      ...sharedParts(),
      inputs: inputs.selected.digest(),
      testModules: modules.digests,
      vitestVersions: discovery.workspaces.map((entry) => [
        entry.workspace.path,
        vitestVersion(entry.workspace.directory),
      ]),
    }),
  };
}

type ModuleDigests =
  | { readonly ok: true; readonly digests: readonly (readonly string[])[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Digests each listed test module the selected inputs leave out: from the project's inputs when they hold it, and
 * otherwise from disk, such as one git ignores, since no watch covers it.
 */
function unselectedModuleDigests(
  inputs: WorkspaceInputs,
  reads: SnapshotReads,
): ModuleDigests {
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
    return {
      ok: true,
      digest: createHash(DIGEST_ALGORITHM)
        .update(readFileSync(path))
        .digest(DIGEST_ENCODING),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === MISSING_CODE) {
      return { ok: true, digest: ABSENT_MODULE };
    }
    return { ok: false, reason: errorText(error) };
  }
}

/**
 * Why a file the discovery protects by path that the inputs leave out may have changed at or after `since`, a time in
 * ms, or undefined when none did: a listed test module, setup file or global setup file. No watch covers such a file,
 * so a job reading it cannot learn of an edit any other way.
 */
export function protectedFileChangedSince(
  project: ProjectInputs,
  discovery: TestDiscovery,
  since: number,
): string | undefined {
  for (const path of protectedFiles(discovery)) {
    if (project.digests.has(path)) continue;
    const modified = modifiedAt(absoluteInputPath(project.root, path));
    if (
      modified === undefined ||
      modified >= since - MODIFIED_TIME_RESOLUTION_MS
    ) {
      return `${path}, which the discovery protects and no watch covers, may have changed while the job ran`;
    }
  }
  return undefined;
}

/** Undefined when it cannot be read, which cannot vouch that it held still. */
function modifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

let environmentDigest: string | undefined;

/** The parts every fingerprint shares; the environment enters as a digest, never as values. */
function sharedParts(): Record<string, unknown> {
  environmentDigest ??= digestOfEntries(
    new Map(
      Object.entries(process.env).map(([name, value]) => [name, value ?? ""]),
    ),
  );
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
  return createHash(DIGEST_ALGORITHM)
    .update(JSON.stringify(parts))
    .digest(DIGEST_ENCODING);
}
