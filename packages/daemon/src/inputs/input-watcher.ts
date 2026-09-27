import {
  existsSync,
  realpathSync,
  watch,
  type FSWatcher,
  type WatchEventType,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { WINDOWS } from "../daemon/endpoint.js";
import { errorText } from "../vitest/error-text.js";
import { liesInside } from "../vitest/find-workspaces.js";

const MISSING_CODE = "ENOENT";
const RENAME_EVENT = "rename";
const LOST_EVENTS_REASON =
  "the file watcher reported that it lost events, so changes it did not name may have been missed";

export interface WatchListener {
  /** An event named `path`, an absolute path under the root, which may have been added, changed or removed. */
  readonly changed: (path: string, kind: WatchEventType) => void;
  /** A watched git file or ignore-rule source changed, so the whole input set must be read again. */
  readonly gitChanged: (path: string) => void;
  /**
   * Events were lost or an open watch failed: every result is unconfirmed until a reconciliation re-reads the inputs.
   * Windows reports a lost batch; Linux drops an inotify queue overflow unreported, which only the periodic
   * reconciliation covers.
   */
  readonly failed: (reason: string) => void;
  /** A watch of the root's tree could not be opened: the watcher is unhealthy until a reconciliation opens every watch. */
  readonly cannotWatch: (reason: string) => void;
}

/**
 * Watches the consumer root and the git files outside it. On Windows one recursive watch covers the root; on Linux,
 * where a recursive watch walks the whole tree itself, each included directory has its own watch, opened before the
 * directory is listed so nothing created in between goes unseen. Every watch is opened on a real path, since
 * Windows aborts the process on the first event of a watch opened through a short (8.3) name.
 */
export class InputWatcher {
  readonly #root: string;
  readonly #listener: WatchListener;
  readonly #recursive = process.platform === WINDOWS;
  readonly #tree = new Map<string, FSWatcher>();
  #git: FSWatcher[] = [];
  readonly #live = new Set<FSWatcher>();
  /** Directories whose watch could not open since the last `clearFailures`, so each is tried once a round. */
  readonly #unopened = new Set<string>();
  #failures: string[] = [];
  #closed = false;

  /** `root` is the consumer root's real path. */
  constructor(root: string, listener: WatchListener) {
    this.#root = root;
    this.#listener = listener;
  }

  /** Why a watch of the root's tree that should be open is not, since the last `clearFailures`; empty when each is. */
  get failures(): readonly string[] {
    return this.#failures;
  }

  clearFailures(): void {
    this.#failures = [];
    this.#unopened.clear();
  }

  /** Opens the watch covering `directory`, a directory under the root about to be listed, unless one is open. */
  watchDirectory(directory: string): void {
    const watched = this.#recursive ? this.#root : directory;
    if (this.#closed || this.#tree.has(watched)) return;
    if (this.#unopened.has(watched)) return;
    const opened = this.#open(
      watched,
      this.#recursive,
      (kind, name) => {
        if (name === null) {
          this.#fail(LOST_EVENTS_REASON);
          return;
        }
        this.#listener.changed(join(watched, name), kind);
        // inotify reports a watched directory's own removal under its own name, so the directory itself is re-read;
        // a child of the same name is told apart by still existing.
        if (
          !this.#recursive &&
          name === basename(watched) &&
          !existsSync(join(watched, name))
        ) {
          this.#listener.changed(watched, RENAME_EVENT);
        }
      },
      (reason) => this.#cannotWatchTree(watched, reason),
    );
    if (opened !== undefined) this.#tree.set(watched, opened);
  }

  /** Closes the watch of each directory not in `directories`, on Linux. */
  keepDirectories(directories: ReadonlySet<string>): void {
    if (this.#recursive) return;
    for (const [directory, watcher] of this.#tree) {
      if (!directories.has(directory)) this.#closeTree(directory, watcher);
    }
  }

  /** Closes the watch of `directory` and of every directory under it, on Linux, once it no longer holds inputs. */
  dropDirectory(directory: string): void {
    if (this.#recursive) return;
    for (const [watched, watcher] of this.#tree) {
      if (liesInside(directory, watched)) this.#closeTree(watched, watcher);
    }
  }

  /**
   * Replaces the watches of the git files: each file is watched through its nearest existing directory, filtered
   * to the entry leading to it, so one created later is still seen. Returns why each watch it could not open did not.
   */
  watchGitFiles(files: readonly string[]): string[] {
    this.#closeGit();
    const unopened: string[] = [];
    if (this.#closed) return unopened;
    for (const [directory, names] of nearestDirectories(files)) {
      const opened = this.#open(
        directory,
        false,
        (_kind, name) => {
          if (name === null) {
            this.#fail(LOST_EVENTS_REASON);
            return;
          }
          if (names.has(name)) this.#listener.gitChanged(join(directory, name));
        },
        (reason) => {
          unopened.push(reason);
        },
      );
      if (opened !== undefined) this.#git.push(opened);
    }
    return unopened;
  }

  close(): void {
    this.#closed = true;
    for (const [directory, watcher] of this.#tree) {
      this.#closeTree(directory, watcher);
    }
    this.#closeGit();
  }

  /** A path that vanished before its watch opened is a deletion its parent reports, never a failure. */
  #open(
    directory: string,
    recursive: boolean,
    onEvent: (kind: WatchEventType, name: string | null) => void,
    cannotOpen: (reason: string) => void,
  ): FSWatcher | undefined {
    let watcher: FSWatcher;
    try {
      watcher = watch(
        realpathSync.native(directory),
        { recursive },
        (kind, name) => {
          if (this.#isCurrent(watcher)) onEvent(kind, name);
        },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== MISSING_CODE) {
        cannotOpen(`cannot watch ${directory}: ${errorText(error)}`);
      }
      return undefined;
    }
    this.#live.add(watcher);
    watcher.on("error", (error) => {
      if (!this.#isCurrent(watcher)) return;
      this.#stop(watcher);
      this.#git = this.#git.filter((kept) => kept !== watcher);
      if (this.#tree.get(directory) === watcher) this.#tree.delete(directory);
      this.#fail(`the watch of ${directory} failed: ${errorText(error)}`);
    });
    return watcher;
  }

  #cannotWatchTree(directory: string, reason: string): void {
    this.#unopened.add(directory);
    this.#failures.push(reason);
    this.#listener.cannotWatch(reason);
  }

  /** A closed watch may still deliver an event it had queued, which must not reach the tracker. */
  #isCurrent(watcher: FSWatcher): boolean {
    return !this.#closed && this.#live.has(watcher);
  }

  #stop(watcher: FSWatcher): void {
    this.#live.delete(watcher);
    watcher.close();
  }

  #closeTree(directory: string, watcher: FSWatcher): void {
    this.#stop(watcher);
    this.#tree.delete(directory);
  }

  #closeGit(): void {
    for (const watcher of this.#git) this.#stop(watcher);
    this.#git = [];
  }

  #fail(reason: string): void {
    this.#failures.push(reason);
    this.#listener.failed(reason);
  }
}

/** Each file's nearest existing ancestor directory, with the names of the entries under it that lead to the files. */
function nearestDirectories(
  files: readonly string[],
): Map<string, Set<string>> {
  const directories = new Map<string, Set<string>>();
  for (const file of files) {
    let entry = file;
    let directory = dirname(file);
    while (!existsSync(directory) && dirname(directory) !== directory) {
      entry = directory;
      directory = dirname(directory);
    }
    const names = directories.get(directory) ?? new Set<string>();
    names.add(basename(entry));
    directories.set(directory, names);
  }
  return directories;
}
