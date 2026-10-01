import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as VitestNode from "vitest/node";
import { errorText } from "./error-text.js";

interface SupportedLine {
  readonly major: number;
  readonly minor?: number;
}

const SUPPORTED_VITEST_LINES: readonly SupportedLine[] = [
  { major: 4, minor: 1 },
  { major: 5 },
];

const SUPPORTED_VITEST_RANGE = SUPPORTED_VITEST_LINES.map(({ major, minor }) =>
  minor === undefined ? `${major}.x` : `${major}.${minor}.x`,
).join(" || ");

const VITEST_MANIFEST = "vitest/package.json";
const VITEST_NODE_ENTRY = "vitest/node";
const PACKAGE_JSON = "package.json";

const RELEASE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

type VitestNodeModule = typeof VitestNode;

export type ResolvedVitest =
  | {
      readonly supported: true;
      /** The real directory of the package's manifest, as it is on disk at the call. */
      readonly directory: string;
      readonly version: string;
      /** The major of `version`. */
      readonly major: number;
      /** As Node resolved it in this process, which keeps its answer: read it only in a process started for one job. */
      readonly nodeEntry: string;
    }
  | {
      readonly supported: false;
      /** Absent when no Vitest resolves from the workspace directory. */
      readonly version?: string;
      readonly supportedRange: string;
      readonly reason: string;
    };

export function resolveWorkspaceVitest(directory: string): ResolvedVitest {
  const require = createRequire(join(directory, PACKAGE_JSON));
  let manifestPath: string;
  try {
    manifestPath = installedManifest(require, directory);
  } catch (error) {
    return unsupported(undefined, `no Vitest resolves: ${errorText(error)}`);
  }
  let version: string | undefined;
  try {
    version = readVersion(manifestPath);
  } catch (error) {
    return unsupported(
      undefined,
      `cannot read ${manifestPath}: ${errorText(error)}`,
    );
  }
  if (version === undefined) {
    return unsupported(undefined, `${manifestPath} has no version`);
  }
  const major = supportedMajor(version);
  if (major === undefined) {
    return unsupported(
      version,
      `Vitest ${version} is outside the supported range`,
    );
  }
  try {
    const nodeEntry = pathToFileURL(require.resolve(VITEST_NODE_ENTRY)).href;
    return {
      supported: true,
      directory: dirname(manifestPath),
      version,
      major,
      nodeEntry,
    };
  } catch (error) {
    return unsupported(
      version,
      `vitest/node does not resolve: ${errorText(error)}`,
    );
  }
}

/**
 * The manifest a process started now would resolve from the workspace, found on disk at each call over Node's own
 * lookup list. Node keeps what it resolved for the life of a process, so its own resolution goes on naming an install
 * that a link no longer leads to.
 */
function installedManifest(require: NodeJS.Require, directory: string): string {
  for (const modules of require.resolve.paths(VITEST_MANIFEST) ?? []) {
    const manifest = join(modules, VITEST_MANIFEST);
    if (isFile(manifest)) return realpathSync(manifest);
  }
  throw new Error(
    `none of the directories Node looks in from ${directory} holds ${VITEST_MANIFEST}`,
  );
}

/** As Node's lookup reads a path: one it cannot stat, for any reason, holds no file, and the lookup goes on. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export async function importVitestNode(
  vitest: Extract<ResolvedVitest, { supported: true }>,
): Promise<VitestNodeModule> {
  return (await import(vitest.nodeEntry)) as VitestNodeModule;
}

function readVersion(manifestPath: string): string | undefined {
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (typeof manifest !== "object" || manifest === null) return undefined;
  const { version } = manifest as { version?: unknown };
  return typeof version === "string" ? version : undefined;
}

export interface ReleaseLine {
  readonly major: number;
  readonly minor: number;
}

/** Undefined for a version that is not a release, such as a prerelease. */
export function releaseLine(version: string): ReleaseLine | undefined {
  const match = RELEASE_VERSION.exec(version);
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** Undefined when the version is outside every supported line. */
function supportedMajor(version: string): number | undefined {
  const release = releaseLine(version);
  if (release === undefined) return undefined;
  const { major, minor } = release;
  const supported = SUPPORTED_VITEST_LINES.some(
    (line) =>
      line.major === major &&
      (line.minor === undefined || line.minor === minor),
  );
  return supported ? major : undefined;
}

function unsupported(
  version: string | undefined,
  reason: string,
): ResolvedVitest {
  return {
    supported: false,
    ...(version === undefined ? {} : { version }),
    supportedRange: SUPPORTED_VITEST_RANGE,
    reason,
  };
}
