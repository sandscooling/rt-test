import { liesInside, POSIX_SEPARATOR } from "../vitest/find-workspaces.js";
import { ProjectInputs } from "./fingerprint.js";
import type { InputDigests } from "./input-inventory.js";

/** Each daemon life counts its revisions from here. */
const INITIAL_REVISION = 0;
/** The consumer root's root-relative path, under which every input lies. */
const ROOT_RELATIVE_PATH = "";

/**
 * The inputs the tracker holds, by root-relative path, and the directories that hold them. Changes collect until
 * `commit`, which raises the revision once when any digest changed.
 */
export class InputState {
  readonly #root: string;
  #inputs = new Map<string, string>();
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
   * established. The first one establishes the set and changes nothing.
   */
  establish(inputs: InputDigests, directories: readonly string[]): string[] {
    const changed = this.#everEstablished
      ? changedPaths(this.#inputs, inputs)
      : [];
    this.#inputs = new Map(inputs);
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

  /** Records the digest of the input at `path`, marking a change when it differs from the one held. */
  set(path: string, digest: string): void {
    if (this.#inputs.get(path) === digest) return;
    this.#inputs.set(path, digest);
    this.#changed = true;
  }

  /** Removes the input at `path`, or every input and directory at or under it; returns the inputs removed. */
  remove(path: string, absolutePath: string): string[] {
    const removed = this.#directories.has(absolutePath)
      ? [...this.#inputs.keys()].filter((input) => liesUnder(input, path))
      : this.#inputs.has(path)
        ? [path]
        : [];
    for (const input of removed) this.#inputs.delete(input);
    this.#removeDirectoriesInside(absolutePath);
    if (removed.length > 0) this.#changed = true;
    return removed;
  }

  /** Replaces what lies at or under `path` with a walk of it; returns the inputs added, changed or removed. */
  replaceUnder(
    path: string,
    absolutePath: string,
    inputs: InputDigests,
    directories: readonly string[],
  ): string[] {
    const before = new Map(
      [...this.#inputs].filter(([input]) => liesUnder(input, path)),
    );
    for (const input of before.keys()) this.#inputs.delete(input);
    this.#removeDirectoriesInside(absolutePath);
    for (const [input, digest] of inputs) this.#inputs.set(input, digest);
    for (const directory of directories) this.#directories.add(directory);
    const changed = changedPaths(before, inputs);
    this.#changed = changed.length > 0 || this.#changed;
    return changed;
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
    this.#project ??= new ProjectInputs(this.#root, new Map(this.#inputs));
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

function changedPaths(before: InputDigests, after: InputDigests): string[] {
  const changed = [...after]
    .filter(([path, digest]) => before.get(path) !== digest)
    .map(([path]) => path);
  for (const path of before.keys()) {
    if (!after.has(path)) changed.push(path);
  }
  return changed;
}
