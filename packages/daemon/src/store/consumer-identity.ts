import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { StoreScope } from "./stored-records.js";

const DEFAULT_STATE_DIRECTORY = ".rt-test";
const POSIX_SEPARATOR = "/";
const GIT_ENTRY = ".git";
const GIT_DIRECTORY_PREFIX = "gitdir:";
const COMMON_DIRECTORY_FILE = "commondir";

/** Outside a git repository the project identity is the worktree identity. */
export function consumerIdentity(consumerRoot: string): StoreScope {
  const worktreeIdentity = canonicalPath(consumerRoot, "the consumer root");
  return {
    projectIdentity: projectIdentity(worktreeIdentity),
    worktreeIdentity,
  };
}

export function defaultStateDirectory(consumerRoot: string): string {
  return join(consumerRoot, DEFAULT_STATE_DIRECTORY);
}

function canonicalPath(path: string, description: string): string {
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch (error) {
    throw new Error(
      `Cannot resolve ${description}, ${path}, to a real path, so it has no identity.`,
      { cause: error },
    );
  }
  return real.split(sep).join(POSIX_SEPARATOR);
}

function projectIdentity(worktreeIdentity: string): string {
  return enclosingCommonDirectory(worktreeIdentity) ?? worktreeIdentity;
}

function enclosingCommonDirectory(directory: string): string | undefined {
  const gitEntry = join(directory, GIT_ENTRY);
  const stats = statSync(gitEntry, { throwIfNoEntry: false });
  if (stats !== undefined) {
    return commonDirectory(gitEntry, stats.isDirectory());
  }
  const parent = dirname(directory);
  return parent === directory ? undefined : enclosingCommonDirectory(parent);
}

function commonDirectory(gitEntry: string, isDirectory: boolean): string {
  if (isDirectory) return canonicalPath(gitEntry, "the git directory");
  const gitDirectory = resolve(dirname(gitEntry), gitDirectoryTarget(gitEntry));
  const commonDirectoryFile = join(gitDirectory, COMMON_DIRECTORY_FILE);
  const common = existsSync(commonDirectoryFile)
    ? resolve(gitDirectory, readFileSync(commonDirectoryFile, "utf8").trim())
    : gitDirectory;
  return canonicalPath(common, `the git common directory named by ${gitEntry}`);
}

function gitDirectoryTarget(gitFile: string): string {
  const content = readFileSync(gitFile, "utf8").trimEnd();
  if (!content.startsWith(GIT_DIRECTORY_PREFIX)) {
    throw new Error(
      `Cannot find the git directory named by ${gitFile}: it does not start with "${GIT_DIRECTORY_PREFIX}".`,
    );
  }
  return content.slice(GIT_DIRECTORY_PREFIX.length).trim();
}
