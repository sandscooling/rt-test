import { lstatSync, type WatchEventType } from "node:fs";
import { relativePosixPath } from "../vitest/find-workspaces.js";
import type { GitFiles } from "./git-files.js";
import {
  absoluteInputPath,
  liesInsideOnHost,
  type InputFilter,
} from "./input-filter.js";
import {
  readEntryDigest,
  takeInventory,
  type InputRead,
  type InventoryScope,
} from "./input-inventory.js";
import type { JobWindows } from "./input-jobs.js";
import type { InputState } from "./input-state.js";
import type { InputWatcher } from "./input-watcher.js";
import {
  readListedFile,
  readListedFiles,
  type ListedFile,
  type ListedFiles,
  type ListedReads,
} from "./listed-files.js";

const RENAME_EVENT = "rename";
const CHANGE_EVENT = "change";
/** A read a query asked for, which no event reported: evidence of no write, so it acts only on a change it finds. */
const NAMED_READ = "named";

type QueuedKind = WatchEventType | typeof NAMED_READ;
type QueuedPath = [path: string, kind: QueuedKind];

/** A path a named read found but could not read, root-relative, with why. */
export interface UnreadPath {
  readonly path: string;
  readonly reason: string;
}

/** How many of `paths` count as changed paths not yet read: every one but a named read. */
export function pendingCount(paths: readonly QueuedPath[]): number {
  return paths.filter(([, kind]) => kind !== NAMED_READ).length;
}

/** What reading queued paths shares with the tracker that queues them. */
interface QueuedReadsParts {
  /** The consumer root's real path. */
  readonly root: string;
  readonly state: InputState;
  readonly watcher: InputWatcher;
  readonly git: GitFiles;
  readonly jobs: JobWindows;
  readonly listed: ListedFiles;
  /** Aborts once the tracker stops. */
  readonly signal: AbortSignal;
  readonly scope: (filter: InputFilter) => InventoryScope;
  readonly inputSetLost: (reason: string) => void;
  readonly retryLostInputSet: () => void;
}

/**
 * Queues the paths events name between reconciliations and reads them into the input state, marking each job a change
 * can affect, and the listed files the inputs leave out into the reads it holds apart from them.
 */
export class QueuedReads {
  readonly #root: string;
  readonly #state: InputState;
  readonly #watcher: InputWatcher;
  readonly #git: GitFiles;
  readonly #jobs: JobWindows;
  readonly #listed: ListedFiles;
  readonly #signal: AbortSignal;
  readonly #scope: (filter: InputFilter) => InventoryScope;
  readonly #inputSetLost: (reason: string) => void;
  readonly #retryLostInputSet: () => void;
  readonly #queue = new Map<string, QueuedKind>();
  /** Queued only because protection changed whether they count, so reading them marks no job; an event clears one. */
  readonly #quiet = new Set<string>();
  /** Why the last read of each named absolute path could not read it, until another read of it. */
  readonly #unreadNamed = new Map<string, string>();

  constructor(parts: QueuedReadsParts) {
    this.#root = parts.root;
    this.#state = parts.state;
    this.#watcher = parts.watcher;
    this.#git = parts.git;
    this.#jobs = parts.jobs;
    this.#listed = parts.listed;
    this.#signal = parts.signal;
    this.#scope = parts.scope;
    this.#inputSetLost = parts.inputSetLost;
    this.#retryLostInputSet = parts.retryLostInputSet;
  }

  /** How many paths wait for a read. */
  get queued(): number {
    return this.#queue.size;
  }

  /** How many waiting paths count as changed paths not yet read. */
  get pending(): number {
    return pendingCount([...this.#queue]);
  }

  /** Whether the absolute `path` waits for a read. */
  has(path: string): boolean {
    return this.#queue.has(path);
  }

  /** The waiting paths, root-relative. */
  queuedLabels(): Set<string> {
    return new Set([...this.#queue.keys()].map((path) => this.#label(path)));
  }

  /** Queues a read of the absolute `path` for an event of `kind`, in place of a quiet or named one; a rename stays one. */
  enqueue(path: string, kind: WatchEventType): void {
    this.#quiet.delete(path);
    if (this.#queue.get(path) !== RENAME_EVENT) this.#queue.set(path, kind);
  }

  /** Queues a read of the absolute `path` that marks no job, in place of a named one, unless an event queued one. */
  enqueueQuietly(path: string): void {
    const queued = this.#queue.get(path);
    if (queued === undefined || queued === NAMED_READ) {
      this.#quiet.add(path);
      this.#queue.set(path, CHANGE_EVENT);
    }
  }

  /** Queues a named read of each of the absolute `paths` not already queued; returns how many it queued. */
  enqueueNamed(paths: readonly string[]): number {
    const added = paths.filter((path) => !this.#queue.has(path));
    for (const path of added) this.#queue.set(path, NAMED_READ);
    return added.length;
  }

  /** Each of the absolute `paths` whose last read was a named one that could not read it. */
  unreadNamed(paths: readonly string[]): UnreadPath[] {
    return paths.flatMap((path) => {
      const reason = this.#unreadNamed.get(path);
      return reason === undefined ? [] : [{ path: this.#label(path), reason }];
    });
  }

  /** Every waiting path with its kind, which no longer waits. */
  takeBatch(): QueuedPath[] {
    const batch = [...this.#queue];
    this.#queue.clear();
    return batch;
  }

  /**
   * The absolute paths a read of the root-relative `named` path reads: each input held at or under it, compared as the
   * host compares names, or with none held, the entry at it unless a directory, as its event would read it. Walks
   * nothing, so a folder no input is held under, or a missing path no input was held at, gives none.
   */
  namedPaths(named: string): string[] {
    const absolute = absoluteInputPath(this.#root, named);
    if (this.#state.hasInput(named)) return [absolute];
    const held = [...this.#state.project().digests.keys()]
      .map((input) => absoluteInputPath(this.#root, input))
      .filter((input) => liesInsideOnHost(absolute, input));
    if (held.length > 0) return held;
    return namesEntryButDirectory(absolute) ? [absolute] : [];
  }

  /**
   * `filter` is the last reconciliation's; without it, or an established input set, nothing is read, and each path
   * marks its jobs as a cause, since no read vouches for it as an input.
   */
  async read(
    batch: readonly QueuedPath[],
    filter: InputFilter | undefined,
  ): Promise<void> {
    if (filter === undefined || !this.#state.established) {
      for (const [path] of batch) this.#jobs.recordCause(this.#label(path));
      this.#retryLostInputSet();
      return;
    }
    const unknown = batch
      .map(([path]) => path)
      .filter(
        (path) =>
          !this.#isKnown(path) &&
          !filter.excludes(path) &&
          filter.needsCheck(path),
      );
    if (unknown.length > 0) {
      await filter.check(unknown, this.#signal);
      this.#git.report(filter);
    }
    for (const [path, kind] of batch) {
      if (kind === NAMED_READ) {
        if (!filter.excludes(path)) await this.#readNamed(filter, path);
        continue;
      }
      const quiet = this.#quiet.has(path);
      if (filter.excludes(path)) this.#quiet.delete(path);
      else await this.#readPath(filter, path, kind);
      await this.#readListed(filter, path, quiet);
    }
  }

  /**
   * Watches the files the discovery now in effect lists and drops each held read no longer listed; returns the newly
   * listed files the filter excludes, root-relative, to read quietly. Before an input set is established, the
   * reconciliation that establishes one watches and reads them all.
   */
  relist(
    added: readonly ListedFile[] | undefined,
    filter: InputFilter | undefined,
  ): string[] {
    if (added === undefined) return [];
    if (filter === undefined || !this.#state.established) return [];
    this.#watcher.watchListedFiles(this.#listed.paths);
    const excluded = this.#listed.excluded(filter);
    this.#state.keepListed(new Set(excluded.map((file) => file.spelling)));
    return added
      .filter((file) => filter.excludes(file.path))
      .map((file) => file.spelling);
  }

  /** A reconciliation's reads of the listed files `filter` excludes, taken again when a discovery relists them meanwhile. */
  async readAllListed(filter: InputFilter): Promise<ListedReads> {
    for (;;) {
      const version = this.#listed.version;
      this.#watcher.watchListedFiles(this.#listed.paths);
      const files = this.#listed.excluded(filter);
      const reads = await readListedFiles(files, this.#signal);
      if (version === this.#listed.version) return reads;
    }
  }

  /**
   * Reads each listed file at or under `path` that the filter excludes into the held reads, since no walk of an input
   * directory reaches it. Unless `quiet`, marks each job a changed read, or a write it may have missed, can affect.
   */
  async #readListed(
    filter: InputFilter,
    path: string,
    quiet: boolean,
  ): Promise<void> {
    for (const file of this.#listed.under(path, filter)) {
      const read = await readListedFile(file, this.#signal);
      if (!this.#listed.lists(file.path)) continue;
      const changed =
        read === undefined
          ? this.#state.dropListed(file.spelling)
          : this.#state.holdListed(file.spelling, read);
      if (changed && !quiet) this.#jobs.recordPath(file.spelling);
    }
  }

  async #readPath(
    filter: InputFilter,
    path: string,
    kind: WatchEventType,
  ): Promise<void> {
    const relative = this.#label(path);
    this.#unreadNamed.delete(path);
    const record = this.#quiet.delete(path)
      ? () => undefined
      : (changed: readonly string[]) => this.#recordAll(changed);
    const entry = await readEntryDigest(path, this.#signal);
    switch (entry.kind) {
      case "absent": {
        const wasDirectory = this.#state.hasDirectory(path);
        record(this.#absentChanged(filter, path, relative, wasDirectory));
        if (wasDirectory) this.#watcher.dropDirectory(path);
        return;
      }
      case "input":
        this.#readFile(filter, path, entry.read, record);
        return;
      case "directory":
        if (this.#state.hasDirectory(path) && kind !== RENAME_EVENT) return;
        await this.#readDirectory(filter, path, relative);
        return;
      case "unreadable":
        this.#inputSetLost(`${relative} cannot be read: ${entry.reason}`);
        return;
    }
  }

  /**
   * Changes only what it finds changed: a new entry, a held input's digest, or a held input it can no longer read as
   * one, which it drops, so no held read vouches for content it could not read, and keeps why it could not. It keeps
   * the held read of an unchanged input, against which the file's own event is judged.
   */
  async #readNamed(filter: InputFilter, path: string): Promise<void> {
    const relative = this.#label(path);
    const entry = await readEntryDigest(path, this.#signal);
    if (entry.kind === "unreadable") this.#unreadNamed.set(path, entry.reason);
    else this.#unreadNamed.delete(path);
    if (entry.kind !== "input") {
      this.#recordAll(this.#state.remove(relative, path));
      return;
    }
    if (this.#state.holdsDigest(relative, entry.read.digest)) return;
    this.#readFile(filter, path, entry.read, (changed) =>
      this.#recordAll(changed),
    );
  }

  /**
   * The inputs a read that found `path` absent removed. A path never held, which the caller found not excluded, came
   * and went before its read, so it counts as changed unless the declaration would have hidden it.
   */
  #absentChanged(
    filter: InputFilter,
    path: string,
    relative: string,
    wasDirectory: boolean,
  ): readonly string[] {
    const removed = this.#state.remove(relative, path);
    if (removed.length > 0 || wasDirectory) return removed;
    return filter.declares(path) === undefined ? [relative] : [];
  }

  /**
   * A file that replaced a directory drops what the directory held; a declared file is not an input. A read that
   * rules out any write since the last one, such as one following a last-access event, marks no job.
   */
  #readFile(
    filter: InputFilter,
    path: string,
    read: InputRead,
    record: (changed: readonly string[]) => void,
  ): void {
    const relative = this.#label(path);
    if (this.#state.hasDirectory(path)) {
      this.#recordAll(this.#state.remove(relative, path));
      this.#watcher.dropDirectory(path);
    }
    if (filter.declares(path) !== undefined) {
      record(this.#state.remove(relative, path));
      return;
    }
    if (this.#state.set(relative, read)) record([relative]);
  }

  /**
   * A directory that appeared, or was replaced by a rename, is walked whole with fresh watches, since a watch left
   * on a replaced directory reports nothing, and each path in it is asked about as a new one.
   */
  async #readDirectory(
    filter: InputFilter,
    path: string,
    relative: string,
  ): Promise<void> {
    filter.distrust(path);
    this.#watcher.dropDirectory(path);
    const walked = await takeInventory(this.#scope(filter), path);
    if (!walked.ok) {
      this.#inputSetLost(walked.reason);
      return;
    }
    for (const ignored of walked.ignoredDirectories) {
      this.#watcher.dropDirectory(ignored);
    }
    this.#recordAll(
      this.#state.replaceUnder(
        relative,
        path,
        walked.inputs,
        walked.directories,
      ),
    );
  }

  #isKnown(path: string): boolean {
    return (
      this.#state.hasDirectory(path) || this.#state.hasInput(this.#label(path))
    );
  }

  #recordAll(changed: readonly string[]): void {
    for (const path of changed) this.#jobs.recordPath(path);
  }

  #label(path: string): string {
    return relativePosixPath(this.#root, path);
  }
}

/**
 * Whether `path` names an entry other than a directory, a link named as itself, so a dangling link counts; false for a
 * path that cannot be statted for any reason, not only a missing one.
 */
function namesEntryButDirectory(path: string): boolean {
  try {
    const entry = lstatSync(path, { throwIfNoEntry: false });
    return entry !== undefined && !entry.isDirectory();
  } catch {
    return false;
  }
}
