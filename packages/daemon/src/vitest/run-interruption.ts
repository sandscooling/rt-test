import type { Reporter, TestRunEndReason, Vitest } from "vitest/node";
import { errorText } from "./error-text.js";
import { FORCE_STOP_GRACE_MS } from "./force-stop.js";
import type { RunExecution } from "./run-states.js";

/** The reason Vitest's own CLI gives a user-initiated cancel; `test-failure` is its `bail`. */
const INTERRUPT_REASON: Parameters<Vitest["cancelCurrentRun"]>[0] =
  "keyboard-input";
const INTERRUPTED_END_REASON: TestRunEndReason = "interrupted";

/**
 * Vitest resets its cancel state as a run or collection starts and drops a cancel issued before that, so the first
 * cancel waits for the reset. A second cancel makes Vitest force-stop its workers and skip the project's teardown,
 * so it is issued only once the grace period since the abort has passed with the job still going.
 */
export class RunInterruption implements Reporter {
  readonly signal: AbortSignal;
  private instance: Vitest | undefined;
  private ready = false;
  private graceElapsed = false;
  private cancelled: Promise<string | undefined> | undefined;
  private forceCancelled: Promise<string | undefined> | undefined;
  private abortedDuringRun = false;
  private endReason: TestRunEndReason | undefined;

  constructor(signal: AbortSignal) {
    this.signal = signal;
  }

  /** Register this as one of the run's reporters: the reset is known done at the first `onTestModuleQueued`. */
  duringRun<T>(instance: Vitest, run: () => Promise<T>): Promise<T> {
    return this.during(instance, run);
  }

  /** `collectTests` reports no event, and its reset awaits only promises a fresh instance has never set, so it is done by the next macrotask. */
  duringCollect<T>(instance: Vitest, collect: () => Promise<T>): Promise<T> {
    return this.during(instance, () => {
      const collected = collect();
      setImmediate(() => this.markReady());
      return collected;
    });
  }

  onTestModuleQueued(): void {
    this.markReady();
  }

  onTestRunEnd(
    _testModules: unknown,
    _unhandledErrors: unknown,
    reason: TestRunEndReason,
  ): void {
    this.endReason = reason;
  }

  /**
   * Vitest ends a run it cancelled, for this signal or the consumer's `bail`, with reason `interrupted`. A run in
   * which Vitest never queued a module ends without the withheld cancel ever being issued.
   */
  execution(): RunExecution {
    const withheldAbort = this.abortedDuringRun && this.cancelled === undefined;
    return this.endReason === INTERRUPTED_END_REASON || withheldAbort
      ? "interrupted"
      : "completed";
  }

  /** Final once the job has ended: the force-stop is issued only while it runs. */
  forceStopped(): boolean {
    return this.forceCancelled !== undefined;
  }

  async cancelError(): Promise<string | undefined> {
    const errors = await Promise.all([this.cancelled, this.forceCancelled]);
    return errors.find((error) => error !== undefined);
  }

  private async during<T>(
    instance: Vitest,
    start: () => Promise<T>,
  ): Promise<T> {
    this.instance = instance;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (this.endReason === undefined) this.abortedDuringRun = true;
      graceTimer = setTimeout(() => {
        this.graceElapsed = true;
        this.forceStopIfDue();
      }, FORCE_STOP_GRACE_MS);
      if (this.ready) this.cancel();
    };
    this.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await start();
    } finally {
      this.signal.removeEventListener("abort", onAbort);
      clearTimeout(graceTimer);
      this.instance = undefined;
    }
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    if (!this.signal.aborted) return;
    this.cancel();
    this.forceStopIfDue();
  }

  /**
   * A withheld first cancel issued after the grace has passed is followed at once: the stop has already waited. Vitest
   * reports `onTestRunEnd` once its pool has finished, so after that no worker is left to force.
   */
  private forceStopIfDue(): void {
    if (!this.graceElapsed || this.cancelled === undefined) return;
    if (this.endReason !== undefined || this.forceCancelled !== undefined) {
      return;
    }
    if (this.instance === undefined) return;
    this.forceCancelled = issueCancel(this.instance);
  }

  private cancel(): void {
    if (this.instance === undefined || this.cancelled !== undefined) return;
    this.cancelled = issueCancel(this.instance);
  }
}

/** `cancelCurrentRun` waits for the run, so a reporter hook that awaited it would never return. */
function issueCancel(instance: Vitest): Promise<string | undefined> {
  return instance
    .cancelCurrentRun(INTERRUPT_REASON)
    .then(() => undefined, errorText);
}
