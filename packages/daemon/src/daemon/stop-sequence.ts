import type { DependencyBuilds } from "./dependency-builds.js";
import type { LifecycleParts } from "./lifecycle.js";
import type { Scheduler } from "./scheduler.js";

type StopParts = Pick<
  LifecycleParts,
  "log" | "executor" | "buildExecutor" | "store" | "closeEndpoint" | "inputs"
>;

/** The lifecycle's stop, run once: it halts the scheduler, the builds, the executor and the tracker, then closes. */
export class StopSequence {
  readonly #parts: StopParts;
  readonly #scheduler: Pick<Scheduler, "stop">;
  readonly #builds: Pick<DependencyBuilds, "stop">;
  /** The scheduler's run, which ends once the job in progress has. */
  readonly #sequence: Promise<void>;

  constructor(
    parts: StopParts,
    scheduler: Pick<Scheduler, "stop">,
    builds: Pick<DependencyBuilds, "stop">,
    sequence: Promise<void>,
  ) {
    this.#parts = parts;
    this.#scheduler = scheduler;
    this.#builds = builds;
    this.#sequence = sequence;
  }

  /**
   * A failed step skips none after it, and the store closes only once the job in progress and the builds have ended. A
   * step failing before the closings fails the stop once they have run.
   */
  async run(): Promise<void> {
    const { log, executor, buildExecutor, store, closeEndpoint, inputs } =
      this.#parts;
    log.entry("stop requested");
    const failures: unknown[] = [];
    void this.#halting(failures, () => this.#scheduler.stop());
    // Before the tracker: its stop resolves every wait of the builds' rounds at once, which would spin them.
    const buildsStopped = this.#halting(failures, () => this.#builds.stop());
    void this.#halting(failures, () => executor.abort());
    await this.#halting(failures, () => inputs.stop());
    await this.#sequence;
    await buildsStopped;
    await this.#closing("the executor", () => executor.close());
    await this.#closing("the dependency build executor", () =>
      buildExecutor.close(),
    );
    await this.#closing("the store", () => store.close());
    await this.#closing("the endpoint", closeEndpoint);
    if (failures.length > 0) {
      throw new AggregateError(failures, "a step before the closings failed");
    }
    log.entry("stopped");
  }

  /** Runs a step whether or not it throws at once, so a failure it gives cannot skip the steps after it. */
  async #halting(failures: unknown[], step: () => unknown): Promise<void> {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }

  /** Each closer runs whatever an earlier one did, so no release is skipped. */
  async #closing(
    what: string,
    close: () => Promise<void> | void,
  ): Promise<void> {
    try {
      await close();
    } catch (error) {
      this.#parts.log.error(`closing ${what}`, error);
    }
  }
}
