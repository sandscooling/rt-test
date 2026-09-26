import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fenceKinds } from "../fences.mjs";
import { display, planningFiles, readText } from "../planning/files.mjs";
import { readStatus } from "../planning/status.mjs";
import { result } from "../standards/result.mjs";

export const USAGE = [
  "Usage: list-unbuilt-work.mjs [<path>...]",
  "  Lists each ticket not done whose ticket file or sprint-file section names one of the paths,",
  "  or a folder at least two segments deep that holds one.",
  "  With no paths, reads the changeset from git: unstaged, staged and untracked files.",
].join("\n");

const PROG = "list-unbuilt-work";
const SETTLED_STATES = new Set(["done"]);
const NO_STATUS = "no status key";
const UNKEYED = "file name matches no key";
const TICKET_FILE =
  /^([1-9]\d*)-([1-9]\d*[a-z]?)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const SPRINT_FILE = /^sprint-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const TICKET_HEADING = /^## Ticket ([1-9]\d*\.[1-9]\d*[a-z]?): /;
const NAME_CHAR = /[A-Za-z0-9_$-]/;
const CHAR_BEFORE_NAME = /[A-Za-z0-9_$.-]/;
const MIN_FOLDER_SEGMENTS = 2;
const SHOWN_LINES = 4;
const GIT_BUFFER_BYTES = 64 * 1024 * 1024;
const CHANGESET_COMMANDS = [
  ["diff", "--name-only", "--no-renames"],
  ["diff", "--cached", "--name-only", "--no-renames"],
  ["ls-files", "--others", "--exclude-standard"],
];

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

const nonBlank = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

function normalize(config, path) {
  const slashed = path.trim().replaceAll("\\", "/");
  const rooted = isAbsolute(slashed)
    ? relative(config.root, slashed).replaceAll("\\", "/")
    : slashed;
  return rooted.replace(/^\.\//, "").replace(/\/+$/, "");
}

function changedPaths(argv, git) {
  if (argv.length > 0) return { paths: argv };
  const paths = [];
  for (const args of CHANGESET_COMMANDS) {
    const run = git(args);
    if (!run.ok) {
      return {
        error: `cannot read the changeset with git ${args.join(" ")}: ${run.out.trim()}. Pass the paths instead.`,
      };
    }
    paths.push(...nonBlank(run.out));
  }
  return { paths };
}

// The planning files are where unbuilt work lives, so one citing another is
// the plan describing itself rather than work a change could invalidate.
function isPlanningPath(config, path) {
  const dirs = [config.ticket_dir, config.sprints_dir].map(
    (dir) => `${display(config, dir)}/`,
  );
  return (
    path === display(config, config.sprint_status) ||
    dirs.some((dir) => path.startsWith(dir))
  );
}

function basenameCounts(git) {
  const run = git(["ls-files"]);
  if (!run.ok) return undefined;
  const counts = new Map();
  for (const path of nonBlank(run.out)) {
    const name = path.split("/").at(-1);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

// Every suffix that keeps a directory, plus the bare file name when no other
// tracked file shares it: planning prose often cites a file by name alone.
function tokensFor(path, counts) {
  const parts = path.split("/");
  const tokens = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    tokens.push(parts.slice(index).join("/"));
  }
  const name = parts.at(-1);
  if (name !== "" && counts !== undefined && (counts.get(name) ?? 0) <= 1)
    tokens.push(name);
  return tokens;
}

// A folder's name is never a file's, so the basename counts cannot vouch for it.
const isDirectory = (root, path) =>
  statSync(join(root, path), { throwIfNoEntry: false })?.isDirectory() === true;

const startsName = (line, at) =>
  at === 0 || !CHAR_BEFORE_NAME.test(line[at - 1]);

function endsName(line, end) {
  if (end === line.length) return true;
  const next = line[end];
  if (NAME_CHAR.test(next)) return false;
  return !(next === "." && NAME_CHAR.test(line[end + 1] ?? ""));
}

// A pending ticket often cites the folder a new file will join. Shallower
// folders than MIN_FOLDER_SEGMENTS would match nearly every ticket.
function foldersFor(path) {
  const parts = path.split("/");
  const folders = [];
  for (let end = MIN_FOLDER_SEGMENTS; end < parts.length; end += 1)
    folders.push(parts.slice(0, end).join("/"));
  return folders;
}

// A folder followed by a child name cites that child, not the folder.
const endsFolder = (line, end) =>
  endsName(line, end) &&
  !(line[end] === "/" && NAME_CHAR.test(line[end + 1] ?? ""));

function cites(line, token, ends) {
  for (
    let at = line.indexOf(token);
    at !== -1;
    at = line.indexOf(token, at + 1)
  ) {
    if (startsName(line, at) && ends(line, at + token.length)) return true;
  }
  return false;
}

const citesFile = (line, { tokens }) =>
  tokens.some((token) => cites(line, token, endsName));

const citesFolder = (line, search) =>
  !citesFile(line, search) &&
  search.folders.some((folder) => cites(line, folder, endsFolder));

const stateOf = (entries, id) => entries.get(id)?.state ?? NO_STATUS;

// A planning file whose name maps to no status key is still searched: its
// state is unknown, and skipping it would hide the work it describes.
const unkeyedUnit = (file, lines) => ({
  id: file,
  label: file,
  state: UNKEYED,
  file,
  lines,
  offset: 0,
});

function ticketUnits(config, status) {
  return planningFiles(config.ticket_dir, { optional: true }).flatMap(
    ({ name, path }) => {
      const match = TICKET_FILE.exec(name);
      const file = display(config, path);
      const lines = readText(path).split(/\r?\n/);
      if (!match) return [unkeyedUnit(file, lines)];
      const id = `${match[1]}.${match[2]}`;
      return [
        {
          id,
          label: `Ticket ${id}`,
          state: stateOf(status.tickets, id),
          file,
          lines,
          offset: 0,
        },
      ];
    },
  );
}

// Splits a sprint file at each ticket heading outside a code fence; the
// section before the first heading is the sprint's own preamble.
function sections(text) {
  const all = [{ id: undefined, offset: 0, lines: [] }];
  const lines = text.split(/\r?\n/);
  const kinds = fenceKinds(lines);
  lines.forEach((line, index) => {
    const prose = kinds[index] === "prose";
    const id = prose ? TICKET_HEADING.exec(line)?.[1] : undefined;
    if (id !== undefined) all.push({ id, offset: index, lines: [] });
    all.at(-1).lines.push(line);
  });
  return all;
}

function sprintUnits(config, status) {
  return planningFiles(config.sprints_dir, { optional: true }).flatMap(
    ({ name, path }) => {
      const sprint = SPRINT_FILE.exec(name)?.[1];
      const file = display(config, path);
      if (sprint === undefined)
        return [unkeyedUnit(file, readText(path).split(/\r?\n/))];
      return sections(readText(path)).map(({ id, offset, lines }) =>
        id === undefined
          ? {
              id: sprint,
              label: `Sprint ${sprint} preamble`,
              state: stateOf(status.sprints, sprint),
              file,
              lines,
              offset,
            }
          : {
              id,
              label: `Ticket ${id}`,
              state: stateOf(status.tickets, id),
              file,
              lines,
              offset,
            },
      );
    },
  );
}

function addSource(hits, unit, path, lines) {
  if (lines.length === 0) return;
  const hit = hits.get(unit.id) ?? {
    label: unit.label,
    state: unit.state,
    sources: [],
  };
  hits.set(unit.id, hit);
  hit.sources.push({ file: unit.file, path, lines });
}

const citingLines = (unit, test) =>
  unit.lines.flatMap((line, index) =>
    test(line) ? [unit.offset + index + 1] : [],
  );

// A line naming only the folder must say so, or a reader searching it for the
// changed path finds nothing and dismisses the hit.
function scan(hits, unit, searches) {
  if (SETTLED_STATES.has(unit.state)) return;
  for (const search of searches) {
    const files = citingLines(unit, (line) => citesFile(line, search));
    const folders = citingLines(unit, (line) => citesFolder(line, search));
    addSource(hits, unit, search.path, files);
    addSource(hits, unit, `a folder holding ${search.path}`, folders);
  }
}

function shown(lines) {
  const listed = lines.slice(0, SHOWN_LINES).join(",");
  const more = lines.length - SHOWN_LINES;
  return more > 0 ? `${listed} (+${more} more)` : listed;
}

function hitLines(hits, searched) {
  if (hits.size === 0) {
    return [
      `unbuilt-work: clean. No unbuilt ticket names any of ${searched} path(s).`,
    ];
  }
  const out = [
    `unbuilt-work: ${hits.size} unbuilt ticket(s) name a searched path. These are candidates, not defects.`,
  ];
  const ordered = [...hits].sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  for (const [, hit] of ordered) {
    out.push("", `  ${hit.label} (${hit.state})`);
    for (const source of hit.sources) {
      out.push(
        `    ${source.file}:${shown(source.lines)} names ${source.path}`,
      );
    }
  }
  return out;
}

function caveatLines(unsearchable, counts) {
  const out = [];
  if (counts === undefined) {
    out.push(
      "",
      "Bare file names were not matched: git ls-files failed, so no name could be shown to be unique.",
    );
  }
  if (unsearchable.length > 0) {
    out.push(
      "",
      `NOT SEARCHED: ${unsearchable.join(", ")}. A bare file name matches nothing unless it is unique among tracked files; pass the repo-relative path.`,
    );
  }
  return out;
}

export function listUnbuiltWork(config, argv, git = gitIn(config.root)) {
  const flag = argv.find((arg) => arg.startsWith("--"));
  if (flag !== undefined) {
    return result(2, [], [`${PROG}: unknown flag ${flag}`, USAGE]);
  }
  const changed = changedPaths(argv, git);
  if (changed.error !== undefined) {
    return result(1, [], [`${PROG}: ${changed.error}`]);
  }
  const paths = [
    ...new Set(changed.paths.map((path) => normalize(config, path))),
  ].filter((path) => path !== "" && !isPlanningPath(config, path));
  if (paths.length === 0) {
    return result(0, [
      "unbuilt-work: no changed path outside the planning files. Nothing to search.",
    ]);
  }
  const counts = basenameCounts(git);
  const searches = paths.map((path) => ({
    path,
    tokens: tokensFor(
      path,
      isDirectory(config.root, path) ? undefined : counts,
    ),
    folders: foldersFor(path),
  }));
  const searchable = searches.filter(({ tokens }) => tokens.length > 0);
  const unsearchable = searches
    .filter(({ tokens }) => tokens.length === 0)
    .map(({ path }) => path);
  const status = readStatus(config);
  const hits = new Map();
  for (const unit of [
    ...ticketUnits(config, status),
    ...sprintUnits(config, status),
  ]) {
    scan(hits, unit, searchable);
  }
  return result(0, [
    ...hitLines(hits, searchable.length),
    ...caveatLines(unsearchable, counts),
  ]);
}
