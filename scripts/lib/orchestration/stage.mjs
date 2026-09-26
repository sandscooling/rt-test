import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listClaims } from "./claims.mjs";
import { comparable } from "./paths.mjs";

const PROG = "stage-lane";
const EXIT = { OK: 0, REFUSED: 1 };
export const HUNK_SEPARATOR = "::";
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
const HUNK_HEADER = /^@@ (-(\d+)(?:,(\d+))?) \+\d+(?:,(\d+))? @@(.*)$/;

class StageError extends Error {}

function git(root, args, input) {
  const r = spawnSync(
    "git",
    ["--literal-pathspecs", "-c", "core.quotepath=false", ...args],
    { cwd: root, encoding: "utf8", input, maxBuffer: GIT_MAX_BUFFER },
  );
  if (r.error) throw r.error;
  return r;
}

function gitOk(root, args, input) {
  const r = git(root, args, input);
  if (r.status !== 0) {
    throw new StageError(`git ${args.join(" ")} failed: ${r.stderr.trim()}`);
  }
  return r.stdout;
}

function worktreeChanges(root, paths) {
  const changes = new Map();
  if (paths.length === 0) return changes;
  const args = [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
    "--",
    ...paths,
  ];
  for (const entry of gitOk(root, args).split("\0")) {
    if (entry.length < 4) continue;
    const path = entry.slice(3);
    changes.set(comparable(path), { path, xy: entry.slice(0, 2) });
  }
  return changes;
}

function parseDiff(text) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const header = [];
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      current = { header: line, body: [] };
      hunks.push(current);
    } else if (current) current.body.push(line);
    else header.push(line);
  }
  return { header, hunks };
}

const changedLines = (hunk) =>
  hunk.body.filter((l) => l.startsWith("+") || l.startsWith("-"));
const countLines = (hunks, sign) =>
  hunks.reduce(
    (n, h) => n + h.body.filter((l) => l.startsWith(sign)).length,
    0,
  );

function uniqueByComparable(items) {
  const seen = new Map();
  for (const item of items) {
    if (!seen.has(comparable(item.path))) seen.set(comparable(item.path), item);
  }
  return [...seen.values()];
}

function planWhole(root, requested, hunkPaths, errors) {
  const changes = worktreeChanges(
    root,
    requested.map((w) => w.path),
  );
  const plan = { whole: [], unchanged: [], alreadyStaged: [] };
  for (const w of requested) {
    const change = changes.get(comparable(w.path));
    if (hunkPaths.has(comparable(w.path))) {
      if (w.source === "--also") {
        errors.push(
          `${w.path}: named by --also AND by --hunk; stage it one way only`,
        );
      }
    } else if (change === undefined) {
      if (w.source === "--also") {
        errors.push(`${w.path}: --also names a file with no change to stage`);
      } else plan.unchanged.push(w.path);
    } else if (change.xy[1] === " ") plan.alreadyStaged.push(change.path);
    else plan.whole.push(change);
  }
  return plan;
}

function groupByPath(hunkSpecs) {
  const byPath = new Map();
  for (const spec of hunkSpecs) {
    const key = comparable(spec.path);
    if (!byPath.has(key)) byPath.set(key, { path: spec.path, specs: [] });
    byPath.get(key).specs.push(spec);
  }
  return [...byPath.values()];
}

function matchHunks(path, parsed, specs, errors) {
  const selected = new Set();
  const matches = specs.map((spec) => {
    const hits = parsed.hunks.flatMap((h, i) =>
      changedLines(h).some((l) => l.slice(1).includes(spec.substring))
        ? [i]
        : [],
    );
    if (hits.length === 0) {
      errors.push(
        `${path}${HUNK_SEPARATOR}${spec.substring}: matches none of the file's ${parsed.hunks.length} hunk(s)`,
      );
    }
    for (const i of hits) selected.add(i);
    return { substring: spec.substring, count: hits.length };
  });
  const hunks = [...selected].sort((a, b) => a - b).map((i) => parsed.hunks[i]);
  return { hunks, matches };
}

function planHunks(root, hunkSpecs, errors) {
  const patches = [];
  for (const { path, specs } of groupByPath(hunkSpecs)) {
    const diff = gitOk(root, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "-U0",
      "--",
      path,
    ]);
    if (diff.trim() === "") {
      const names = specs
        .map((s) => `${path}${HUNK_SEPARATOR}${s.substring}`)
        .join(", ");
      errors.push(
        `${names}: the file has no unstaged change (not modified; a new file goes through --also)`,
      );
      continue;
    }
    const parsed = parseDiff(diff);
    const { hunks, matches } = matchHunks(path, parsed, specs, errors);
    patches.push({
      path,
      header: parsed.header,
      hunks,
      total: parsed.hunks.length,
      matches,
    });
  }
  return patches;
}

export function planLane({ root, claimsDir, lane, hunkSpecs = [], also = [] }) {
  const errors = [];
  const requested = uniqueByComparable([
    ...listClaims(claimsDir, lane).map((c) => ({
      path: c.path,
      source: "claim",
    })),
    ...also.map((path) => ({ path, source: "--also" })),
  ]);
  const hunkPaths = new Set(hunkSpecs.map((s) => comparable(s.path)));
  const whole = planWhole(root, requested, hunkPaths, errors);
  const patches = planHunks(root, hunkSpecs, errors);
  return { errors, ...whole, patches };
}

const rangeText = (start, count) =>
  count === 1 ? `${start}` : `${start},${count}`;

// `--unidiff-zero` places a hunk with no old lines by its new-side number, and that number
// counts every hunk above it, including the ones left unstaged. So each header keeps its real
// old side, and its new side is recomputed from the selected hunks alone.
function rebaseHeaders(hunks) {
  let delta = 0;
  return hunks.map((h) => {
    const m = HUNK_HEADER.exec(h.header);
    if (m === null)
      throw new StageError(`unparseable hunk header: ${h.header}`);
    const [, oldText, oldStartText, oldCountText, newCountText, rest] = m;
    const oldCount = oldCountText === undefined ? 1 : Number(oldCountText);
    const newCount = newCountText === undefined ? 1 : Number(newCountText);
    const firstLine = Number(oldStartText) + (oldCount === 0 ? 1 : 0) + delta;
    delta += newCount - oldCount;
    const newStart = newCount === 0 ? firstLine - 1 : firstLine;
    const header = `@@ ${oldText} +${rangeText(newStart, newCount)} @@${rest}`;
    return { header, body: h.body };
  });
}

const patchText = (p) =>
  `${[...p.header, ...rebaseHeaders(p.hunks).flatMap((h) => [h.header, ...h.body])].join("\n")}\n`;

function applyPlan(root, plan) {
  const apply = ["apply", "--cached", "--unidiff-zero", "-"];
  const check = ["apply", "--cached", "--check", "--unidiff-zero", "-"];
  for (const p of plan.patches) {
    const r = git(root, check, patchText(p));
    if (r.status !== 0) {
      throw new StageError(
        `${p.path}: git apply --check refused the hunk patch: ${r.stderr.trim()}`,
      );
    }
  }
  if (plan.whole.length > 0) {
    gitOk(root, ["add", "-A", "--", ...plan.whole.map((w) => w.path)]);
  }
  for (const p of plan.patches) gitOk(root, apply, patchText(p));
}

function parseNumstat(out) {
  return out
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const [added = "", removed = "", ...rest] = record.split("\t");
      return { added, removed, path: rest.join("\t") };
    });
}

export const indexNumstat = (root) =>
  parseNumstat(
    gitOk(root, ["diff", "--cached", "--numstat", "-z", "--no-renames"]),
  );

function untrackedNumstat(root, path) {
  const bytes = readFileSync(join(root, path));
  if (bytes.includes(0)) return { added: "-", removed: "-", path };
  const text = bytes.toString("utf8");
  const lines =
    text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return { added: String(lines), removed: "0", path };
}

function previewNumstat(root, plan) {
  const tracked = plan.whole.filter((w) => w.xy !== "??").map((w) => w.path);
  const rows =
    tracked.length > 0
      ? parseNumstat(
          gitOk(root, [
            "diff",
            "--numstat",
            "-z",
            "--no-renames",
            "--",
            ...tracked,
          ]),
        )
      : [];
  for (const w of plan.whole.filter((x) => x.xy === "??")) {
    rows.push(untrackedNumstat(root, w.path));
  }
  for (const p of plan.patches) {
    const added = String(countLines(p.hunks, "+"));
    const removed = String(countLines(p.hunks, "-"));
    rows.push({ added, removed, path: p.path });
  }
  return rows;
}

function formatNumstat(rows, note = () => "") {
  const lines = [];
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    added += Number(r.added) || 0;
    removed += Number(r.removed) || 0;
    lines.push(
      `  +${r.added.padEnd(5)} -${r.removed.padEnd(5)} ${r.path}${note(r)}`,
    );
  }
  lines.push(`TOTAL ${rows.length} file(s), +${added} -${removed}`);
  return lines;
}

function describePlan(plan, lines) {
  for (const w of plan.whole) {
    lines.push(`  WHOLE     ${w.xy.trim().padEnd(2)} ${w.path}`);
  }
  for (const p of plan.patches) {
    lines.push(
      `  HUNKS     ${p.path}: ${p.hunks.length} of ${p.total} hunk(s)`,
    );
    for (const m of p.matches) {
      const many = m.count > 1 ? ` (matched ${m.count} hunks, all staged)` : "";
      lines.push(
        `            ${HUNK_SEPARATOR}${m.substring}: ${m.count} hunk(s)${many}`,
      );
    }
  }
  for (const u of plan.unchanged) {
    lines.push(`  UNCHANGED ${u} (claimed, nothing to stage)`);
  }
  for (const s of plan.alreadyStaged) {
    lines.push(`  STAGED    ${s} (already fully staged before this run)`);
  }
}

export function stageLane(options) {
  const { root, lane, dryRun = false } = options;
  const dry = dryRun ? " (DRY RUN, nothing is staged)" : "";
  const out = [`${PROG}: lane ${lane}${dry}`];
  const err = [];
  try {
    const before = new Set(indexNumstat(root).map((r) => comparable(r.path)));
    const plan = planLane(options);
    if (plan.errors.length > 0) {
      for (const e of plan.errors) err.push(`REFUSED   ${e}`);
      err.push(`${PROG}: NOTHING WAS STAGED.`);
      return { code: EXIT.REFUSED, out, err, plan };
    }
    describePlan(plan, out);
    if (dryRun) {
      out.push("WOULD STAGE:", ...formatNumstat(previewNumstat(root, plan)));
      return { code: EXIT.OK, out, err, plan };
    }
    applyPlan(root, plan);
    const note = (r) =>
      before.has(comparable(r.path)) ? "   (in the index before this run)" : "";
    out.push(
      "STAGED (the whole index, which is what the commit takes):",
      ...formatNumstat(indexNumstat(root), note),
    );
    return { code: EXIT.OK, out, err, plan };
  } catch (error) {
    if (!(error instanceof StageError)) throw error;
    err.push(`${PROG}: ${error.message}`);
    return { code: EXIT.REFUSED, out, err };
  }
}
