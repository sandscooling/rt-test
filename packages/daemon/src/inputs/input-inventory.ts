import { createHash } from "node:crypto";
import { createReadStream, type Dirent, type Stats } from "node:fs";
import { lstat, opendir, readlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { errorText } from "../vitest/error-text.js";
import {
  POSIX_SEPARATOR,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";
import type { InputFilter } from "./input-filter.js";

export const DIGEST_ALGORITHM = "sha256";
export const DIGEST_ENCODING = "hex";
/** Directory levels below the consumer root the inventory descends before it stops, incomplete. */
const MAX_INVENTORY_DEPTH = 64;
/** Files and directories one inventory visits before it stops, incomplete. */
const MAX_INVENTORY_ENTRIES = 200_000;
/** Files hashed at once, so a large tree neither holds every file open nor starves the answers. */
const HASH_CONCURRENCY = 16;
/** Nothing at the path: no entry, or one below a file, which Linux reports as ENOTDIR and Windows as ENOENT. */
const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR"]);
const FILE_KIND = "file";
const LINK_KIND = "link";
const SPECIAL_KIND = "special";
const KIND_SEPARATOR = ":";
/** The coarsest timestamp step a supported file system records, FAT's two seconds. */
export const MODIFIED_TIME_RESOLUTION_MS = 2000;

/** Each input's digest by its root-relative, `/`-separated path. */
export type InputDigests = ReadonlyMap<string, string>;

/** What one read of an input saw beside its content, all times in ms. */
export interface InputStamp {
  readonly size: number;
  readonly modifiedMs: number;
  readonly changedMs: number;
  /** Taken before the read's stat, so a write the read missed lands after it. */
  readonly readAtMs: number;
}

export interface InputRead {
  readonly digest: string;
  readonly stamp: InputStamp;
}

/** Each input's read by its root-relative, `/`-separated path. */
export type InputReads = ReadonlyMap<string, InputRead>;

export type InventoryResult =
  | {
      readonly ok: true;
      readonly inputs: InputReads;
      /** Every directory walked that is not excluded, empty ones included, `start` first, as absolute paths. */
      readonly directories: readonly string[];
      /** Directories walked that git turned out to ignore, whose watches must close. */
      readonly ignoredDirectories: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/** What a path holds now, read without following a directory link. */
export type EntryDigest =
  | { readonly kind: "input"; readonly read: InputRead }
  | { readonly kind: "directory" }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly reason: string };

/** What every walk of one tracker shares. */
export interface InventoryScope {
  /** The consumer root's real path. */
  readonly root: string;
  readonly filter: InputFilter;
  readonly signal: AbortSignal;
  /** Called with each directory before it is listed, so a watch opened there misses nothing created after. */
  readonly beforeListing: (directory: string) => void;
}

interface Walk extends InventoryScope {
  readonly pending: { readonly directory: string; readonly depth: number }[];
  readonly directories: string[];
  readonly files: string[];
  visited: number;
}

class Incomplete extends Error {}

/**
 * Lists and hashes every input at or under `start`, a directory under the consumer `root`, breadth-first, without
 * following a directory link. A bound reached, or a file or directory that cannot be read, gives no list at all
 * but the reason; a path that vanishes while it is read is a deletion.
 */
export async function takeInventory(
  scope: InventoryScope,
  start: string,
): Promise<InventoryResult> {
  const startDepth =
    start === scope.root
      ? 0
      : relativePosixPath(scope.root, start).split(POSIX_SEPARATOR).length;
  const walk: Walk = {
    ...scope,
    pending: [{ directory: start, depth: startDepth }],
    directories: [],
    files: [],
    visited: 0,
  };
  try {
    for (const next of walk.pending) await walkDirectory(walk, next);
    await checkUncertain(walk);
    const excluded = (path: string): boolean =>
      path !== start && walk.filter.excludes(path);
    return {
      ok: true,
      inputs: await hashFiles(
        walk,
        walk.files.filter(
          (path) => !excluded(path) && walk.filter.declares(path) === undefined,
        ),
      ),
      directories: walk.directories.filter((path) => !excluded(path)),
      ignoredDirectories: walk.directories.filter(excluded),
    };
  } catch (error) {
    if (error instanceof Incomplete)
      return { ok: false, reason: error.message };
    throw error;
  }
}

async function walkDirectory(
  walk: Walk,
  { directory, depth }: Walk["pending"][number],
): Promise<void> {
  walk.signal.throwIfAborted();
  await walk.filter.enter(directory, walk.signal);
  walk.beforeListing(directory);
  let entries: AsyncIterable<Dirent>;
  try {
    entries = await opendir(directory);
  } catch (error) {
    if (isMissing(error) && directory !== walk.root) return;
    throw new Incomplete(
      `the directory ${label(walk, directory)} cannot be listed: ${errorText(error)}`,
    );
  }
  walk.directories.push(directory);
  try {
    for await (const entry of entries)
      visitEntry(walk, directory, entry, depth);
  } catch (error) {
    if (error instanceof Incomplete) throw error;
    throw new Incomplete(
      `the directory ${label(walk, directory)} cannot be listed: ${errorText(error)}`,
    );
  }
}

function visitEntry(
  walk: Walk,
  directory: string,
  entry: Dirent,
  depth: number,
): void {
  walk.visited += 1;
  if (walk.visited > MAX_INVENTORY_ENTRIES) {
    throw new Incomplete(
      `the walk of the consumer root met more than ${MAX_INVENTORY_ENTRIES} files and directories, so its inputs were not all read`,
    );
  }
  const path = join(directory, entry.name);
  if (walk.filter.excludes(path)) return;
  if (!entry.isDirectory()) {
    walk.files.push(path);
    return;
  }
  if (depth + 1 > MAX_INVENTORY_DEPTH) {
    throw new Incomplete(
      `the directory ${label(walk, path)} lies more than ${MAX_INVENTORY_DEPTH} levels below the consumer root, so its inputs were not read`,
    );
  }
  walk.pending.push({ directory: path, depth: depth + 1 });
}

/** Asks git about each path walked under a directory whose listing it could not vouch for. */
async function checkUncertain(walk: Walk): Promise<void> {
  const uncertain = [...walk.directories, ...walk.files].filter((path) =>
    walk.filter.isUncertain(path),
  );
  if (uncertain.length > 0) await walk.filter.check(uncertain, walk.signal);
}

async function hashFiles(
  walk: Walk,
  files: readonly string[],
): Promise<InputReads> {
  const inputs = new Map<string, InputRead>();
  await readTogether(files, walk.signal, async (path) => {
    const entry = await readEntryDigest(path, walk.signal);
    if (entry.kind === "unreadable") {
      throw new Incomplete(
        `${label(walk, path)} cannot be read: ${entry.reason}`,
      );
    }
    if (entry.kind === "input") {
      inputs.set(relativePosixPath(walk.root, path), entry.read);
    }
  });
  return inputs;
}

/**
 * Runs `read` over each of `paths`, `HASH_CONCURRENCY` at a time. Once `signal` aborts or a read rejects it begins
 * no other, and rejects with the first such abort or failure once the reads then in flight have ended.
 */
export async function readTogether(
  paths: readonly string[],
  signal: AbortSignal,
  read: (path: string) => Promise<void>,
): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async (): Promise<void> => {
    while (next < paths.length && failures.length === 0) {
      const path = paths[next] as string;
      next += 1;
      try {
        signal.throwIfAborted();
        await read(path);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(HASH_CONCURRENCY, paths.length) }, worker),
  );
  if (failures.length > 0) throw failures[0];
}

/**
 * The digest of what `path` holds: a file's content, read through a link to a file; a link to anything else by
 * its target; a FIFO, socket or device by its type alone, since reading one could block or never end. Its stamp is
 * the entry's stat, and for a link to a file the file's size with the later of each time, so a retarget moves it.
 */
export async function readEntryDigest(
  path: string,
  signal?: AbortSignal,
): Promise<EntryDigest> {
  const readAtMs = Date.now();
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    return failedRead(error);
  }
  if (stats.isDirectory()) return { kind: "directory" };
  try {
    if (stats.isSymbolicLink())
      return await linkDigest(path, stats, readAtMs, signal);
    if (stats.isFile()) {
      const digest = await contentDigest(path, signal);
      return inputDigest(FILE_KIND, digest, stampOf(stats, readAtMs));
    }
    return inputDigest(
      SPECIAL_KIND,
      specialKind(stats),
      stampOf(stats, readAtMs),
    );
  } catch (error) {
    return failedRead(error);
  }
}

async function linkDigest(
  path: string,
  link: Stats,
  readAtMs: number,
  signal: AbortSignal | undefined,
): Promise<EntryDigest> {
  const target = await stat(path).catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (target?.isFile() === true) {
    const digest = await contentDigest(path, signal);
    return inputDigest(FILE_KIND, digest, {
      size: target.size,
      modifiedMs: Math.max(link.mtimeMs, target.mtimeMs),
      changedMs: Math.max(link.ctimeMs, target.ctimeMs),
      readAtMs,
    });
  }
  const digest = wholeDigest(await readlink(path));
  return inputDigest(LINK_KIND, digest, stampOf(link, readAtMs));
}

function stampOf(stats: Stats, readAtMs: number): InputStamp {
  return {
    size: stats.size,
    modifiedMs: stats.mtimeMs,
    changedMs: stats.ctimeMs,
    readAtMs,
  };
}

async function contentDigest(
  path: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const hash = createHash(DIGEST_ALGORITHM);
  const stream = createReadStream(
    path,
    signal === undefined ? undefined : { signal },
  );
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest(DIGEST_ENCODING);
}

/** Whether a held digest is of a file's content, read directly or through a link to it. */
export function holdsFileContent(digest: string): boolean {
  return digest.startsWith(`${FILE_KIND}${KIND_SEPARATOR}`);
}

/** The digest the inputs hold for a file whose content digests as `content`, read directly or through a link. */
export function heldFileDigest(content: string): string {
  return `${FILE_KIND}${KIND_SEPARATOR}${content}`;
}

/** A digest of text or bytes held whole in memory, where `contentDigest` streams a file. */
export function wholeDigest(content: string | Uint8Array): string {
  return createHash(DIGEST_ALGORITHM).update(content).digest(DIGEST_ENCODING);
}

function specialKind(stats: Stats): string {
  if (stats.isFIFO()) return "fifo";
  if (stats.isSocket()) return "socket";
  if (stats.isBlockDevice()) return "block-device";
  return "character-device";
}

function inputDigest(
  kind: string,
  digest: string,
  stamp: InputStamp,
): EntryDigest {
  return {
    kind: "input",
    read: { digest: `${kind}${KIND_SEPARATOR}${digest}`, stamp },
  };
}

function failedRead(error: unknown): EntryDigest {
  return isMissing(error)
    ? { kind: "absent" }
    : { kind: "unreadable", reason: errorText(error) };
}

function isMissing(error: unknown): boolean {
  return MISSING_CODES.has(
    (error as NodeJS.ErrnoException | undefined)?.code ?? "",
  );
}

function label(walk: Walk, path: string): string {
  return relativePosixPath(walk.root, path) || ROOT_PATH;
}
