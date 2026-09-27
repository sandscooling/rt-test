import { realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  readCheckedIgnored,
  readIgnoredPaths,
} from "../selection/git-ignored.js";
import {
  holdsRepository,
  SKIPPED_DIRECTORIES,
} from "../selection/source-walk.js";
import {
  climbsOut,
  liesInside,
  POSIX_SEPARATOR,
  relativePosixPath,
} from "../vitest/find-workspaces.js";

const UNREAD_IGNORED_PREFIX =
  "git's ignored paths could not be read, so every file there counts as an input";

/**
 * Decides which paths under the consumer root are inputs. A path is excluded when a segment of it is a skipped
 * directory name, when it is or lies under one of the exclusions, or when git ignores it or a directory above it.
 * One filter serves one reconciliation: git's listing is read when it opens, and a path created later is asked
 * about through `check`.
 */
export class InputFilter {
  readonly #root: string;
  readonly #exclusions: readonly string[];
  readonly #ignored = new Set<string>();
  /** Directories git listed but does not itself ignore, so what lies under them must be asked about. */
  readonly #unconfirmed = new Set<string>();
  /** Each repository whose ignored paths git reported, innermost last. */
  readonly #repositories: string[] = [];
  /** Repositories whose listing failed, asked about once per filter. */
  readonly #failed = new Set<string>();
  readonly #unread = new Set<string>();

  private constructor(root: string, exclusions: readonly string[]) {
    this.#root = root;
    this.#exclusions = exclusions.map(canonicalPath);
  }

  /** `root` is the consumer root's real path; `exclusions` are absolute paths, each excluded with all it holds. */
  static async open(
    root: string,
    exclusions: readonly string[],
    signal: AbortSignal,
  ): Promise<InputFilter> {
    const filter = new InputFilter(root, exclusions);
    if (enclosingRepository(root) !== undefined) {
      await filter.#addRepository(root, signal);
    }
    return filter;
  }

  /** Reasons git's ignored paths could not be read; each such repository ignores nothing. */
  get unread(): readonly string[] {
    return [...this.#unread];
  }

  /** The repositories nested under the root whose ignored paths were read. */
  get nestedRepositories(): readonly string[] {
    return this.#repositories.filter((repository) => repository !== this.#root);
  }

  /** Reads the ignored paths of a repository nested at `directory`, which the enclosing listing omits. */
  async enter(directory: string, signal: AbortSignal): Promise<void> {
    if (directory === this.#root || !holdsRepository(directory)) return;
    if (this.#repositories.includes(directory) || this.#failed.has(directory)) {
      return;
    }
    await this.#addRepository(directory, signal);
  }

  excludes(path: string): boolean {
    const fromRoot = relative(this.#root, path);
    if (climbsOut(fromRoot, sep)) return true;
    if (
      fromRoot
        .split(sep)
        .some((segment) => SKIPPED_DIRECTORIES.includes(segment))
    ) {
      return true;
    }
    if (this.#exclusions.some((excluded) => liesInside(excluded, path))) {
      return true;
    }
    return this.#isIgnored(path);
  }

  /** Whether git must be asked about `path` before it counts: it lies in a repository whose listing predates it. */
  needsCheck(path: string): boolean {
    return this.#repositoryOf(path) !== undefined;
  }

  /** Marks what lies under `directory`, which appeared after git's listing, as asked about only through `check`. */
  distrust(directory: string): void {
    this.#unconfirmed.add(directory);
  }

  /** Whether `path` lies under a directory git listed without ignoring it, so it must be asked about before it counts. */
  isUncertain(path: string): boolean {
    for (let current = dirname(path); liesInside(this.#root, current);) {
      if (this.#unconfirmed.has(current)) return true;
      if (current === this.#root) return false;
      current = dirname(current);
    }
    return false;
  }

  /** Asks git which of `paths` it ignores; a repository git cannot answer for ignores none of them. */
  async check(paths: readonly string[], signal: AbortSignal): Promise<void> {
    const byRepository = new Map<string, string[]>();
    for (const path of paths) {
      const repository = this.#repositoryOf(path);
      if (repository === undefined) continue;
      const group = byRepository.get(repository) ?? [];
      group.push(relativePosixPath(repository, path));
      byRepository.set(repository, group);
    }
    for (const [repository, group] of byRepository) {
      const checked = await readCheckedIgnored(repository, group, signal);
      if (checked.ok) {
        for (const ignored of checked.paths) this.#ignored.add(ignored);
      } else {
        this.#dropRepository(repository, checked.reason);
      }
    }
  }

  async #addRepository(directory: string, signal: AbortSignal): Promise<void> {
    const listing = await readIgnoredPaths(directory, signal);
    if (!listing.ok) {
      this.#failed.add(directory);
      this.#unread.add(`${UNREAD_IGNORED_PREFIX}: ${listing.reason}`);
      return;
    }
    for (const path of listing.paths) this.#ignored.add(path);
    for (const path of listing.unconfirmed) this.#unconfirmed.add(path);
    this.#repositories.push(directory);
  }

  #dropRepository(repository: string, reason: string): void {
    const index = this.#repositories.indexOf(repository);
    if (index !== -1) this.#repositories.splice(index, 1);
    this.#failed.add(repository);
    this.#unread.add(`${UNREAD_IGNORED_PREFIX}: ${reason}`);
  }

  #isIgnored(path: string): boolean {
    for (let current = path; liesInside(this.#root, current);) {
      if (current === this.#root) return false;
      if (this.#ignored.has(current)) return true;
      current = dirname(current);
    }
    return false;
  }

  /**
   * The innermost repository holding `path` whose listing was read, since a nested one answers for its own paths.
   * Undefined when a failed repository lies between it and `path`, since that one ignores nothing.
   */
  #repositoryOf(path: string): string | undefined {
    let found: string | undefined;
    for (const repository of this.#repositories) {
      if (
        liesInside(repository, path) &&
        (found === undefined || liesInside(found, repository))
      ) {
        found = repository;
      }
    }
    for (const failed of this.#failed) {
      if (
        liesInside(failed, path) &&
        (found === undefined || liesInside(found, failed))
      ) {
        return undefined;
      }
    }
    return found;
  }
}

/** The directory holding the `.git` entry of the repository `directory` lies in, or undefined outside git. */
export function enclosingRepository(directory: string): string | undefined {
  for (let current = directory; ; current = dirname(current)) {
    if (holdsRepository(current)) return current;
    if (dirname(current) === current) return undefined;
  }
}

/**
 * The real path of `path`, or of its nearest existing ancestor with the rest appended, so an exclusion compares
 * with paths under the consumer root's real path however the caller spelled it.
 */
function canonicalPath(path: string): string {
  const missing: string[] = [];
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      return join(realpathSync.native(current), ...missing);
    } catch {
      if (dirname(current) === current) return resolve(path);
      missing.unshift(basename(current));
    }
  }
}

/** The absolute path of a root-relative input path. */
export function absoluteInputPath(root: string, path: string): string {
  return join(root, ...path.split(POSIX_SEPARATOR));
}
