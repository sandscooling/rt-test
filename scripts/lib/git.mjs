import { spawnSync } from "node:child_process";

const GIT_BUFFER_BYTES = 64 * 1024 * 1024;
const DIFF_HEAD = ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"];
const DIFF_STAGED = ["diff", "--cached", "--name-only", "--no-renames", "-z"];
const HEAD_EXISTS = ["rev-parse", "--verify", "-q", "HEAD"];
const UNTRACKED = [
  "ls-files",
  "--others",
  "--exclude-standard",
  "--full-name",
  "-z",
];
const TRACKED = ["ls-files", "--full-name", "-z"];

export function gitIn(root) {
  return (args) => {
    const run = spawnSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: GIT_BUFFER_BYTES,
    });
    if (run.status === 0) return { ok: true, out: run.stdout };
    return { ok: false, out: run.stderr || run.error?.message || "" };
  };
}

// Without -z git quotes a path holding a non-ASCII byte, which then names no file.
function listed(git, args) {
  const run = git(args);
  if (!run.ok) return { error: `git ${args.join(" ")}: ${run.out.trim()}` };
  return { paths: run.out.split("\0").filter(Boolean) };
}

// Before the first commit there is no HEAD, and the index holds every change.
function trackedChanges(git) {
  const againstHead = listed(git, DIFF_HEAD);
  if (againstHead.error === undefined || git(HEAD_EXISTS).ok)
    return againstHead;
  return listed(git, DIFF_STAGED);
}

// Staged and unstaged changes against HEAD, plus untracked files. A rename
// lists its old path too, since whatever cited the old path is affected.
export function changedPaths(git) {
  const tracked = trackedChanges(git);
  if (tracked.error !== undefined) return tracked;
  const untracked = listed(git, UNTRACKED);
  if (untracked.error !== undefined) return untracked;
  return { paths: [...tracked.paths, ...untracked.paths] };
}

export const trackedPaths = (git) => listed(git, TRACKED);
