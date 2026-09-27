/** How long after a reconciliation ends the next one runs, the longest an input change no event reported goes unseen. */
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
/** The soonest after a reconciliation that could not establish the input set that an event starts the next one. */
const LOST_INPUT_SET_RETRY_MS = 10 * 1000;
const LOST_INPUT_SET_RETRY_REASON =
  "an input event arrived while the input set could not be established";
const PERIODIC_REASON = "the periodic reconciliation";

/** When the next reconciliation runs, each timed from the end of the last one. */
export class ReconcileSchedule {
  readonly #request: (reason: string) => void;
  #timer: NodeJS.Timeout | undefined;
  /** Whether an event has already brought the next reconciliation forward since the last one ended. */
  #retryArmed = false;

  constructor(request: (reason: string) => void) {
    this.#request = request;
  }

  /** Timed from the end of the last reconciliation, so one that outlasts the interval never runs back to back. */
  periodic(): void {
    this.#retryArmed = false;
    this.#arm(RECONCILE_INTERVAL_MS, PERIODIC_REASON);
  }

  /**
   * An event while the input set cannot be established may report its cause fixed, so it brings the next
   * reconciliation forward to `LOST_INPUT_SET_RETRY_MS` after `lastEndedAt`, the ISO time the last one ended.
   */
  retryLostInputSet(lastEndedAt: string | undefined): void {
    if (this.#retryArmed) return;
    this.#retryArmed = true;
    const endedAt = Date.parse(lastEndedAt ?? "") || 0;
    this.#arm(
      Math.max(0, endedAt + LOST_INPUT_SET_RETRY_MS - Date.now()),
      LOST_INPUT_SET_RETRY_REASON,
    );
  }

  clear(): void {
    clearTimeout(this.#timer);
  }

  #arm(delayMs: number, reason: string): void {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#request(reason), delayMs);
    this.#timer.unref();
  }
}
