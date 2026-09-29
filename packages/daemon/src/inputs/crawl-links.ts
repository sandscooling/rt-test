import { realpath, type Dirent } from "node:fs";
import { readdir, stat, realpath as nativeRealpath } from "node:fs/promises";
import { promisify } from "node:util";
import type { CrawledLinks, PatternBase } from "../vitest/selection-facts.js";
import { errorText } from "../vitest/error-text.js";
import { directoryPrefix, projectCrawls } from "./protection.js";

/** How many directories one crawl's walk reads before it stops, since the links past that point are not known. */
const MAX_CRAWLED_DIRECTORIES = 200_000;
/** How many directory links one crawl's walk follows before it stops, since each one is matched on every check. */
const MAX_CRAWLED_LINKS = 1_000;
/** Protection itself names the pattern picomatch refuses, since it compiles the same patterns. */
const UNCOMPILED_REASON =
  "picomatch cannot compile a test file pattern, so the crawl was not walked";
/** fdir resolves a link with the callback `realpath`, whose JavaScript spelling of the result its cycle test compares. */
const javaScriptRealpath = promisify(realpath);

/**
 * One crawl of Vitest's glob: each pattern's base, below which alone it can find a file, as the glob spells it, and
 * which directories the glob prunes.
 */
export interface Crawl {
  readonly bases: readonly string[];
  /** Takes a directory's absolute path as the crawl spells it. */
  readonly prunes: (directory: string) => boolean;
}

/** A project's test file patterns as Vitest globs them, each list on its own, from its spelling of the pattern directory. */
export interface GlobbedProject {
  readonly projectName: string;
  readonly vitestDirectory: string;
  readonly globbed: readonly (readonly string[])[];
  readonly exclude: readonly string[];
  /** Names a real path as the project's selection facts name paths. */
  readonly rootRelative: (path: string) => string;
}

type Walked =
  | { readonly complete: true; readonly links: readonly string[] }
  | { readonly complete: false; readonly reason: string };

/** A directory the walk has yet to read. */
interface Pending {
  /** What is read: a followed link's real path, or the directory's own spelling. */
  readonly opened: string;
  /** The directory as the crawl spells it, ending in `/`. */
  readonly spelled: string;
  /** The real path of each link followed on the way to it. */
  readonly followed: readonly string[];
}

interface Walk {
  readonly crawl: Crawl;
  readonly pending: Pending[];
  readonly links: string[];
}

/**
 * Each directory link any of the project's crawls follows, with where it resolves, or the first reason the links
 * of a crawl are not known. A pattern picomatch refuses leaves them unknown, as does a link the native `realpath`
 * cannot resolve, since then no path under it can be named.
 */
export async function crawledLinks(
  project: GlobbedProject,
  signal: AbortSignal,
): Promise<CrawledLinks> {
  const planned = projectCrawls(
    project.globbed,
    project.exclude,
    project.vitestDirectory,
    project.projectName,
  );
  if (!planned.ok) return { complete: false, reason: UNCOMPILED_REASON };
  const links = new Set<string>();
  for (const crawl of planned.crawls) {
    const walked = await followedLinks(crawl, signal);
    if (!walked.complete) return walked;
    for (const link of walked.links) links.add(link);
  }
  const bases: PatternBase[] = [];
  for (const spelled of links) {
    try {
      const real = await nativeRealpath(spelled);
      bases.push({ spelled, directory: project.rootRelative(real) });
    } catch (error) {
      return {
        complete: false,
        reason: `the link ${spelled}, which the crawl follows, cannot be resolved to name what lies below it: ${errorText(error)}`,
      };
    }
  }
  return { complete: true, links: bases };
}

/**
 * Each directory link one crawl follows below its patterns' bases, found as fdir 6.5.0 crawls for tinyglobby 0.2.17:
 * every directory link it can resolve is followed, what lies below is named by the link's path, and a link is skipped
 * when its real path and that of a link followed on the way to it are equal or one begins with the other. Starting at
 * the bases rather than the crawl root counts fewer links on the way, and it prunes only what the glob's ignore list
 * prunes, so it follows at least every link the crawl follows. Like the crawl, which suppresses every error, it
 * passes over a directory it cannot read and a link it cannot resolve, since the crawl finds nothing through either.
 * A bound reached gives no list, since the crawl may follow a link past it.
 */
async function followedLinks(
  crawl: Crawl,
  signal: AbortSignal,
): Promise<Walked> {
  const walk: Walk = {
    crawl,
    pending: outermost(crawl.bases).map((base) => ({
      opened: base,
      spelled: directoryPrefix(base),
      followed: [],
    })),
    links: [],
  };
  const from = crawl.bases.join(", ");
  let failure: string | undefined;
  let read = 0;
  for (
    let next = walk.pending.pop();
    failure === undefined && next !== undefined;
    next = walk.pending.pop()
  ) {
    signal.throwIfAborted();
    read += 1;
    failure =
      read > MAX_CRAWLED_DIRECTORIES
        ? `the walk below ${from} reads more than ${MAX_CRAWLED_DIRECTORIES} directories`
        : await readDirectory(walk, next);
  }
  return failure === undefined
    ? { complete: true, links: walk.links }
    : { complete: false, reason: failure };
}

/** Undefined once the directory's entries are queued, or why the walk cannot go on; one it cannot read holds none. */
async function readDirectory(
  walk: Walk,
  directory: Pending,
): Promise<string | undefined> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory.opened, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = `${directory.spelled}${entry.name}`;
    if (entry.isDirectory()) {
      if (!walk.crawl.prunes(path)) {
        walk.pending.push({
          opened: path,
          spelled: directoryPrefix(path),
          followed: directory.followed,
        });
      }
    } else if (entry.isSymbolicLink()) {
      const failure = await followLink(walk, path, directory.followed);
      if (failure !== undefined) return failure;
    }
  }
  return undefined;
}

/** Queues what a directory link leads to, or says why the walk cannot go on; one it cannot resolve leads nowhere. */
async function followLink(
  walk: Walk,
  path: string,
  followed: readonly string[],
): Promise<string | undefined> {
  let resolved: string;
  let isDirectory: boolean;
  try {
    resolved = await javaScriptRealpath(path);
    isDirectory = (await stat(resolved)).isDirectory();
  } catch {
    return undefined;
  }
  if (
    !isDirectory ||
    returnsToFollowed(resolved, followed) ||
    walk.crawl.prunes(path)
  ) {
    return undefined;
  }
  walk.links.push(path);
  if (walk.links.length > MAX_CRAWLED_LINKS) {
    return `the walk below ${walk.crawl.bases.join(", ")} follows more than ${MAX_CRAWLED_LINKS} directory links`;
  }
  walk.pending.push({
    opened: resolved,
    spelled: directoryPrefix(path),
    followed: [...followed, resolved],
  });
  return undefined;
}

/**
 * Each base no other base holds by its spelling. The walk below a holding base counts fewer links on the way than
 * the crawl does, so it already follows every link the crawl follows below the base it holds.
 */
function outermost(bases: readonly string[]): string[] {
  const unique = [...new Set(bases)];
  return unique.filter(
    (base) =>
      !unique.some(
        (other) => other !== base && base.startsWith(directoryPrefix(other)),
      ),
  );
}

/** fdir's cycle test, by string: the real path equals that of a link followed on the way, or one begins with the other. */
function returnsToFollowed(
  resolved: string,
  followed: readonly string[],
): boolean {
  return followed.some(
    (earlier) => earlier.startsWith(resolved) || resolved.startsWith(earlier),
  );
}
