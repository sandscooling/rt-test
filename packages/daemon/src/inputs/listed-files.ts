import { dirname } from "node:path";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import { liesInside } from "../vitest/find-workspaces.js";
import { absoluteInputPath, type InputFilter } from "./input-filter.js";
import {
  readEntryDigest,
  type InputRead,
  type InputReads,
} from "./input-inventory.js";
import { caseComparable, liesUnderRoot, protectedFiles } from "./protection.js";

/** A file the discovery in effect lists by path under the consumer root. */
export interface ListedFile {
  /** Root-relative, as the discovery lists it: the key of its held read and of every job window naming it. */
  readonly spelling: string;
  readonly path: string;
}

/**
 * The files the discovery in effect lists by path under the consumer root, every one whatever the filter excludes
 * now, since a filter excludes more as git answers for paths created after its listing. Which of them the tracker
 * holds apart from the inputs is decided at each read by asking the filter then.
 */
export class ListedFiles {
  /** The consumer root's real path. */
  readonly #root: string;
  /** By the case-comparable absolute path. */
  #files = new Map<string, ListedFile>();
  /** Case-comparable: each directory on the way from the root to a listed file. */
  #ways = new Set<string>();
  #version = 0;

  constructor(root: string) {
    this.#root = root;
  }

  /** Every listed file's absolute path. */
  get paths(): readonly string[] {
    return [...this.#files.values()].map((file) => file.path);
  }

  /** Rises each time the files listed change, so a read of them can tell it read a set since replaced. */
  get version(): number {
    return this.#version;
  }

  /**
   * Takes the listing of the discovery now in effect; returns each file it newly lists, or undefined when the files
   * listed did not change.
   */
  list(discovery: TestDiscovery | undefined): ListedFile[] | undefined {
    const files = new Map<string, ListedFile>();
    const spellings = discovery === undefined ? [] : protectedFiles(discovery);
    for (const spelling of spellings) {
      if (!liesUnderRoot(spelling)) continue;
      const path = absoluteInputPath(this.#root, spelling);
      const key = caseComparable(path);
      if (!files.has(key)) files.set(key, { spelling, path });
    }
    const added = [...files]
      .filter(([key]) => !this.#files.has(key))
      .map(([, file]) => file);
    if (added.length === 0 && files.size === this.#files.size) return undefined;
    this.#files = files;
    this.#ways = new Set(
      [...directoriesAbove(this.#root, this.paths)].map(caseComparable),
    );
    this.#version += 1;
    return added;
  }

  /** Whether `path`, absolute, names a listed file or a directory on the way to one. */
  names(path: string): boolean {
    const key = caseComparable(path);
    return this.#files.has(key) || this.#ways.has(key);
  }

  /** Whether the discovery in effect lists the file at `path`, absolute. */
  lists(path: string): boolean {
    return this.#files.has(caseComparable(path));
  }

  /** Each listed file at or under `path`, an absolute path, that `filter` excludes now. */
  under(path: string, filter: InputFilter): ListedFile[] {
    const key = caseComparable(path);
    const file = this.#files.get(key);
    if (file !== undefined) return filter.excludes(file.path) ? [file] : [];
    if (!this.#ways.has(key)) return [];
    return [...this.#files]
      .filter(([listed]) => liesInside(key, listed))
      .map(([, listed]) => listed)
      .filter((listed) => filter.excludes(listed.path));
  }

  /** Each listed file `filter` excludes now. */
  excluded(filter: InputFilter): ListedFile[] {
    return [...this.#files.values()].filter((file) =>
      filter.excludes(file.path),
    );
  }
}

/** Each directory from `root` down to the directory holding each of `paths`, absolute, as `paths` spell them. */
export function directoriesAbove(
  root: string,
  paths: readonly string[],
): Set<string> {
  const directories = new Set<string>();
  for (const path of paths) {
    let directory = dirname(path);
    while (liesInside(root, directory) && !directories.has(directory)) {
      directories.add(directory);
      if (directory === root) break;
      directory = dirname(directory);
    }
  }
  return directories;
}

/** The read to hold for a listed file: none for nothing there, a directory, or one that cannot be read. */
export async function readListedFile(
  file: ListedFile,
  signal: AbortSignal,
): Promise<InputRead | undefined> {
  const entry = await readEntryDigest(file.path, signal);
  return entry.kind === "input" ? entry.read : undefined;
}

/** A reconciliation's reads of the listed files the filter excludes, and the listed spelling of each one read. */
export interface ListedReads {
  readonly files: ReadonlySet<string>;
  /** By listed spelling, each held as `readListedFile` decides. */
  readonly reads: InputReads;
}

export async function readListedFiles(
  files: readonly ListedFile[],
  signal: AbortSignal,
): Promise<ListedReads> {
  const reads = new Map<string, InputRead>();
  for (const file of files) {
    const read = await readListedFile(file, signal);
    if (read !== undefined) reads.set(file.spelling, read);
  }
  return { files: new Set(files.map((file) => file.spelling)), reads };
}
