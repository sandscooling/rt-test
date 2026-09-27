import type { FingerprintResult } from "../inputs/fingerprint.js";
import type { JobVerdict } from "../inputs/input-jobs.js";
import type { TrackedInputs } from "../inputs/input-tracker.js";
import type {
  NoAnswer,
  PathStatusAnswer,
  SummaryAnswer,
} from "../query/answer.js";
import { pathStatusAnswer } from "../query/path-status.js";
import { summaryAnswer, type DaemonView } from "../query/summary.js";
import type { LatestResults, RtTestStore } from "../store/open-store.js";
import { FINGERPRINT_DIGEST, NOT_FINGERPRINTED } from "../store/schema.js";
import type { StoreBindings, StoreScope } from "../store/stored-records.js";
import {
  confirmedEntry,
  type ConfirmedStart,
} from "../vitest/confirmed-start.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
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
const MOVED_DURING_RUN_REASON =
  "its workspace's input fingerprint at its end differs from the one at its start";

export interface LifecycleParts {
  readonly identity: DaemonIdentity;
  readonly scope: StoreScope;
  readonly start: ConfirmedStart;
  readonly store: RtTestStore;
  readonly log: DaemonLog;
  readonly executor: Executor;
  /** Started with the start sequence and stopped before the store closes. */
  readonly inputs: TrackedInputs;
  /** Stops accepting connections and resolves once the endpoint is closed. */
  readonly closeEndpoint: () => Promise<void>;
}

/**
 * Once the first reconciliation of the inputs has ended, discovers once, runs each confirmed workspace once, then
 * idles until a stop, answering status and queries throughout. Each job is stored under the input fingerprint it
 * started from, or not fingerprinted when its inputs moved while it ran.
 */
export class DaemonLifecycle implements DaemonHandlers {
  readonly identity: DaemonIdentity;
  readonly #parts: LifecycleParts;
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
  }

  begin(): void {
    this.#protectStoredTestModules();
    this.#parts.inputs.start();
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
    return summaryAnswer(
      this.#latestResults(),
      this.#view(),
      this.#parts.inputs.current(),
    );
  }

  pathStatus(path: string): PathStatusAnswer | NoAnswer {
    return pathStatusAnswer(
      path,
      this.#latestResults(),
      this.#view(),
      this.#parts.inputs.current(),
    );
  }

  isStopping(): boolean {
    return this.#stopping !== undefined;
  }

  /** The first reconciliation leaves out no test module the store's latest discovery, from an earlier life, lists. */
  #protectStoredTestModules(): void {
    const { inputs, log } = this.#parts;
    let stored: TestDiscovery | undefined;
    try {
      stored = this.#latestResults().discovery?.discovery;
    } catch (error) {
      log.error("reading the latest stored discovery's test modules", error);
      return;
    }
    inputs.protectTestModules(stored).catch((error: unknown) => {
      log.error("protecting the stored discovery's test modules", error);
    });
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
    const { log, executor, start, inputs } = this.#parts;
    await inputs.firstReconciled();
    if (this.isStopping()) return;
    log.entry("discovery started");
    const mark = inputs.beginJob();
    const startedAt = Date.now();
    const outcome = await executor.discover(start);
    const verdict = await inputs.endJob(mark);
    if (!outcome.ended) {
      this.#nothingStored(undefined, outcome.reason);
      return;
    }
    const discovery = outcome.value;
    const held = await this.#protectDiscovered(discovery, verdict, startedAt);
    if (this.isStopping()) {
      this.#nothingStored(undefined, DISCOVERY_STOPPED_REASON);
      return;
    }
    const bindings = this.#bindings("the discovery", held, () =>
      inputs.current().discoveryFingerprint(discovery),
    );
    this.#store("the discovery", undefined, () =>
      this.#parts.store.writeDiscovery(bindings, discovery),
    );
    log.entry(`discovery ended: ${discoverySummary(discovery)}`);
    this.#logMissingConfirmed(discovery);
    for (const entry of discovery.workspaces) {
      if (this.isStopping()) break;
      if (entry.status === "not-confirmed") continue;
      await this.#run(entry);
    }
    if (!this.isStopping())
      log.entry("idle: every confirmed workspace has run");
  }

  /**
   * Protects the discovery's test modules before its fingerprint is taken, so the stored digest counts them as every
   * later answer does. A module a pattern covered had no watch through the job, so its time is read before
   * protection moves it into the inputs; an input event during protection fails the fingerprint, and protection's own
   * reads do not.
   */
  async #protectDiscovered(
    discovery: TestDiscovery,
    verdict: JobVerdict,
    startedAt: number,
  ): Promise<JobVerdict> {
    const { inputs } = this.#parts;
    const unwatched = inputs
      .current()
      .testModuleChangedSince(discovery, startedAt);
    const guard = inputs.beginJob();
    await inputs.protectTestModules(discovery);
    const guarded = await inputs.endJob(guard);
    if (!verdict.fingerprinted) return verdict;
    if (unwatched !== undefined)
      return { fingerprinted: false, reason: unwatched };
    return guarded;
  }

  async #run(entry: WorkspaceDiscovery): Promise<void> {
    const { log, executor, start, inputs } = this.#parts;
    const { workspace } = entry;
    const confirmed = confirmedEntry(start, workspace);
    if (confirmed === undefined) {
      this.#nothingStored(workspace.path, UNCONFIRMED_RUN_REASON);
      return;
    }
    this.#activity = { state: "running", workspacePath: workspace.path };
    log.entry(`run started: ${workspace.path}`);
    const mark = inputs.beginJob();
    const started = inputs.current().workspaceFingerprint(entry);
    const outcome = await executor.run(workspace, confirmed.configFile);
    const verdict = await inputs.endJob(mark);
    if (!outcome.ended) {
      this.#nothingStored(workspace.path, outcome.reason);
      return;
    }
    const run = outcome.value;
    if (run.status === "not-confirmed") {
      this.#nothingStored(workspace.path, run.reason);
      return;
    }
    const bindings = this.#bindings(
      `the run of ${workspace.path}`,
      verdict,
      () => unmoved(started, inputs.current().workspaceFingerprint(entry)),
    );
    const stored = this.#store(
      `the run of ${workspace.path}`,
      workspace.path,
      () => this.#parts.store.writeRun(bindings, run),
    );
    if (stored) {
      log.entry(
        `run ended: ${workspace.path} ${run.status}${"execution" in run ? ` ${run.execution}` : ""}`,
      );
    }
  }

  /** The job's record is bound to its fingerprint only when its inputs held still from its start to its end. */
  #bindings(
    job: string,
    verdict: JobVerdict,
    fingerprint: () => FingerprintResult,
  ): StoreBindings {
    const { scope, log } = this.#parts;
    const print: FingerprintResult = verdict.fingerprinted
      ? fingerprint()
      : { ok: false, reason: verdict.reason };
    if (print.ok) {
      return {
        ...scope,
        inputFingerprint: { kind: FINGERPRINT_DIGEST, digest: print.digest },
      };
    }
    log.entry(`${job} is stored not fingerprinted: ${print.reason}`);
    return { ...scope, inputFingerprint: { kind: NOT_FINGERPRINTED } };
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
    const { log, executor, store, closeEndpoint, inputs } = this.#parts;
    log.entry("stop requested");
    executor.abort();
    await inputs.stop();
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

/** A run's fingerprint at its start, when its workspace's fingerprint at its end is the same one. */
function unmoved(
  started: FingerprintResult,
  ended: FingerprintResult,
): FingerprintResult {
  if (!started.ok) return started;
  if (!ended.ok) return ended;
  return started.digest === ended.digest
    ? started
    : { ok: false, reason: MOVED_DURING_RUN_REASON };
}

function discoverySummary(discovery: TestDiscovery): string {
  return discovery.workspaces
    .map((entry) => `${entry.workspace.path} ${entry.status}`)
    .join(", ");
}
