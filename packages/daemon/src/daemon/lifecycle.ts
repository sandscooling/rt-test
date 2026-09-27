import type {
  NoAnswer,
  PathStatusAnswer,
  SummaryAnswer,
} from "../query/answer.js";
import { pathStatusAnswer } from "../query/path-status.js";
import { summaryAnswer, type DaemonView } from "../query/summary.js";
import type { LatestResults, RtTestStore } from "../store/open-store.js";
import { NOT_FINGERPRINTED } from "../store/schema.js";
import type { StoreBindings, StoreScope } from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import type { DaemonLog } from "./daemon-log.js";
import type { Executor } from "./executor.js";
import type {
  DaemonActivity,
  DaemonIdentity,
  UnstoredJob,
} from "./protocol.js";
import type { DaemonHandlers } from "./server.js";

const DISCOVERY_STOPPED_REASON =
  "the stop arrived during the discovery, so it was not stored";
const UNCONFIRMED_RUN_REASON =
  "the discovery listed it, but the confirmed start does not, so it was not run";

export interface LifecycleParts {
  readonly identity: DaemonIdentity;
  readonly scope: StoreScope;
  readonly start: ConfirmedStart;
  readonly store: RtTestStore;
  readonly log: DaemonLog;
  readonly executor: Executor;
  /** Stops accepting connections and resolves once the endpoint is closed. */
  readonly closeEndpoint: () => Promise<void>;
}

/** Discovers once, runs each confirmed workspace once, then idles until a stop, answering status and queries throughout. */
export class DaemonLifecycle implements DaemonHandlers {
  readonly identity: DaemonIdentity;
  readonly #parts: LifecycleParts;
  readonly #bindings: StoreBindings;
  #activity: DaemonActivity = { state: "discovering" };
  readonly #unstored: UnstoredJob[] = [];
  #sequence: Promise<void> = Promise.resolve();
  #stopping: Promise<void> | undefined;
  readonly #whenStopped: Promise<void>;
  #markStopped: () => void = () => undefined;

  constructor(parts: LifecycleParts) {
    this.identity = parts.identity;
    this.#parts = parts;
    this.#whenStopped = new Promise((resolve) => {
      this.#markStopped = resolve;
    });
    this.#bindings = {
      ...parts.scope,
      inputFingerprint: { kind: NOT_FINGERPRINTED },
    };
  }

  begin(): void {
    this.#sequence = this.#startSequence()
      .catch((error: unknown) => {
        this.#parts.log.error("the start sequence failed", error);
      })
      .finally(() => {
        this.#activity = { state: "idle" };
      });
  }

  status(): {
    activity: DaemonActivity;
    stopping: boolean;
    unstoredJobs: readonly UnstoredJob[];
  } {
    return {
      activity: this.#activity,
      stopping: this.isStopping(),
      unstoredJobs: [...this.#unstored],
    };
  }

  summary(): SummaryAnswer | NoAnswer {
    return summaryAnswer(this.#latestResults(), this.#view());
  }

  pathStatus(path: string): PathStatusAnswer | NoAnswer {
    return pathStatusAnswer(path, this.#latestResults(), this.#view());
  }

  isStopping(): boolean {
    return this.#stopping !== undefined;
  }

  #latestResults(): LatestResults {
    return this.#parts.store.readLatestResults(this.#parts.scope);
  }

  #view(): DaemonView {
    const { activity, unstoredJobs } = this.status();
    return { consumerRoot: this.identity.consumerRoot, activity, unstoredJobs };
  }

  stop(): void {
    this.#stopping ??= this.#stopSequence().finally(() => this.#markStopped());
  }

  /** Resolves once a stop has run to its end. */
  stopped(): Promise<void> {
    return this.#whenStopped;
  }

  async #startSequence(): Promise<void> {
    const { log, executor, start } = this.#parts;
    log.entry("discovery started");
    const outcome = await executor.discover(start);
    if (!outcome.ended) {
      this.#nothingStored(undefined, outcome.reason);
      return;
    }
    if (this.isStopping()) {
      this.#nothingStored(undefined, DISCOVERY_STOPPED_REASON);
      return;
    }
    const discovery = outcome.value;
    this.#store("the discovery", undefined, () =>
      this.#parts.store.writeDiscovery(this.#bindings, discovery),
    );
    log.entry(`discovery ended: ${discoverySummary(discovery)}`);
    this.#logMissingConfirmed(discovery);
    for (const entry of discovery.workspaces) {
      if (this.isStopping()) break;
      if (entry.status === "not-confirmed") continue;
      await this.#run(entry.workspace);
    }
    if (!this.isStopping())
      log.entry("idle: every confirmed workspace has run");
  }

  async #run(workspace: VitestWorkspace): Promise<void> {
    const { log, executor, start } = this.#parts;
    const confirmed = confirmedEntry(start, workspace);
    if (confirmed === undefined) {
      this.#nothingStored(workspace.path, UNCONFIRMED_RUN_REASON);
      return;
    }
    this.#activity = { state: "running", workspacePath: workspace.path };
    log.entry(`run started: ${workspace.path}`);
    const outcome = await executor.run(workspace, confirmed.configFile);
    if (!outcome.ended) {
      this.#nothingStored(workspace.path, outcome.reason);
      return;
    }
    const run = outcome.value;
    if (run.status === "not-confirmed") {
      this.#nothingStored(workspace.path, run.reason);
      return;
    }
    const stored = this.#store(
      `the run of ${workspace.path}`,
      workspace.path,
      () => this.#parts.store.writeRun(this.#bindings, run),
    );
    if (stored) {
      log.entry(
        `run ended: ${workspace.path} ${run.status}${"execution" in run ? ` ${run.execution}` : ""}`,
      );
    }
  }

  /** Returns whether the record was stored; a failed write is logged and listed, and the sequence goes on. */
  #store(
    what: string,
    workspacePath: string | undefined,
    write: () => unknown,
  ): boolean {
    try {
      write();
      return true;
    } catch (error) {
      this.#parts.log.error(`storing ${what}`, error);
      this.#nothingStored(workspacePath, `the store write failed`);
      return false;
    }
  }

  #nothingStored(workspacePath: string | undefined, reason: string): void {
    this.#unstored.push(
      workspacePath === undefined ? { reason } : { workspacePath, reason },
    );
    this.#parts.log.entry(
      `${workspacePath === undefined ? "the discovery" : `the run of ${workspacePath}`} ended with nothing stored: ${reason}`,
    );
  }

  #logMissingConfirmed(discovery: TestDiscovery): void {
    const found = new Set(
      discovery.workspaces.map((entry) => entry.workspace.path),
    );
    for (const confirmed of this.#parts.start.workspaces) {
      if (!found.has(confirmed.path)) {
        this.#parts.log.entry(
          `the confirmed workspace ${confirmed.path} was not found, so nothing of it was loaded`,
        );
      }
    }
  }

  async #stopSequence(): Promise<void> {
    const { log, executor, store, closeEndpoint } = this.#parts;
    log.entry("stop requested");
    executor.abort();
    await this.#sequence;
    await executor.close();
    try {
      store.close();
    } catch (error) {
      log.error("closing the store", error);
    }
    try {
      await closeEndpoint();
    } catch (error) {
      log.error("closing the endpoint", error);
    }
    log.entry("stopped");
  }
}

function discoverySummary(discovery: TestDiscovery): string {
  return discovery.workspaces
    .map((entry) => `${entry.workspace.path} ${entry.status}`)
    .join(", ");
}
