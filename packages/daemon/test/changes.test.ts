import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Freshness, TestOutcome } from "@rt-test/core";
import { describe, expect, it } from "vitest";
import { ChangeJournal } from "../src/daemon/change-journal.js";
import { Changes } from "../src/daemon/changes.js";
import { WorkspaceSchedule } from "../src/daemon/workspace-schedule.js";
import type { ProjectInputs } from "../src/inputs/fingerprint.js";
import {
  narrowingAt,
  type Narrowing,
  type QueryNarrowing,
} from "../src/inputs/narrowed-inputs.js";
import {
  CURRENT,
  FAILED_MODULE,
  MODULE_CRASHED,
  MODULE_FAILED_TO_LOAD,
  RUN_CRASHED,
  RUN_FAILED,
  STALE,
  TEST_STATES,
  WORKSPACE_DISCOVERY_FAILED,
  WORKSPACE_NOT_CONFIRMED,
  WORKSPACE_UNHANDLED_ERRORS,
  type NoAnswer,
  type NotDiscoveredEntry,
  type RefusedQuery,
  type TestState,
} from "../src/query/answer.js";
import {
  changesAnswer,
  type ChangesAnswer,
  type ListedChange,
} from "../src/query/changes-answer.js";
import {
  queryBasis,
  type DaemonView,
  type QueryBasis,
} from "../src/query/summary.js";
import type { TestStanding } from "../src/query/test-states.js";
import { coverageAt } from "../src/query/wait-answer.js";
import type { LatestResults } from "../src/store/open-store.js";
import type { StoredRun } from "../src/store/stored-records.js";
import { VITEST_ADAPTER_VERSION } from "../src/vitest/adapter-version.js";
import type { WorkspaceRun } from "../src/vitest/run-workspace.js";
import { memoryLog } from "./daemon-harness.js";
import { inTempDir } from "./harness.js";
import {
  builtAt,
  discoveredIn,
  failedRun,
  inputsOf,
  narrowingSelecting,
  NO_BUILD_ENDED,
  ranWorkspace,
} from "./round-fixtures.js";
import {
  digestOf,
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
const B_MODULE = `${WORKSPACE_B}/a.test.ts`;
/** Every input at the first revision, each path to its content digest. */
const FIRST_INPUTS: Readonly<Record<string, string>> = {
  [A_SOURCE]: "a-1",
  [A_MODULE]: "a-module",
  [B_SOURCE]: "b-1",
  [B_MODULE]: "b-module",
};
/** Selection selects `a` for its own files and `b` for its own, and each workspace's inputs are its own files. */
const NARROWING: Narrowing = narrowingSelecting(
  {
    [A_SOURCE]: [WORKSPACE_A],
    [A_MODULE]: [WORKSPACE_A],
    [B_SOURCE]: [WORKSPACE_B],
  },
  {
    [WORKSPACE_A]: [A_SOURCE, A_MODULE],
    [WORKSPACE_B]: [B_SOURCE, B_MODULE],
  },
);
/** The module each workspace's one discovered test `t0` lives in, as `ranWorkspace` records it. */
const MODULE = "a.test.ts";
const PROJECT = "unit";
const BUSY = "EBUSY: resource busy or locked";
const RECONCILING = "a reconciliation runs";

/** The digest each workspace's runs are stored under, which reads current until the test edits that workspace. */
function firstDigest(workspacePath: string): string {
  return `${workspacePath}-digest`;
}

/** A run of `workspacePath` stored under its first digest, so it reads current until that workspace is edited. */
function storedRun(run: WorkspaceRun): StoredRun {
  return {
    ...SCOPE,
    inputFingerprint: digestOf(firstDigest(run.workspace.path)),
    adapterVersion: VITEST_ADAPTER_VERSION,
    runId: `run-${run.workspace.path}`,
    run,
  };
}

/** A run of `workspacePath` whose one test `t0` ended `outcome`, recording `errors` for it. */
function runOf(
  workspacePath: string,
  outcome: TestOutcome,
  errors: readonly string[] = [],
): StoredRun {
  const run = ranWorkspace(workspacePath, [outcome]);
  if (run.status !== "ran") throw new Error("ranWorkspace returns a ran run");
  return storedRun({
    ...run,
    modules: run.modules.map((module) =>
      module.state === "ran"
        ? {
            ...module,
            tests: module.tests.map((test) => ({ ...test, errors })),
          }
        : module,
    ),
  });
}

/** Both workspaces discovered with one test `t0` each, and each workspace's latest run ending that test as given. */
function resultsWith(outcomes: {
  readonly a?: StoredRun;
  readonly b?: StoredRun;
}): LatestResults {
  return {
    discovery: {
      ...SCOPE,
      inputFingerprint: UNFINGERPRINTED,
      adapterVersion: VITEST_ADAPTER_VERSION,
      discoveryId: "discovery",
      discovery: discovery(
        discoveredIn(WORKSPACE_A, [MODULE]),
        discoveredIn(WORKSPACE_B, [MODULE]),
      ),
    },
    discoveryRefusal: undefined,
    latestRuns: [
      outcomes.a ?? runOf(WORKSPACE_A, "passed"),
      outcomes.b ?? runOf(WORKSPACE_B, "passed"),
    ],
    runRefusals: [],
  };
}

function viewOf(root: string): DaemonView {
  return {
    consumerRoot: root,
    activity: { state: "idle" },
    unstoredJobs: [],
    schedule: new WorkspaceSchedule({
      confirmed: () => true,
      storedNothing: () => false,
      heldBy: () => undefined,
      discoveryHeldBy: () => undefined,
    }),
  };
}

type Answered = ChangesAnswer | NoAnswer | RefusedQuery;

/**
 * The daemon a changes query reads, each part scripted: a tracker whose committed inputs and per-workspace fingerprints
 * the test sets, the dependency builds' state and the stored results, as the lifecycle hands them to `Changes`.
 */
class ChangesWorld {
  readonly root: string;
  readonly inputs: StandInInputs;
  readonly changes: Changes;
  project: ProjectInputs | undefined = inputsOf(FIRST_INPUTS);
  query: QueryNarrowing = builtAt(1, NARROWING);
  results: LatestResults = resultsWith({});
  /** Whether a dependency build is still to end, as the builds report it. */
  building = false;
  /** Each report of edited input keys the answers made, as `reported <keys>`, and each close of one, in order. */
  readonly reports: string[] = [];
  readonly #digests = new Map<string, string>();
  #buildEnds: (() => void)[] = [];
  readonly #stop = new AbortController();

  constructor(root: string, script: InputsScript = {}) {
    this.root = root;
    this.inputs = new StandInInputs({
      ...script,
      snapshot: () => this.project,
      fingerprintOf: (workspacePath) => ({
        ok: true,
        digest: this.#digests.get(workspacePath) ?? firstDigest(workspacePath),
      }),
    });
    this.changes = new Changes({
      consumerRoot: root,
      inputs: this.inputs,
      builds: {
        pending: () => this.building,
        ended: () =>
          this.building
            ? new Promise((resolve) => this.#buildEnds.push(resolve))
            : Promise.resolve(),
      },
      stopSignal: this.#stop.signal,
      log: memoryLog(),
      moment: () => {
        const inputs = this.inputs.current(this.query);
        return {
          results: this.results,
          view: viewOf(root),
          inputs,
          narrowing: narrowingAt(this.query, inputs.facts.revision),
        };
      },
      reportEdits: (keys) => {
        this.reports.push(`reported ${keys.join(", ")}`);
        return { read: () => this.reports.push("closed") };
      },
    });
  }

  /** Asks for the changes of the root-relative `paths` since `since`, naming the root-relative `edited` as edited. */
  ask(
    paths: readonly string[],
    since?: string,
    edited: readonly string[] = [],
  ): Promise<Answered> {
    const absolute = (path: string): string => join(this.root, path);
    return this.changes.answer(
      { paths: paths.map(absolute), since, edited: edited.map(absolute) },
      new AbortController().signal,
    );
  }

  /** Stores `results` and signals the store, as the lifecycle does after each write. */
  store(results: LatestResults): void {
    this.results = results;
    this.changes.stored("storing a run");
  }

  /** Edits `workspacePath`'s inputs at the next revision, whose dependency build has not ended. */
  edit(workspacePath: string): void {
    this.#digests.set(workspacePath, `${workspacePath}-edited`);
    this.inputs.moveRevision();
  }

  /** Ends the dependency build at the current revision, narrowing it as before. */
  endBuild(): void {
    this.query = builtAt(this.inputs.revision, NARROWING);
    this.building = false;
    const ends = this.#buildEnds;
    this.#buildEnds = [];
    for (const resolve of ends) resolve();
  }

  close(): Promise<void> {
    this.#stop.abort();
    return this.inputs.stop();
  }
}

function inWorld<T>(
  body: (world: ChangesWorld) => Promise<T>,
  script: InputsScript = {},
): Promise<T> {
  return inTempDir(async (root) => {
    const world = new ChangesWorld(root, script);
    try {
      return await body(world);
    } finally {
      await world.close();
    }
  });
}

function cursorOf(answer: Answered): string | null {
  if ("cursor" in answer) return answer.cursor;
  throw new Error(`the query did not answer: ${JSON.stringify(answer)}`);
}

/** Each listed change by its test's workspace and name, or its entry's module, and its kind. */
function listed(answer: Answered): unknown {
  if (!("determined" in answer) || !answer.determined) return answer;
  return answer.changes.map(changeLine);
}

function changeLine(change: ListedChange): unknown {
  if ("test" in change) {
    return {
      kind: change.kind,
      workspacePath: change.test.workspacePath,
      name: change.test.namePath.join(" > "),
    };
  }
  const entry = change.now ?? change.atCursor;
  return {
    kind: change.kind,
    module:
      entry !== undefined && "modulePath" in entry ? entry.modulePath : null,
  };
}

describe("refusing a changes query", () => {
  it("D3476: a changes query naming a directory and a path outside the consumer root beside a file is refused whole, naming each and why, and reads nothing", async () => {
    const outcome = await inWorld(async (world) => {
      const directory = join(world.root, WORKSPACE_A);
      mkdirSync(directory, { recursive: true });
      const outside = join(dirname(world.root), "elsewhere.ts");
      const answer = await world.changes.answer(
        {
          paths: [directory, outside, join(world.root, A_SOURCE)],
          since: undefined,
          edited: [],
        },
        new AbortController().signal,
      );
      return {
        answer,
        reads: world.inputs.namedReads,
        refusal: `the changes query refuses the paths it cannot take: ${directory} is a directory, and a changes query names only files; ${outside} lies outside the consumer root ${world.root}`,
      };
    });
    expect({ answer: outcome.answer, reads: outcome.reads }).toStrictEqual({
      answer: { refused: outcome.refusal },
      reads: [],
    });
  });
});

describe("what a changes answer reads", () => {
  it("D3477: an edit that lands while the named read runs is what the answer reads, so the edited workspace's result is never answered current from before it", async () => {
    const answer = await inWorld(
      async (world) => {
        const asked = world.ask([A_SOURCE]);
        await flush();
        world.edit(WORKSPACE_A);
        world.endBuild();
        world.inputs.namedReadHeld.resolve();
        const done = await asked;
        return "determined" in done && done.determined
          ? { revision: done.revision, freshness: done.counts.freshness }
          : done;
      },
      { heldNamedRead: true },
    );
    expect(answer).toStrictEqual({
      revision: 2,
      freshness: { current: 0, stale: 1, unknown: 0 },
    });
  });

  it("D3478: a named file the answer's own read found busy, though the read it awaited resolved naming none, leaves the answer not determined, naming that file and its reason", async () => {
    const answer = await inWorld(
      async (world) => {
        const done = await world.ask([A_SOURCE]);
        return "determined" in done && !done.determined
          ? { determined: done.determined, notDetermined: done.notDetermined }
          : done;
      },
      { unreadOnceRead: [{ path: A_SOURCE, reason: BUSY }] },
    );
    expect(answer).toStrictEqual({
      determined: false,
      notDetermined: {
        kind: "paths-unread",
        unread: [
          { path: A_SOURCE, reason: { reason: BUSY, omittedCharacters: 0 } },
        ],
      },
    });
  });

  it("D3480: while the tracker cannot vouch for its inputs, the answer is not determined and names why", async () => {
    const answer = await inWorld(
      async (world) => {
        const done = await world.ask([A_SOURCE]);
        return "determined" in done && !done.determined
          ? done.notDetermined
          : done;
      },
      { unavailable: RECONCILING },
    );
    expect(answer).toStrictEqual({
      kind: "inputs-unavailable",
      reason: { reason: RECONCILING, omittedCharacters: 0 },
    });
  });

  it("D3573: a changes query hands over the files it names as edited before its named read begins, so a job beginning while that read runs holds them", async () => {
    const whileReading = await inWorld(
      async (world) => {
        const asked = world.ask([A_SOURCE], undefined, [A_SOURCE]);
        await flush();
        const seen = {
          reports: [...world.reports],
          reads: world.inputs.namedReads.length,
        };
        world.inputs.namedReadHeld.resolve();
        await asked;
        return seen;
      },
      { heldNamedRead: true },
    );
    expect(whileReading).toStrictEqual({
      reports: [`reported ${A_SOURCE}`],
      reads: 1,
    });
  });

  it("D3574: a changes query closes its report of edited files once its named read has resolved, so no job beginning later holds them", async () => {
    const reports = await inWorld(async (world) => {
      await world.ask([A_SOURCE], undefined, [A_SOURCE]);
      return world.reports;
    });
    expect(reports).toStrictEqual([`reported ${A_SOURCE}`, "closed"]);
  });

  it("D3575: a changes query reports as edited only the files it names as edited, never the other files it names", async () => {
    const reports = await inWorld(async (world) => {
      await world.ask([A_SOURCE, B_SOURCE], undefined, [A_SOURCE]);
      return world.reports;
    });
    expect(reports).toStrictEqual([`reported ${A_SOURCE}`, "closed"]);
  });

  it("D3576: a changes query reports each edited file by the root-relative key its named read reads, never as the caller spelled it", async () => {
    const outcome = await inWorld(async (world) => {
      await world.ask([A_SOURCE], undefined, [A_SOURCE]);
      return { reports: world.reports, reads: world.inputs.namedReads };
    });
    expect(outcome).toStrictEqual({
      reports: [`reported ${A_SOURCE}`, "closed"],
      reads: [[A_SOURCE]],
    });
  });
});

describe("the cursor a changes answer returns", () => {
  it("D3479: right after an edit, before its build ends, the answer is not determined and hands back the given cursor, though a failure was recorded since, so the next determined answer lists that failure", async () => {
    const outcome = await inWorld(async (world) => {
      const given = cursorOf(await world.ask([A_SOURCE]));
      world.store(resultsWith({ a: runOf(WORKSPACE_A, "failed") }));
      world.edit(WORKSPACE_B);
      const early = await world.ask([A_SOURCE], given ?? undefined);
      world.endBuild();
      const handedBack = cursorOf(early);
      const later = await world.ask([A_SOURCE], handedBack ?? undefined);
      return {
        early:
          "determined" in early && !early.determined
            ? {
                kind: early.notDetermined.kind,
                cursorUse: early.cursorUse,
                handedBack: handedBack === given,
              }
            : early,
        later: listed(later),
      };
    });
    expect(outcome).toStrictEqual({
      early: { kind: "build-not-ended", cursorUse: "used", handedBack: true },
      later: [{ kind: "failing", workspacePath: WORKSPACE_A, name: "t0" }],
    });
  });

  it("D3481: a failure stored after the journal's last record is listed by the next answer given the earlier cursor, since the answer records before it compares", async () => {
    const changes = await inWorld(async (world) => {
      const given = cursorOf(await world.ask([A_SOURCE]));
      world.results = resultsWith({ a: runOf(WORKSPACE_A, "failed") });
      return listed(await world.ask([A_SOURCE], given ?? undefined));
    });
    expect(changes).toStrictEqual([
      { kind: "failing", workspacePath: WORKSPACE_A, name: "t0" },
    ]);
  });

  it("D3482: a dependency build that ends is recorded, so an answer not determined after it hands back that moment's cursor rather than none", async () => {
    const answer = await inWorld(async (world) => {
      world.query = NO_BUILD_ENDED;
      world.building = true;
      world.changes.start();
      await flush();
      world.endBuild();
      await flush();
      world.project = undefined;
      const done = await world.ask([A_SOURCE]);
      return "determined" in done
        ? {
            determined: done.determined,
            cursorUse: done.cursorUse,
            issued: done.cursor !== null,
          }
        : done;
    });
    expect(answer).toStrictEqual({
      determined: false,
      cursorUse: "none-given",
      issued: true,
    });
  });

  it("D3483: a store whose build has not begun records nothing yet, and has the build-end loop look again, so the end of the build over it is recorded", async () => {
    const answer = await inWorld(async (world) => {
      world.query = NO_BUILD_ENDED;
      world.changes.start();
      await flush();
      world.building = true;
      world.store(resultsWith({}));
      await flush();
      world.endBuild();
      await flush();
      world.project = undefined;
      const done = await world.ask([A_SOURCE]);
      return "determined" in done
        ? { determined: done.determined, issued: done.cursor !== null }
        : done;
    });
    expect(answer).toStrictEqual({ determined: false, issued: true });
  });
});

describe("the scope of a changes answer", () => {
  it("D3484: a change in the workspace covering a named file is listed, and one in a workspace that does not cover it is only counted outside scope", async () => {
    const outcome = await inWorld(async (world) => {
      const given = cursorOf(await world.ask([A_SOURCE]));
      world.store(
        resultsWith({
          a: runOf(WORKSPACE_A, "failed"),
          b: runOf(WORKSPACE_B, "failed"),
        }),
      );
      const done = await world.ask([A_SOURCE], given ?? undefined);
      return "determined" in done && done.determined
        ? { listed: listed(done), outsideChanged: done.outside.changed }
        : done;
    });
    expect(outcome).toStrictEqual({
      listed: [{ kind: "failing", workspacePath: WORKSPACE_A, name: "t0" }],
      outsideChanged: 1,
    });
  });

  it("D3485: the tests in scope are counted once however many named files their workspace covers, and the rest are counted outside scope", async () => {
    const counts = await inWorld(async (world) => {
      const done = await world.ask([A_SOURCE, A_MODULE]);
      return "determined" in done && done.determined
        ? {
            inScope: done.counts.tests,
            outside: done.outside.counts.tests,
            outsideChanged: done.outside.changed,
          }
        : done;
    });
    expect(counts).toStrictEqual({
      inScope: 1,
      outside: 1,
      outsideChanged: null,
    });
  });
});

/** A standing of the test `name` of `workspacePath`, in the module `ranWorkspace` records it in. */
function standing(
  state: TestState,
  freshness: Freshness,
  name = "t0",
  workspacePath = WORKSPACE_A,
): TestStanding {
  return {
    test: {
      identity: {
        workspacePath,
        projectName: PROJECT,
        modulePath: MODULE,
        namePath: [name],
        occurrence: 0,
      },
      isDuplicate: false,
      mode: "run",
    },
    state,
    freshness,
  };
}

/** A module of workspace `a` that failed to load at discovery, with `reason`. */
function failedModule(
  modulePath: string,
  reason = "SyntaxError: Unexpected token",
): NotDiscoveredEntry {
  return {
    kind: FAILED_MODULE,
    workspacePath: WORKSPACE_A,
    projectName: PROJECT,
    modulePath,
    errorCount: 1,
    reason,
    omittedCharacters: 0,
  };
}

describe("the changes a journal gives for a cursor", () => {
  it("D3486: a test whose standing changed and changed back since the cursor is not listed", () => {
    const journal = new ChangeJournal();
    const cursor = journal.record([standing("passed", CURRENT)], []);
    journal.record([standing("failed", CURRENT)], []);
    journal.record([standing("passed", CURRENT)], []);
    expect(journal.since(cursor)).toStrictEqual({ use: "used", changes: [] });
  });

  it("D3487: a test that failed after the cursor and then went stale is given with its standing at the cursor, not the one it replaced later", () => {
    const journal = new ChangeJournal();
    const cursor = journal.record([standing("passed", CURRENT)], []);
    journal.record([standing("failed", CURRENT)], []);
    journal.record([standing("failed", STALE)], []);
    const reading = journal.since(cursor);
    expect(
      reading.use === "used"
        ? reading.changes.map(({ atCursor, now }) => ({ atCursor, now }))
        : reading,
    ).toStrictEqual([
      {
        atCursor: {
          test: standing("passed", CURRENT).test.identity,
          state: "passed",
          freshness: CURRENT,
        },
        now: {
          test: standing("passed", CURRENT).test.identity,
          state: "failed",
          freshness: STALE,
        },
      },
    ]);
  });

  it("D3488: a second module failing to load in a workspace that already holds one is a change of its own", () => {
    const journal = new ChangeJournal();
    const cursor = journal.record([], [failedModule("a.test.ts")]);
    journal.record([], [failedModule("a.test.ts"), failedModule("b.test.ts")]);
    const reading = journal.since(cursor);
    expect(
      reading.use === "used"
        ? reading.changes.map(({ now }) =>
            now !== undefined && "entry" in now && "modulePath" in now.entry
              ? now.entry.modulePath
              : now,
          )
        : reading,
    ).toStrictEqual(["b.test.ts"]);
  });

  it("D3489: no cursor, another daemon life's cursor and a string no daemon issued are each not used", () => {
    const earlier = new ChangeJournal();
    const earlierCursor = earlier.record([standing("passed", CURRENT)], []);
    const journal = new ChangeJournal();
    journal.record([standing("passed", CURRENT)], []);
    journal.record([standing("failed", CURRENT)], []);
    expect([
      journal.use(undefined),
      journal.use(earlierCursor),
      journal.use("not-a-cursor"),
    ]).toStrictEqual(["none-given", "not-issued", "not-issued"]);
  });

  it("D3490: a cursor with 100000 changes recorded after it is expired rather than read as listing none, while one with 99999 after it is used", () => {
    const uses = [100_000, 99_999].map((count) => {
      const names = Array.from({ length: count }, (_, index) => `t${index}`);
      const journal = new ChangeJournal();
      const cursor = journal.record(
        names.map((name) => standing("passed", CURRENT, name)),
        [],
      );
      journal.record(
        names.map((name) => standing("failed", CURRENT, name)),
        [],
      );
      return journal.use(cursor);
    });
    expect(uses).toStrictEqual(["expired", "used"]);
  });
});

/** Workspaces `a` and `b` passing and current, the basis every answer below composes over. */
function basisOf(latestRuns: readonly StoredRun[] = []): QueryBasis {
  const inputs = new StandInInputs({
    snapshot: () => inputsOf(FIRST_INPUTS),
    fingerprintOf: (workspacePath) => ({
      ok: true,
      digest: firstDigest(workspacePath),
    }),
  }).current();
  const basis = queryBasis(resultsWith({}), viewOf("/consumer"), inputs);
  if ("noAnswer" in basis) throw new Error(basis.noAnswer);
  return {
    ...basis,
    latestRuns: new Map([
      ...basis.latestRuns,
      ...latestRuns.map((run) => [run.run.workspace.path, run] as const),
    ]),
  };
}

interface Moments {
  readonly before: readonly TestStanding[];
  readonly after: readonly TestStanding[];
  readonly entriesBefore?: readonly NotDiscoveredEntry[];
  readonly entriesAfter?: readonly NotDiscoveredEntry[];
  /** The latest runs a failing change's first error is taken from. */
  readonly runs?: readonly StoredRun[];
}

/** The answer for `A_SOURCE`, which workspace `a` covers, given the cursor of the `before` moment once `after` is recorded. */
function answerBetween(moments: Moments): ChangesAnswer {
  const journal = new ChangeJournal();
  const cursor = journal.record(moments.before, moments.entriesBefore ?? []);
  const latest = journal.record(moments.after, moments.entriesAfter ?? []);
  const basis = basisOf(moments.runs);
  const coverage = coverageAt(
    basis.discovery,
    { kind: "narrowed", narrowing: NARROWING },
    inputsOf(FIRST_INPUTS),
    1,
    [A_SOURCE],
  );
  if (coverage === undefined) throw new Error("no coverage at revision 1");
  return changesAnswer(basis, {
    revision: 1,
    cursor: latest,
    reading: journal.since(cursor),
    coverage,
    paths: [A_SOURCE],
  });
}

function kindsBetween(moments: Moments): unknown {
  return listed(answerBetween(moments));
}

const FAILING_STATES = [
  "failed",
  "error",
  MODULE_CRASHED,
  MODULE_FAILED_TO_LOAD,
  RUN_FAILED,
  RUN_CRASHED,
] as const satisfies readonly TestState[];

describe("the kind of each change", () => {
  it("D3491: a test that now stands failed, error, module-crashed, module-failed-to-load, run-failed or run-crashed after passing is a failing change", () => {
    const names = FAILING_STATES.map((_, index) => `t${index}`);
    expect(
      kindsBetween({
        before: names.map((name) => standing("passed", CURRENT, name)),
        after: FAILING_STATES.map((state, index) =>
          standing(state, CURRENT, names[index]),
        ),
      }),
    ).toStrictEqual(
      names.map((name) => ({
        kind: "failing",
        workspacePath: WORKSPACE_A,
        name,
      })),
    );
  });

  it("D3492: a test that stood failed and stale at the cursor and now stands failed and current, its rerun still failing, is a failing change, while one that has only gone stale since is not", () => {
    expect(
      kindsBetween({
        before: [
          standing("failed", STALE, "rerun"),
          standing("failed", CURRENT, "staled"),
        ],
        after: [
          standing("failed", CURRENT, "rerun"),
          standing("failed", STALE, "staled"),
        ],
      }),
    ).toStrictEqual([
      { kind: "failing", workspacePath: WORKSPACE_A, name: "rerun" },
      { kind: "other", workspacePath: WORKSPACE_A, name: "staled" },
    ]);
  });

  it("D3493: a test that stood failing at the cursor, stale or not, and now stands a current pass is recovered, while a pass that is not current is not", () => {
    expect(
      kindsBetween({
        before: [
          standing("failed", STALE, "fixed"),
          standing("error", CURRENT, "unproven"),
        ],
        after: [
          standing("passed", CURRENT, "fixed"),
          standing("passed", STALE, "unproven"),
        ],
      }),
    ).toStrictEqual([
      { kind: "recovered", workspacePath: WORKSPACE_A, name: "fixed" },
      { kind: "other", workspacePath: WORKSPACE_A, name: "unproven" },
    ]);
  });

  it("D3494: a module of a covering workspace that newly fails to load is a failing change carrying its reason's first line, and one that loads again is recovered", () => {
    const answer = answerBetween({
      before: [],
      after: [],
      entriesBefore: [failedModule("gone.test.ts")],
      entriesAfter: [
        failedModule(
          "new.test.ts",
          "SyntaxError: Unexpected token\n    at new.test.ts:1:1",
        ),
      ],
    });
    expect(
      answer.determined
        ? answer.changes.map((change) => ({
            ...(changeLine(change) as object),
            ...("firstError" in change
              ? { firstError: change.firstError }
              : {}),
          }))
        : answer,
    ).toStrictEqual([
      {
        kind: "failing",
        module: "new.test.ts",
        firstError: {
          reason: "SyntaxError: Unexpected token",
          omittedCharacters: 0,
        },
      },
      { kind: "recovered", module: "gone.test.ts" },
    ]);
  });

  it("D3496: a failing change carries the first line of the first error its latest run recorded for it", () => {
    const answer = answerBetween({
      before: [standing("passed", CURRENT)],
      after: [standing("failed", CURRENT)],
      runs: [
        runOf(WORKSPACE_A, "failed", [
          "AssertionError: expected 1 to be 2\n    at a.test.ts:3:5",
          "a second error",
        ]),
      ],
    });
    expect(
      answer.determined
        ? answer.changes.map((change) =>
            "firstError" in change ? change.firstError : change,
          )
        : answer,
    ).toStrictEqual([
      { reason: "AssertionError: expected 1 to be 2", omittedCharacters: 0 },
    ]);
  });
});

describe("the order and bound of the listed changes", () => {
  it("D3495: failing and recovered changes are listed before the others, up to 20 in all, and the rest are counted by kind", () => {
    const others = Array.from(
      { length: 20 },
      (_, index) => `a${String(index).padStart(2, "0")}`,
    );
    const answer = answerBetween({
      before: [
        ...others.map((name) => standing("passed", CURRENT, name)),
        standing("passed", CURRENT, "z-fails"),
        standing("failed", CURRENT, "z-recovers"),
      ],
      after: [
        ...others.map((name) => standing("passed", STALE, name)),
        standing("failed", CURRENT, "z-fails"),
        standing("passed", CURRENT, "z-recovers"),
      ],
    });
    expect(
      answer.determined
        ? {
            first: answer.changes.slice(0, 2).map(changeLine),
            listed: answer.changes.length,
            omitted: answer.omittedChanges,
          }
        : answer,
    ).toStrictEqual({
      first: [
        { kind: "failing", workspacePath: WORKSPACE_A, name: "z-fails" },
        { kind: "recovered", workspacePath: WORKSPACE_A, name: "z-recovers" },
      ],
      listed: 20,
      omitted: { failing: 0, recovered: 0, other: 2 },
    });
  });
});

describe("recording at an input change", () => {
  it("D3509: the inputs coming back at an unchanged revision are recorded, so an answer not determined afterwards hands back a cursor newer than the one before them", async () => {
    const answer = await inWorld(async (world) => {
      world.changes.start();
      await flush();
      const before = cursorOf(await world.ask([A_SOURCE]));
      world.project = undefined;
      world.store(resultsWith({ a: runOf(WORKSPACE_A, "failed") }));
      await flush();
      world.project = inputsOf(FIRST_INPUTS);
      world.inputs.endPeriodicReconciliation();
      await flush();
      world.project = undefined;
      const done = await world.ask([A_SOURCE]);
      return "determined" in done
        ? {
            determined: done.determined,
            newer: done.cursor !== null && done.cursor !== before,
          }
        : done;
    });
    expect(answer).toStrictEqual({ determined: false, newer: true });
  });

  it("D3518: a store at a moment not determined records nothing, so an answer not determined afterwards hands back the last determined moment's cursor", async () => {
    const answer = await inWorld(async (world) => {
      const before = cursorOf(await world.ask([A_SOURCE]));
      world.query = NO_BUILD_ENDED;
      world.store(resultsWith({ a: runOf(WORKSPACE_A, "failed") }));
      const done = await world.ask([A_SOURCE]);
      return "determined" in done
        ? { determined: done.determined, handedBack: done.cursor === before }
        : done;
    });
    expect(answer).toStrictEqual({ determined: false, handedBack: true });
  });
});

/** The states that say a test has no outcome: neither `passed` nor one of the failing states. */
const NO_OUTCOME_STATES = TEST_STATES.filter(
  (state) =>
    state !== "passed" &&
    !(FAILING_STATES as readonly TestState[]).includes(state),
);

/** A workspace-level entry of workspace `a` of `kind`, which a covering workspace's changes include. */
function workspaceEntry(
  kind:
    | typeof WORKSPACE_DISCOVERY_FAILED
    | typeof WORKSPACE_NOT_CONFIRMED
    | typeof WORKSPACE_UNHANDLED_ERRORS,
): NotDiscoveredEntry {
  const reason = { reason: `${kind} in ${WORKSPACE_A}`, omittedCharacters: 0 };
  return kind === WORKSPACE_UNHANDLED_ERRORS
    ? { kind, workspacePath: WORKSPACE_A, errorCount: 1, ...reason }
    : { kind, workspacePath: WORKSPACE_A, ...reason };
}

/** Each listed entry change by its kind and the kind of entry it names. */
function entryKinds(answer: ChangesAnswer): unknown {
  if (!answer.determined) return answer;
  return answer.changes.map((change) => {
    const entry =
      "test" in change ? undefined : (change.now ?? change.atCursor);
    return { kind: change.kind, entry: entry?.kind };
  });
}

describe("the kinds of the other states and entries", () => {
  it("D3510: a test moving between a current pass and a state that says it has no outcome is neither failing nor recovered, whichever way it moves", () => {
    const kinds = listed(
      answerBetween({
        before: [
          ...NO_OUTCOME_STATES.map((state, index) =>
            standing(state, CURRENT, `from${index}`),
          ),
          ...NO_OUTCOME_STATES.map((_, index) =>
            standing("passed", CURRENT, `into${index}`),
          ),
        ],
        after: [
          ...NO_OUTCOME_STATES.map((_, index) =>
            standing("passed", CURRENT, `from${index}`),
          ),
          ...NO_OUTCOME_STATES.map((state, index) =>
            standing(state, CURRENT, `into${index}`),
          ),
        ],
      }),
    );
    expect(
      Array.isArray(kinds)
        ? {
            kinds: [
              ...new Set(kinds.map((change: { kind: string }) => change.kind)),
            ],
            count: kinds.length,
          }
        : kinds,
    ).toStrictEqual({ kinds: ["other"], count: 2 * NO_OUTCOME_STATES.length });
  });

  it("D3511: a covering workspace whose discovery failed or raised unhandled errors is a failing change when the entry appears and recovered when it goes away, while a workspace not confirmed is neither", () => {
    expect([
      entryKinds(
        answerBetween({
          before: [],
          after: [],
          entriesAfter: [
            workspaceEntry(WORKSPACE_DISCOVERY_FAILED),
            workspaceEntry(WORKSPACE_UNHANDLED_ERRORS),
            workspaceEntry(WORKSPACE_NOT_CONFIRMED),
          ],
        }),
      ),
      entryKinds(
        answerBetween({
          before: [],
          after: [],
          entriesBefore: [
            workspaceEntry(WORKSPACE_DISCOVERY_FAILED),
            workspaceEntry(WORKSPACE_UNHANDLED_ERRORS),
          ],
        }),
      ),
    ]).toStrictEqual([
      [
        { kind: "failing", entry: WORKSPACE_DISCOVERY_FAILED },
        { kind: "failing", entry: WORKSPACE_UNHANDLED_ERRORS },
        { kind: "other", entry: WORKSPACE_NOT_CONFIRMED },
      ],
      [
        { kind: "recovered", entry: WORKSPACE_DISCOVERY_FAILED },
        { kind: "recovered", entry: WORKSPACE_UNHANDLED_ERRORS },
      ],
    ]);
  });

  it("D3517: a failing change of a test whose run failed, or whose module failed to load, carries the first line of the error its run recorded", () => {
    const ran = ranWorkspace(WORKSPACE_A, ["passed"]);
    if (ran.status !== "ran") throw new Error("ranWorkspace returns a ran run");
    const firstErrors = [
      answerBetween({
        before: [standing("passed", CURRENT)],
        after: [standing(RUN_FAILED, CURRENT)],
        runs: [storedRun(failedRun(WORKSPACE_A))],
      }),
      answerBetween({
        before: [standing("passed", CURRENT)],
        after: [standing(MODULE_FAILED_TO_LOAD, CURRENT)],
        runs: [
          storedRun({
            ...ran,
            modules: [
              {
                projectName: PROJECT,
                modulePath: MODULE,
                state: "failed",
                errors: [
                  "Error: Cannot find module './gone.js'\n    at a.test.ts:1:1",
                ],
              },
            ],
          }),
        ],
      }),
    ].map((answer) =>
      answer.determined
        ? answer.changes.map((change) =>
            "firstError" in change ? change.firstError : change,
          )
        : answer,
    );
    expect(firstErrors).toStrictEqual([
      [{ reason: "Error: config boom", omittedCharacters: 0 }],
      [
        {
          reason: "Error: Cannot find module './gone.js'",
          omittedCharacters: 0,
        },
      ],
    ]);
  });
});
