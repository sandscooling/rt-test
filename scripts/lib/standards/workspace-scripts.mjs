import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { result } from "./result.mjs";

const REQUIRED_SCRIPTS = Object.freeze(["build", "typecheck"]);
const CHILDREN = "/*";
const NEGATION = "!";
const FIELD_SHAPE =
  'package.json workspaces must be an array or { "packages": [...] }.';

class WorkspaceError extends Error {}

const isObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new WorkspaceError(`cannot read ${path}: ${error.message}`, {
      cause: error,
    });
  }
}

function listedPatterns(workspaces) {
  if (Array.isArray(workspaces)) return workspaces;
  if (!isObject(workspaces)) throw new WorkspaceError(FIELD_SHAPE);
  if (Array.isArray(workspaces.packages)) return workspaces.packages;
  throw new WorkspaceError(FIELD_SHAPE);
}

function patternsOf(manifest) {
  if (!isObject(manifest)) {
    throw new WorkspaceError("package.json is not a JSON object.");
  }
  const { workspaces } = manifest;
  if (workspaces === undefined) return [];
  const patterns = listedPatterns(workspaces);
  const unreadable = patterns.find(
    (pattern) => typeof pattern !== "string" || pattern.trim() === "",
  );
  if (unreadable !== undefined) {
    throw new WorkspaceError(
      `workspaces pattern ${JSON.stringify(unreadable)} names no directory.`,
    );
  }
  return patterns;
}

const isWorkspace = (root, dir) => existsSync(join(root, dir, "package.json"));

const canonical = (root, dir) =>
  relative(root, join(root, dir)).split(sep).join("/") || ".";

function expand(root, pattern) {
  if (pattern.startsWith(NEGATION)) {
    throw new WorkspaceError(
      `unsupported workspaces pattern ${JSON.stringify(pattern)}; this check does not apply exclusions, so it cannot tell which workspaces to examine.`,
    );
  }
  const parent = pattern.endsWith(CHILDREN)
    ? pattern.slice(0, -CHILDREN.length)
    : undefined;
  if (parent === undefined && !pattern.includes("*")) {
    return isWorkspace(root, pattern) ? [pattern] : [];
  }
  if (parent === undefined || parent.includes("*")) {
    throw new WorkspaceError(
      `unsupported workspaces pattern ${JSON.stringify(pattern)}; teach this check to expand it.`,
    );
  }
  if (!existsSync(join(root, parent))) return [];
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${parent}/${entry.name}`)
    .filter((dir) => isWorkspace(root, dir))
    .sort();
}

function missingScripts(scripts) {
  return REQUIRED_SCRIPTS.filter(
    (name) => typeof scripts[name] !== "string" || scripts[name].trim() === "",
  );
}

function examine(root, dir) {
  const manifest = readJson(join(root, dir, "package.json"));
  if (!isObject(manifest)) {
    throw new WorkspaceError(`${dir}/package.json is not a JSON object.`);
  }
  const { name, scripts } = manifest;
  const label = `${typeof name === "string" ? name : dir} (${dir})`;
  const absent = missingScripts(isObject(scripts) ? scripts : {});
  return absent.length === 0
    ? { ok: true, line: `ok       ${label}` }
    : { ok: false, line: `MISSING  ${label}: no ${absent.join(", ")} script` };
}

export function checkWorkspaceScripts(config) {
  try {
    const manifest = readJson(join(config.root, "package.json"));
    const workspaces = [
      ...new Set(
        patternsOf(manifest)
          .flatMap((pattern) => expand(config.root, pattern))
          .map((dir) => canonical(config.root, dir)),
      ),
    ];
    if (workspaces.length === 0) {
      return result(
        1,
        [],
        ["FAIL: found no workspaces, so the check examined nothing."],
      );
    }
    const reports = workspaces.map((dir) => examine(config.root, dir));
    const out = reports.map((report) => report.line);
    const offenders = reports.filter((report) => !report.ok).length;
    const required = REQUIRED_SCRIPTS.join(" and ");
    if (offenders === 0) {
      return result(0, [
        ...out,
        `PASS: all ${workspaces.length} workspaces define ${required}.`,
      ]);
    }
    return result(1, out, [
      `FAIL: ${offenders} of ${workspaces.length} workspaces lack ${required}, so \`bun run --filter '*'\` skips them without a word.`,
    ]);
  } catch (error) {
    if (!(error instanceof WorkspaceError)) throw error;
    return result(1, [], [`FAIL: ${error.message}`]);
  }
}
