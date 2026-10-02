import type { WatchEventType } from "node:fs";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { DaemonLog } from "../daemon/daemon-log.js";
import type { InputFacts } from "../query/answer.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import { errorText } from "../vitest/error-text.js";
import { relativePosixPath } from "../vitest/find-workspaces.js";
import {
  currentInputs,
  inputFacts,
  unavailableReason,
  type CurrentInputs,
  type TrackerCondition,
} from "./current-inputs.js";
import { DeclaredNonInputs } from "./declared-non-inputs.js";
import type { StartEnvironment } from "./environment-digest.js";
import { GitFiles } from "./git-files.js";
import {
  absoluteInputPath,
  InputFilter,
  liesInsideOnHost,
} from "./input-filter.js";
import {
  takeInventory,
  type InventoryResult,
  type InventoryScope,
} from "./input-inventory.js";
import {
  EventLedger,
  JobWindows,
  namedList,
  type JobMark,
  type JobVerdict,
} from "./input-jobs.js";
import { InputState } from "./input-state.js";
import { InputWatcher } from "./input-watcher.js";
import { ListedFiles, type ListedReads } from "./listed-files.js";
import type { QueryNarrowing } from "./narrowed-inputs.js";
import { NON_INPUTS_FILE, type NonInputsDeclaration } from "./non-inputs.js";
import { protection } from "./protection.js";
import { keepReleasedFiles } from "./protection-walk.js";
import { pendingCount, QueuedReads, type UnreadPath } from "./queued-reads.js";
import {
  RECONCILE_INTERVAL_MS,
  ReconcileSchedule,
} from "./reconcile-schedule.js";
import { WatcherHealth } from "./watcher-health.js";

const IGNORE_FILE = ".gitignore";
const NON_INPUTS_CHANGED_REASON = `${NON_INPUTS_FILE}, which declares the non-inputs, changed`;
const LISTED_UNWATCHED_CONSEQUENCE =
  "so a change to a listed file there is seen at the next reconciliation";

export interface InputTrackerOptions {
  readonly consumerRoot: string;
  /** Absolute paths excluded with everything under them, such as the daemon's state directory and log file. */
  readonly exclusions: readonly string[];
  readonly log: DaemonLog;
  /** The daemon's environment as it began serving, which the digest counts. */
  readonly startEnvironment: StartEnvironment;
}

export type { CurrentInputs } from "./current-inputs.js";

/** What the lifecycle needs of the tracker, so a stand-in can take its place. */
export interface TrackedInputs {
  start(): void;
  /** Resolves once the first reconciliation has ended, or the tracker has stopped. */
  firstReconciled(): Promise<void>;
  /**
   * With a narrowing, each workspace's inputs are those the dependency builds' state gives it at this moment's
   * revision; without one, every input of the project.
   */
  current(narrowing?: QueryNarrowing): CurrentInputs;
  /**
   * Resolves at the next change a caller waiting to use the inputs can observe: the revision moving, a reconciliation
   * ending or the pending reads draining; at once when the tracker has stopped.
   */
  changed(): Promise<void>;
  /**
   * How many reconciliations have counted as periodic in this daemon's life: each that ended at least
   * `RECONCILE_INTERVAL_MS` after the last one counted, whatever asked for it, the first one starting the measure.
   */
  periodicReconciliations(): number;
  /** The declaration in effect, which decides with the protection in effect which files are inputs. */
  nonInputsDeclaration(): NonInputsDeclaration;
  /**
   * Resolves once every event seen before the call has been read and no reconciliation runs, or at once when the
   * tracker has stopped. Events arriving after the call do not hold it, except that a reconciliation it waits out
   * may queue reads, and it then waits for those and for the events seen before them.
   */
  settled(): Promise<void>;
  /**
   * Reads each root-relative path, a folder as each input held under it, changing only what the read finds changed,
   * and resolves once those reads and every event seen before the call are read, or at once while a reconciliation runs
   * or once one begins, or when the tracker has stopped. Reads nothing while a reconciliation runs or before an input
   * set is established, and never `rt-test.json`; its reads count as no pending change, ask for no reconciliation, and
   * drop a held input they cannot read as one rather than the input set, which a failed git check of a new path still
   * loses, as for an event. Resolves with each path whose read found an entry it could not read.
   */
  readNamed(paths: readonly string[]): Promise<readonly UnreadPath[]>;
  /**
   * Each of the root-relative paths whose latest read found an entry it could not read. A named read a reconciliation
   * holds has not run when `readNamed` resolves, so a caller that must know what it read asks here once `settled()` has.
   */
  unreadNamed(paths: readonly string[]): readonly UnreadPath[];
  beginJob(): JobMark;
  endJob(mark: JobMark): Promise<JobVerdict>;
  /**
   * Protects from the declared patterns what `discovery` lists and its projects' test file patterns find, in place of
   * the last discovery's, and resolves once every path whose declared state that change flips, and every file it newly
   * lists that the inputs leave out, has been read, marking no job; a change in the files listed moves the revision.
   * Resolves with why a file only a walk found may have changed at or after `jobStart`, a time in ms; undefined when
   * none may.
   */
  protectInputs(
    discovery: TestDiscovery | undefined,
    jobStart?: number,
  ): Promise<string | undefined>;
  /** Ends the timer, every watch and any git process, and releases every job waiting on the inputs. */
  stop(): Promise<void>;
}

/**
 * Tracks the consumer's inputs for one daemon life: reads them all in a reconciliation at start, on a watcher
 * failure, a git move, an ignore-rule change or a change to `rt-test.json`, and `RECONCILE_INTERVAL_MS` after the
 * last one ended; between reconciliations, re-reads only the paths events name and those a reconciliation read with
 * their content unchanged but their size or a time moved. A declared non-input is never an input,
 * and no declared pattern applies until the lifecycle gives a discovery that reports what the patterns may not remove.
 */
export class InputTracker implements TrackedInputs {
  readonly #root: string;
  readonly #exclusions: readonly string[];
  readonly #log: DaemonLog;
  readonly #abort = new AbortController();
  readonly #state: InputState;
  readonly #watcher: InputWatcher;
  readonly #jobs = new JobWindows();
  readonly #listed: ListedFiles;
  readonly #ledger = new EventLedger(() => this.#reconciling);
  readonly #declared: DeclaredNonInputs;
  /** `rt-test.json` at the consumer root, which is never an input and whose change reconciles every one. */
  readonly #declarationFile: string;
  readonly #git: GitFiles;
  readonly #reads: QueuedReads;
  #changeWaiters: (() => void)[] = [];
  readonly #schedule = new ReconcileSchedule((reason) =>
    this.#requestReconciliation(reason),
  );
  #filter: InputFilter | undefined;
  #started = false;
  #reconciling = false;
  #reconcileRequested = false;
  #periodicEnded = 0;
  /** When, by `performance.now()`, the last reconciliation counted as periodic ended; the first one's end starts it. */
  #periodicMeasuredFrom: number | undefined;
  #reconciliation: Promise<void> = Promise.resolve();
  #processing: Promise<void> | undefined;
  #inFlight = 0;
  #protecting = 0;
  #establishFailure: string | undefined;
  readonly #health: WatcherHealth;
  #lastReconciledAt: string | undefined;
  #stopped = false;
  readonly #firstReconciled: Promise<void>;
  #markFirstReconciled: () => void = () => undefined;

  constructor({
    consumerRoot,
    exclusions,
    log,
    startEnvironment,
  }: InputTrackerOptions) {
    this.#root = realpathSync.native(consumerRoot);
    this.#declarationFile = join(this.#root, NON_INPUTS_FILE);
    this.#exclusions = exclusions;
    this.#log = log;
    this.#health = new WatcherHealth(log);
    this.#declared = new DeclaredNonInputs(this.#root, log, startEnvironment);
    this.#state = new InputState(this.#root);
    this.#listed = new ListedFiles(this.#root);
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
      cannotWatchListed: (reason) =>
        log.entry(`warning: ${reason}, ${LISTED_UNWATCHED_CONSEQUENCE}`),
    });
    this.#git = new GitFiles(this.#root, this.#watcher, log);
    this.#reads = new QueuedReads({
      root: this.#root,
      state: this.#state,
      watcher: this.#watcher,
      git: this.#git,
      jobs: this.#jobs,
      listed: this.#listed,
      signal: this.#abort.signal,
      scope: (filter) => this.#scope(filter),
      inputSetLost: (reason) => this.#inputSetLost(reason),
      retryLostInputSet: () => this.#retryLostInputSet(),
    });
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
    return inputFacts(
      this.#condition(),
      this.#state.revision,
      this.#git.unread,
    );
  }

  current(narrowing?: QueryNarrowing): CurrentInputs {
    return currentInputs({
      unavailable: unavailableReason(this.#condition()),
      facts: this.facts(),
      nonInputsUnusable: this.#declared.unusable,
      environment: this.#declared.environment,
      narrowing,
      project: () => this.#state.project(),
    });
  }

  changed(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    return new Promise((resolve) => this.#changeWaiters.push(resolve));
  }

  periodicReconciliations(): number {
    return this.#periodicEnded;
  }

  nonInputsDeclaration(): NonInputsDeclaration {
    return this.#declared.declaration;
  }

  settled(): Promise<void> {
    return this.#stopped ? Promise.resolve() : this.#ledger.waitForRead();
  }

  /** An ignore file named is read as the input it is; its rules apply at its event or the next reconciliation. */
  async readNamed(paths: readonly string[]): Promise<readonly UnreadPath[]> {
    if (this.#stopped) return [];
    let named: string[] = [];
    if (!this.#reconciling && this.#state.established) {
      named = paths
        .flatMap((path) => this.#reads.namedPaths(path))
        .filter((path) => !liesInsideOnHost(this.#declarationFile, path));
      this.#ledger.accept(this.#reads.enqueueNamed(named));
      this.#processQueue();
    }
    await this.#ledger.waitForReadOrReconciliation();
    return this.#reads.unreadNamed(named);
  }

  unreadNamed(paths: readonly string[]): readonly UnreadPath[] {
    return this.#reads.unreadNamed(
      paths.flatMap((path) => this.#reads.namedPaths(path)),
    );
  }

  /** Each edge of a job reads the digests a round's view compares, only while the view can vouch for them. */
  beginJob(): JobMark {
    const view = this.current();
    return this.#jobs.open(view.unavailable, view.snapshot?.comparedDigests);
  }

  /**
   * Judges the job once every event seen before its end has been read and any reconciliation running has ended, with
   * the reads that reconciliation queued.
   */
  async endJob(mark: JobMark): Promise<JobVerdict> {
    await this.settled();
    const view = this.current();
    return this.#jobs.close(
      mark,
      view.unavailable,
      view.snapshot?.comparedDigests,
    );
  }

  /**
   * Reads the paths whose declared state the change flips, once any reconciliation running has ended, and walks for
   * the files a pattern no longer hides when the patterns changed or stopped applying. The walk starts at once.
   */
  async protectInputs(
    discovery: TestDiscovery | undefined,
    jobStart?: number,
  ): Promise<string | undefined> {
    const change = this.#declared.protect(
      protection(discovery, this.#root),
      this.#state.project().digests.keys(),
    );
    const added = this.#listed.list(discovery);
    if (!this.#started || this.#stopped) return undefined;
    const listed = this.#reads.relist(added, this.#filter);
    if (added !== undefined) this.#commit();
    if (change.flipped.length === 0 && !change.walk && listed.length === 0) {
      return undefined;
    }
    this.#queueQuietly([...change.flipped, ...listed]);
    const changed = change.walk
      ? await this.#walkReleased(jobStart)
      : undefined;
    this.#processQueue();
    await this.settled();
    return changed;
  }

  /** A path a reconciliation will read anyway needs no walk: one runs until the input set is established. */
  async #walkReleased(
    jobStart: number | undefined,
  ): Promise<string | undefined> {
    const filter = this.#filter;
    if (filter === undefined || !this.#state.established) return undefined;
    this.#protecting += 1;
    const released = await keepReleasedFiles(
      this.#scope(filter),
      this.#state,
      (path) => this.#reads.has(path),
      jobStart,
    )
      .catch((error: unknown) => ({
        ok: false as const,
        reason: errorText(error),
      }))
      .finally(() => {
        this.#commit();
        this.#protecting -= 1;
        this.#signalChange();
      });
    if (released.ok) return released.changed;
    if (this.#stopped) return unavailableReason(this.#condition());
    const reason = `the inputs protection released could not be read: ${released.reason}`;
    this.#inputSetLost(reason);
    return reason;
  }

  /** Root-relative paths queued because protection changed whether they count; an event before their read clears it. */
  #queueQuietly(paths: readonly string[]): void {
    for (const path of paths) {
      this.#reads.enqueueQuietly(absoluteInputPath(this.#root, path));
      this.#ledger.accept();
    }
  }

  /** Releases every wait on the tracker even when closing its watches throws, so no job it holds outlives the stop. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    try {
      this.#schedule.clear();
      this.#abort.abort();
      this.#watcher.close();
    } finally {
      this.#ledger.releaseAll();
      this.#signalChange();
      this.#markFirstReconciled();
    }
    await Promise.allSettled([this.#reconciliation, this.#processing]);
  }

  #changed(path: string, kind: WatchEventType): void {
    if (this.#stopped) return;
    if (liesInsideOnHost(this.#declarationFile, path)) {
      this.#requestReconciliation(NON_INPUTS_CHANGED_REASON);
      return;
    }
    if (this.#filter?.excludes(path) === true) {
      if (this.#listed.names(path)) this.#queuePath(path, kind);
      return;
    }
    if (basename(path) === IGNORE_FILE) {
      this.#requestReconciliation(
        `the ignore rules in ${this.#label(path)} changed`,
      );
    }
    const knownDirectory = this.#state.hasDirectory(path);
    if (this.#declared.namesFile(this.#label(path), path, knownDirectory)) {
      return;
    }
    this.#queuePath(path, kind);
  }

  #queuePath(path: string, kind: WatchEventType): void {
    this.#reads.enqueue(path, kind);
    this.#ledger.accept();
    this.#processQueue();
  }

  #watchFailed(reason: string): void {
    this.#health.fail(reason);
    this.#requestReconciliation(reason);
  }

  /** A reconciliation reopening the same watch would fail the same way, so one running asks for no other. */
  #cannotWatch(reason: string): void {
    this.#health.fail(reason);
    if (!this.#reconciling) this.#requestReconciliation(reason);
  }

  #requestReconciliation(reason: string): void {
    if (this.#stopped) return;
    this.#reconcileRequested = true;
    if (this.#reconciling) return;
    this.#reconciling = true;
    this.#ledger.notify();
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
    this.#countPeriodic();
    this.#markFirstReconciled();
    this.#schedule.periodic();
    this.#processQueue();
    this.#ledger.notify();
    this.#signalChange();
  }

  /**
   * Counts by elapsed time, whoever asked: each end re-arms the timer, so reconciliations that run often keep it from
   * firing.
   */
  #countPeriodic(): void {
    const endedAt = performance.now();
    const from = this.#periodicMeasuredFrom;
    if (from !== undefined && endedAt - from < RECONCILE_INTERVAL_MS) return;
    if (from !== undefined) this.#periodicEnded += 1;
    this.#periodicMeasuredFrom = endedAt;
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
    const listed = await this.#reads.readAllListed(filter);
    this.#filter = filter;
    this.#git.report(filter);
    this.#settleReconciliation(inventory, listed);
  }

  #settleReconciliation(inventory: InventoryResult, listed: ListedReads): void {
    if (inventory.ok) {
      this.#watcher.keepDirectories(new Set(inventory.directories));
      const unread = this.#reads.queuedLabels();
      const restamped = this.#state.restamped(inventory.inputs, listed.reads);
      const changed = [
        ...this.#state.establish(
          inventory.inputs,
          inventory.directories,
          unread,
        ),
        ...this.#state.establishListed(listed, unread),
      ];
      this.#commit();
      for (const path of changed) this.#jobs.recordPath(path);
      this.#ledger.acceptHeld(this.#reads.enqueueRestamped(restamped));
      this.#establishFailure = undefined;
      this.#log.entry(
        `input reconciliation ended: ${inventory.inputs.size} inputs, ${changed.length} changed, revision ${this.#state.revision}`,
      );
      if (restamped.length > 0) {
        this.#log.entry(
          `input reconciliation reads again ${restamped.length} inputs moved in size or time with their content unchanged: ${namedList(restamped)}`,
        );
      }
    } else {
      this.#inputSetLost(inventory.reason);
    }
    this.#health.settle(this.#watcher.failures, inventory.ok);
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
    if (this.#reads.queued === 0 || this.#processing !== undefined) return;
    if (this.#reconciling || this.#stopped) return;
    this.#processing = this.#drainQueue().finally(() => {
      this.#processing = undefined;
      this.#inFlight = 0;
      this.#processQueue();
    });
  }

  async #drainQueue(): Promise<void> {
    while (this.#reads.queued > 0 && !this.#reconciling && !this.#stopped) {
      const batch = this.#reads.takeBatch();
      const through = this.#ledger.accepted;
      this.#inFlight = pendingCount(batch);
      try {
        await this.#reads.read(batch, this.#filter);
      } catch (error) {
        this.#readFailed(error);
      }
      this.#commit();
      this.#inFlight = 0;
      this.#ledger.readUpTo(through);
      this.#signalChange();
    }
  }

  #readFailed(error: unknown): void {
    if (this.#stopped) return;
    this.#log.error("reading changed inputs", error);
    this.#inputSetLost(`reading changed inputs failed: ${errorText(error)}`);
  }

  /** An input set that cannot be established leaves every result unknown until a reconciliation reads it whole. */
  #inputSetLost(reason: string): void {
    this.#state.lose();
    this.#establishFailure = reason;
    this.#jobs.recordCause(reason);
    this.#log.entry(
      `warning: the input set could not be established: ${reason}`,
    );
    if (!this.#reconciling) this.#requestReconciliation(reason);
  }

  /** Raises the revision when any read changed a digest, which a caller waiting for a change can observe. */
  #commit(): void {
    const before = this.#state.revision;
    this.#state.commit();
    if (this.#state.revision !== before) this.#signalChange();
  }

  #signalChange(): void {
    const waiting = this.#changeWaiters;
    this.#changeWaiters = [];
    for (const resolve of waiting) resolve();
  }

  #condition(): TrackerCondition {
    return {
      stopped: this.#stopped,
      lastReconciledAt: this.#lastReconciledAt,
      reconciling: this.#reconciling,
      establishFailure: this.#establishFailure,
      watchFailure: this.#health.failure,
      protecting: this.#protecting > 0,
      pending: this.#reads.pending + this.#inFlight,
    };
  }

  #label(path: string): string {
    return relativePosixPath(this.#root, path);
  }
}
