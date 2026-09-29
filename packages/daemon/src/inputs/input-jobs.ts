/** Changed paths or reasons a job's verdict names before it counts the rest. */
const MAX_NAMED_CHANGES = 20;
const LIST_SEPARATOR = ", ";
/** How a job's reason begins when a change while it ran keeps it from its fingerprint; the paths follow it. */
export const CHANGED_WHILE_RUNNING_REASON = "its inputs changed while it ran";

/** Taken when a job starts; its verdict is judged against it when the job ends. */
export interface JobMark {
  readonly window: JobWindow;
  /** Why the job's inputs cannot be vouched for from its start, when they cannot. */
  readonly unsettled?: string;
}

/** What made one job's inputs uncertain, readable while it runs; each set keeps its first-recorded order. */
export interface JobWindow {
  /** Every input that changed, by the input state's own root-relative key. */
  readonly paths: ReadonlySet<string>;
  /** Every cause that names no input: a watcher failure, a lost input set, or an event no read vouches for. */
  readonly causes: ReadonlySet<string>;
}

export type JobVerdict =
  | { readonly fingerprinted: true }
  | {
      readonly fingerprinted: false;
      readonly reason: string;
      /** Whether its window named a change while it ran and a fingerprint can be computed at its end, so a rerun could be bound to one. */
      readonly changedWhileRunning: boolean;
    };

interface ChangeWindow extends JobWindow {
  readonly paths: Set<string>;
  readonly causes: Set<string>;
}

/** The change windows of the jobs running now; each learns every change and failure seen while it runs. */
export class JobWindows {
  /** By the view each job's mark holds. */
  readonly #open = new Map<JobWindow, ChangeWindow>();

  open(unsettled: string | undefined): JobMark {
    const window: ChangeWindow = { paths: new Set(), causes: new Set() };
    this.#open.set(window, window);
    return unsettled === undefined ? { window } : { window, unsettled };
  }

  /** Records, for each job running, an input that changed, by the input state's own key. */
  recordPath(path: string): void {
    for (const window of this.#open.values()) window.paths.add(path);
  }

  /** Records, for each job running, a cause of uncertainty that names no input. */
  recordCause(cause: string): void {
    for (const window of this.#open.values()) window.causes.add(cause);
  }

  /** `unavailable` says why no fingerprint can be computed at the job's end, when none can. */
  close(mark: JobMark, unavailable: string | undefined): JobVerdict {
    this.#open.delete(mark.window);
    if (mark.unsettled !== undefined) {
      return {
        fingerprinted: false,
        reason: `its inputs were unsettled when it started: ${mark.unsettled}`,
        changedWhileRunning: false,
      };
    }
    const { paths, causes } = mark.window;
    const changes = [...new Set([...causes, ...paths])];
    if (changes.length > 0) {
      return {
        fingerprinted: false,
        reason: `${CHANGED_WHILE_RUNNING_REASON}: ${namedList(changes)}`,
        changedWhileRunning: unavailable === undefined,
      };
    }
    return unavailable === undefined
      ? { fingerprinted: true }
      : {
          fingerprinted: false,
          reason: unavailable,
          changedWhileRunning: false,
        };
  }
}

/** Names up to `MAX_NAMED_CHANGES` of `descriptions` and counts the rest. */
export function namedList(descriptions: readonly string[]): string {
  const named = descriptions.slice(0, MAX_NAMED_CHANGES).join(LIST_SEPARATOR);
  const rest = descriptions.length - MAX_NAMED_CHANGES;
  return rest > 0 ? `${named} and ${rest} more` : named;
}

/**
 * Counts the events accepted and read, so a job ending waits only for the events seen before its end, never for a
 * stream that keeps arriving after it.
 */
export class EventLedger {
  readonly #reconciling: () => boolean;
  #accepted = 0;
  #readThrough = 0;
  #waiters: { readonly through: number; readonly resolve: () => void }[] = [];

  /** `reconciling` says whether a reconciliation runs, which every wait also waits out. */
  constructor(reconciling: () => boolean) {
    this.#reconciling = reconciling;
  }

  get accepted(): number {
    return this.#accepted;
  }

  accept(): void {
    this.#accepted += 1;
  }

  /** Records that every event accepted up to `through` has been read. */
  readUpTo(through: number): void {
    this.#readThrough = Math.max(this.#readThrough, through);
    this.notify();
  }

  /** Resolves once the events accepted by now are read and no reconciliation runs. */
  waitForRead(): Promise<void> {
    const through = this.#accepted;
    if (this.#hasRead(through)) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push({ through, resolve }));
  }

  /** Releases each wait that can end now. */
  notify(): void {
    const waiting = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiting) {
      if (this.#hasRead(waiter.through)) waiter.resolve();
      else this.#waiters.push(waiter);
    }
  }

  #hasRead(through: number): boolean {
    return !this.#reconciling() && this.#readThrough >= through;
  }

  releaseAll(): void {
    const waiting = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiting) waiter.resolve();
  }
}
