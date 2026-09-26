import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { classifyPath, comparable, covers, PATH_CLASS } from "./paths.mjs";

const CLAIM_EXTENSION = ".json";
const KEY_LENGTH = 24;
// Not `.json`, so listClaims never reads a grant as a file claim.
const GRANT_PREFIX = "grant-";
const GRANT_EXTENSION = ".lock";

export const CLAIMS_DIR = "_agent-docs/.scratch/file-claims";

const REFUSAL_REASON =
  "orchestrator-only file: report the edit you would make, or ask the orchestrator to grant this path to your lane";
const UNGRANTABLE_REASON =
  "not orchestrator-only: a lane claims it without a grant";

function keyedFile(dir, prefix, extension, repoPath) {
  const key = createHash("sha256")
    .update(comparable(repoPath))
    .digest("hex")
    .slice(0, KEY_LENGTH);
  return join(dir, `${prefix}${key}${extension}`);
}

const claimFileFor = (dir, repoPath) =>
  keyedFile(dir, "", CLAIM_EXTENSION, repoPath);
const grantFileFor = (dir, repoPath) =>
  keyedFile(dir, GRANT_PREFIX, GRANT_EXTENSION, repoPath);
const isClaimFile = (name) => name.endsWith(CLAIM_EXTENSION);
const isGrantFile = (name) =>
  name.startsWith(GRANT_PREFIX) && name.endsWith(GRANT_EXTENSION);

function readRecord(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    return {
      path: "(unreadable record)",
      lane: "(unknown, possibly mid-write)",
      thread: "",
      at: 0,
    };
  }
}

function createExclusive(file, record) {
  const fd = openSync(file, "wx");
  try {
    writeSync(fd, JSON.stringify(record));
  } finally {
    closeSync(fd);
  }
}

function tryCreateOne(file, repoPath, owner, now) {
  const record = { path: repoPath, lane: owner.lane, thread: owner.thread };
  try {
    createExclusive(file, { ...record, at: now });
    return { status: "created" };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const existing = readRecord(file);
  if (existing === null) return tryCreateOne(file, repoPath, owner, now);
  if (existing.lane === owner.lane) return { status: "held" };
  return { status: "conflict", holder: existing };
}

const EMPTY = Object.freeze({
  refused: [],
  conflicts: [],
  created: [],
  held: [],
});

// All or nothing: a conflict on any path removes every record this call created.
function createAll(dir, fileFor, owner, repoPaths, now) {
  mkdirSync(dir, { recursive: true });
  const created = [];
  const held = [];
  const conflicts = [];
  for (const path of repoPaths) {
    const file = fileFor(dir, path);
    const result = tryCreateOne(file, path, owner, now);
    if (result.status === "created") created.push({ path, file });
    else if (result.status === "held") held.push(path);
    else conflicts.push({ path, holder: result.holder });
  }
  if (conflicts.length === 0) {
    const paths = created.map((record) => record.path);
    return { ok: true, ...EMPTY, created: paths, held };
  }
  for (const record of created) unlinkSync(record.file);
  return { ok: false, ...EMPTY, conflicts };
}

function uniqueByComparable(repoPaths) {
  const seen = new Map();
  for (const path of repoPaths) {
    if (!seen.has(comparable(path))) seen.set(comparable(path), path);
  }
  return [...seen.values()];
}

function listRecords(dir, isRecord, lane) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isRecord)
    .map((name) => ({ ...readRecord(join(dir, name)), file: join(dir, name) }))
    .filter(
      (record) => record.lane && (lane === undefined || record.lane === lane),
    )
    .sort(
      (a, b) => a.lane.localeCompare(b.lane) || a.path.localeCompare(b.path),
    );
}

export const listClaims = (dir, lane) => listRecords(dir, isClaimFile, lane);
export const listGrants = (dir, lane) => listRecords(dir, isGrantFile, lane);

export function claimPaths(dir, rules, owner, repoPaths, now = Date.now()) {
  const granted = listGrants(dir, owner.lane).map((g) => comparable(g.path));
  const unique = uniqueByComparable(repoPaths);
  const refused = unique
    .filter(
      (path) =>
        classifyPath(rules, path) === PATH_CLASS.ORCHESTRATOR_ONLY &&
        !granted.some((grant) => covers(grant, comparable(path))),
    )
    .map((path) => ({ path, reason: REFUSAL_REASON }));
  if (refused.length > 0) return { ok: false, ...EMPTY, refused };
  return createAll(dir, claimFileFor, owner, unique, now);
}

const overlaps = (a, b) => covers(a, b) || covers(b, a);

export function grantPaths(dir, rules, owner, repoPaths, now = Date.now()) {
  const unique = uniqueByComparable(repoPaths);
  const refused = unique
    .filter((path) => classifyPath(rules, path) === PATH_CLASS.CLAIMABLE)
    .map((path) => ({ path, reason: UNGRANTABLE_REASON }));
  if (refused.length > 0) return { ok: false, ...EMPTY, refused };
  const others = listGrants(dir).filter((g) => g.lane !== owner.lane);
  const conflicts = unique.flatMap((path) => {
    const holder = others.find((g) =>
      overlaps(comparable(g.path), comparable(path)),
    );
    return holder ? [{ path, holder }] : [];
  });
  if (conflicts.length > 0) return { ok: false, ...EMPTY, conflicts };
  return createAll(dir, grantFileFor, owner, unique, now);
}

export function claimFailureAdvice(result) {
  if (result.conflicts.length > 0) {
    return "NOTHING WAS CLAIMED. Stop, and send the orchestrator the lines above.";
  }
  return "NOTHING WAS CLAIMED. Claim again without the REFUSED paths, and report the edit you would make to each.";
}

function removeRecords(dir, list, fileFor, { lane, any = false }, repoPaths) {
  const outcome = { removed: [], refused: [], missing: [] };
  if (repoPaths.length === 0) {
    for (const record of list(dir, lane)) {
      unlinkSync(record.file);
      outcome.removed.push(record.path);
    }
    return outcome;
  }
  for (const path of uniqueByComparable(repoPaths)) {
    const file = fileFor(dir, path);
    const existing = readRecord(file);
    if (existing === null) outcome.missing.push(path);
    else if (!any && existing.lane !== lane) outcome.refused.push(path);
    else {
      unlinkSync(file);
      outcome.removed.push(path);
    }
  }
  return outcome;
}

export const releasePaths = (dir, who, repoPaths) =>
  removeRecords(dir, listClaims, claimFileFor, who, repoPaths);
export const endGrants = (dir, who, repoPaths) =>
  removeRecords(dir, listGrants, grantFileFor, who, repoPaths);
