import { spawnSync } from "node:child_process";
import { display, proseLines } from "./files.mjs";

// Lenient on purpose: an id on any list line of any past version counts as used.
const USED_ID = /^\s*[-*+]\s+\W*(N?FR\d+)\b/;
const BATCH_HEADER = /^\S+ blob (\d+)$/;
const NEWLINE = 10;
// --follow tracks one name and can jump to another file where this one was recreated, so the exact path is walked too.
// A lower rename threshold only reserves more ids, which is the safe direction.
const WALKS = [["--full-history"], ["--follow", "-M30%"]];

// Every requirement id any committed version of the file defined, so a deleted id is never reissued.
export function historicIds(config) {
  const name = display(config, config.requirements);
  const unreadable = (why) => ({
    ids: [],
    problem: `cannot read the history of ${name}, so --next could reissue a deleted id: ${why}`,
  });
  const shallow = git(config, ["rev-parse", "--is-shallow-repository"]);
  if (shallow.why) return unreadable(shallow.why);
  if (shallow.stdout.toString().trim() !== "false") {
    return unreadable("the clone is shallow; run git fetch --unshallow.");
  }
  const head = git(config, ["rev-parse", "-q", "--verify", "HEAD"], {
    unborn: true,
  });
  if (head.why) return unreadable(head.why);
  if (head.unborn) return { ids: [] };
  const versions = new Set();
  for (const walk of WALKS) {
    // Unquoted non-ASCII paths, so cat-file can resolve an earlier name like docs/réq.md.
    const log = git(config, [
      "-c",
      "core.quotePath=false",
      "log",
      ...walk,
      "-m",
      "--diff-filter=d",
      "--format=%x00%H",
      "--name-only",
      "--",
      name,
    ]);
    if (log.why) return unreadable(log.why);
    for (const version of versionsOf(log.stdout.toString())) {
      versions.add(version);
    }
  }
  return readVersions(config, [...versions], unreadable);
}

function readVersions(config, versions, unreadable) {
  if (versions.length === 0) return { ids: [] };
  const batch = git(config, ["cat-file", "--batch"], {
    input: versions.map((version) => `${version}\n`).join(""),
  });
  if (batch.why) return unreadable(batch.why);
  const texts = blobTexts(batch.stdout);
  if (texts.length !== versions.length) {
    return unreadable(
      `git cat-file returned ${texts.length} of ${versions.length} versions.`,
    );
  }
  return { ids: texts.flatMap(usedIds) };
}

function git(config, args, { input, unborn = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: config.root,
    input,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) return { why: result.error.message };
  // rev-parse --verify -q exits 1 with no output when HEAD has no commit yet.
  if (unborn && result.status === 1 && result.stdout.length === 0) {
    return { unborn: true };
  }
  if (result.status !== 0) {
    const stderr = result.stderr.toString().trim();
    return {
      why: `git ${args.join(" ")} exited ${result.status}${stderr ? `: ${stderr}` : "."}`,
    };
  }
  return { stdout: result.stdout };
}

// Each record is a commit hash followed by the file's path in that commit; a merge with -m repeats per parent.
function versionsOf(log) {
  return log
    .split("\0")
    .slice(1)
    .flatMap((record) => {
      const [hash, ...paths] = record.split("\n").filter((line) => line !== "");
      return paths.map((path) => `${hash}:${path}`);
    });
}

function blobTexts(buffer) {
  const texts = [];
  let offset = 0;
  while (offset < buffer.length) {
    const end = buffer.indexOf(NEWLINE, offset);
    if (end === -1) break;
    const size = BATCH_HEADER.exec(buffer.toString("utf8", offset, end))?.[1];
    if (size === undefined) break;
    const start = end + 1;
    texts.push(buffer.toString("utf8", start, start + Number(size)));
    offset = start + Number(size) + 1;
  }
  return texts;
}

function usedIds(text) {
  return proseLines(text).flatMap((line) => USED_ID.exec(line.text)?.[1] ?? []);
}
