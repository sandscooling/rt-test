import { statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { fenceKinds } from "../fences.mjs";
import { changedPaths, gitIn, trackedPaths } from "../git.mjs";
import { display, planningFiles, readText } from "../planning/files.mjs";
import { readStatus } from "../planning/status.mjs";
import { result } from "../standards/result.mjs";

export const USAGE = [
  "Usage: list-unbuilt-work.mjs [--except <ticket id>]... [<path>...]",
  "  Lists each ticket not done whose ticket file or sprint-file section names one of the paths,",
  "  or a folder at least two segments deep that holds one.",
  "  --except leaves out a ticket, such as the one being written, built or reviewed.",
  "  With no paths, reads the changeset from git: changes against HEAD, staged or not, and untracked files.",
].join("\n");

const PROG = "list-unbuilt-work";
const SETTLED_STATES = new Set(["done"]);
const NO_STATUS = "no status key";
const UNKEYED = "file name matches no key";
const TICKET_FILE =
  /^([1-9]\d*)-([1-9]\d*[a-z]?)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const SPRINT_FILE = /^sprint-([1-9]\d*)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const TICKET_HEADING = /^## Ticket ([1-9]\d*\.[1-9]\d*[a-z]?): /;
const TICKET_ID = /^[1-9]\d*\.[1-9]\d*[a-z]?$/;
const NAME_CHAR = /[A-Za-z0-9_$-]/;
const CHAR_BEFORE_NAME = /[A-Za-z0-9_$.-]/;
const MODULE_EXTENSION = /\.(?:tsx|[cm]?[jt]s)$/;
const RELATIVE_LINK_END = "./";
const MIN_FOLDER_SEGMENTS = 2;
const SHOWN_LINES = 4;

function parseArgv(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { except: { type: "string", multiple: true, default: [] } },
      allowPositionals: true,
    });
  } catch (error) {
    return { error: error.message };
  }
  const { values, positionals } = parsed;
  const bad = values.except.find((id) => !TICKET_ID.test(id));
  if (bad !== undefined) {
    return { error: `--except takes a ticket id such as 1.2, not ${bad}` };
  }
  return { paths: positionals, except: new Set(values.except) };
}

function normalize(config, path) {
  const slashed = path.replaceAll("\\", "/");
  const rooted = isAbsolute(slashed)
    ? relative(config.root, slashed).replaceAll("\\", "/")
    : slashed;
  return rooted.replace(/^\.\//, "").replace(/\/+$/, "");
}

function searchedPaths(paths, git) {
  if (paths.length > 0) return { paths: paths.map((path) => path.trim()) };
  const changeset = changedPaths(git);
  if (changeset.error === undefined) return changeset;
  return {
    error: `cannot read the changeset with ${changeset.error}. Pass the paths instead.`,
  };
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

function basenameCounts(tracked) {
  const counts = new Map();
  for (const path of tracked) {
    const name = path.split("/").at(-1);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function directorySuffixes(path) {
  const parts = path.split("/");
  const suffixes = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    suffixes.push(parts.slice(index).join("/"));
  }
  return suffixes;
}

// Every suffix that keeps a directory, plus the bare file name when no other
// tracked file shares it: planning prose often cites a file by name alone.
function tokensFor(path, counts) {
  const tokens = directorySuffixes(path);
  const name = path.split("/").at(-1);
  if (name !== "" && counts !== undefined && (counts.get(name) ?? 0) <= 1)
    tokens.push(name);
  return tokens;
}

// Prose cites a module the way an import names it, without its extension.
function moduleTokensFor(path) {
  const stem = path.replace(MODULE_EXTENSION, "");
  return stem === path ? [] : directorySuffixes(stem);
}

const statOf = (root, path) =>
  statSync(join(root, path), { throwIfNoEntry: false });

// A folder's name is never a file's, so the basename counts cannot vouch for it.
const isDirectory = (root, path) => statOf(root, path)?.isDirectory() === true;

const isRootFile = (root, path, rootFiles) =>
  !path.includes("/") &&
  (rootFiles.has(path) || statOf(root, path)?.isFile() === true);

function searchFor(config, path, { counts, rootFiles }) {
  const file = !isDirectory(config.root, path);
  return {
    path,
    tokens: tokensFor(path, file ? counts : undefined),
    modules: file ? moduleTokensFor(path) : [],
    rootNames: file && isRootFile(config.root, path, rootFiles) ? [path] : [],
    folders: foldersFor(path),
  };
}

function trackedIndex(git) {
  const tracked = trackedPaths(git);
  if (tracked.error !== undefined) {
    return { error: tracked.error, counts: undefined, rootFiles: new Set() };
  }
  return {
    counts: basenameCounts(tracked.paths),
    rootFiles: new Set(tracked.paths.filter((path) => !path.includes("/"))),
  };
}

const isSearchable = ({ tokens, modules, rootNames }) =>
  tokens.length + modules.length + rootNames.length > 0;

const startsName = (line, at) =>
  at === 0 || !CHAR_BEFORE_NAME.test(line[at - 1]);

// After a "/" a root file's name is another folder's file of that name,
// unless the "/" ends a relative link such as "../".
const startsRootName = (line, at) =>
  startsName(line, at) &&
  (line[at - 1] !== "/" || line.slice(0, at).endsWith(RELATIVE_LINK_END));

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

// A module cited without its extension followed by "/" names a folder.
const endsModule = (line, end) => endsName(line, end) && line[end] !== "/";

function cites(line, token, ends, starts = startsName) {
  for (
    let at = line.indexOf(token);
    at !== -1;
    at = line.indexOf(token, at + 1)
  ) {
    if (starts(line, at) && ends(line, at + token.length)) return true;
  }
  return false;
}

const citesFile = (line, { tokens, modules, rootNames }) =>
  tokens.some((token) => cites(line, token, endsName)) ||
  modules.some((token) => cites(line, token, endsModule)) ||
  rootNames.some((name) => cites(line, name, endsName, startsRootName));

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
  if (searched === 0) {
    return ["unbuilt-work: no path could be searched. Nothing was checked."];
  }
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

function caveatLines(unsearchable, trackedError) {
  const out = [];
  if (trackedError !== undefined) {
    out.push(
      "",
      `Bare file names were not matched below the repository root: ${trackedError}, so no name could be shown to be unique.`,
    );
  }
  if (unsearchable.length > 0) {
    out.push(
      "",
      `NOT SEARCHED: ${unsearchable.join(", ")}. A bare file name matches nothing unless it is unique among tracked files or names a file at the repository root; pass the repo-relative path.`,
    );
  }
  return out;
}

function unitsToScan(config, except) {
  const status = readStatus(config);
  return [
    ...ticketUnits(config, status),
    ...sprintUnits(config, status),
  ].filter((unit) => !except.has(unit.id));
}

export function listUnbuiltWork(config, argv, git = gitIn(config.root)) {
  const args = parseArgv(argv);
  if (args.error !== undefined) {
    return result(2, [], [`${PROG}: ${args.error}`, USAGE]);
  }
  const changed = searchedPaths(args.paths, git);
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
  const index = trackedIndex(git);
  const searches = paths.map((path) => searchFor(config, path, index));
  const searchable = searches.filter(isSearchable);
  const unsearchable = searches
    .filter((search) => !isSearchable(search))
    .map(({ path }) => path);
  const hits = new Map();
  for (const unit of unitsToScan(config, args.except)) {
    scan(hits, unit, searchable);
  }
  return result(0, [
    ...hitLines(hits, searchable.length),
    ...caveatLines(unsearchable, index.error),
  ]);
}
