import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  queryPathStatus,
  querySummary,
  queryWait,
  roundText,
  type SummaryResponse,
  type WaitResponse,
} from "../src/client.js";
import { EXECUTION_STATE, ROUND, WAIT_OUTCOME } from "../src/query/answer.js";
import { declaredNonInputs, readNonInputs } from "../src/inputs/non-inputs.js";
import type { Protection } from "../src/inputs/protection.js";
import { SKIPPED_DIRECTORIES } from "../src/selection/source-walk.js";
import { consumerIdentity } from "../src/store/consumer-identity.js";
import { openStore } from "../src/store/open-store.js";
import type { StoredRun } from "../src/store/stored-records.js";
import {
  eventually,
  settled,
  started,
  withDaemons,
  type Settled,
} from "./daemon-harness.js";
import {
  daemonFindings,
  daemonSide,
  declaredFailureFindings,
  FINDING,
  finding,
  storedRunFindings,
  type Finding,
  type FindingKind,
} from "./edit-corpus-findings.js";
import { fullRun, type FullRun } from "./edit-corpus-full-run.js";
import {
  CHANGE,
  CORPUS_WORKSPACES,
  EDIT_CORPUS_FIXTURE,
  NO_FAILURES,
  type CorpusEdit,
  type CorpusSequence,
  type FileChange,
} from "./edit-corpus-sequences.js";
import {
  confirmEvery,
  fixtureRepository,
  inConsumerCopy,
  linkWorkspacePackages,
} from "./harness.js";

export { FINDING, type Finding, type FindingKind };

/** What a sequence with no finding returns. */
export const CLEAN = "clean";

export type SequenceReport =
  | typeof CLEAN
  | { readonly sequence: string; readonly findings: readonly Finding[] };

/** The step before a sequence's first edit, at which every confirmed workspace runs once. */
export const BASELINE = "baseline";

/** Covers a start's discovery and a run of every workspace, with room for a loaded machine. */
const WAIT_LIMIT_MS = 45_000;
/** How long the daemon may take, after a wait has settled, to have its round planned and every workspace idle. */
const IDLE_BOUND_MS = 15_000;
const TEST_MODULE = /\.test\.mjs$/;
/** Asks only whether a path matches a declared pattern: no fixture file both matches one and is protected. */
const NOTHING_PROTECTED: Protection = {
  applies: true,
  files: new Set(),
  patternKey: "",
  protects: () => false,
};
const REPORT_PREFIX = "full-run";

/**
 * Replays `sequence` against RT Test's own daemon in a fresh copy of the edit corpus's fixture, and after its baseline
 * and each edit compares the daemon with a full run by plain Vitest. Throws when the harness cannot run (a copy that
 * fails, a start that confirms other than the fixture's workspaces, a daemon that does not start, an edit that does
 * not apply to the fixture) and when the daemon fails to answer a summary or path status, or its store a read.
 */
export function checkSequence(
  sequence: CorpusSequence,
): Promise<SequenceReport> {
  return inConsumerCopy(EDIT_CORPUS_FIXTURE, "vitest-4", async (root) => {
    linkWorkspacePackages(root);
    fixtureRepository(root);
    const start = confirmEvery(root);
    const confirmed = start.workspaces.map((workspace) => workspace.path);
    if (
      confirmed.length !== CORPUS_WORKSPACES.length ||
      !CORPUS_WORKSPACES.every((path) => confirmed.includes(path))
    ) {
      throw new Error(
        `The edit corpus's start confirms ${confirmed.join(", ")}, not ${CORPUS_WORKSPACES.join(", ")}`,
      );
    }
    const findings = await withDaemons([root], async (pids) => {
      const identity = await started(root, pids, start);
      if ("thrown" in identity) {
        throw new Error(
          `The edit corpus's daemon did not start: ${identity.thrown}`,
        );
      }
      const replay = new Replay(root, identity.stateDirectory, confirmed);
      await replay.run(sequence.edits);
      return replay.findings;
    });
    return findings.length === 0
      ? CLEAN
      : { sequence: sequence.name, findings };
  });
}

class Replay {
  readonly findings: Finding[] = [];
  readonly #root: string;
  readonly #stateDirectory: string;
  readonly #workspaces: readonly string[];
  /** The consumer copy's parent, inside the run's temp root and removed with the copy. */
  readonly #reportDirectory: string;
  #storedRuns = 0;
  #steps = 0;

  constructor(
    root: string,
    stateDirectory: string,
    workspaces: readonly string[],
  ) {
    this.#root = root;
    this.#stateDirectory = stateDirectory;
    this.#workspaces = workspaces;
    this.#reportDirectory = dirname(root);
  }

  /** Stops at the first step whose wait does not settle or whose daemon does not go idle, since no later step can be judged. */
  async run(edits: readonly CorpusEdit[]): Promise<void> {
    const baseline: CorpusEdit = {
      name: BASELINE,
      changes: [],
      declaredRuns: this.#workspaces,
      declaredFailures: NO_FAILURES,
    };
    if (!(await this.#step(baseline, testModules(this.#root)))) return;
    for (const edit of edits) {
      const paths = changedPaths(this.#root, edit.changes);
      if (!(await this.#step(edit, paths))) return;
    }
  }

  async #step(
    edit: CorpusEdit,
    waitPaths: readonly string[],
  ): Promise<boolean> {
    this.#steps += 1;
    const revisionBefore =
      edit.declaredRuns.length === 0
        ? (await querySummary(this.#root)).inputs.revision
        : undefined;
    if (!(await this.#saveAndWait(edit, waitPaths))) return false;
    if ((await this.#idle(edit.name)) === undefined) return false;
    const result = await this.#fullRun();
    // Read once more after the full run, so a run the daemon began late is still this edit's.
    const idle = await this.#idle(edit.name);
    if (idle === undefined) return false;
    if (
      revisionBefore !== undefined &&
      idle.inputs.revision !== revisionBefore
    ) {
      this.#find(
        FINDING.inputRevisionMoved,
        edit.name,
        "the input revision",
        `${revisionBefore} before the save, ${idle.inputs.revision} once the daemon settled`,
      );
    }
    const runs = this.#readStoredRuns();
    this.findings.push(...storedRunFindings(edit, runs, this.#storedRuns));
    this.#storedRuns = runs.length;
    if (!result.usable) {
      for (const { workspacePath, detail } of result.unusable) {
        this.#find(FINDING.fullRunUnusable, edit.name, workspacePath, detail);
      }
      return true;
    }
    const { tests, failedModules } = result;
    const status = await queryPathStatus(this.#root, this.#root);
    const daemon = daemonSide(runs, status.files, idle.schedule.workspaces);
    this.findings.push(
      ...declaredFailureFindings(edit, tests, failedModules),
      ...daemonFindings(edit.name, tests, failedModules, daemon),
    );
    return true;
  }

  #fullRun(): Promise<FullRun> {
    const step = this.#steps;
    return fullRun(this.#root, this.#workspaces, (path) =>
      join(
        this.#reportDirectory,
        `${REPORT_PREFIX}-${step}-${path.replaceAll("/", "-")}.json`,
      ),
    );
  }

  async #saveAndWait(
    edit: CorpusEdit,
    waitPaths: readonly string[],
  ): Promise<boolean> {
    applyChanges(this.#root, edit.changes);
    if (edit.name === BASELINE) return this.#baselineWait(waitPaths);
    const firstWait = settled(
      queryWait(this.#root, waitPaths, { limitMs: WAIT_LIMIT_MS }),
    );
    if (edit.duringRun === undefined) {
      return this.#settledWait(edit.name, await firstWait, false);
    }
    let answered = false;
    void firstWait.then(() => {
      answered = true;
    });
    await eventually(
      async () => answered || (await this.#declaredRunning(edit)),
      WAIT_LIMIT_MS,
    );
    applyChanges(this.#root, edit.duringRun);
    const bothParts = [
      ...waitPaths,
      ...changedPaths(this.#root, edit.duringRun),
    ];
    const secondWait = await settled(
      queryWait(this.#root, bothParts, { limitMs: WAIT_LIMIT_MS }),
    );
    const first = this.#settledWait(edit.name, await firstWait, true);
    const second = this.#settledWait(edit.name, secondWait, false);
    return first && second;
  }

  /**
   * A wait sent before the first discovery binds before `rt-test.json` first applies, so the declared non-inputs
   * dropping out of the inputs supersedes it once; it waits again then, and any other supersede stays a finding.
   */
  async #baselineWait(waitPaths: readonly string[]): Promise<boolean> {
    const wait = (): Promise<Settled<WaitResponse>> =>
      settled(queryWait(this.#root, waitPaths, { limitMs: WAIT_LIMIT_MS }));
    const first = await wait();
    const answer =
      !("thrown" in first) && this.#supersededByNonInputs(first)
        ? await wait()
        : first;
    return this.#settledWait(BASELINE, answer, false);
  }

  #supersededByNonInputs(answer: WaitResponse): boolean {
    if (answer.outcome !== WAIT_OUTCOME.superseded) return false;
    const { named, more } = answer.changedPaths;
    const declared = declaredNonInputs(
      readNonInputs(this.#root),
      NOTHING_PROTECTED,
    );
    return (
      more === 0 &&
      named.length > 0 &&
      named.every((path) => declared(path) !== undefined)
    );
  }

  async #declaredRunning(edit: CorpusEdit): Promise<boolean> {
    const summary = await settled(querySummary(this.#root));
    return (
      !("thrown" in summary) &&
      summary.schedule.workspaces.some(
        (workspace) =>
          workspace.state === EXECUTION_STATE.running &&
          edit.declaredRuns.includes(workspace.workspacePath),
      )
    );
  }

  #settledWait(
    edit: string,
    answer: Settled<WaitResponse>,
    mayBeSuperseded: boolean,
  ): boolean {
    if ("thrown" in answer) {
      this.#find(FINDING.waitNotSettled, edit, "the wait", answer.thrown);
      return false;
    }
    const { outcome } = answer;
    if (
      outcome === WAIT_OUTCOME.settled ||
      (mayBeSuperseded && outcome === WAIT_OUTCOME.superseded)
    ) {
      return true;
    }
    const unread = answer.files
      .filter((file) => file.unread !== undefined)
      .map((file) => `${file.path} unread: ${file.unread?.reason}`);
    const superseded =
      outcome === WAIT_OUTCOME.superseded
        ? [
            `superseded at ${answer.supersededAt} by ${answer.changedPaths.named.join(", ")}`,
          ]
        : [];
    this.#find(
      FINDING.waitNotSettled,
      edit,
      answer.files.map((file) => file.path).join(", "),
      [`answered ${outcome}`, ...superseded, ...unread].join("; "),
    );
    return false;
  }

  /** The summary that shows the daemon idle, or undefined, with a finding, when it does not get there in time. */
  async #idle(edit: string): Promise<SummaryResponse | undefined> {
    const read: { summary?: Settled<SummaryResponse> } = {};
    const idle = await eventually(async () => {
      read.summary = await settled(querySummary(this.#root));
      return !("thrown" in read.summary) && this.#isIdle(read.summary);
    }, IDLE_BOUND_MS);
    const { summary } = read;
    if (idle && summary !== undefined && !("thrown" in summary)) return summary;
    this.#find(
      FINDING.daemonNotIdle,
      edit,
      "the daemon",
      summary === undefined || "thrown" in summary
        ? String(summary?.thrown)
        : scheduleText(summary),
    );
    return undefined;
  }

  #isIdle(summary: SummaryResponse): boolean {
    const { round, workspaces } = summary.schedule;
    return (
      round.state === ROUND.planned &&
      this.#workspaces.every((path) =>
        workspaces.some(
          (workspace) =>
            workspace.workspacePath === path &&
            workspace.state === EXECUTION_STATE.idle,
        ),
      )
    );
  }

  #readStoredRuns(): StoredRun[] {
    const store = openStore(this.#stateDirectory);
    try {
      return store.readRuns(consumerIdentity(this.#root));
    } finally {
      store.close();
    }
  }

  #find(
    kind: FindingKind,
    edit: string,
    subject: string,
    detail: string,
  ): void {
    this.findings.push(finding(kind, edit, subject, detail));
  }
}

function applyChanges(root: string, changes: readonly FileChange[]): void {
  for (const change of changes) applyChange(root, change);
}

function applyChange(root: string, change: FileChange): void {
  const file = join(root, change.path);
  switch (change.kind) {
    case CHANGE.replace: {
      const parts = readFileSync(file, "utf8").split(change.from);
      if (parts.length !== 2) {
        throw new Error(
          `${change.path} holds ${parts.length - 1} occurrences of ${change.from}, not one`,
        );
      }
      writeFileSync(file, parts.join(change.to));
      return;
    }
    case CHANGE.create:
      if (existsSync(file)) throw new Error(`${change.path} already exists`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, change.content);
      return;
    case CHANGE.delete:
      rmSync(file);
      return;
    case CHANGE.rename: {
      const target = join(root, change.to);
      if (existsSync(target)) throw new Error(`${change.to} already exists`);
      const content = readFileSync(file);
      mkdirSync(dirname(target), { recursive: true });
      rmSync(file);
      writeFileSync(target, content);
      return;
    }
    case CHANGE.resave:
      writeFileSync(file, readFileSync(file));
      return;
  }
}

/** Every path the changes touch, a renamed file's old and new paths both, as absolute paths. */
function changedPaths(root: string, changes: readonly FileChange[]): string[] {
  return changes
    .flatMap((change) =>
      change.kind === CHANGE.rename ? [change.path, change.to] : [change.path],
    )
    .map((path) => join(root, path));
}

/** Every `.test.mjs` module under `directory`, as the fixture names them, as absolute paths; throws when there is none. */
function testModules(directory: string): string[] {
  const found = modulesUnder(directory);
  if (found.length === 0) throw new Error(`${directory} holds no test module`);
  return found;
}

function modulesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.includes(entry.name) ? [] : modulesUnder(path);
    }
    return entry.isFile() && TEST_MODULE.test(entry.name) ? [path] : [];
  });
}

function scheduleText(summary: SummaryResponse): string {
  const { round, workspaces } = summary.schedule;
  const states = workspaces.map(
    (workspace) => `${workspace.workspacePath} ${workspace.state}`,
  );
  return `${roundText(round)}; ${states.join(", ")}`;
}
