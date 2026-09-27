import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runGit } from "../selection/git-ignored.js";
import { errorText } from "../vitest/error-text.js";
import { liesInside } from "../vitest/find-workspaces.js";
import { enclosingRepository } from "./input-filter.js";

const REV_PARSE = "rev-parse";
const ABSOLUTE_PATHS = "--path-format=absolute";
const GIT_PATH = "--git-path";
const EXCLUDE_FILE = "info/exclude";
const REPOSITORY_PATHS_ARGUMENTS = [
  REV_PARSE,
  ABSOLUTE_PATHS,
  "--git-common-dir",
  "--show-toplevel",
  GIT_PATH,
  "HEAD",
  GIT_PATH,
  "packed-refs",
  GIT_PATH,
  EXCLUDE_FILE,
];
const REPOSITORY_PATH_COUNT = 5;
const EXCLUDES_FILE_ARGUMENTS = [
  "config",
  "--path",
  "--get",
  "core.excludesFile",
];
const GIT_SUCCESS_EXIT_CODE = 0;
/** `git config --get` exits 1 when the key is unset. */
const UNSET_EXIT_CODE = 1;
const SYMBOLIC_REF_PREFIX = "ref:";
const REFTABLE_TABLES = join("reftable", "tables.list");
const REPOSITORY_CONFIG = "config";
const IGNORE_FILE = ".gitignore";
const XDG_CONFIG_HOME = "XDG_CONFIG_HOME";
const DEFAULT_CONFIG_DIRECTORY = ".config";
const XDG_GIT_DIRECTORY = "git";
const XDG_EXCLUDES_FILE = "ignore";
const XDG_CONFIG_FILE = "config";
const HOME_CONFIG_FILE = ".gitconfig";
const LINE_BREAK = /\r?\n/;

export type GitSources =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The files outside the consumer's own inputs whose change can move HEAD or change what git ignores: HEAD, the ref
 * it names and `packed-refs` in git's own directories (which lie outside the root for a linked worktree), each
 * `.gitignore` between the repository's top level and the root, `info/exclude` of the repository and of each
 * nested one, `core.excludesFile`, and the config files that can name another. Outside a git repository, only the
 * global files and each nested repository's `info/exclude`; none when there is no nested repository either.
 */
export async function gitSources(
  root: string,
  nestedRepositories: readonly string[],
  signal: AbortSignal,
): Promise<GitSources> {
  const insideRepository = enclosingRepository(root) !== undefined;
  if (!insideRepository && nestedRepositories.length === 0) {
    return { ok: true, files: [] };
  }
  const found = await Promise.all([
    insideRepository
      ? enclosingRepositoryFiles(root, signal)
      : Promise.resolve<GitSources>({ ok: true, files: [] }),
    globalExcludesFile(root, signal),
    ...nestedRepositories.map((repository) =>
      gitPath(repository, EXCLUDE_FILE, signal),
    ),
  ]);
  const failed = found.find((result) => !result.ok);
  if (failed !== undefined) return failed;
  return {
    ok: true,
    files: [
      ...found.flatMap((result) => (result.ok ? result.files : [])),
      ...globalConfigFiles(),
    ],
  };
}

/**
 * The enclosing repository's own files: HEAD, the ref it names, `packed-refs`, the reftable list, the repository
 * config, `info/exclude`, and each `.gitignore` between its top level and the root.
 */
async function enclosingRepositoryFiles(
  root: string,
  signal: AbortSignal,
): Promise<GitSources> {
  const listed = await runGit(root, REPOSITORY_PATHS_ARGUMENTS, { signal });
  if (!listed.ok) return listed;
  const paths = pathLines(listed.stdout);
  const [commonDirectory, topLevel, head, packedRefs, exclude] = paths;
  if (
    paths.length !== REPOSITORY_PATH_COUNT ||
    commonDirectory === undefined ||
    topLevel === undefined ||
    head === undefined ||
    packedRefs === undefined ||
    exclude === undefined
  ) {
    return {
      ok: false,
      reason: `git rev-parse printed ${paths.length} paths, not the ${REPOSITORY_PATH_COUNT} it was asked for: ${listed.stdout}`,
    };
  }
  const namedRef = await namedRefFile(root, head, signal);
  if (!namedRef.ok) return namedRef;
  return {
    ok: true,
    files: [
      head,
      packedRefs,
      join(commonDirectory, REFTABLE_TABLES),
      join(commonDirectory, REPOSITORY_CONFIG),
      exclude,
      ...namedRef.files,
      ...ancestorIgnoreFiles(root, topLevel),
    ],
  };
}

/** The loose ref file HEAD names, or none for a detached HEAD. */
async function namedRefFile(
  root: string,
  head: string,
  signal: AbortSignal,
): Promise<GitSources> {
  let content: string;
  try {
    content = await readFile(head, { encoding: "utf8", signal });
  } catch (error) {
    return { ok: false, reason: `cannot read ${head}: ${errorText(error)}` };
  }
  if (!content.startsWith(SYMBOLIC_REF_PREFIX)) return { ok: true, files: [] };
  return gitPath(
    root,
    content.slice(SYMBOLIC_REF_PREFIX.length).trim(),
    signal,
  );
}

/** Where `repository` keeps `path` inside its git directory. */
async function gitPath(
  repository: string,
  path: string,
  signal: AbortSignal,
): Promise<GitSources> {
  const located = await runGit(
    repository,
    [REV_PARSE, ABSOLUTE_PATHS, GIT_PATH, path],
    { signal },
  );
  if (!located.ok) return located;
  return { ok: true, files: pathLines(located.stdout) };
}

async function globalExcludesFile(
  root: string,
  signal: AbortSignal,
): Promise<GitSources> {
  const configured = await runGit(root, EXCLUDES_FILE_ARGUMENTS, {
    signal,
    acceptedExitCodes: [GIT_SUCCESS_EXIT_CODE, UNSET_EXIT_CODE],
  });
  if (!configured.ok) return configured;
  const path = configured.stdout.trim();
  if (path !== "") return { ok: true, files: [resolve(root, path)] };
  return {
    ok: true,
    files: [join(xdgConfigHome(), XDG_GIT_DIRECTORY, XDG_EXCLUDES_FILE)],
  };
}

/** The user's git config files, either of which can set `core.excludesFile`. */
function globalConfigFiles(): string[] {
  return [
    join(homedir(), HOME_CONFIG_FILE),
    join(xdgConfigHome(), XDG_GIT_DIRECTORY, XDG_CONFIG_FILE),
  ];
}

function xdgConfigHome(): string {
  const configHome = process.env[XDG_CONFIG_HOME];
  return configHome === undefined || configHome === ""
    ? join(homedir(), DEFAULT_CONFIG_DIRECTORY)
    : configHome;
}

/** The `.gitignore` of each directory from the repository's top level down to the root's parent. */
function ancestorIgnoreFiles(root: string, topLevel: string): string[] {
  const files: string[] = [];
  for (
    let directory = dirname(root);
    directory !== root && liesInside(topLevel, directory);
    directory = dirname(directory)
  ) {
    files.push(join(directory, IGNORE_FILE));
    if (directory === dirname(directory)) break;
  }
  return files;
}

function pathLines(stdout: string): string[] {
  return stdout
    .split(LINE_BREAK)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => resolve(line));
}
