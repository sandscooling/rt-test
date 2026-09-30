import type { WatchEventType } from "node:fs";
import { relativePosixPath } from "../vitest/find-workspaces.js";
import type { GitFiles } from "./git-files.js";
import type { InputFilter } from "./input-filter.js";
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

export const RENAME_EVENT = "rename";

/** What reading queued paths shares with the tracker that queues them. */
interface QueuedReadsParts {
  /** The consumer root's real path. */
  readonly root: string;
  readonly state: InputState;
  readonly watcher: InputWatcher;
  readonly git: GitFiles;
  readonly jobs: JobWindows;
  readonly listed: ListedFiles;
  readonly abort: AbortController;
  /** Absolute paths queued only because protection changed whether they count, whose read marks no job. */
  readonly quiet: Set<string>;
  readonly scope: (filter: InputFilter) => InventoryScope;
  readonly inputSetLost: (reason: string) => void;
  readonly retryLostInputSet: () => void;
}

/**
 * Reads the paths events named between reconciliations into the input state, marking each job a change can affect,
 * and the listed files the inputs leave out into the reads it holds apart from them.
 */
export class QueuedReads {
  readonly #root: string;
  readonly #state: InputState;
  readonly #watcher: InputWatcher;
  readonly #git: GitFiles;
  readonly #jobs: JobWindows;
  readonly #listed: ListedFiles;
  readonly #abort: AbortController;
  readonly #quiet: Set<string>;
  readonly #scope: (filter: InputFilter) => InventoryScope;
  readonly #inputSetLost: (reason: string) => void;
  readonly #retryLostInputSet: () => void;

  constructor(parts: QueuedReadsParts) {
    this.#root = parts.root;
    this.#state = parts.state;
    this.#watcher = parts.watcher;
    this.#git = parts.git;
    this.#jobs = parts.jobs;
    this.#listed = parts.listed;
    this.#abort = parts.abort;
    this.#quiet = parts.quiet;
    this.#scope = parts.scope;
    this.#inputSetLost = parts.inputSetLost;
    this.#retryLostInputSet = parts.retryLostInputSet;
  }

  /**
   * `filter` is the last reconciliation's; without it, or an established input set, nothing is read, and each path
   * marks its jobs as a cause, since no read vouches for it as an input.
   */
  async read(
    batch: readonly [string, WatchEventType][],
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
      await filter.check(unknown, this.#abort.signal);
      this.#git.report(filter);
    }
    for (const [path, kind] of batch) {
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
      const reads = await readListedFiles(files, this.#abort.signal);
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
      const read = await readListedFile(file, this.#abort.signal);
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
    const relative = relativePosixPath(this.#root, path);
    const record = this.#quiet.delete(path)
      ? () => undefined
      : (changed: readonly string[]) => this.#recordAll(changed);
    const entry = await readEntryDigest(path, this.#abort.signal);
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
    const relative = relativePosixPath(this.#root, path);
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
      this.#state.hasDirectory(path) ||
      this.#state.hasInput(relativePosixPath(this.#root, path))
    );
  }

  #recordAll(changed: readonly string[]): void {
    for (const path of changed) this.#jobs.recordPath(path);
  }

  #label(path: string): string {
    return relativePosixPath(this.#root, path);
  }
}
