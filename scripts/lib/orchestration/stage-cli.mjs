import { HUNK_SEPARATOR, stageLane } from "./stage.mjs";
import { toRepoPath } from "./paths.mjs";

const PROG = "stage-lane";
const EXIT_USAGE = 2;
const USAGE = `  --lane <lane> [--hunk <path>${HUNK_SEPARATOR}<substring>]... [--also <path>]... [--dry-run]`;

class UsageError extends Error {}

function pathOrThrow(root, input) {
  if (input === undefined) throw new UsageError("--also needs a path");
  const path = toRepoPath(root, input);
  if (path === null) {
    throw new UsageError(`path is outside the repository: ${input}`);
  }
  return path;
}

function parseHunkSpec(root, value) {
  const at = value?.indexOf(HUNK_SEPARATOR) ?? -1;
  if (at <= 0) {
    throw new UsageError(
      `--hunk needs <path>${HUNK_SEPARATOR}<substring>, got ${JSON.stringify(value ?? "")}`,
    );
  }
  const substring = value.slice(at + HUNK_SEPARATOR.length);
  if (substring === "")
    throw new UsageError(`--hunk ${value}: the substring is empty`);
  return { path: pathOrThrow(root, value.slice(0, at)), substring };
}

export function parseStageArgs(root, argv) {
  const opts = { hunkSpecs: [], also: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--lane") opts.lane = argv[++i];
    else if (arg === "--hunk")
      opts.hunkSpecs.push(parseHunkSpec(root, argv[++i]));
    else if (arg === "--also") opts.also.push(pathOrThrow(root, argv[++i]));
    else throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
  }
  if (!opts.lane) throw new UsageError("--lane is required");
  return opts;
}

export function runStageCli(argv, { root, claimsDir }) {
  try {
    return stageLane({ root, claimsDir, ...parseStageArgs(root, argv) });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return {
      code: EXIT_USAGE,
      out: [],
      err: [`${PROG}: ${error.message}`, USAGE],
    };
  }
}
