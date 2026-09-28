import { liesInside, POSIX_SEPARATOR } from "../vitest/find-workspaces.js";
import { ProjectInputs } from "./fingerprint.js";
import {
  MODIFIED_TIME_RESOLUTION_MS,
  type InputRead,
  type InputReads,
} from "./input-inventory.js";

/** Each daemon life counts its revisions from here. */
const INITIAL_REVISION = 0;
/** The consumer root's root-relative path, under which every input lies. */
const ROOT_RELATIVE_PATH = "";

/**
 * The inputs the tracker holds, each as its last read saw it, by root-relative path, and the directories that hold
 * them. Changes collect until `commit`, which raises the revision once when any digest changed.
 */
export class InputState {
  readonly #root: string;
  #inputs = new Map<string, InputRead>();
  #directories = new Set<string>();
  #everEstablished = false;
  #established = false;
  #revision = INITIAL_REVISION;
  #changed = false;
  #project: ProjectInputs | undefined;

  /** `root` is the consumer root's real path. */
  constructor(root: string) {
    this.#root = root;
  }

  get revision(): number {
    return this.#revision;
  }

  /** Whether the last reconciliation read the whole input set; false before the first one ends. */
  get established(): boolean {
    return this.#established;
  }

  hasInput(path: string): boolean {
    return this.#inputs.has(path);
  }

  /** `directory` is absolute. */
  hasDirectory(directory: string): boolean {
    return this.#directories.has(directory);
  }

  /**
   * Replaces every input with a whole inventory's, returning the paths whose digest changed since the last input set
   * established. The first one establishes the set and changes nothing. `unread` holds the paths an event named
   * that has not been read yet.
   */
  establish(
    inputs: InputReads,
    directories: readonly string[],
    unread: ReadonlySet<string>,
  ): string[] {
    const changed = this.#everEstablished
      ? changedPaths(this.#inputs, inputs)
      : [];
    this.#inputs = keptReads(this.#inputs, inputs, (path) => unread.has(path));
    this.#directories = new Set(directories);
    this.#everEstablished = true;
    this.#established = true;
    this.#project = undefined;
    if (changed.length > 0) this.#changed = true;
    return changed;
  }

  /** Keeps the last input set to compare the next inventory with, but no longer vouches for it. */
  lose(): void {
    this.#established = false;
  }

  /**
   * Records a read of the input at `path`, marking a change when its digest differs from the one held. Returns
   * whether a write may have landed since the last read, which only a read seeing all of it unmoved can rule out.
   */
  set(path: string, read: InputRead): boolean {
    const held = this.#inputs.get(path);
    this.#inputs.set(path, read);
    if (held?.digest !== read.digest) this.#changed = true;
    return held === undefined || !restedSince(held, read);
  }

  /** Removes the input at `path`, or every input and directory at or under it; returns the inputs removed. */
  remove(path: string, absolutePath: string): string[] {
    const isDirectory = this.#directories.has(absolutePath);
    const removed = isDirectory
      ? [...this.#inputs.keys()].filter((input) => liesUnder(input, path))
      : this.#inputs.has(path)
        ? [path]
        : [];
    for (const input of removed) this.#inputs.delete(input);
    if (isDirectory) this.#removeDirectoriesInside(absolutePath);
    if (removed.length > 0) this.#changed = true;
    return removed;
  }

  /**
   * Replaces what lies at or under `path` with a walk of it; returns the inputs added, changed or removed, and each
   * one a write may have reached since its last read, whose content the walk found unchanged.
   */
  replaceUnder(
    path: string,
    absolutePath: string,
    inputs: InputReads,
    directories: readonly string[],
  ): string[] {
    const before = new Map(
      [...this.#inputs].filter(([input]) => liesUnder(input, path)),
    );
    for (const input of before.keys()) this.#inputs.delete(input);
    this.#removeDirectoriesInside(absolutePath);
    for (const [input, read] of keptReads(before, inputs, () => true)) {
      this.#inputs.set(input, read);
    }
    for (const directory of directories) this.#directories.add(directory);
    const changed = changedPaths(before, inputs);
    this.#changed = changed.length > 0 || this.#changed;
    return [...changed, ...unrestedPaths(before, inputs)];
  }

  /** Raises the revision once when anything changed since the last commit. */
  commit(): void {
    if (!this.#changed) return;
    this.#changed = false;
    this.#revision += 1;
    this.#project = undefined;
  }

  /** The committed inputs, whose digest is computed once per revision. */
  project(): ProjectInputs {
    this.#project ??= new ProjectInputs(
      this.#root,
      new Map([...this.#inputs].map(([path, read]) => [path, read.digest])),
    );
    return this.#project;
  }

  #removeDirectoriesInside(absolutePath: string): void {
    for (const directory of this.#directories) {
      if (liesInside(absolutePath, directory))
        this.#directories.delete(directory);
    }
  }
}

function liesUnder(input: string, path: string): boolean {
  if (path === ROOT_RELATIVE_PATH) return true;
  return input === path || input.startsWith(`${path}${POSIX_SEPARATOR}`);
}

/**
 * Whether `next` sees the input as `held` left it, with `held` taken late enough after the input's last write that
 * a write since would have moved a time. A last-access update moves none of what is compared.
 */
function restedSince(held: InputRead, next: InputRead): boolean {
  const lastWriteMs = Math.max(held.stamp.modifiedMs, held.stamp.changedMs);
  return (
    unmoved(held, next) &&
    held.stamp.readAtMs - lastWriteMs >= MODIFIED_TIME_RESOLUTION_MS
  );
}

function unmoved(held: InputRead, next: InputRead): boolean {
  return (
    held.digest === next.digest &&
    held.stamp.size === next.stamp.size &&
    held.stamp.modifiedMs === next.stamp.modifiedMs &&
    held.stamp.changedMs === next.stamp.changedMs
  );
}

/**
 * The reads to hold after a walk. A walk that found an input's content unchanged replaces its held read only when
 * it saw nothing move and no event on it is unread, so a write the walk read past is judged against a read before it.
 */
function keptReads(
  held: InputReads,
  walked: InputReads,
  unread: (path: string) => boolean,
): Map<string, InputRead> {
  return new Map(
    [...walked].map(([path, read]) => {
      const before = held.get(path);
      const keep =
        before !== undefined &&
        before.digest === read.digest &&
        (unread(path) || !unmoved(before, read));
      return [path, keep ? before : read];
    }),
  );
}

/** The inputs whose content `after` found as `before` held it, but which a write may have reached since. */
function unrestedPaths(before: InputReads, after: InputReads): string[] {
  return [...after]
    .filter(([path, read]) => {
      const held = before.get(path);
      return (
        held !== undefined &&
        held.digest === read.digest &&
        !restedSince(held, read)
      );
    })
    .map(([path]) => path);
}

function changedPaths(before: InputReads, after: InputReads): string[] {
  const changed = [...after]
    .filter(([path, read]) => before.get(path)?.digest !== read.digest)
    .map(([path]) => path);
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(path);
  }
  return changed;
}
