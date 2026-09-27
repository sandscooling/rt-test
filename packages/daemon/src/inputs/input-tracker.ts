import type { WatchEventType } from "node:fs";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { DaemonLog } from "../daemon/daemon-log.js";
import {
  RECONCILIATION_COMPLETE,
  RECONCILIATION_INCOMPLETE,
  WATCHER_HEALTHY,
  WATCHER_UNHEALTHY,
  type InputFacts,
} from "../query/answer.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import { relativePosixPath } from "../vitest/find-workspaces.js";
import {
  discoveryFingerprint,
  SnapshotReads,
  testModuleChangedSince,
  workspaceFingerprint,
  type FingerprintResult,
} from "./fingerprint.js";
import { DeclaredNonInputs } from "./declared-non-inputs.js";
import { GitFiles } from "./git-files.js";
import {
  absoluteInputPath,
  InputFilter,
  liesInsideOnHost,
} from "./input-filter.js";
import {
  readEntryDigest,
  takeInventory,
  type InventoryResult,
  type InventoryScope,
} from "./input-inventory.js";
import {
  EventLedger,
  JobWindows,
  type JobMark,
  type JobVerdict,
} from "./input-jobs.js";
import { InputState } from "./input-state.js";
import { InputWatcher } from "./input-watcher.js";
import { discoveredTestModules, NON_INPUTS_FILE } from "./non-inputs.js";
import { ReconcileSchedule } from "./reconcile-schedule.js";

const IGNORE_FILE = ".gitignore";
const RENAME_EVENT = "rename";
const CHANGE_EVENT = "change";
const NON_INPUTS_CHANGED_REASON = `${NON_INPUTS_FILE}, which declares the non-inputs, changed`;
const FIRST_RECONCILIATION_REASON = "the first reconciliation has not ended";
const RECONCILING_REASON = "a reconciliation of the inputs is running";
const STOPPED_REASON = "the daemon is stopping";

export interface InputTrackerOptions {
  readonly consumerRoot: string;
  /** Absolute paths excluded with everything under them, such as the daemon's state directory and log file. */
  readonly exclusions: readonly string[];
  readonly log: DaemonLog;
}

/** What a query reads of the inputs, taken at one moment. */
export interface CurrentInputs {
  readonly facts: InputFacts;
  /** Why no fingerprint can be computed for any workspace; absent when each is computed on its own. */
  readonly unavailable?: string;
  /** Why every file stays an input, while `rt-test.json` cannot be used; absent otherwise. */
  readonly nonInputsUnusable?: string;
  workspaceFingerprint(entry: WorkspaceDiscovery): FingerprintResult;
  discoveryFingerprint(discovery: TestDiscovery): FingerprintResult;
  /** Why a listed test module no watch covers may have changed at or after `since`, a time in ms; undefined when none did. */
  testModuleChangedSince(
    discovery: TestDiscovery,
    since: number,
  ): string | undefined;
}

/** What the lifecycle needs of the tracker, so a stand-in can take its place. */
export interface TrackedInputs {
  start(): void;
  /** Resolves once the first reconciliation has ended, or the tracker has stopped. */
  firstReconciled(): Promise<void>;
  current(): CurrentInputs;
  beginJob(): JobMark;
  endJob(mark: JobMark): Promise<JobVerdict>;
  /**
   * Protects the test modules `discovery` lists from the declared patterns, in place of the last discovery's, and
   * resolves once every path whose declared state that change flips has been read.
   */
  protectTestModules(discovery: TestDiscovery | undefined): Promise<void>;
  /** Ends the timer, every watch and any git process, and releases every job waiting on the inputs. */
  stop(): Promise<void>;
}

/**
 * Tracks the consumer's inputs for one daemon life: reads them all in a reconciliation at start, on a watcher
 * failure, a git move, an ignore-rule change or a change to `rt-test.json`, and `RECONCILE_INTERVAL_MS` after the
 * last one ended; between reconciliations, re-reads only the paths events name. A declared non-input is never an input.
 */
export class InputTracker implements TrackedInputs {
  readonly #root: string;
  readonly #exclusions: readonly string[];
  readonly #log: DaemonLog;
  readonly #abort = new AbortController();
  readonly #state: InputState;
  readonly #watcher: InputWatcher;
  readonly #jobs = new JobWindows();
  readonly #ledger = new EventLedger(() => this.#reconciling);
  readonly #queue = new Map<string, WatchEventType>();
  /** Queued only because protection changed whether they count, so reading them marks no job; an event clears one. */
  readonly #quiet = new Set<string>();
  readonly #declared: DeclaredNonInputs;
  /** `rt-test.json` at the consumer root, which is never an input and whose change reconciles every one. */
  readonly #declarationFile: string;
  readonly #git: GitFiles;
  readonly #schedule = new ReconcileSchedule((reason) =>
    this.#requestReconciliation(reason),
  );
  #filter: InputFilter | undefined;
  #started = false;
  #reconciling = false;
  #reconcileRequested = false;
  #reconciliation: Promise<void> = Promise.resolve();
  #processing: Promise<void> | undefined;
  #inFlight = 0;
  #establishFailure: string | undefined;
  #watchFailure: string | undefined;
  #lastReconciledAt: string | undefined;
  #stopped = false;
  readonly #firstReconciled: Promise<void>;
  #markFirstReconciled: () => void = () => undefined;

  constructor({ consumerRoot, exclusions, log }: InputTrackerOptions) {
    this.#root = realpathSync.native(consumerRoot);
    this.#declarationFile = join(this.#root, NON_INPUTS_FILE);
    this.#exclusions = [...exclusions, this.#declarationFile];
    this.#log = log;
    this.#declared = new DeclaredNonInputs(this.#root, log);
    this.#state = new InputState(this.#root);
    this.#firstReconciled = new Promise((resolve) => {
      this.#markFirstReconciled = resolve;
    });
    this.#watcher = new InputWatcher(this.#root, {
      changed: (path, kind) => this.#changed(path, kind),
      gitChanged: (path) =>
        this.#requestReconciliation(
          `${path}, which can move HEAD or change what git ignores, changed`,
        ),
      failed: (reason) => this.#watchFailed(reason),
      cannotWatch: (reason) => this.#cannotWatch(reason),
    });
    this.#git = new GitFiles(this.#root, this.#watcher, log);
  }

  start(): void {
    if (this.#stopped || this.#started) return;
    this.#started = true;
    this.#requestReconciliation("the daemon started");
  }

  firstReconciled(): Promise<void> {
    return this.#firstReconciled;
  }

  facts(): InputFacts {
    const incomplete = this.#incompleteReason();
    return {
      revision: this.#state.revision,
      reconciliation:
        incomplete === undefined
          ? { state: RECONCILIATION_COMPLETE }
          : { state: RECONCILIATION_INCOMPLETE, reason: incomplete },
      ...(this.#lastReconciledAt === undefined
        ? {}
        : { lastReconciledAt: this.#lastReconciledAt }),
      watcher:
        this.#watchFailure === undefined
          ? { state: WATCHER_HEALTHY }
          : { state: WATCHER_UNHEALTHY, reason: this.#watchFailure },
      pendingChanges: this.#pending(),
      gitUnread: this.#git.unread,
    };
  }

  current(): CurrentInputs {
    const unavailable = this.#unavailableReason();
    const facts = this.facts();
    const unusable = this.#declared.unusable;
    const declaration =
      unusable === undefined ? {} : { nonInputsUnusable: unusable };
    if (unavailable !== undefined) {
      const none: FingerprintResult = { ok: false, reason: unavailable };
      return {
        facts,
        ...declaration,
        unavailable,
        workspaceFingerprint: () => none,
        discoveryFingerprint: () => none,
        testModuleChangedSince: () => unavailable,
      };
    }
    const project = this.#state.project();
    const reads = new SnapshotReads(project.root);
    return {
      facts,
      ...declaration,
      workspaceFingerprint: (entry) =>
        workspaceFingerprint(project, entry, reads),
      discoveryFingerprint: (discovery) =>
        discoveryFingerprint(project, discovery, reads),
      testModuleChangedSince: (discovery, since) =>
        testModuleChangedSince(project, discovery, since),
    };
  }

  beginJob(): JobMark {
    return this.#jobs.open(this.#unavailableReason());
  }

  /** Judges the job once every event seen before its end has been read and any reconciliation running has ended. */
  async endJob(mark: JobMark): Promise<JobVerdict> {
    if (!this.#stopped) await this.#ledger.waitForRead();
    return this.#jobs.close(mark, this.#unavailableReason());
  }

  /** Reads only the paths whose declared state the change flips, after any reconciliation running has ended. */
  async protectTestModules(
    discovery: TestDiscovery | undefined,
  ): Promise<void> {
    const flipped = this.#declared.protect(
      discovery === undefined ? [] : discoveredTestModules(discovery),
    );
    if (flipped.length === 0 || !this.#started || this.#stopped) return;
    for (const path of flipped) {
      const absolute = absoluteInputPath(this.#root, path);
      if (!this.#queue.has(absolute)) {
        this.#quiet.add(absolute);
        this.#queue.set(absolute, CHANGE_EVENT);
      }
      this.#ledger.accept();
    }
    this.#processQueue();
    await this.#ledger.waitForRead();
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#schedule.clear();
    this.#abort.abort();
    this.#watcher.close();
    this.#ledger.releaseAll();
    this.#markFirstReconciled();
    await Promise.allSettled([this.#reconciliation, this.#processing]);
  }

  #changed(path: string, kind: WatchEventType): void {
    if (this.#stopped) return;
    if (liesInsideOnHost(this.#declarationFile, path)) {
      this.#requestReconciliation(NON_INPUTS_CHANGED_REASON);
      return;
    }
    if (this.#filter?.excludes(path) === true) return;
    if (basename(path) === IGNORE_FILE) {
      this.#requestReconciliation(
        `the ignore rules in ${this.#label(path)} changed`,
      );
    }
    const knownDirectory = this.#state.hasDirectory(path);
    if (this.#declared.namesFile(this.#label(path), path, knownDirectory)) {
      return;
    }
    this.#quiet.delete(path);
    if (this.#queue.get(path) !== RENAME_EVENT) this.#queue.set(path, kind);
    this.#ledger.accept();
    this.#processQueue();
  }

  #watchFailed(reason: string): void {
    this.#markUnhealthy(reason);
    this.#requestReconciliation(reason);
  }

  /** A reconciliation reopening the same watch would fail the same way, so one running asks for no other. */
  #cannotWatch(reason: string): void {
    this.#markUnhealthy(reason);
    if (!this.#reconciling) this.#requestReconciliation(reason);
  }

  #markUnhealthy(reason: string): void {
    this.#watchFailure = reason;
    this.#log.entry(`input watcher unhealthy: ${reason}`);
    this.#jobs.record(reason);
  }

  #requestReconciliation(reason: string): void {
    if (this.#stopped) return;
    this.#reconcileRequested = true;
    if (this.#reconciling) return;
    this.#reconciling = true;
    this.#log.entry(`input reconciliation started: ${reason}`);
    this.#reconciliation = this.#reconcileWhileRequested();
  }

  /** A request arriving during a reconciliation starts another once it ends; only the last one's end completes. */
  async #reconcileWhileRequested(): Promise<void> {
    await this.#processing;
    while (this.#reconcileRequested && !this.#stopped) {
      this.#reconcileRequested = false;
      try {
        await this.#reconcileOnce();
      } catch (error) {
        if (this.#stopped) break;
        this.#inputSetLost(`the reconciliation failed: ${errorText(error)}`);
        this.#lastReconciledAt = new Date().toISOString();
      }
      this.#declared.report();
    }
    this.#reconciling = false;
    if (this.#stopped) return;
    this.#markFirstReconciled();
    this.#schedule.periodic();
    this.#processQueue();
    this.#ledger.notify();
  }

  #retryLostInputSet(): void {
    if (this.#reconciling || this.#establishFailure === undefined) return;
    this.#schedule.retryLostInputSet(this.#lastReconciledAt);
  }

  async #reconcileOnce(): Promise<void> {
    const signal = this.#abort.signal;
    this.#watcher.clearFailures();
    await this.#git.watch(this.#filter?.nestedRepositories ?? [], signal);
    this.#declared.read();
    const filter = await InputFilter.open(
      this.#root,
      this.#exclusions,
      this.#declared.match,
      signal,
    );
    const inventory = await takeInventory(this.#scope(filter), this.#root);
    await this.#git.follow(filter.nestedRepositories, signal);
    this.#filter = filter;
    this.#git.report(filter);
    this.#settleReconciliation(inventory);
  }

  #settleReconciliation(inventory: InventoryResult): void {
    if (inventory.ok) {
      this.#watcher.keepDirectories(new Set(inventory.directories));
      const changed = this.#state.establish(
        inventory.inputs,
        inventory.directories,
      );
      this.#state.commit();
      for (const path of changed) this.#jobs.record(path);
      this.#establishFailure = undefined;
      this.#log.entry(
        `input reconciliation ended: ${inventory.inputs.size} inputs, ${changed.length} changed, revision ${this.#state.revision}`,
      );
    } else {
      this.#inputSetLost(inventory.reason);
    }
    const failures = this.#watcher.failures;
    this.#watchFailure = failures.length === 0 ? undefined : failures[0];
    this.#lastReconciledAt = new Date().toISOString();
  }

  #scope(filter: InputFilter): InventoryScope {
    return {
      root: this.#root,
      filter,
      signal: this.#abort.signal,
      beforeListing: (directory) => this.#watcher.watchDirectory(directory),
    };
  }

  /** Reads queued paths in batches, never while a reconciliation runs, whose end applies them after its own read. */
  #processQueue(): void {
    if (this.#queue.size === 0 || this.#processing !== undefined) return;
    if (this.#reconciling || this.#stopped) return;
    this.#processing = this.#drainQueue().finally(() => {
      this.#processing = undefined;
      this.#inFlight = 0;
      this.#processQueue();
    });
  }

  async #drainQueue(): Promise<void> {
    while (this.#queue.size > 0 && !this.#reconciling && !this.#stopped) {
      const batch = [...this.#queue];
      const through = this.#ledger.accepted;
      this.#queue.clear();
      this.#inFlight = batch.length;
      try {
        await this.#readBatch(batch);
      } catch (error) {
        this.#readFailed(error);
      }
      this.#state.commit();
      this.#inFlight = 0;
      this.#ledger.readUpTo(through);
    }
  }

  #readFailed(error: unknown): void {
    if (this.#stopped) return;
    this.#log.error("reading changed inputs", error);
    this.#inputSetLost(`reading changed inputs failed: ${errorText(error)}`);
  }

  async #readBatch(batch: readonly [string, WatchEventType][]): Promise<void> {
    const filter = this.#filter;
    if (filter === undefined || !this.#state.established) {
      for (const [path] of batch) this.#jobs.record(this.#label(path));
      this.#retryLostInputSet();
      return;
    }
    const unknown = batch
      .map(([path]) => path)
      .filter((path) => !this.#isKnown(path) && filter.needsCheck(path));
    if (unknown.length > 0) {
      await filter.check(unknown, this.#abort.signal);
      this.#git.report(filter);
    }
    for (const [path, kind] of batch) {
      if (filter.excludes(path)) continue;
      await this.#readPath(filter, path, kind);
    }
  }

  async #readPath(
    filter: InputFilter,
    path: string,
    kind: WatchEventType,
  ): Promise<void> {
    const relative = relativePosixPath(this.#root, path);
    const record = this.#quiet.delete(path)
      ? () => undefined
      : (changed: readonly string[]) => this.#recordAll(changed);
    const entry = await readEntryDigest(path, this.#abort.signal);
    switch (entry.kind) {
      case "absent": {
        const wasDirectory = this.#state.hasDirectory(path);
        record(this.#state.remove(relative, path));
        if (wasDirectory) this.#watcher.dropDirectory(path);
        return;
      }
      case "input":
        this.#readFile(filter, path, entry.digest, record);
        return;
      case "directory":
        if (this.#state.hasDirectory(path) && kind !== RENAME_EVENT) return;
        await this.#readDirectory(filter, path, relative);
        return;
      case "unreadable":
        this.#inputSetLost(`${relative} cannot be read: ${entry.reason}`);
        return;
    }
  }

  /** A file that replaced a directory drops what the directory held; a declared file is not an input. */
  #readFile(
    filter: InputFilter,
    path: string,
    digest: string,
    record: (changed: readonly string[]) => void,
  ): void {
    const relative = relativePosixPath(this.#root, path);
    if (this.#state.hasDirectory(path)) {
      this.#recordAll(this.#state.remove(relative, path));
      this.#watcher.dropDirectory(path);
    }
    if (filter.declares(path) !== undefined) {
      record(this.#state.remove(relative, path));
      return;
    }
    this.#state.set(relative, digest);
    record([relative]);
  }

  /**
   * A directory that appeared, or was replaced by a rename, is walked whole with fresh watches, since a watch left
   * on a replaced directory reports nothing, and each path in it is asked about as a new one.
   */
  async #readDirectory(
    filter: InputFilter,
    path: string,
    relative: string,
  ): Promise<void> {
    filter.distrust(path);
    this.#watcher.dropDirectory(path);
    const walked = await takeInventory(this.#scope(filter), path);
    if (!walked.ok) {
      this.#inputSetLost(walked.reason);
      return;
    }
    for (const ignored of walked.ignoredDirectories) {
      this.#watcher.dropDirectory(ignored);
    }
    this.#recordAll(
      this.#state.replaceUnder(
        relative,
        path,
        walked.inputs,
        walked.directories,
      ),
    );
  }

  /** An input set that cannot be established leaves every result unknown until a reconciliation reads it whole. */
  #inputSetLost(reason: string): void {
    this.#state.lose();
    this.#establishFailure = reason;
    this.#jobs.record(reason);
    this.#log.entry(
      `warning: the input set could not be established: ${reason}`,
    );
    if (!this.#reconciling) this.#requestReconciliation(reason);
  }

  #isKnown(path: string): boolean {
    return (
      this.#state.hasDirectory(path) ||
      this.#state.hasInput(relativePosixPath(this.#root, path))
    );
  }

  #recordAll(descriptions: readonly string[]): void {
    for (const description of descriptions) this.#jobs.record(description);
  }

  #pending(): number {
    return this.#queue.size + this.#inFlight;
  }

  /** Why no current fingerprint can be computed now; undefined when one can. */
  #unavailableReason(): string | undefined {
    const incomplete = this.#incompleteReason();
    if (incomplete !== undefined) return incomplete;
    if (this.#watchFailure !== undefined) {
      return `the input watcher is unhealthy: ${this.#watchFailure}`;
    }
    const pending = this.#pending();
    if (pending > 0) return `${pending} changed paths have not been read yet`;
    return undefined;
  }

  #incompleteReason(): string | undefined {
    if (this.#stopped) return STOPPED_REASON;
    if (this.#lastReconciledAt === undefined) {
      return FIRST_RECONCILIATION_REASON;
    }
    if (this.#reconciling) return RECONCILING_REASON;
    if (this.#establishFailure !== undefined) {
      return `the input set could not be established: ${this.#establishFailure}`;
    }
    return undefined;
  }

  #label(path: string): string {
    return relativePosixPath(this.#root, path);
  }
}
