import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isInside } from "../paths.mjs";
import { comparable, toRepoPath } from "./paths.mjs";

// `prettier --check .` reads both ignore files and .editorconfig by default, and never descends
// into a version-control folder; the API does none of that unless told.
const IGNORE_FILES = [".gitignore", ".prettierignore"];
const VCS_DIRS = [".git", ".sl", ".svn", ".hg", ".jj"];

const STATUS = Object.freeze({
  FORMATTED: "formatted",
  UNCHANGED: "unchanged",
  SKIPPED: "skipped",
  FAILED: "failed",
});

const skipped = (repoPath, reason, note = null) => ({
  status: STATUS.SKIPPED,
  repoPath,
  reason,
  note,
});

const firstLine = (error) =>
  String(error instanceof Error ? error.message : error).split("\n")[0];

const inVcsDir = (repoPath) =>
  comparable(repoPath)
    .split("/")
    .some((segment) => VCS_DIRS.includes(segment));

export async function formatOnSave(root, filePath) {
  if (typeof filePath !== "string" || filePath === "") {
    return skipped(null, "no file path");
  }
  const repoPath = toRepoPath(root, filePath);
  if (repoPath == null) return skipped(null, "outside the project");
  if (inVcsDir(repoPath)) return skipped(repoPath, "version-control folder");
  try {
    return await formatInPlace(root, repoPath);
  } catch (error) {
    const reason = firstLine(error);
    return {
      status: STATUS.FAILED,
      repoPath,
      reason,
      note: `The format-on-save hook could not format ${repoPath}, so it stays as saved: ${reason}`,
    };
  }
}

async function formatInPlace(root, repoPath) {
  const file = resolve(root, repoPath);
  if (!isInside(realpathSync(root), realpathSync(file))) {
    return skipped(repoPath, "links outside the project");
  }
  const prettier = await import("prettier");
  const info = await prettier.getFileInfo(file, {
    ignorePath: IGNORE_FILES.map((name) => join(root, name)),
  });
  if (info.ignored) return skipped(repoPath, "ignored");
  if (info.inferredParser == null) return skipped(repoPath, "no parser");
  const source = readFileSync(file, "utf8");
  const config = await prettier.resolveConfig(file, { editorconfig: true });
  const formatted = await prettier.format(source, {
    ...config,
    filepath: file,
  });
  if (formatted === source) {
    return { status: STATUS.UNCHANGED, repoPath, reason: null, note: null };
  }
  if (readFileSync(file, "utf8") !== source) {
    return skipped(
      repoPath,
      "changed while formatting",
      `${repoPath} changed on disk while prettier ran, so it stays as saved, unformatted.`,
    );
  }
  writeFileSync(file, formatted);
  // Claude Code already tells the session when a PostToolUse hook rewrote its file.
  return { status: STATUS.FORMATTED, repoPath, reason: null, note: null };
}
