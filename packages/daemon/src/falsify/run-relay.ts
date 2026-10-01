import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";
import type { RunInterruption } from "../vitest/run-interruption.js";

/**
 * An instance's reporters are fixed at load, so this one forwards each run's events to that run's interruption, and
 * collects the modules Vitest queued during it.
 */
export class RunRelay implements Reporter {
  #current: RunInterruption | undefined;
  #queued: TestModule[] = [];

  start(interruption: RunInterruption): void {
    this.#current = interruption;
    this.#queued = [];
  }

  /** The modules queued since `start`; one queued after this joins no run's list. */
  end(): readonly TestModule[] {
    this.#current = undefined;
    const queued = this.#queued;
    this.#queued = [];
    return queued;
  }

  onTestModuleQueued(testModule: TestModule): void {
    this.#queued.push(testModule);
    this.#current?.onTestModuleQueued();
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly unknown[],
    reason: TestRunEndReason,
  ): void {
    this.#current?.onTestRunEnd(testModules, unhandledErrors, reason);
  }
}
