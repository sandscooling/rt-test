import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { errorText, exitText } from "../vitest/error-text.js";

const GIT = "git";
const FSMONITOR_OFF = ["-c", "core.fsmonitor=false"];
/**
 * Untracked paths git ignores, a wholly ignored directory as one entry. `core.fsmonitor` is off because a
 * repository's config can name a program for git to run while it reads the index.
 */
const IGNORED_PATHS_ARGUMENTS = [
  ...FSMONITOR_OFF,
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
  "--directory",
  "-z",
];
/** Reads NUL-separated paths from stdin and prints those git ignores, a tracked path never among them. */
const CHECK_IGNORE_ARGUMENTS = [
  ...FSMONITOR_OFF,
  "check-ignore",
  "--stdin",
  "-z",
];
const GIT_SUCCESS_EXIT_CODE = 0;
/** `check-ignore` exits 1 when none of the paths it read is ignored. */
const NONE_IGNORED_EXIT_CODE = 1;
const GIT_ENVIRONMENT_PREFIX = "GIT_";
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
/** Enough of git's stderr to say why it failed. */
const MAX_GIT_ERROR_CHARACTERS = 2000;
const ENTRY_SEPARATOR = "\0";

/** What git reports as ignored under the consumer root and under each nested repository the walk enters. */
export interface IgnoredPaths {
  readonly has: (path: string) => boolean;
  /** Asks git once per scan for a repository inside the root, whose ignored paths the root's listing omits. */
  readonly addRepository: (directory: string) => void;
}

export type GitOutput =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

export type CheckedPaths =
  | { readonly ok: true; readonly paths: ReadonlySet<string> }
  | { readonly ok: false; readonly reason: string };

export type IgnoredListing =
  | {
      readonly ok: true;
      readonly paths: ReadonlySet<string>;
      /**
       * Directories the listing named whose own ignored status git denies: every entry they held was ignored when
       * listed, but one created later may not be, so each path under them must be checked.
       */
      readonly unconfirmed: ReadonlySet<string>;
    }
  | { readonly ok: false; readonly reason: string };

/** A listing's entries, relative to its repository, a directory entry ending in `/`. */
interface ListedEntries {
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

const DIRECTORY_SUFFIX = "/";

export function ignoredPathsReader(root: string): IgnoredPaths {
  const listings = [gitIgnoredPaths(root)];
  const asked = new Set([resolve(root)]);
  return {
    has: (path) => listings.some((listing) => listing.has(path)),
    addRepository: (directory) => {
      const repository = resolve(directory);
      if (asked.has(repository)) return;
      asked.add(repository);
      listings.push(gitIgnoredPaths(repository));
    },
  };
}

/**
 * The absolute paths under `root` that git reports as ignored. Outside a git repository, or when git cannot
 * be run or its output read, it is empty, so the walk skips nothing and widens nothing extra. A listed directory
 * git does not itself ignore is left out, so the walk enters it rather than skip what may be read.
 */
function gitIgnoredPaths(root: string): ReadonlySet<string> {
  const absoluteRoot = resolve(root);
  const listed = runGitSync(absoluteRoot, IGNORED_PATHS_ARGUMENTS);
  if (listed === undefined) return new Set();
  const { files, directories } = listedEntries(listed);
  const checked =
    directories.length === 0
      ? ""
      : runGitSync(
          absoluteRoot,
          CHECK_IGNORE_ARGUMENTS,
          checkInput(directories),
        );
  return absolutePaths(absoluteRoot, [
    ...files,
    ...(checked === undefined ? [] : listedEntries(checked).files),
  ]);
}

/** Undefined when git cannot be run or fails. */
function runGitSync(
  directory: string,
  args: readonly string[],
  input?: string,
): string | undefined {
  const ran = spawnSync(GIT, ["-C", directory, ...args], {
    ...gitSpawnOptions(),
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    ...(input === undefined ? {} : { input }),
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (ran.error !== undefined) return undefined;
  return ran.status === GIT_SUCCESS_EXIT_CODE ? ran.stdout : undefined;
}

function gitSpawnOptions(): {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  windowsHide: boolean;
} {
  return {
    // Windows looks a bare command up in the working directory before PATH, and the daemon's is the consumer root.
    cwd: tmpdir(),
    env: environmentWithoutGit(),
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  };
}

/**
 * The listing of `repository`'s ignored paths, read without blocking; the signal ends git. `ls-files --directory`
 * names a directory whose every present entry is ignored even when git does not ignore the directory itself, so
 * each directory it names is asked about again, and those git denies are returned as unconfirmed.
 */
export async function readIgnoredPaths(
  repository: string,
  signal: AbortSignal,
): Promise<IgnoredListing> {
  const absolute = resolve(repository);
  const listed = await runGit(absolute, IGNORED_PATHS_ARGUMENTS, { signal });
  if (!listed.ok) return listed;
  const { files, directories } = listedEntries(listed.stdout);
  const checked = await readCheckedIgnored(absolute, directories, signal);
  if (!checked.ok) return checked;
  const unconfirmed = absolutePaths(absolute, directories);
  for (const path of checked.paths) unconfirmed.delete(path);
  return {
    ok: true,
    paths: new Set([...absolutePaths(absolute, files), ...checked.paths]),
    unconfirmed,
  };
}

/** Which of `paths`, relative to `repository` and `/`-separated, git ignores, as absolute paths. */
export async function readCheckedIgnored(
  repository: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<CheckedPaths> {
  const absolute = resolve(repository);
  if (paths.length === 0) return { ok: true, paths: new Set() };
  const checked = await runGit(absolute, CHECK_IGNORE_ARGUMENTS, {
    signal,
    input: checkInput(paths),
    acceptedExitCodes: [GIT_SUCCESS_EXIT_CODE, NONE_IGNORED_EXIT_CODE],
  });
  if (!checked.ok) return checked;
  return {
    ok: true,
    paths: absolutePaths(absolute, listedEntries(checked.stdout).files),
  };
}

function checkInput(paths: readonly string[]): string {
  return paths.map((path) => `${path}${ENTRY_SEPARATOR}`).join("");
}

/** A directory entry keeps its path without the trailing `/`; `check-ignore` prints its paths as given. */
function listedEntries(stdout: string): ListedEntries {
  const files: string[] = [];
  const directories: string[] = [];
  for (const entry of stdout.split(ENTRY_SEPARATOR)) {
    if (entry === "") continue;
    if (entry.endsWith(DIRECTORY_SUFFIX)) {
      directories.push(entry.slice(0, -DIRECTORY_SUFFIX.length));
    } else {
      files.push(entry);
    }
  }
  return { files, directories };
}

function absolutePaths(root: string, entries: readonly string[]): Set<string> {
  return new Set(entries.map((entry) => resolve(root, entry)));
}

interface GitRun {
  readonly signal: AbortSignal;
  readonly input?: string;
  readonly acceptedExitCodes?: readonly number[];
}

/**
 * Runs git in `directory` from outside the consumer, with the same environment as the synchronous reader, and
 * never blocks the event loop. The signal, the timeout and an output past its bound each end git.
 */
export function runGit(
  directory: string,
  args: readonly string[],
  { signal, input, acceptedExitCodes = [GIT_SUCCESS_EXIT_CODE] }: GitRun,
): Promise<GitOutput> {
  return new Promise((settle) => {
    const child = spawn(GIT, ["-C", directory, ...args], {
      ...gitSpawnOptions(),
      stdio: ["pipe", "pipe", "pipe"],
      signal,
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = "";
    let failure: string | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_GIT_OUTPUT_BYTES) {
        failure ??= `git printed more than ${MAX_GIT_OUTPUT_BYTES} bytes`;
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_GIT_ERROR_CHARACTERS) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      failure ??= signal.aborted
        ? `git ${commandText(args)} was stopped before it ended`
        : `git could not be run: ${errorText(error)}`;
    });
    child.stdin.on("error", (error) => {
      failure ??= `git's input could not be written: ${errorText(error)}`;
    });
    child.stdin.end(input);
    child.on("close", (code, exitSignal) => {
      if (
        failure === undefined &&
        code !== null &&
        acceptedExitCodes.includes(code)
      ) {
        settle({ ok: true, stdout: Buffer.concat(stdout).toString("utf8") });
        return;
      }
      const ending =
        code === null
          ? `did not end within ${GIT_TIMEOUT_MS} ms`
          : `ended with ${exitText(code, exitSignal)}`;
      settle({
        ok: false,
        reason:
          failure ??
          `git ${commandText(args)} ${ending}: ${stderr.slice(0, MAX_GIT_ERROR_CHARACTERS).trim()}`,
      });
    });
  });
}

function commandText(args: readonly string[]): string {
  return args.filter((arg) => !FSMONITOR_OFF.includes(arg)).join(" ");
}

/**
 * A `GIT_DIR` or `GIT_WORK_TREE` inherited from the daemon's caller would point git at another repository.
 * Names compare without case, as Windows reads them.
 */
function environmentWithoutGit(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.toUpperCase().startsWith(GIT_ENVIRONMENT_PREFIX),
    ),
  );
}
