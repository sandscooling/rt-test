import { realpath, type Dirent } from "node:fs";
import { readdir, stat, realpath as nativeRealpath } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  CrawledLinks,
  SpelledDirectory,
} from "../vitest/selection-facts.js";
import { errorText } from "../vitest/error-text.js";
import { directoryPrefix, projectCrawls, type Crawl } from "./vitest-glob.js";

/** How many directories one crawl's walk reads before it stops, since the links past that point are not known. */
const MAX_CRAWLED_DIRECTORIES = 200_000;
/**
 * How many directory links one crawl's walk follows before it stops, since each one is matched on every check, and
 * how many of a directory's entries it takes at a time.
 */
const MAX_CRAWLED_LINKS = 1_000;
/** Protection itself names the pattern picomatch refuses, since it compiles the same patterns. */
const UNCOMPILED_REASON =
  "picomatch cannot compile a test file pattern, so the crawl was not walked";
/** fdir resolves a link with the callback `realpath`, whose JavaScript spelling of the result its cycle test compares. */
const javaScriptRealpath = promisify(realpath);

/** A project's test file patterns as Vitest globs them, each list on its own, from its spelling of the pattern directory. */
export interface GlobbedProject {
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

/** A link that leads to a directory. */
interface DirectoryLink {
  /** The link as the crawl spells it. */
  readonly path: string;
  /** Where it leads, as the JavaScript `realpath` spells it. */
  readonly target: string;
}

interface Walk {
  readonly crawl: Crawl;
  /** How a reason names the walk. */
  readonly from: string;
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
  );
  if (!planned.ok) return { complete: false, reason: UNCOMPILED_REASON };
  const links = new Set<string>();
  for (const crawl of planned.crawls) {
    const walked = await followedLinks(crawl, signal);
    if (!walked.complete) return walked;
    for (const link of walked.links) links.add(link);
  }
  const bases: SpelledDirectory[] = [];
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
  const starts = outermost(crawl.bases);
  const walk: Walk = {
    crawl,
    from: walkedFrom(starts),
    pending: starts.map((base) => ({
      opened: base,
      spelled: directoryPrefix(base),
      followed: [],
    })),
    links: [],
  };
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
        ? `the walk below ${walk.from} reads more than ${MAX_CRAWLED_DIRECTORIES} directories`
        : await readDirectory(walk, next);
  }
  return failure === undefined
    ? { complete: true, links: walk.links }
    : { complete: false, reason: failure };
}

/**
 * Undefined once the directory's entries are queued, or why the walk cannot go on; one it cannot read holds none.
 * The entries are taken as many at a time as the walk may follow links, so no more links than that are being
 * resolved at once.
 */
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
  for (let start = 0; start < entries.length; start += MAX_CRAWLED_LINKS) {
    const failure = await queueEntries(
      walk,
      directory,
      entries.slice(start, start + MAX_CRAWLED_LINKS),
    );
    if (failure !== undefined) return failure;
  }
  return undefined;
}

/**
 * Queues some of a directory's entries in their order, or says why the walk cannot go on. Their links are resolved
 * together, since resolving one takes a file call for each part of its path, and each call awaited after another
 * waits its own turn for a processor on a busy machine.
 */
async function queueEntries(
  walk: Walk,
  directory: Pending,
  entries: readonly Dirent[],
): Promise<string | undefined> {
  const listed = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory.spelled}${entry.name}`;
      return {
        entry,
        path,
        link: entry.isSymbolicLink() ? await directoryLink(path) : undefined,
      };
    }),
  );
  for (const { entry, path, link } of listed) {
    if (entry.isDirectory()) {
      if (!walk.crawl.prunes(path)) {
        walk.pending.push({
          opened: path,
          spelled: directoryPrefix(path),
          followed: directory.followed,
        });
      }
    } else if (link !== undefined) {
      const failure = followLink(walk, link, directory.followed);
      if (failure !== undefined) return failure;
    }
  }
  return undefined;
}

/** The link at `path` when it leads to a directory; one that cannot be resolved leads nowhere. */
async function directoryLink(path: string): Promise<DirectoryLink | undefined> {
  try {
    const target = await javaScriptRealpath(path);
    return (await stat(target)).isDirectory() ? { path, target } : undefined;
  } catch {
    return undefined;
  }
}

/** Queues what a directory link leads to, or says why the walk cannot go on. */
function followLink(
  walk: Walk,
  { path, target }: DirectoryLink,
  followed: readonly string[],
): string | undefined {
  if (returnsToFollowed(target, followed) || walk.crawl.prunes(path)) {
    return undefined;
  }
  walk.links.push(path);
  if (walk.links.length > MAX_CRAWLED_LINKS) {
    return `the walk below ${walk.from} follows more than ${MAX_CRAWLED_LINKS} directory links`;
  }
  walk.pending.push({
    opened: target,
    spelled: directoryPrefix(path),
    followed: [...followed, target],
  });
  return undefined;
}

/** The first base the walk starts at, with a count of the others, so a stored reason stays short however many there are. */
function walkedFrom(starts: readonly string[]): string {
  const [first = "", ...others] = starts;
  if (others.length === 0) return first;
  const noun = others.length === 1 ? "pattern base" : "pattern bases";
  return `${first} and ${others.length} other ${noun}`;
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
