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

export const RENAME_EVENT = "rename";

/** What reading queued paths shares with the tracker that queues them. */
interface QueuedReadsParts {
  /** The consumer root's real path. */
  readonly root: string;
  readonly state: InputState;
  readonly watcher: InputWatcher;
  readonly git: GitFiles;
  readonly jobs: JobWindows;
  readonly abort: AbortController;
  /** Absolute paths queued only because protection changed whether they count, whose read marks no job. */
  readonly quiet: Set<string>;
  readonly scope: (filter: InputFilter) => InventoryScope;
  readonly inputSetLost: (reason: string) => void;
  readonly retryLostInputSet: () => void;
}

/** Reads the paths events named between reconciliations into the input state, marking each job a change can affect. */
export class QueuedReads {
  readonly #root: string;
  readonly #state: InputState;
  readonly #watcher: InputWatcher;
  readonly #git: GitFiles;
  readonly #jobs: JobWindows;
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
    this.#abort = parts.abort;
    this.#quiet = parts.quiet;
    this.#scope = parts.scope;
    this.#inputSetLost = parts.inputSetLost;
    this.#retryLostInputSet = parts.retryLostInputSet;
  }

  /** `filter` is the last reconciliation's; without it, or an established input set, nothing is read. */
  async read(
    batch: readonly [string, WatchEventType][],
    filter: InputFilter | undefined,
  ): Promise<void> {
    if (filter === undefined || !this.#state.established) {
      for (const [path] of batch) this.#jobs.record(this.#label(path));
      this.#retryLostInputSet();
      return;
    }
    const unknown = batch
      .map(([path]) => path)
      .filter((path) => !this.#isKnown(path) && filter.needsCheck(path));
    if (unknown.length > 0) {
      await filter.check(unknown, this.#abort.signal);
      this.#git.report(filter);
    }
    for (const [path, kind] of batch) {
      if (filter.excludes(path)) {
        this.#quiet.delete(path);
        continue;
      }
      await this.#readPath(filter, path, kind);
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
        record(this.#state.remove(relative, path));
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

  #recordAll(descriptions: readonly string[]): void {
    for (const description of descriptions) this.#jobs.record(description);
  }

  #label(path: string): string {
    return relativePosixPath(this.#root, path);
  }
}
