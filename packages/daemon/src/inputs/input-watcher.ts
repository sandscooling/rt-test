import {
  existsSync,
  realpathSync,
  statSync,
  watch,
  type FSWatcher,
  type WatchEventType,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { WINDOWS } from "../daemon/endpoint.js";
import { errorText } from "../vitest/error-text.js";
import { liesInside } from "../vitest/find-workspaces.js";
import { directoriesAbove } from "./listed-files.js";

const MISSING_CODE = "ENOENT";
const RENAME_EVENT = "rename";
const LOST_EVENTS_REASON =
  "the file watcher reported that it lost events, so changes it did not name may have been missed";
const VANISHED_TWICE_REASON = "it vanished twice while its watch was opening";

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
  /**
   * A listed file's watch could not be opened, reported once per directory: the watcher stays healthy, since every
   * fingerprint reads such a file afresh, and its change waits for the next reconciliation.
   */
  readonly cannotWatchListed: (reason: string) => void;
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
  #listed: FSWatcher[] = [];
  /** The listed files the inputs may leave out, by absolute path, watched apart from the tree on Linux. */
  #listedFiles: readonly string[] = [];
  /** Each directory on the way from the root to a listed file, whose change re-arms the listed watches. */
  #listedWays: ReadonlySet<string> = new Set();
  /** Directories whose listed watch could not open, each reported once. */
  readonly #listedUnopened = new Set<string>();
  /** Whether a closed tree watch covered a directory on the way to a listed file since the listed watches were armed. */
  #listedOwed = false;
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
        const path = join(watched, name);
        if (this.#listedWays.has(path)) this.#armListed();
        this.#listener.changed(path, kind);
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
    this.#armListedIfOwed();
  }

  /** Closes the watch of `directory` and of every directory under it, on Linux, once it no longer holds inputs. */
  dropDirectory(directory: string): void {
    if (this.#recursive) return;
    for (const [watched, watcher] of this.#tree) {
      if (liesInside(directory, watched)) this.#closeTree(watched, watcher);
    }
    this.#armListedIfOwed();
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

  /**
   * Replaces the listed files watched on Linux, `files` being absolute paths under the root; the recursive watch
   * covers them on Windows.
   */
  watchListedFiles(files: readonly string[]): void {
    if (this.#recursive) return;
    this.#listedFiles = files;
    this.#listedWays = directoriesAbove(this.#root, files);
    this.#armListed();
  }

  close(): void {
    this.#closed = true;
    for (const [directory, watcher] of this.#tree) {
      this.#closeTree(directory, watcher);
    }
    this.#closeGit();
    this.#closeListed();
  }

  /**
   * Watches every existing directory on the way to each listed file that the tree does not watch, up to the first one
   * it does, each filtered to the entries leading to a listed file, so replacing or renaming any of them is seen. The
   * new watches open before the old ones close, so no moment goes unwatched. A directory that vanished before its watch
   * opened is looked for again once, then logged as unwatched.
   */
  #armListed(retry = true): void {
    this.#listedOwed = false;
    const replaced = this.#listed;
    this.#listed = [];
    this.#armListedWatches(retry);
    for (const watcher of replaced) this.#stop(watcher);
  }

  #armListedWatches(retry: boolean): void {
    if (this.#closed || this.#listedFiles.length === 0) return;
    const covered = (directory: string): boolean => this.#tree.has(directory);
    const vanished: string[] = [];
    const watched = listedDirectories(this.#root, this.#listedFiles, covered);
    for (const [directory, names] of watched) {
      let refused = false;
      const opened = this.#open(
        directory,
        false,
        (kind, name) => this.#listedEvent(directory, names, kind, name),
        (reason) => {
          refused = true;
          this.#cannotWatchListed(directory, reason);
        },
      );
      if (opened !== undefined) this.#listed.push(opened);
      else if (!refused) vanished.push(directory);
    }
    if (vanished.length === 0) return;
    if (retry) this.#armListed(false);
    else for (const directory of vanished) this.#vanishedTwice(directory);
  }

  #vanishedTwice(directory: string): void {
    this.#cannotWatchListed(
      directory,
      `cannot watch ${directory}: ${VANISHED_TWICE_REASON}`,
    );
  }

  #closeListed(): void {
    for (const watcher of this.#listed) this.#stop(watcher);
    this.#listed = [];
  }

  /**
   * An entry on the way to a listed file re-arms before it is reported. So does an entry named as the watched directory,
   * which may be its own removal or replacement, reported under its own name, and is then reported as the directory.
   */
  #listedEvent(
    directory: string,
    names: ReadonlySet<string>,
    kind: WatchEventType,
    name: string | null,
  ): void {
    if (name === null) {
      this.#fail(LOST_EVENTS_REASON);
      return;
    }
    if (name === basename(directory)) {
      this.#armListed();
      this.#listener.changed(directory, RENAME_EVENT);
    }
    if (!names.has(name)) return;
    const path = join(directory, name);
    if (this.#listedWays.has(path)) this.#armListed();
    this.#listener.changed(path, kind);
  }

  /** Re-arms once after a batch of tree watches closed, when one covered a directory on the way to a listed file. */
  #armListedIfOwed(): void {
    if (!this.#listedOwed) return;
    this.#listedOwed = false;
    this.#armListed();
  }

  #cannotWatchListed(directory: string, reason: string): void {
    if (this.#listedUnopened.has(directory)) return;
    this.#listedUnopened.add(directory);
    this.#listener.cannotWatchListed(reason);
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
      this.#listed = this.#listed.filter((kept) => kept !== watcher);
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

  /** A listed file whose directory the closed watch covered needs a listed watch of its own. */
  #closeTree(directory: string, watcher: FSWatcher): void {
    this.#stop(watcher);
    this.#tree.delete(directory);
    if (this.#listedWays.has(directory)) this.#listedOwed = true;
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
    addEntry(directories, directory, entry);
  }
  return directories;
}

/**
 * Each existing directory from each file's up to the first `covered` or the root, with the names of the entries under
 * it that lead to the files. One already met stops the climb, since everything above it was met with it.
 */
function listedDirectories(
  root: string,
  files: readonly string[],
  covered: (directory: string) => boolean,
): Map<string, Set<string>> {
  const directories = new Map<string, Set<string>>();
  for (const file of files) {
    let entry = file;
    let directory = dirname(file);
    while (!covered(directory) && liesInside(root, directory)) {
      if (isDirectory(directory)) {
        const met = directories.has(directory);
        addEntry(directories, directory, entry);
        if (met) break;
      }
      if (directory === root) break;
      entry = directory;
      directory = dirname(directory);
    }
  }
  return directories;
}

function addEntry(
  directories: Map<string, Set<string>>,
  directory: string,
  entry: string,
): void {
  const names = directories.get(directory) ?? new Set<string>();
  names.add(basename(entry));
  directories.set(directory, names);
}

/** A path that cannot be read is no directory to watch, so its parent is watched for it. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
