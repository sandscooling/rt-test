import type { InputDigests } from "./input-inventory.js";

/** Changed paths or reasons a job's verdict names before it counts the rest. */
export const MAX_NAMED_CHANGES = 20;
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
  /** Every cause that names no input: a lost input set, or an event no read vouches for. */
  readonly causes: ReadonlySet<string>;
  /** The committed digests when it began; undefined when its inputs could not be vouched for then. */
  readonly startDigests: InputDigests | undefined;
  /** The committed digests when it ended; undefined while it runs or when its inputs could not be vouched for then. */
  readonly endDigests: InputDigests | undefined;
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
  endDigests: InputDigests | undefined;
}

/** The change windows of the jobs running now; each learns every change and failure seen while it runs. */
export class JobWindows {
  /** By the view each job's mark holds. */
  readonly #open = new Map<JobWindow, ChangeWindow>();

  open(unsettled: string | undefined, digests?: InputDigests): JobMark {
    const window: ChangeWindow = {
      paths: new Set(),
      causes: new Set(),
      startDigests: digests,
      endDigests: undefined,
    };
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
  close(
    mark: JobMark,
    unavailable: string | undefined,
    digests?: InputDigests,
  ): JobVerdict {
    const open = this.#open.get(mark.window);
    if (open !== undefined) open.endDigests = digests;
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

/** A wait for the events accepted before it to be read. */
interface LedgerWait {
  readonly through: number;
  /** Whether a reconciliation running ends the wait, rather than holding it until the reconciliation ends. */
  readonly endsAtReconciliation: boolean;
  readonly resolve: () => void;
}

/**
 * Counts the events accepted and read, so a job ending waits only for the events seen before its end and for the
 * reads a reconciliation it waited out queued, never for a stream that keeps arriving after it.
 */
export class EventLedger {
  readonly #reconciling: () => boolean;
  #accepted = 0;
  #readThrough = 0;
  #waiters: LedgerWait[] = [];

  /**
   * `reconciling` says whether a reconciliation runs, which a wait for the read waits out and a wait for the read or a
   * reconciliation ends at.
   */
  constructor(reconciling: () => boolean) {
    this.#reconciling = reconciling;
  }

  get accepted(): number {
    return this.#accepted;
  }

  accept(count = 1): void {
    this.#accepted += count;
  }

  /**
   * Counts `count` reads a reconciliation queued. Every wait already placed waits for them too, since for a caller
   * holding out for the reconciliation, what the reconciliation left to read is part of it.
   */
  acceptHeld(count: number): void {
    if (count === 0) return;
    this.#accepted += count;
    this.#waiters = this.#waiters.map((wait) => ({
      ...wait,
      through: this.#accepted,
    }));
  }

  /** Records that every event accepted up to `through` has been read. */
  readUpTo(through: number): void {
    this.#readThrough = Math.max(this.#readThrough, through);
    this.notify();
  }

  /** Resolves once the events accepted by now, and the reads a reconciliation queues meanwhile, are read and none runs. */
  waitForRead(): Promise<void> {
    return this.#wait(false);
  }

  /** Resolves once the events accepted by now are read, or at once while a reconciliation runs or once one begins. */
  waitForReadOrReconciliation(): Promise<void> {
    return this.#wait(true);
  }

  /** Releases each wait that can end now; called after each read, and as a reconciliation begins and as one ends. */
  notify(): void {
    const waiting = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiting) {
      if (this.#canEnd(waiter)) waiter.resolve();
      else this.#waiters.push(waiter);
    }
  }

  #wait(endsAtReconciliation: boolean): Promise<void> {
    const through = this.#accepted;
    if (this.#canEnd({ through, endsAtReconciliation })) {
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.#waiters.push({ through, endsAtReconciliation, resolve }),
    );
  }

  #canEnd(wait: Omit<LedgerWait, "resolve">): boolean {
    if (wait.endsAtReconciliation && this.#reconciling()) return true;
    return this.#hasRead(wait.through);
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
