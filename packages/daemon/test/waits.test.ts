import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Waits } from "../src/daemon/waits.js";
import type { ScheduleReader } from "../src/daemon/workspace-schedule.js";
import type { ProjectInputs } from "../src/inputs/fingerprint.js";
import type {
  Narrowing,
  QueryNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import {
  DUE_REASON,
  EXECUTION_STATE,
  ROUND,
  ROUND_SELECTION,
  ROUND_WAIT,
  type NoAnswer,
  type RefusedQuery,
  type ScheduleFacts,
  type WaitAnswer,
  type WorkspaceExecution,
} from "../src/query/answer.js";
import type { LatestResults } from "../src/store/open-store.js";
import type { StoredDiscovery } from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";
import { settled, type Settled } from "./daemon-harness.js";
import { inTempDir, projectFacts, WAITING } from "./harness.js";
import {
  builtAt,
  discoveredIn,
  inputsOf,
  narrowingSelecting,
  NO_BUILD_ENDED,
} from "./round-fixtures.js";
import {
  discovered,
  discovery,
  flush,
  SCOPE,
  StandInInputs,
  UNFINGERPRINTED,
  type InputsScript,
} from "./scheduling-harness.js";

const WORKSPACE_A = "packages/a";
const WORKSPACE_B = "packages/b";
const A_SOURCE = `${WORKSPACE_A}/src/a.ts`;
const A_MODULE = `${WORKSPACE_A}/a.test.ts`;
const B_SOURCE = `${WORKSPACE_B}/src/b.ts`;
const A_SETUP = `${WORKSPACE_A}/setup.ts`;
/** Every input at the first revision, each path to its content digest. */
const FIRST_INPUTS: Readonly<Record<string, string>> = {
  [A_SOURCE]: "a-1",
  [A_MODULE]: "a-module",
  [B_SOURCE]: "b-1",
};
/** Selection selects `a` for its source, and each workspace's inputs are its own files. */
const NARROWING: Narrowing = narrowingSelecting(
  { [A_SOURCE]: [WORKSPACE_A] },
  {
    [WORKSPACE_A]: [A_SOURCE, A_MODULE],
    [WORKSPACE_B]: [B_SOURCE],
  },
);
const FIRST_DISCOVERY_ID = "discovery";
const TWO_WORKSPACES = discovery(
  discoveredIn(WORKSPACE_A, ["a.test.ts"]),
  discoveredIn(WORKSPACE_B, ["b.test.ts"]),
);
/** A limit no test passes unless it advances the faked clock past it. */
const LIMIT_MS = 1_000;
const BUSY = "EBUSY: resource busy or locked";

function stored(found: TestDiscovery, discoveryId: string): StoredDiscovery {
  return {
    ...SCOPE,
    inputFingerprint: UNFINGERPRINTED,
    adapterVersion: VITEST_ADAPTER_VERSION,
    discoveryId,
    discovery: found,
  };
}

function resultsOf(found: StoredDiscovery): LatestResults {
  return {
    discovery: found,
    discoveryRefusal: undefined,
    latestRuns: [],
    runRefusals: [],
  };
}

function idle(workspacePath: string): WorkspaceExecution {
  return { workspacePath, state: EXECUTION_STATE.idle };
}

function queued(workspacePath: string): WorkspaceExecution {
  return {
    workspacePath,
    state: EXECUTION_STATE.queued,
    due: { kind: DUE_REASON.inputsChanged },
    chosenBy: { named: [], more: 0 },
  };
}

function plannedAt(
  revision: number,
  ...workspaces: WorkspaceExecution[]
): ScheduleFacts {
  return { round: { state: ROUND.planned, revision }, workspaces };
}

/** The builds' state once a build over the discovery `discoveryId` ended at `revision` and narrowed it. */
function builtOver(
  discoveryId: string,
  revision: number,
  narrowing: Narrowing,
): QueryNarrowing {
  return {
    discoveryId,
    state: {
      discoveryId,
      selectionInput: true,
      latest: { revision, built: true, narrowing },
      lastFailure: undefined,
    },
    buildsEnded: undefined,
  };
}

type Answered = Settled<WaitAnswer | NoAnswer | RefusedQuery>;

/** A wait's answer once it has one, and `WAITING` until then. */
class Observed {
  #answer: Answered | typeof WAITING = WAITING;

  constructor(answer: Promise<WaitAnswer | NoAnswer | RefusedQuery>) {
    void settled(answer).then((done) => {
      this.#answer = done;
    });
  }

  get answer(): Answered | typeof WAITING {
    return this.#answer;
  }
}

/**
 * The daemon a wait reads, each part scripted: a tracker whose committed inputs the test sets, the dependency builds'
 * state, the schedule each answer carries and the stored results. Each move signals as the lifecycle's parts do.
 */
class WaitWorld {
  readonly root: string;
  readonly inputs: StandInInputs;
  readonly waits: Waits;
  project: ProjectInputs | undefined = inputsOf(FIRST_INPUTS);
  narrowing: QueryNarrowing = builtAt(1, NARROWING);
  schedule: ScheduleFacts = plannedAt(
    1,
    queued(WORKSPACE_A),
    idle(WORKSPACE_B),
  );
  results: LatestResults = resultsOf(
    stored(TWO_WORKSPACES, FIRST_DISCOVERY_ID),
  );
  readonly #stop = new AbortController();
  readonly #requests: AbortController[] = [];
  #scheduleMoves: (() => void)[] = [];

  constructor(root: string, script: InputsScript) {
    this.root = root;
    this.inputs = new StandInInputs({
      ...script,
      snapshot: () => this.project,
    });
    const reader: ScheduleReader = {
      read: () => ({
        schedule: this.schedule,
        latestSelection: { state: ROUND_SELECTION.noRoundYet },
      }),
      round: () => this.schedule.round,
      invalidation: () => undefined,
      moved: () => new Promise((resolve) => this.#scheduleMoves.push(resolve)),
    };
    this.waits = new Waits({
      consumerRoot: root,
      inputs: this.inputs,
      builds: {
        narrowing: () => this.narrowing,
        pending: () => false,
        ended: () => new Promise(() => undefined),
      },
      schedule: reader,
      stopSignal: this.#stop.signal,
      moment: () => ({
        results: this.results,
        view: {
          consumerRoot: root,
          activity: { state: "idle" },
          unstoredJobs: [],
          schedule: reader,
        },
        inputs: this.inputs.current(),
      }),
    });
  }

  /** Waits on the root-relative `paths`, with `request` as the client's signal, which the world aborts at its close. */
  wait(paths: readonly string[], request = new AbortController()): Observed {
    this.#requests.push(request);
    return new Observed(
      this.waits.wait(
        {
          paths: paths.map((path) => join(this.root, path)),
          limitMs: LIMIT_MS,
        },
        request.signal,
      ),
    );
  }

  moveSchedule(schedule: ScheduleFacts): void {
    this.schedule = schedule;
    const waiting = this.#scheduleMoves;
    this.#scheduleMoves = [];
    for (const resolve of waiting) resolve();
  }

  /** Commits `edits` at the next revision with the builds' state `narrowing`, then signals the move, as a read does. */
  edit(
    edits: Readonly<Record<string, string>>,
    narrowing: QueryNarrowing,
  ): void {
    this.project = inputsOf({
      ...Object.fromEntries(this.project?.digests ?? []),
      ...edits,
    });
    this.narrowing = narrowing;
    this.inputs.moveRevision();
  }

  /** Leaves no timer or listener behind: each request left, and the daemon stopped. */
  close(): void {
    for (const request of this.#requests) request.abort();
    this.#stop.abort();
  }
}

/** Runs `body` over a world rooted in a fresh directory, closing it however `body` ends. */
function inWorld<T>(
  script: InputsScript,
  body: (world: WaitWorld) => Promise<T>,
): Promise<T> {
  return inTempDir(async (root) => {
    const world = new WaitWorld(root, script);
    try {
      return await body(world);
    } finally {
      world.close();
    }
  });
}

/** Runs `body` with the limit's timer faked, so a wait passes its limit only when the test advances the clock. */
async function withFakedLimit<T>(body: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    return await body();
  } finally {
    vi.useRealTimers();
  }
}

/** An answer by its outcome and revisions, or whatever else it was. */
function outcomeOf(answer: Answered | typeof WAITING): unknown {
  if (answer === WAITING || !("outcome" in answer)) return answer;
  return {
    outcome: answer.outcome,
    boundRevision: answer.boundRevision,
    givenAt: answer.inputs.revision,
  };
}

describe("binding a wait", () => {
  it("D3427: a wait reads its files, then reads them again once the inputs have settled, before it binds", async () => {
    const reads = await inWorld({ heldSettle: 0 }, async (world) => {
      world.wait([A_SOURCE]);
      await flush();
      const whileSettling = [...world.inputs.namedReads];
      world.inputs.settleHeld.resolve();
      await flush();
      return { whileSettling, after: [...world.inputs.namedReads] };
    });
    expect(reads).toStrictEqual({
      whileSettling: [[A_SOURCE]],
      after: [[A_SOURCE], [A_SOURCE]],
    });
  });

  it("D3438: a wait naming any path outside the consumer root is refused whole, naming that path, and reads nothing", async () => {
    const outcome = await inWorld({}, async (world) => {
      const outside = join(dirname(world.root), "elsewhere.ts");
      const answer = await world.waits.wait(
        { paths: [join(world.root, A_SOURCE), outside], limitMs: LIMIT_MS },
        new AbortController().signal,
      );
      return {
        answer,
        reads: world.inputs.namedReads,
        refusal: `the wait refuses the paths it cannot take: ${outside} lies outside the consumer root ${world.root}`,
      };
    });
    expect({
      answer: outcome.answer,
      reads: outcome.reads,
    }).toStrictEqual({ answer: { refused: outcome.refusal }, reads: [] });
  });

  it("D3437: a wait whose client leaves answers that nobody waits for it", async () => {
    const answer = await inWorld({}, async (world) => {
      const request = new AbortController();
      const waited = world.wait([A_SOURCE], request);
      await flush();
      request.abort();
      await flush();
      return waited.answer;
    });
    expect(answer).toStrictEqual({
      noAnswer: "nobody waits for the answer any more",
    });
  });
});

describe("settling a wait", () => {
  it("D3428: a wait is not settled while a covering workspace is queued, and settles once it is idle, naming the revision it bound to and the one it was given at", async () => {
    const outcome = await inWorld({}, async (world) => {
      const waited = world.wait([A_SOURCE]);
      await flush();
      const whileQueued = waited.answer;
      world.moveSchedule(plannedAt(1, idle(WORKSPACE_A), idle(WORKSPACE_B)));
      await flush();
      return { whileQueued, after: outcomeOf(waited.answer) };
    });
    expect(outcome).toStrictEqual({
      whileQueued: WAITING,
      after: { outcome: "settled", boundRevision: 1, givenAt: 1 },
    });
  });

  it("D3429: a wait is not settled while a round is pending, though every covering workspace reads idle", async () => {
    const outcome = await inWorld({}, async (world) => {
      world.schedule = {
        round: { state: ROUND.pending, waitsFor: ROUND_WAIT.quietWindow },
        workspaces: [idle(WORKSPACE_A), idle(WORKSPACE_B)],
      };
      const waited = world.wait([A_SOURCE]);
      await flush();
      const whilePending = waited.answer;
      world.moveSchedule(plannedAt(1, idle(WORKSPACE_A), idle(WORKSPACE_B)));
      await flush();
      return { whilePending, after: outcomeOf(waited.answer) };
    });
    expect(outcome).toStrictEqual({
      whilePending: WAITING,
      after: { outcome: "settled", boundRevision: 1, givenAt: 1 },
    });
  });

  it("D3430: a named file the wait found but could not read keeps it from settling, and its limit answers unsettled naming that file's reason", async () => {
    const outcome = await inWorld(
      { unreadNamed: [{ path: A_SOURCE, reason: BUSY }] },
      (world) =>
        withFakedLimit(async () => {
          world.schedule = plannedAt(1, idle(WORKSPACE_A), idle(WORKSPACE_B));
          const waited = world.wait([A_SOURCE]);
          await flush();
          const beforeLimit = waited.answer;
          await vi.advanceTimersByTimeAsync(LIMIT_MS);
          await flush();
          const answer = waited.answer;
          return {
            beforeLimit,
            atLimit:
              answer !== WAITING && "outcome" in answer
                ? { outcome: answer.outcome, files: answer.files }
                : answer,
          };
        }),
    );
    expect(outcome).toStrictEqual({
      beforeLimit: WAITING,
      atLimit: {
        outcome: "unsettled",
        files: [
          {
            path: A_SOURCE,
            unread: { reason: BUSY, omittedCharacters: 0 },
            selection: expect.objectContaining({ path: A_SOURCE }),
            listed: { named: [], more: 0 },
          },
        ],
      },
    });
  });

  it("D3435: a rediscovery stored at the bound revision replaces the covering workspaces, so a wait on a setup file it newly lists waits while that file's workspace is queued", async () => {
    const outcome = await inWorld({}, async (world) => {
      world.schedule = {
        round: { state: ROUND.pending, waitsFor: ROUND_WAIT.rediscovery },
        workspaces: [idle(WORKSPACE_A), idle(WORKSPACE_B)],
      };
      const waited = world.wait([A_SETUP]);
      await flush();
      const withSetup: WorkspaceDiscovery = {
        ...discovered(WORKSPACE_A),
        selectionFacts: {
          reported: true,
          projects: [projectFacts({ setupFiles: [A_SETUP] })],
        },
      };
      const rediscoveryId = "rediscovery";
      world.results = resultsOf(
        stored(
          discovery(withSetup, discoveredIn(WORKSPACE_B, ["b.test.ts"])),
          rediscoveryId,
        ),
      );
      world.narrowing = builtOver(rediscoveryId, 1, NARROWING);
      world.schedule = plannedAt(1, queued(WORKSPACE_A), idle(WORKSPACE_B));
      world.waits.moved();
      await flush();
      const whileQueued = waited.answer;
      world.moveSchedule(plannedAt(1, idle(WORKSPACE_A), idle(WORKSPACE_B)));
      await flush();
      return { whileQueued, after: outcomeOf(waited.answer) };
    });
    expect(outcome).toStrictEqual({
      whileQueued: WAITING,
      after: { outcome: "settled", boundRevision: 1, givenAt: 1 },
    });
  });
});

describe("superseding a wait", () => {
  it("D3431: a wait answers superseded at a later revision whose build ended when an input of a covering workspace changed, naming the path", async () => {
    const answer = await inWorld({}, async (world) => {
      const waited = world.wait([A_SOURCE]);
      await flush();
      world.edit({ [A_SOURCE]: "a-2" }, builtAt(2, NARROWING));
      await flush();
      const done = waited.answer;
      return done !== WAITING && "outcome" in done
        ? {
            ...(outcomeOf(done) as object),
            ...(done.outcome === "superseded"
              ? {
                  supersededAt: done.supersededAt,
                  changedPaths: done.changedPaths,
                }
              : {}),
          }
        : done;
    });
    expect(answer).toStrictEqual({
      outcome: "superseded",
      boundRevision: 1,
      givenAt: 2,
      supersededAt: 2,
      changedPaths: { named: [A_SOURCE], more: 0 },
    });
  });

  it("D3432: a change only to an input no covering workspace reads leaves the wait waiting, and it settles at the later revision", async () => {
    const outcome = await inWorld({}, async (world) => {
      const waited = world.wait([A_SOURCE]);
      await flush();
      world.edit({ [B_SOURCE]: "b-2" }, builtAt(2, NARROWING));
      await flush();
      const afterEdit = waited.answer;
      world.moveSchedule(plannedAt(2, idle(WORKSPACE_A), idle(WORKSPACE_B)));
      await flush();
      return { afterEdit, after: outcomeOf(waited.answer) };
    });
    expect(outcome).toStrictEqual({
      afterEdit: WAITING,
      after: { outcome: "settled", boundRevision: 1, givenAt: 2 },
    });
  });

  it("D3433: a wait whose bound revision's build never ended answers superseded once the revision moves, every workspace's tests counted as covering", async () => {
    const answer = await inWorld({}, async (world) => {
      world.narrowing = NO_BUILD_ENDED;
      const waited = world.wait([A_SOURCE]);
      await flush();
      world.edit({ [A_SOURCE]: "a-2" }, builtAt(2, NARROWING));
      await flush();
      const done = waited.answer;
      return done !== WAITING && "outcome" in done
        ? {
            outcome: done.outcome,
            coverage: done.coverage,
            tests: done.counts.tests,
          }
        : done;
    });
    expect(answer).toStrictEqual({
      outcome: "superseded",
      coverage: { state: "not-yet-known" },
      tests: 2,
    });
  });

  it("D3434: a later revision whose inputs match the bound one's again, after an edit and its undoing, does not supersede the wait", async () => {
    const outcome = await inWorld({}, async (world) => {
      const waited = world.wait([A_SOURCE]);
      await flush();
      world.edit({ [A_SOURCE]: "a-2" }, builtAt(1, NARROWING));
      await flush();
      world.edit({ [A_SOURCE]: "a-1" }, builtAt(3, NARROWING));
      await flush();
      const afterUndo = waited.answer;
      world.moveSchedule(plannedAt(3, idle(WORKSPACE_A), idle(WORKSPACE_B)));
      await flush();
      return { afterUndo, after: outcomeOf(waited.answer) };
    });
    expect(outcome).toStrictEqual({
      afterUndo: WAITING,
      after: { outcome: "settled", boundRevision: 1, givenAt: 3 },
    });
  });
});

describe("a wait's limit", () => {
  it("D3436: a limit that passes before the wait binds answers unsettled with no bound revision and its coverage not yet known, naming every workspace's execution state", async () => {
    const answer = await inWorld({ heldNamedRead: true }, (world) =>
      withFakedLimit(async () => {
        const waited = world.wait([A_SOURCE]);
        await flush();
        await vi.advanceTimersByTimeAsync(LIMIT_MS);
        await flush();
        const done = waited.answer;
        return done !== WAITING && "outcome" in done
          ? {
              outcome: done.outcome,
              boundRevision: done.boundRevision,
              coverage: done.coverage,
              workspaces: done.workspaces,
            }
          : done;
      }),
    );
    expect(answer).toStrictEqual({
      outcome: "unsettled",
      boundRevision: null,
      coverage: { state: "not-yet-known" },
      workspaces: [queued(WORKSPACE_A), idle(WORKSPACE_B)],
    });
  });

  it("D3456: a limit that passes before any discovery is stored answers that there is nothing to answer, with the reason a summary gives", async () => {
    const outcome = await inWorld({}, (world) =>
      withFakedLimit(async () => {
        world.results = {
          discovery: undefined,
          discoveryRefusal: undefined,
          latestRuns: [],
          runRefusals: [],
        };
        const waited = world.wait([A_SOURCE]);
        await flush();
        await vi.advanceTimersByTimeAsync(LIMIT_MS);
        await flush();
        const done = waited.answer;
        const lead = `the daemon serving ${world.root} has stored no discovery for this worktree; `;
        return done !== WAITING &&
          "noAnswer" in done &&
          done.noAnswer.startsWith(lead)
          ? "nothing to answer, with the reason"
          : done;
      }),
    );
    expect(outcome).toBe("nothing to answer, with the reason");
  });
});
