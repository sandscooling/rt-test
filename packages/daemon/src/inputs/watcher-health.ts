import type { DaemonLog } from "../daemon/daemon-log.js";

/**
 * Whether the input watcher can be trusted to have reported every change, and the log's one line for each reason it
 * cannot, however many events repeat that reason while it stays unhealthy.
 */
export class WatcherHealth {
  readonly #log: DaemonLog;
  /** Each reason logged since the watcher was last healthy. */
  readonly #logged = new Set<string>();
  #failure: string | undefined;

  constructor(log: DaemonLog) {
    this.#log = log;
  }

  /** Why the watcher is unhealthy; undefined while it is healthy. */
  get failure(): string | undefined {
    return this.#failure;
  }

  fail(reason: string): void {
    this.#failure = reason;
    if (this.#logged.has(reason)) return;
    this.#logged.add(reason);
    this.#log.entry(`input watcher unhealthy: ${reason}`);
  }

  /**
   * Takes a reconciliation's end: `failures` are the watch failures since it began, and `established` says it read
   * every input. Only one that read them all with no watch failing makes the watcher healthy again.
   */
  settle(failures: readonly string[], established: boolean): void {
    const [failure] = failures;
    if (failure !== undefined) {
      this.#failure = failure;
    } else if (established) {
      this.#failure = undefined;
      this.#logged.clear();
    }
  }
}
