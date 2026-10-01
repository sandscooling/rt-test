import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
  canaryExperiments,
  NO_READING_KIND,
  noReading,
  readCanaryJob,
  readCanarySet,
  type CanaryReading,
  type CanarySet,
} from "../falsify/canary-set.js";
import { isRecord } from "../json-guards.js";
import { chosenConfigFile } from "../vitest/confirmed-start.js";
import { errorText } from "../vitest/error-text.js";
import { ROOT_PATH, type VitestWorkspace } from "../vitest/find-workspaces.js";
import type { ResolvedVitest } from "../vitest/load-vitest.js";
import type { DaemonLog } from "./daemon-log.js";
import type { Executor } from "./executor.js";

const PLACED_PREFIX = "canary-reading-";
const MODULES_DIRECTORY = "node_modules";
const VITEST_PACKAGE = "vitest";
/** A directory link Windows lets a user without the symlink privilege make; Linux ignores the type. */
const DIRECTORY_LINK = "junction";
/** What a job is sent for a workspace that holds no Vitest config, which it then reports as not confirmed. */
const NO_CONFIG_FILE = "";
/** Nothing at the path: no entry, or one below a file, which Linux reports as ENOTDIR and Windows as ENOENT. */
const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);
const NOT_A_JOB_REASON =
  "the executor's reply held no falsification job, so the job has nothing to read";

export interface CanaryReadingParts {
  /** Sends one falsification job, as `Executor.falsify` does. */
  readonly falsify: Executor["falsify"];
  readonly stateDirectory: string;
  readonly log: DaemonLog;
  /** Holds the canary file and the Vitest project it names. */
  readonly canaryDirectory: string;
}

type VitestInstall = Pick<
  Extract<ResolvedVitest, { supported: true }>,
  "directory" | "version"
>;

type Placement =
  | { readonly placed: true; readonly directory: string }
  | { readonly placed: false; readonly reason: string };

/**
 * Runs the canary set under `install` from a copy of its own in the state directory, removed before this resolves
 * unless the removal is refused or fails, which the log then says. The job loads the install, which is the project's
 * code: call only in a daemon started for that project, and only while the executor behind `falsify` holds no job.
 */
export async function takeCanaryReading(
  parts: CanaryReadingParts,
  install: VitestInstall,
): Promise<CanaryReading> {
  const read = readCanarySet(parts.canaryDirectory);
  if (!read.usable) return noReading(NO_READING_KIND.setUnusable, read.reason);
  const placement = placeSet(parts, install);
  if (!placement.placed) {
    return noReading(NO_READING_KIND.setNotPlaced, placement.reason);
  }
  try {
    return await readJob(parts.falsify, read.set, placement.directory, install);
  } finally {
    removePlaced(parts.log, placement.directory);
  }
}

/** Copies the canary directory into a directory of the reading's own and links the install into it. */
function placeSet(
  parts: CanaryReadingParts,
  install: VitestInstall,
): Placement {
  let directory: string;
  try {
    directory = makeOwnDirectory(parts.stateDirectory);
  } catch (error) {
    return { placed: false, reason: errorText(error) };
  }
  try {
    cpSync(parts.canaryDirectory, directory, { recursive: true });
    const modules = join(directory, MODULES_DIRECTORY);
    mkdirSync(modules);
    symlinkSync(
      install.directory,
      join(modules, VITEST_PACKAGE),
      DIRECTORY_LINK,
    );
    return { placed: true, directory };
  } catch (error) {
    removePlaced(parts.log, directory);
    return { placed: false, reason: errorText(error) };
  }
}

/** Makes a directory under a name no other reading, daemon or worktree shares, and gives its real path. */
function makeOwnDirectory(stateDirectory: string): string {
  const directory = join(
    realpathSync.native(stateDirectory),
    `${PLACED_PREFIX}${randomUUID()}`,
  );
  mkdirSync(directory);
  return realpathSync.native(directory);
}

async function readJob(
  falsify: CanaryReadingParts["falsify"],
  set: CanarySet,
  directory: string,
  install: VitestInstall,
): Promise<CanaryReading> {
  const workspace: VitestWorkspace = { path: ROOT_PATH, directory };
  try {
    const outcome = await falsify(
      workspace,
      chosenConfigFile(workspace) ?? NO_CONFIG_FILE,
      canaryExperiments(set, directory),
      set.assertionErrors,
    );
    if (!outcome.ended) {
      return noReading(NO_READING_KIND.noReply, outcome.reason);
    }
    if (!isRecord(outcome.value)) {
      return noReading(NO_READING_KIND.noReply, NOT_A_JOB_REASON);
    }
    return readCanaryJob(set, outcome.value, install.version);
  } catch (error) {
    return noReading(NO_READING_KIND.noReply, errorText(error));
  }
}

/**
 * Removes the directory a reading placed, given by the real path it was placed at, and nothing else: a path that
 * now resolves elsewhere is left alone. The link to the install goes first, by a call that cannot recurse, so the
 * recursive removal walks a tree that holds no link, since some Node lines' removal can follow one on Windows.
 */
function removePlaced(log: DaemonLog, placed: string): void {
  let directory: string;
  try {
    directory = realpathSync.native(placed);
  } catch (error) {
    if (isMissing(error)) return;
    log.error(
      `the canary reading's directory ${placed} was not removed, since its real path could not be read`,
      error,
    );
    return;
  }
  if (directory !== placed) {
    log.entry(
      `the canary reading's directory ${placed} was not removed, since it now resolves to ${directory}, which is not the directory the reading placed`,
    );
    return;
  }
  if (!unlinkInstall(log, placed)) return;
  try {
    rmSync(placed, { recursive: true });
  } catch (error) {
    log.error(
      `the canary reading's directory ${placed} could not be removed`,
      error,
    );
  }
}

/** Whether the placed directory holds no link to the install any more: removed here, or never made. */
function unlinkInstall(log: DaemonLog, placed: string): boolean {
  try {
    unlinkSync(join(placed, MODULES_DIRECTORY, VITEST_PACKAGE));
    return true;
  } catch (error) {
    if (isMissing(error)) return true;
    log.error(
      `the canary reading's directory ${placed} was not removed, since the link to the Vitest install in it could not be removed`,
      error,
    );
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.has((error as NodeJS.ErrnoException).code ?? "");
}
