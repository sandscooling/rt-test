import type { DaemonLog } from "../daemon/daemon-log.js";
import { gitSources } from "./git-sources.js";
import type { InputFilter } from "./input-filter.js";
import type { InputWatcher } from "./input-watcher.js";

const GIT_SOURCES_UNREAD =
  "git's HEAD and ignore-rule files could not be located, so a branch or ignore-rule change is seen only by events and the periodic reconciliation";
const GIT_FILE_UNWATCHED =
  "a file whose change can move HEAD or change what git ignores cannot be watched, so such a change is seen only by the periodic reconciliation";

/** The watches on git's HEAD and ignore-rule files, and what of git could not be read. */
export class GitFiles {
  readonly #root: string;
  readonly #watcher: InputWatcher;
  readonly #log: DaemonLog;
  #unread: readonly string[] = [];
  /** What of git's HEAD and ignore-rule files the last watch could not locate or watch. */
  #filesUnread: readonly string[] = [];
  #watchedFor: readonly string[] = [];

  /** `root` is the consumer root's real path. */
  constructor(root: string, watcher: InputWatcher, log: DaemonLog) {
    this.#root = root;
    this.#watcher = watcher;
    this.#log = log;
  }

  /** What of git could not be read, as the last report found it. */
  get unread(): readonly string[] {
    return this.#unread;
  }

  /** Locates git's HEAD and ignore-rule files for `nestedRepositories` and watches them in place of the last ones. */
  async watch(
    nestedRepositories: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    this.#watchedFor = nestedRepositories;
    const sources = await gitSources(this.#root, nestedRepositories, signal);
    const unwatched = this.#watcher.watchGitFiles(
      sources.ok ? sources.files : [],
    );
    const unlocated = sources.ok ? sources.unread : [sources.reason];
    this.#filesUnread = [
      ...unwatched.map((reason) => `${GIT_FILE_UNWATCHED}: ${reason}`),
      ...unlocated.map((reason) => `${GIT_SOURCES_UNREAD}: ${reason}`),
    ];
  }

  /** Watches again only when the nested repositories differ from those the last watch covered. */
  async follow(
    nestedRepositories: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    if (sameMembers(this.#watchedFor, nestedRepositories)) return;
    await this.watch(nestedRepositories, signal);
  }

  /** Logs git's unread reasons when they differ from the last report's, not on every one. */
  report(filter: InputFilter): void {
    const unread = [...filter.unread, ...this.#filesUnread];
    const changed =
      unread.length !== this.#unread.length ||
      unread.some((reason, index) => reason !== this.#unread[index]);
    this.#unread = unread;
    if (!changed) return;
    for (const reason of unread) this.#log.entry(`warning: ${reason}`);
  }
}

function sameMembers(
  first: readonly string[],
  second: readonly string[],
): boolean {
  const members = new Set(first);
  const others = new Set(second);
  return (
    members.size === others.size &&
    [...others].every((member) => members.has(member))
  );
}
