import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const GIT = "git";
/**
 * Untracked paths git ignores, a wholly ignored directory as one entry. `core.fsmonitor` is off because a
 * repository's config can name a program for git to run while it reads the index.
 */
const IGNORED_PATHS_ARGUMENTS = [
  "-c",
  "core.fsmonitor=false",
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
  "--directory",
  "-z",
];
const GIT_ENVIRONMENT_PREFIX = "GIT_";
const GIT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024 * 1024;
const ENTRY_SEPARATOR = "\0";

/**
 * The absolute paths under `root` that git reports as ignored. Outside a git repository, or when git cannot
 * be run or its output read, it is empty, so the walk skips nothing and widens nothing extra.
 */
export function gitIgnoredPaths(root: string): ReadonlySet<string> {
  const absoluteRoot = resolve(root);
  const listed = spawnSync(
    GIT,
    ["-C", absoluteRoot, ...IGNORED_PATHS_ARGUMENTS],
    {
      // Windows looks a bare command up in the working directory before PATH, and the daemon's is the consumer root.
      cwd: tmpdir(),
      encoding: "utf8",
      env: environmentWithoutGit(),
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (listed.error !== undefined || listed.status !== 0) return new Set();
  return new Set(
    listed.stdout
      .split(ENTRY_SEPARATOR)
      .map((entry) => resolve(absoluteRoot, entry)),
  );
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
