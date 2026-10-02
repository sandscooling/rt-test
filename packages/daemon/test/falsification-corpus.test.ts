import { describe, expect, it } from "vitest";
import { FALSIFICATION_JOB } from "../src/daemon/protocol.js";
import { DEFECT_STATE } from "../src/defects/defect-states.js";
import {
  CURRENT,
  EXECUTION_STATE,
  ROUND,
  ROUND_WAIT,
  STALE,
  UNKNOWN,
} from "../src/query/answer.js";
import type { ListedEvidence } from "../src/query/defects-answer.js";
import { DAEMON_TEST_TIMEOUT_MS } from "./daemon-harness.js";
import {
  CLEAN,
  replayCorpus,
  type ReplayReport,
} from "./falsification-corpus.js";
import {
  countFindings,
  falsifiedFindings,
  FINDING,
  isSettled,
  mutationTextFindings,
  notSettledFinding,
  stateFindings,
  treeFindings,
  versionFindings,
  waitingDefinitions,
  type DefinitionReading,
  type Finding,
  type FindingKind,
  type MutationText,
  type SearchedFile,
  type SettleReading,
  type TreeEntry,
} from "./falsification-corpus-findings.js";
import {
  ANCHOR_REWRITTEN,
  BASELINE,
  CORPUS_WORKSPACES,
  type CorpusStep,
  type DeclaredDefinition,
  type DeclaredEvidence,
} from "./falsification-corpus-steps.js";
import type { VitestInstall } from "./harness.js";

const VITEST_4_1: VitestInstall = "vitest-4";
const VITEST_5: VitestInstall = "vitest";

const replays = new Map<VitestInstall, Promise<ReplayReport>>();

/** Replays the corpus once per Vitest install and keeps the report for the file, since a replay is a whole daemon life. */
function replayedOn(install: VitestInstall): Promise<ReplayReport> {
  const kept = replays.get(install);
  if (kept !== undefined) return kept;
  const replay = replayCorpus(install);
  replays.set(install, replay);
  return replay;
}

/** The findings of one kind in the replay on `install`; a clean replay holds none of any kind. */
async function findingsOn(
  install: VitestInstall,
  kind: FindingKind,
): Promise<Finding[]> {
  const report = await replayedOn(install);
  return report === CLEAN
    ? []
    : report.findings.filter((finding) => finding.kind === kind);
}

describe(
  "the falsification corpus replayed against the daemon",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4211: on Vitest 4.1 the baseline and both steps read as declared, the weakened assertion's detection retired", async () => {
      expect(await replayedOn(VITEST_4_1)).toBe(CLEAN);
    });

    it("D4212: on Vitest 5 the baseline and both steps read as declared, the setup hook's failure never a detection", async () => {
      expect(await replayedOn(VITEST_5)).toBe(CLEAN);
    });

    it("D4213: on Vitest 4.1 every definition reads the state its step declares, the rewritten anchor's as anchor missing", async () => {
      expect(
        await findingsOn(VITEST_4_1, FINDING.stateNotAsDeclared),
      ).toStrictEqual([]);
    });

    it("D4214: on Vitest 5 every definition reads the state its step declares, the second of two tests sharing a name path as survived", async () => {
      expect(
        await findingsOn(VITEST_5, FINDING.stateNotAsDeclared),
      ).toStrictEqual([]);
    });

    it("D4215: on Vitest 4.1 the answer's counts are the numbers each step declares, verified counting current detections alone", async () => {
      expect(
        await findingsOn(VITEST_4_1, FINDING.countNotAsDeclared),
      ).toStrictEqual([]);
    });

    it("D4216: on Vitest 5 no definition is falsified outside the set its step declares, so the app's edit leaves the library's evidence as stored", async () => {
      expect(
        await findingsOn(VITEST_5, FINDING.falsifiedOutsideDeclaredSet),
      ).toStrictEqual([]);
    });

    it("D4217: on Vitest 5 the baseline and each step settle inside the replay's deadline, behind a canary job read through the executor", async () => {
      expect(await findingsOn(VITEST_5, FINDING.notSettled)).toStrictEqual([]);
    });
  },
);

type Reading = Pick<DefinitionReading, "state" | "eligible" | "evidence">;
type EvidenceIdentity = Parameters<typeof falsifiedFindings>[1][number];

const LISTING_FILE = "packages/lib/named-defects.json";
const CART = "packages/app/src/cart.mjs";
const PRICE = "packages/lib/src/price.mjs";

const DETECTED: Reading = {
  state: DEFECT_STATE.detected,
  eligible: true,
  evidence: { freshness: CURRENT },
};
const NEVER_VERIFIED: Reading = {
  state: DEFECT_STATE.neverVerified,
  eligible: true,
};
const STALE_EVIDENCE: ListedEvidence = {
  freshness: STALE,
  staleCauses: ["inputs-changed"],
};

function evidenceListed({
  freshness,
  reason,
}: DeclaredEvidence): ListedEvidence {
  const reasoned = reason === undefined ? {} : { reason };
  switch (freshness) {
    case CURRENT:
      return { freshness, ...reasoned };
    case STALE:
      return { freshness, staleCauses: [], ...reasoned };
    case UNKNOWN:
      return { freshness, unknownReasons: [], ...reasoned };
  }
}

function asListed({ state, eligible, evidence }: DeclaredDefinition): Reading {
  return evidence === undefined
    ? { state, eligible }
    : { state, eligible, evidence: evidenceListed(evidence) };
}

/** Every definition of `step` as an answer lists one that reads as declared, but each of `changed`, which reads as given. */
function listed(
  step: CorpusStep,
  changed: Readonly<Record<string, Reading>> = {},
): DefinitionReading[] {
  return Object.entries(step.definitions).map(([id, declared], position) => ({
    id,
    file: LISTING_FILE,
    position,
    ...(changed[id] ?? asListed(declared)),
  }));
}

/** Each finding by what it must name; its detail is wording. */
function named(
  findings: readonly Finding[],
): Pick<Finding, "kind" | "step" | "subject">[] {
  return findings.map(({ kind, step, subject }) => ({ kind, step, subject }));
}

/** One evidence record for each id, as the job `job` stored it. */
function stored(ids: readonly string[], job: string): EvidenceIdentity[] {
  return ids.map((id) => ({ defectId: id, evidenceId: `${job}:${id}` }));
}

/** The records `before` once a later job has replaced those of `replaced` and the store has lost those of `lost`. */
function afterJob(
  before: readonly EvidenceIdentity[],
  replaced: readonly string[],
  lost: readonly string[] = [],
): EvidenceIdentity[] {
  return before
    .filter((record) => !lost.includes(record.defectId))
    .map((record) =>
      replaced.includes(record.defectId)
        ? { ...record, evidenceId: `later:${record.defectId}` }
        : record,
    );
}

const AT_BASELINE = stored(BASELINE.falsified, "baseline");

const TREE_BEFORE: readonly TreeEntry[] = [
  { path: "packages", holds: "directory" },
  { path: CART, holds: "file cart-as-committed" },
  { path: PRICE, holds: "file price-as-committed" },
];
const CART_WRITTEN: TreeEntry = { path: CART, holds: "file cart-as-rewritten" };
/** The tree once the step's own edit is in it and nothing else differs. */
const TREE_AFTER: readonly TreeEntry[] = TREE_BEFORE.map((entry) =>
  entry.path === CART ? CART_WRITTEN : entry,
);

function treeFindingsOver(after: readonly TreeEntry[]): unknown {
  return named(
    treeFindings(ANCHOR_REWRITTEN, TREE_BEFORE, after, [CART_WRITTEN]),
  );
}

const MUTATIONS: readonly MutationText[] = [
  {
    id: "lib-discount",
    definitionFile: "packages/lib/named-defects.json",
    text: "price * 0.8",
  },
  {
    id: "app-total-first",
    definitionFile: "packages/app/named-defects.json",
    text: "sum -= discounted",
  },
];

function fileHolding(path: string, text: string): SearchedFile {
  return { path, content: Buffer.from(text) };
}

const DEFINITION_FILES_READ = MUTATIONS.map(({ definitionFile, text }) =>
  fileHolding(definitionFile, `{ "new": "${text}" }`),
);

const SETTLED: SettleReading = {
  schedule: {
    round: { state: ROUND.planned, revision: 1 },
    workspaces: CORPUS_WORKSPACES.map((workspacePath) => ({
      workspacePath,
      state: EXECUTION_STATE.idle,
    })),
  },
  inputs: { pendingChanges: 0 },
  activity: { state: "idle" },
  unstoredJobs: [],
  definitions: listed(BASELINE),
};

/** Whether a reading with everything finished reads settled, then whether it does with `changed` in it. */
function settledWithout(changed: Partial<SettleReading>): boolean[] {
  return [SETTLED, { ...SETTLED, ...changed }].map((reading) =>
    isSettled(reading, CORPUS_WORKSPACES),
  );
}

describe("the corpus's comparisons over hand-built readings, each finding alone", () => {
  it("D4218: a definition read in another state than its step declares is one finding naming the step and the definition", () => {
    const read = listed(BASELINE, { "app-total-second": DETECTED });
    expect(named(stateFindings(BASELINE, read))).toStrictEqual([
      {
        kind: FINDING.stateNotAsDeclared,
        step: BASELINE.name,
        subject: "app-total-second",
      },
    ]);
  });

  it("D4219: a definition read not eligible where its step declares it eligible is a finding", () => {
    const read = listed(BASELINE, {
      "lib-label": { ...DETECTED, eligible: false },
    });
    expect(named(stateFindings(BASELINE, read))).toStrictEqual([
      {
        kind: FINDING.stateNotAsDeclared,
        step: BASELINE.name,
        subject: "lib-label",
      },
    ]);
  });

  it("D4220: a definition whose evidence reads stale where its step declares it current is a finding", () => {
    const read = listed(BASELINE, {
      "lib-label": { ...DETECTED, evidence: STALE_EVIDENCE },
    });
    expect(named(stateFindings(BASELINE, read))).toStrictEqual([
      {
        kind: FINDING.stateNotAsDeclared,
        step: BASELINE.name,
        subject: "lib-label",
      },
    ]);
  });

  it("D4221: an invalid experiment read with another reason than the failed setup hook's is a finding", () => {
    const read = listed(BASELINE, {
      "lib-rate-setup": {
        state: DEFECT_STATE.invalidExperiment,
        eligible: true,
        evidence: { freshness: CURRENT, reason: "test-not-run" },
      },
    });
    expect(named(stateFindings(BASELINE, read))).toStrictEqual([
      {
        kind: FINDING.stateNotAsDeclared,
        step: BASELINE.name,
        subject: "lib-rate-setup",
      },
    ]);
  });

  it("D4222: a definition the answer lists that the corpus does not declare is a finding", () => {
    const read = [
      ...listed(BASELINE),
      { id: "lib-rounding", file: LISTING_FILE, position: 7, ...DETECTED },
    ];
    expect(named(stateFindings(BASELINE, read))).toStrictEqual([
      {
        kind: FINDING.definitionNotDeclared,
        step: BASELINE.name,
        subject: "lib-rounding",
      },
    ]);
  });

  it("D4223: a definition the corpus declares that the answer does not list is a finding", () => {
    const read = listed(BASELINE).filter(({ id }) => id !== "app-receipt");
    expect(named(stateFindings(BASELINE, read))).toStrictEqual([
      {
        kind: FINDING.declaredDefinitionNotListed,
        step: BASELINE.name,
        subject: "app-receipt",
      },
    ]);
  });

  it("D4224: a verified count one above the step's number is one finding naming the step and the count", () => {
    const counts = {
      ...BASELINE.counts,
      verified: BASELINE.counts.verified + 1,
    };
    expect(named(countFindings(BASELINE, counts))).toStrictEqual([
      {
        kind: FINDING.countNotAsDeclared,
        step: BASELINE.name,
        subject: "verified",
      },
    ]);
  });

  it("D4225: an eligible count one below the step's number is a finding", () => {
    const counts = {
      ...BASELINE.counts,
      eligible: BASELINE.counts.eligible - 1,
    };
    expect(named(countFindings(BASELINE, counts))).toStrictEqual([
      {
        kind: FINDING.countNotAsDeclared,
        step: BASELINE.name,
        subject: "eligible",
      },
    ]);
  });

  it("D4226: a total one above the step's number is a finding", () => {
    const counts = { ...BASELINE.counts, total: BASELINE.counts.total + 1 };
    expect(named(countFindings(BASELINE, counts))).toStrictEqual([
      {
        kind: FINDING.countNotAsDeclared,
        step: BASELINE.name,
        subject: "total",
      },
    ]);
  });

  it("D4227: a state's count one above the step's number is a finding naming the state", () => {
    const counts = {
      ...BASELINE.counts,
      states: {
        ...BASELINE.counts.states,
        [DEFECT_STATE.survived]: BASELINE.counts.states.survived + 1,
      },
    };
    expect(named(countFindings(BASELINE, counts))).toStrictEqual([
      {
        kind: FINDING.countNotAsDeclared,
        step: BASELINE.name,
        subject: expect.stringContaining(DEFECT_STATE.survived),
      },
    ]);
  });

  it("D4228: a definition whose evidence a step replaced without declaring it falsified is a finding", () => {
    const after = afterJob(AT_BASELINE, [
      ...ANCHOR_REWRITTEN.falsified,
      "lib-label",
    ]);
    expect(
      named(falsifiedFindings(ANCHOR_REWRITTEN, AT_BASELINE, after)),
    ).toStrictEqual([
      {
        kind: FINDING.falsifiedOutsideDeclaredSet,
        step: ANCHOR_REWRITTEN.name,
        subject: "lib-label",
      },
    ]);
  });

  it("D4229: a definition a step declares falsified whose evidence is the record it held before is a finding", () => {
    const after = afterJob(AT_BASELINE, ["app-total-second"]);
    expect(
      named(falsifiedFindings(ANCHOR_REWRITTEN, AT_BASELINE, after)),
    ).toStrictEqual([
      {
        kind: FINDING.declaredNotFalsified,
        step: ANCHOR_REWRITTEN.name,
        subject: "app-total-first",
      },
    ]);
  });

  it("D4230: at the baseline a definition is falsified once the store holds a record for it at all", () => {
    const after = stored(
      [...BASELINE.falsified, "app-total-unnamed"],
      "baseline",
    );
    expect(named(falsifiedFindings(BASELINE, [], after))).toStrictEqual([
      {
        kind: FINDING.falsifiedOutsideDeclaredSet,
        step: BASELINE.name,
        subject: "app-total-unnamed",
      },
    ]);
  });

  it("D4231: a record the store held before a step and holds no more, of a definition the step does not declare falsified, is a finding", () => {
    const after = afterJob(AT_BASELINE, ANCHOR_REWRITTEN.falsified, [
      "app-receipt",
    ]);
    expect(
      named(falsifiedFindings(ANCHOR_REWRITTEN, AT_BASELINE, after)),
    ).toStrictEqual([
      {
        kind: FINDING.falsifiedOutsideDeclaredSet,
        step: ANCHOR_REWRITTEN.name,
        subject: "app-receipt",
      },
    ]);
  });

  it("D4232: an evidence record stored under another Vitest version than the replay linked is a finding, beside one under the linked version that is none", () => {
    const evidence = [
      { defectId: "lib-discount", vitestVersion: "5.0.1" },
      { defectId: "lib-label", vitestVersion: "4.1.11" },
    ];
    expect(named(versionFindings(BASELINE, "5.0.1", evidence))).toStrictEqual([
      {
        kind: FINDING.evidenceUnderAnotherVitestVersion,
        step: BASELINE.name,
        subject: "lib-label",
      },
    ]);
  });

  it("D4233: a file the step does not edit that holds other bytes after it is a finding naming the step and the path", () => {
    const after = TREE_AFTER.map((entry) =>
      entry.path === PRICE
        ? { path: PRICE, holds: "file price-rewritten" }
        : entry,
    );
    expect(treeFindingsOver(after)).toStrictEqual([
      {
        kind: FINDING.consumerFileChanged,
        step: ANCHOR_REWRITTEN.name,
        subject: PRICE,
      },
    ]);
  });

  it("D4234: an entry added to the consumer copy during a step is a finding", () => {
    const added = `${PRICE}.orig`;
    const after = [
      ...TREE_AFTER,
      { path: added, holds: "file price-as-committed" },
    ];
    expect(treeFindingsOver(after)).toStrictEqual([
      {
        kind: FINDING.consumerFileChanged,
        step: ANCHOR_REWRITTEN.name,
        subject: added,
      },
    ]);
  });

  it("D4235: an entry removed from the consumer copy during a step is a finding", () => {
    const after = TREE_AFTER.filter((entry) => entry.path !== PRICE);
    expect(treeFindingsOver(after)).toStrictEqual([
      {
        kind: FINDING.consumerFileChanged,
        step: ANCHOR_REWRITTEN.name,
        subject: PRICE,
      },
    ]);
  });

  it("D4236: a file the step edited that reads as before the edit is a finding", () => {
    expect(treeFindingsOver(TREE_BEFORE)).toStrictEqual([
      {
        kind: FINDING.consumerFileChanged,
        step: ANCHOR_REWRITTEN.name,
        subject: CART,
      },
    ]);
  });

  it("D4237: a file the step edited that holds other bytes than the step wrote is a finding", () => {
    const after = TREE_AFTER.map((entry) =>
      entry.path === CART ? { path: CART, holds: "file cart-damaged" } : entry,
    );
    expect(treeFindingsOver(after)).toStrictEqual([
      {
        kind: FINDING.consumerFileChanged,
        step: ANCHOR_REWRITTEN.name,
        subject: CART,
      },
    ]);
  });

  it("D4238: a file other than a definition file that holds a definition's new text is a finding naming the step and the path", () => {
    const files = [
      ...DEFINITION_FILES_READ,
      fileHolding(PRICE, "return price * 0.9;"),
      fileHolding(".rt-test/daemon.log", "transformed with price * 0.8"),
    ];
    expect(
      named(mutationTextFindings(BASELINE, MUTATIONS, files)),
    ).toStrictEqual([
      {
        kind: FINDING.mutationTextOnDisk,
        step: BASELINE.name,
        subject: ".rt-test/daemon.log",
      },
    ]);
  });

  it("D4239: a search that did not read a definition's own definition file throws, naming the definition", () => {
    const files = DEFINITION_FILES_READ.filter(
      ({ path }) => path !== "packages/lib/named-defects.json",
    );
    expect(() => mutationTextFindings(BASELINE, MUTATIONS, files)).toThrow(
      /lib-discount/,
    );
  });

  it("D4240: a round that has not planned leaves a step not settled", () => {
    expect(
      settledWithout({
        schedule: {
          ...SETTLED.schedule,
          round: { state: ROUND.pending, waitsFor: ROUND_WAIT.quietWindow },
        },
      }),
    ).toStrictEqual([true, false]);
  });

  it("D4241: a confirmed workspace that is running leaves a step not settled", () => {
    expect(
      settledWithout({
        schedule: {
          ...SETTLED.schedule,
          workspaces: CORPUS_WORKSPACES.map((workspacePath, index) => ({
            workspacePath,
            state: index === 0 ? EXECUTION_STATE.running : EXECUTION_STATE.idle,
          })),
        },
      }),
    ).toStrictEqual([true, false]);
  });

  it("D4242: a change the daemon has not read leaves a step not settled", () => {
    expect(settledWithout({ inputs: { pendingChanges: 1 } })).toStrictEqual([
      true,
      false,
    ]);
  });

  it("D4243: a canary job in progress, which holds none of its workspace's definitions, leaves a step not settled", () => {
    expect(
      settledWithout({
        activity: {
          state: "falsifying",
          workspacePath: "packages/lib",
          definitions: 0,
        },
      }),
    ).toStrictEqual([true, false]);
  });

  it("D4244: an eligible definition with no evidence leaves a step not settled", () => {
    expect(
      settledWithout({
        definitions: listed(BASELINE, { "lib-discount": NEVER_VERIFIED }),
      }),
    ).toStrictEqual([true, false]);
  });

  it("D4245: the waiting definitions are the eligible ones whose evidence is missing or not current, and no definition that is not eligible", () => {
    const read = listed(BASELINE, {
      "lib-discount": NEVER_VERIFIED,
      "lib-label": { ...DETECTED, evidence: STALE_EVIDENCE },
    });
    expect(waitingDefinitions(read)).toStrictEqual([
      "lib-discount",
      "lib-label",
    ]);
  });

  it("D4246: a step that did not settle is a finding naming the step, the waiting definitions, the activity and each job ended with nothing stored", () => {
    const answer: SettleReading = {
      ...SETTLED,
      activity: {
        state: "falsifying",
        workspacePath: "packages/lib",
        definitions: 0,
      },
      unstoredJobs: [
        {
          workspacePath: "packages/app",
          kind: FALSIFICATION_JOB,
          reason: "its job did not run",
        },
      ],
      definitions: listed(BASELINE, {
        "lib-discount": NEVER_VERIFIED,
        "app-receipt": NEVER_VERIFIED,
      }),
    };
    expect(
      notSettledFinding(BASELINE.name, "the deadline passed", answer),
    ).toStrictEqual({
      kind: FINDING.notSettled,
      step: BASELINE.name,
      subject: expect.any(String),
      detail: expect.stringMatching(
        /(?=[\s\S]*lib-discount, app-receipt)(?=[\s\S]*falsifying[^;]*packages\/lib)(?=[\s\S]*packages\/app[^;]*its job did not run)/,
      ),
    });
  });
});
