/** Changed paths or reasons a job's verdict names before it counts the rest. */
const MAX_NAMED_CHANGES = 20;
const LIST_SEPARATOR = ", ";

/** Taken when a job starts; its verdict is judged against it when the job ends. */
export interface JobMark {
  readonly window: ChangeWindow;
  /** Why the job's inputs cannot be vouched for from its start, when they cannot. */
  readonly unsettled?: string;
}

export type JobVerdict =
  | { readonly fingerprinted: true }
  | { readonly fingerprinted: false; readonly reason: string };

/** What made one running job's inputs uncertain. */
interface ChangeWindow {
  readonly named: string[];
  omitted: number;
}

/** The change windows of the jobs running now; each learns every change and failure seen while it runs. */
export class JobWindows {
  readonly #open = new Set<ChangeWindow>();

  open(unsettled: string | undefined): JobMark {
    const window: ChangeWindow = { named: [], omitted: 0 };
    this.#open.add(window);
    return unsettled === undefined ? { window } : { window, unsettled };
  }

  /** Records, for each job running, one thing that makes its inputs uncertain. */
  record(description: string): void {
    for (const window of this.#open) {
      if (window.named.includes(description)) continue;
      if (window.named.length < MAX_NAMED_CHANGES) {
        window.named.push(description);
      } else {
        window.omitted += 1;
      }
    }
  }

  /** `unavailable` says why no fingerprint can be computed at the job's end, when none can. */
  close(mark: JobMark, unavailable: string | undefined): JobVerdict {
    this.#open.delete(mark.window);
    if (mark.unsettled !== undefined) {
      return {
        fingerprinted: false,
        reason: `its inputs were unsettled when it started: ${mark.unsettled}`,
      };
    }
    const { named, omitted } = mark.window;
    if (named.length > 0) {
      return {
        fingerprinted: false,
        reason: `its inputs changed while it ran: ${named.join(LIST_SEPARATOR)}${omitted > 0 ? ` and ${omitted} more` : ""}`,
      };
    }
    return unavailable === undefined
      ? { fingerprinted: true }
      : { fingerprinted: false, reason: unavailable };
  }
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
