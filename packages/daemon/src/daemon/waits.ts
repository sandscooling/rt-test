import { statSync } from "node:fs";
import type { ProjectInputs } from "../inputs/fingerprint.js";
import type { InputDigests } from "../inputs/input-inventory.js";
import { MAX_NAMED_CHANGES } from "../inputs/input-jobs.js";
import type { CurrentInputs, TrackedInputs } from "../inputs/input-tracker.js";
import { narrowingAt } from "../inputs/narrowed-inputs.js";
import type { UnreadPath } from "../inputs/queued-reads.js";
import {
  WAIT_OUTCOME,
  type NoAnswer,
  type RefusedQuery,
  type WaitAnswer,
  type WaitOutcomeFacts,
} from "../query/answer.js";
import { resolveCallerPath } from "../query/caller-paths.js";
import {
  queryBasis,
  type DaemonView,
  type QueryBasis,
} from "../query/summary.js";
import {
  coverageAt,
  settles,
  waitAnswer,
  type Coverage,
} from "../query/wait-answer.js";
import type { LatestResults } from "../store/open-store.js";
import type { StoredDiscovery } from "../store/stored-records.js";
import type { DependencyBuilds } from "./dependency-builds.js";
import type { WaitQuery } from "./server.js";
import { boundedList, type ScheduleReader } from "./workspace-schedule.js";

export const NOT_AWAITED_REASON = "nobody waits for the answer any more";
const WAIT_QUERY = "wait";
const REFUSAL_SEPARATOR = "; ";

/** What moves the waits: the tracker, the schedule, the store and the dependency builds. */
const MOVE_SOURCE = {
  inputs: "inputs",
  schedule: "schedule",
  store: "store",
  builds: "builds",
} as const;

type MoveSource = (typeof MOVE_SOURCE)[keyof typeof MOVE_SOURCE];
type WaitResult = WaitAnswer | NoAnswer;

/** What an answer reads, taken together: the latest stored results, the daemon's view and the inputs narrowed for them. */
export interface WaitMoment {
  readonly results: LatestResults;
  readonly view: DaemonView;
  readonly inputs: CurrentInputs;
}

export interface WaitParts {
  readonly consumerRoot: string;
  readonly inputs: TrackedInputs;
  readonly builds: Pick<DependencyBuilds, "narrowing" | "pending" | "ended">;
  readonly schedule: Pick<ScheduleReader, "moved">;
  readonly stopSignal: AbortSignal;
  readonly moment: () => WaitMoment;
}

/** The input revision a wait bound to, with the committed inputs of that revision. */
interface Bound {
  readonly revision: number;
  readonly snapshot: ProjectInputs;
}

interface PendingWait {
  /** Root-relative, each once. */
  readonly paths: readonly string[];
  readonly resolve: (answer: WaitResult) => void;
  readonly reject: (error: unknown) => void;
  /** Clears the limit's timer and the abort listener. */
  release: () => void;
  /** Whether its paths were read, then read again once the inputs settled. */
  read: boolean;
  unread: readonly UnreadPath[];
  bound: Bound | undefined;
  /** The coverage at the bound revision, over the discovery in effect; undefined until its build is seen ended. */
  boundCoverage: Coverage | undefined;
  /** The coverage at the latest revision judged whose build had ended. */
  coverage: Coverage | undefined;
}

/** The paths a later revision changed, and whether every workspace counts as covering, the bound set being unknown. */
interface Change {
  readonly paths: ReadonlySet<string>;
  readonly everyWorkspace: boolean;
}

/**
 * The pending waits: each reads its files, binds to the first input revision after those reads that the tracker can
 * vouch for, and answers superseded once a covering workspace's inputs differ from that revision's, settled once each
 * covering workspace reads current or has nothing coming, or unsettled at its limit. Judged again whenever the tracker,
 * the dependency builds, the schedule or the store moves, never on a timer but the limit's.
 */
export class Waits {
  readonly #parts: WaitParts;
  readonly #pending = new Set<PendingWait>();
  #watching = false;
  #storedWaiters: (() => void)[] = [];
  /** One unresolved move per source, so a source that does not win the race is not asked again. */
  readonly #armed = new Map<MoveSource, Promise<void>>();

  constructor(parts: WaitParts) {
    this.#parts = parts;
  }

  /**
   * Refuses the wait whole when any path lies outside the consumer root, is a directory, or is a missing name the
   * Windows host may read as another.
   */
  wait(
    query: WaitQuery,
    signal: AbortSignal,
  ): Promise<WaitResult | RefusedQuery> {
    const resolved = resolveFiles(
      query.paths,
      this.#parts.consumerRoot,
      WAIT_QUERY,
    );
    if ("refused" in resolved) return Promise.resolve(resolved);
    return new Promise<WaitResult>((resolve, reject) => {
      const wait: PendingWait = {
        paths: resolved.paths,
        resolve,
        reject,
        release: () => undefined,
        read: false,
        unread: [],
        bound: undefined,
        boundCoverage: undefined,
        coverage: undefined,
      };
      const timer = setTimeout(() => this.#expire(wait), query.limitMs);
      const forget = (): void => {
        this.#settle(wait, { noAnswer: NOT_AWAITED_REASON });
      };
      wait.release = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", forget);
      };
      this.#pending.add(wait);
      signal.addEventListener("abort", forget, { once: true });
      if (signal.aborted) {
        forget();
        return;
      }
      void this.#read(wait).catch((error: unknown) => this.#fail(wait, error));
      void this.#watch();
    });
  }

  /** The store or the jobs that stored nothing moved; every pending wait is judged again. */
  moved(): void {
    const waiting = this.#storedWaiters;
    this.#storedWaiters = [];
    for (const resolve of waiting) resolve();
  }

  /**
   * A first read may read nothing while a reconciliation runs or before an input set is established, so it reads again,
   * and takes what it could not read only once that read has run.
   */
  async #read(wait: PendingWait): Promise<void> {
    const { inputs } = this.#parts;
    await inputs.readNamed(wait.paths);
    await inputs.settled();
    if (!this.#pending.has(wait)) return;
    await inputs.readNamed(wait.paths);
    await inputs.settled();
    if (!this.#pending.has(wait)) return;
    wait.unread = inputs.unreadNamed(wait.paths);
    wait.read = true;
    this.#judge([wait]);
  }

  /** Runs while any wait is pending, judging every one at each move; a stop ends it, and a failed move fails them. */
  async #watch(): Promise<void> {
    if (this.#watching) return;
    this.#watching = true;
    try {
      while (this.#pending.size > 0 && !this.#parts.stopSignal.aborted) {
        try {
          await this.#nextMove();
        } catch (error) {
          for (const wait of this.#pending) this.#fail(wait, error);
          return;
        }
        this.#judge([...this.#pending]);
      }
    } finally {
      this.#watching = false;
    }
  }

  #nextMove(): Promise<void> {
    const { inputs, builds, schedule } = this.#parts;
    this.#arm(MOVE_SOURCE.inputs, () => inputs.changed());
    this.#arm(MOVE_SOURCE.schedule, () => schedule.moved());
    this.#arm(
      MOVE_SOURCE.store,
      () => new Promise<void>((resolve) => this.#storedWaiters.push(resolve)),
    );
    if (builds.pending()) this.#arm(MOVE_SOURCE.builds, () => builds.ended());
    return Promise.race(this.#armed.values());
  }

  #arm(source: MoveSource, move: () => Promise<void>): void {
    if (this.#armed.has(source)) return;
    this.#armed.set(
      source,
      move().then(() => {
        this.#armed.delete(source);
      }),
    );
  }

  /** One reading of the daemon serves every wait judged; a failed reading fails each of them as a query that threw. */
  #judge(waits: readonly PendingWait[]): void {
    const ready = waits.filter((wait) => wait.read && this.#pending.has(wait));
    if (ready.length === 0) return;
    let moment: Moment;
    try {
      moment = new Moment(this.#parts.moment());
      for (const wait of ready) this.#judgeOne(wait, moment);
    } catch (error) {
      for (const wait of ready) this.#fail(wait, error);
    }
  }

  /**
   * Binds in the same turn it reads the snapshot, then judges superseded before settled, over the discovery in effect:
   * one stored at the bound revision replaces the covering set taken over the one before.
   */
  #judgeOne(wait: PendingWait, moment: Moment): void {
    if (!this.#pending.has(wait)) return;
    const { snapshot, facts } = moment.inputs;
    if (snapshot === undefined) return;
    const { revision } = facts;
    wait.bound ??= { revision, snapshot };
    const bound = wait.bound;
    const discovery = moment.results.discovery;
    if (discovery === undefined) return;
    const now = this.#coverageAt(wait, discovery, revision, snapshot);
    if (revision === bound.revision) {
      if (now !== undefined) wait.boundCoverage = now;
    } else {
      wait.boundCoverage ??= this.#coverageAt(
        wait,
        discovery,
        bound.revision,
        bound.snapshot,
      );
    }
    wait.coverage = now ?? wait.coverage ?? wait.boundCoverage;
    const change = changedSince(wait.boundCoverage, bound, snapshot, now);
    if (revision !== bound.revision && change !== undefined) {
      this.#answer(
        wait,
        moment,
        {
          outcome: WAIT_OUTCOME.superseded,
          supersededAt: revision,
          changedPaths: boundedList(
            [...change.paths].sort(),
            MAX_NAMED_CHANGES,
          ),
        },
        change.everyWorkspace ? undefined : wait.coverage,
      );
      return;
    }
    if (now === undefined || wait.unread.length > 0) return;
    const basis = moment.basis();
    if ("noAnswer" in basis) return;
    if (settles(basis.context.schedule, now.workspaces)) {
      this.#answer(wait, moment, { outcome: WAIT_OUTCOME.settled }, now);
    }
  }

  /** The wait's latest coverage when it is of this revision and discovery, which is computed once. */
  #coverageAt(
    wait: PendingWait,
    discovery: StoredDiscovery,
    revision: number,
    snapshot: ProjectInputs,
  ): Coverage | undefined {
    const known = wait.coverage;
    if (
      known?.revision === revision &&
      known.discoveryId === discovery.discoveryId
    ) {
      return known;
    }
    const narrowing = narrowingAt(
      {
        ...this.#parts.builds.narrowing(),
        discoveryId: discovery.discoveryId,
      },
      revision,
    );
    return coverageAt(discovery, narrowing, snapshot, revision, wait.paths);
  }

  #expire(wait: PendingWait): void {
    try {
      this.#answer(
        wait,
        new Moment(this.#parts.moment()),
        { outcome: WAIT_OUTCOME.unsettled },
        wait.coverage,
      );
    } catch (error) {
      this.#fail(wait, error);
    }
  }

  /** `coverage` undefined answers every workspace as covering. */
  #answer(
    wait: PendingWait,
    moment: Moment,
    outcome: WaitOutcomeFacts,
    coverage: Coverage | undefined,
  ): void {
    const basis = moment.basis();
    this.#settle(
      wait,
      "noAnswer" in basis
        ? basis
        : waitAnswer(basis, {
            outcome,
            boundRevision: wait.bound?.revision,
            paths: wait.paths,
            unread: wait.unread,
            coverage,
          }),
    );
  }

  /** Answers a wait once; it holds nothing after. */
  #settle(wait: PendingWait, answer: WaitResult): void {
    if (!this.#pending.delete(wait)) return;
    wait.release();
    wait.resolve(answer);
  }

  #fail(wait: PendingWait, error: unknown): void {
    if (!this.#pending.delete(wait)) return;
    wait.release();
    wait.reject(error);
  }
}

/** The daemon read once for every wait judged at one move; the answer's basis is composed only when one needs it. */
class Moment {
  readonly results: LatestResults;
  readonly view: DaemonView;
  readonly inputs: CurrentInputs;
  #basis: QueryBasis | NoAnswer | undefined;

  constructor({ results, view, inputs }: WaitMoment) {
    this.results = results;
    this.view = view;
    this.inputs = inputs;
  }

  basis(): QueryBasis | NoAnswer {
    this.#basis ??= queryBasis(this.results, this.view, this.inputs);
    return this.#basis;
  }
}

/**
 * The paths changed, added or removed between the bound revision's snapshot and a later one's, among the inputs of
 * every workspace covering the files at either, once the later revision's build has ended; undefined when none is or
 * it is too soon to say. A path that only enters or leaves a workspace's inputs, as a narrowing does, changed
 * nothing. When the bound revision's build never ended, its covering set is unknown, so every input counts.
 */
function changedSince(
  covered: Coverage | undefined,
  bound: Bound,
  snapshot: ProjectInputs,
  now: Coverage | undefined,
): Change | undefined {
  const before = bound.snapshot.comparedDigests;
  const after = snapshot.comparedDigests;
  const paths = new Set<string>();
  const everyWorkspace = covered === undefined;
  if (covered === undefined) {
    differing(before.keys(), before, after, paths);
    differing(after.keys(), before, after, paths);
  } else if (now !== undefined) {
    for (const workspace of new Set([
      ...covered.workspaces,
      ...now.workspaces,
    ])) {
      differing(covered.inputPaths(workspace), before, after, paths);
      differing(now.inputPaths(workspace), before, after, paths);
    }
  }
  return paths.size === 0 ? undefined : { paths, everyWorkspace };
}

/** Adds each of `paths` whose digest differs between the two snapshots, or that only one of them holds. */
function differing(
  paths: Iterable<string>,
  before: InputDigests,
  after: InputDigests,
  into: Set<string>,
): void {
  for (const path of paths) {
    if (before.get(path) !== after.get(path)) into.add(path);
  }
}

/** The files a query named, resolved inside the consumer root. */
interface ResolvedFiles {
  /** Root-relative, each once. */
  readonly paths: string[];
  /** By each absolute path as given, its root-relative path. */
  readonly byGiven: ReadonlyMap<string, string>;
}

/**
 * Each of the absolute `given` paths root-relative, or the refusal of them all naming why each refused path cannot be
 * taken: it lies outside the consumer root, is a directory, or is a missing name the Windows host may read as another.
 * `query` names the query that takes only files.
 */
export function resolveFiles(
  given: readonly string[],
  consumerRoot: string,
  query: string,
): ResolvedFiles | RefusedQuery {
  const byGiven = new Map<string, string>();
  const refusals: string[] = [];
  for (const path of given) {
    const target = resolveCallerPath(path, consumerRoot);
    if (!target.ok) refusals.push(target.reason);
    else if (isDirectory(path)) {
      refusals.push(`${path} is a directory, and a ${query} names only files`);
    } else byGiven.set(path, target.path);
  }
  if (refusals.length === 0) {
    return { paths: [...new Set(byGiven.values())], byGiven };
  }
  return {
    refused: `the ${query} refuses the paths it cannot take: ${refusals.join(REFUSAL_SEPARATOR)}`,
  };
}

/** A path that cannot be statted is left to the named read, which reports what it could not read. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}
