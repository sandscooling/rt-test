import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  queryDefects,
  queryWait,
  STOP_DEADLINE_MS,
  type DefectsResponse,
  type WaitResponse,
} from "../src/client.js";
import { RESPONSE_BOUND_MS } from "../src/daemon/protocol.js";
import { WAIT_OUTCOME } from "../src/query/answer.js";
import {
  consumerIdentity,
  defaultStateDirectory,
} from "../src/store/consumer-identity.js";
import type { StoredEvidence } from "../src/store/defect-evidence.js";
import { openStore } from "../src/store/open-store.js";
import { relativePosixPath } from "../src/vitest/find-workspaces.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  settled,
  started,
  withDaemons,
} from "./daemon-harness.js";
import {
  countFindings,
  falsifiedFindings,
  isSettled,
  mutationTextFindings,
  notSettledFinding,
  stateFindings,
  treeFindings,
  versionFindings,
  type Finding,
  type MutationText,
  type SearchedFile,
  type TreeEntry,
} from "./falsification-corpus-findings.js";
import {
  CORPUS_STEPS,
  CORPUS_WORKSPACES,
  DEFINITION_FILES,
  FALSIFICATION_CORPUS_FIXTURE,
  type CorpusStep,
  type FileChange,
} from "./falsification-corpus-steps.js";
import {
  confirmEvery,
  fixtureRepository,
  inConsumerCopy,
  linkWorkspacePackages,
  WAITING,
  within,
  type VitestInstall,
} from "./harness.js";

/** What a replay with no finding returns. */
export const CLEAN = "clean";

export type ReplayReport =
  | typeof CLEAN
  | { readonly install: VitestInstall; readonly findings: readonly Finding[] };

/**
 * How long a replay may take from its copy until its last step has settled. It leaves a test's timeout room for one
 * answer still in flight and for the stop of a daemon with a job in progress, so a replay too slow to finish ends by
 * its report and not by the test's timeout.
 */
export const REPLAY_DEADLINE_MS =
  DAEMON_TEST_TIMEOUT_MS - STOP_DEADLINE_MS - RESPONSE_BOUND_MS;
/** A defects query reads every definition file, so the replay asks a few times a second rather than without pause. */
const SETTLE_POLL_MS = 200;
/** Longer than the slowest look measured between two jobs at the corpus's size, 321 ms on Windows. */
const SETTLE_HOLD_MS = 400;
const TEST_MODULE = /\.test\.mjs$/;
const LINKED_VITEST_MANIFEST = "node_modules/vitest/package.json";
/** The names the tree's byte comparison leaves out at any depth, beside the state directory. */
const LEFT_OUT_OF_THE_TREE: readonly string[] = [".git", "node_modules"];

const ENTRY = {
  file: "file",
  link: "link",
  directory: "directory",
  other: "other",
} as const;

interface Entry {
  /** Absolute. */
  readonly path: string;
  readonly kind: (typeof ENTRY)[keyof typeof ENTRY];
}

/**
 * Replays the falsification corpus against RT Test's own daemon in a fresh copy of its fixture linked to `install`:
 * the baseline and each step in one daemon life, each compared with what it declares once the daemon has finished
 * what it set off. Throws when the harness cannot run (a copy that fails, a start that confirms other than the
 * fixture's workspaces, a daemon that does not start, a step whose text does not match the fixture, a query or a
 * store read that fails), and never returns `CLEAN` over a failure.
 */
export function replayCorpus(install: VitestInstall): Promise<ReplayReport> {
  const deadline = Date.now() + REPLAY_DEADLINE_MS;
  return inConsumerCopy(FALSIFICATION_CORPUS_FIXTURE, install, async (root) => {
    linkWorkspacePackages(root);
    fixtureRepository(root);
    const start = confirmEvery(root);
    const confirmed = start.workspaces.map((workspace) => workspace.path);
    if (
      confirmed.length !== CORPUS_WORKSPACES.length ||
      !CORPUS_WORKSPACES.every((path) => confirmed.includes(path))
    ) {
      throw new Error(
        `The falsification corpus's start confirms ${confirmed.join(", ")}, not ${CORPUS_WORKSPACES.join(", ")}`,
      );
    }
    const stateDirectory = defaultStateDirectory(root);
    const replay = new Replay(root, stateDirectory, deadline);
    const findings = await withDaemons([root], async (pids) => {
      const identity = await started(root, pids, start);
      if ("thrown" in identity) {
        throw new Error(
          `The falsification corpus's daemon did not start: ${identity.thrown}`,
        );
      }
      if (identity.stateDirectory !== stateDirectory) {
        throw new Error(
          `The falsification corpus's daemon keeps its state in ${identity.stateDirectory}, not ${stateDirectory}`,
        );
      }
      await replay.run();
      return replay.findings;
    });
    return findings.length === 0 ? CLEAN : { install, findings };
  });
}

class Replay {
  readonly findings: Finding[] = [];
  readonly #root: string;
  readonly #stateDirectory: string;
  /** A `Date.now()` time. */
  readonly #deadline: number;
  readonly #linkedVersion: string;
  readonly #mutations: readonly MutationText[];
  readonly #testModules: readonly string[];
  /** The copy's tree as the step before left it; before the daemon starts, as the copy was made. */
  #tree: readonly TreeEntry[];
  /** The evidence the store held once the step before had settled; none before the daemon starts. */
  #evidence: readonly StoredEvidence[] = [];

  /** Construct it before the daemon starts, since it takes the first reading of the tree. */
  constructor(root: string, stateDirectory: string, deadline: number) {
    this.#root = root;
    this.#stateDirectory = stateDirectory;
    this.#deadline = deadline;
    this.#linkedVersion = linkedVitestVersion(root);
    this.#mutations = mutationTexts(root);
    this.#tree = treeEntries(root, stateDirectory);
    this.#testModules = this.#tree
      .filter((entry) => TEST_MODULE.test(entry.path))
      .map((entry) => join(root, entry.path));
    if (this.#testModules.length === 0) {
      throw new Error(`${root} holds no test module`);
    }
  }

  /** Stops at the first step that does not settle, since no later step can be judged. */
  async run(): Promise<void> {
    for (const step of CORPUS_STEPS) {
      if (!(await this.#step(step))) return;
    }
  }

  async #step(step: CorpusStep): Promise<boolean> {
    const written = step.changes.map((change) =>
      applyChange(this.#root, change),
    );
    const answer = await this.#settled(step);
    if (answer === undefined) return false;
    const evidence = this.#readEvidence();
    const tree = treeEntries(this.#root, this.#stateDirectory);
    this.findings.push(
      ...stateFindings(step, answer.definitions),
      ...countFindings(step, answer.counts),
      ...falsifiedFindings(step, this.#evidence, evidence),
      ...versionFindings(step, this.#linkedVersion, evidence),
      ...treeFindings(step, this.#tree, tree, written),
      ...mutationTextFindings(step, this.#mutations, regularFiles(this.#root)),
    );
    this.#evidence = evidence;
    this.#tree = tree;
    return true;
  }

  /**
   * The defects answer that shows the daemon has finished what the step set off, or undefined, with a finding, when
   * the step's wait does not settle or the replay's deadline passes first. A daemon about to begin another job with
   * nothing waiting reads idle for the length of a look first, so the step is settled only once every answer has
   * read it for `SETTLE_HOLD_MS`.
   */
  async #settled(step: CorpusStep): Promise<DefectsResponse | undefined> {
    const limitMs = this.#left();
    if (limitMs < 1) {
      return this.#notSettledNow(
        step,
        "the replay's deadline passed before the step's wait began",
      );
    }
    const wait = await queryWait(this.#root, this.#waitPaths(step), {
      limitMs,
    });
    if (wait.outcome !== WAIT_OUTCOME.settled) {
      return this.#notSettledNow(step, waitText(wait));
    }
    let last: DefectsResponse | undefined;
    let settledSince: number | undefined;
    for (let left = this.#left(); left > 0; left = this.#left()) {
      const answer = await this.#answerWithin(left);
      if (answer === undefined) break;
      if (isSettled(answer, CORPUS_WORKSPACES)) {
        settledSince ??= Date.now();
        if (Date.now() - settledSince >= SETTLE_HOLD_MS) return answer;
      } else {
        settledSince = undefined;
      }
      last = answer;
      await new Promise((wake) => setTimeout(wake, SETTLE_POLL_MS));
    }
    return this.#notSettled(
      step,
      `the daemon had not finished the step when the replay's ${REPLAY_DEADLINE_MS} ms had passed`,
      last,
    );
  }

  /**
   * Reports the step not settled for `cause`, beside one defects answer taken in the room the deadline leaves for an
   * answer still in flight. A query that fails there adds its failure to the cause, which stays the finding.
   */
  async #notSettledNow(step: CorpusStep, cause: string): Promise<undefined> {
    const answer = await settled(
      this.#answerWithin(this.#left() + RESPONSE_BOUND_MS),
    );
    if (answer !== undefined && "thrown" in answer) {
      return this.#notSettled(
        step,
        `${cause}; the defects query after it failed: ${answer.thrown}`,
        undefined,
      );
    }
    return this.#notSettled(step, cause, answer);
  }

  #notSettled(
    step: CorpusStep,
    cause: string,
    answer: DefectsResponse | undefined,
  ): undefined {
    this.findings.push(notSettledFinding(step.name, cause, answer));
    return undefined;
  }

  /** Every test module at the baseline, which edits nothing, and after it the files the step changed. */
  #waitPaths(step: CorpusStep): readonly string[] {
    return step.changes.length === 0
      ? this.#testModules
      : step.changes.map((change) => join(this.#root, change.path));
  }

  /** A whole number of ms, below 1 once the deadline has passed. */
  #left(): number {
    return this.#deadline - Date.now();
  }

  /** A defects answer, or undefined when the daemon gives none within `boundMs`; a query that fails first rejects. */
  async #answerWithin(boundMs: number): Promise<DefectsResponse | undefined> {
    const query = queryDefects(this.#root);
    // Once the bound has passed the step is reported not settled, which a query failing later does not change.
    void query.catch(() => undefined);
    const answer = await within(query, boundMs);
    return answer === WAITING ? undefined : answer;
  }

  #readEvidence(): readonly StoredEvidence[] {
    const store = openStore(this.#stateDirectory);
    try {
      return store.readLatestResults(consumerIdentity(this.#root)).evidence;
    } finally {
      store.close();
    }
  }
}

function waitText(wait: WaitResponse): string {
  const files = wait.files.map((file) => file.path).join(", ");
  const unread = wait.files
    .filter((file) => file.unread !== undefined)
    .map((file) => `${file.path} unread: ${file.unread?.reason}`);
  const superseded =
    wait.outcome === WAIT_OUTCOME.superseded
      ? [
          `superseded at ${wait.supersededAt} by ${wait.changedPaths.named.join(", ")}`,
        ]
      : [];
  return [
    `the wait on ${files} answered ${wait.outcome}`,
    ...superseded,
    ...unread,
  ].join(", ");
}

/** Replaces the one occurrence of the change's text, and returns the file as a tree reading holds what was written. */
function applyChange(root: string, change: FileChange): TreeEntry {
  const file = join(root, change.path);
  const parts = readFileSync(file, "utf8").split(change.from);
  if (parts.length !== 2) {
    throw new Error(
      `${change.path} holds ${parts.length - 1} occurrences of ${change.from}, not one`,
    );
  }
  const written = parts.join(change.to);
  writeFileSync(file, written);
  return { path: change.path, holds: fileHolding(written) };
}

function fileHolding(content: string | Buffer): string {
  const digest = createHash("sha256").update(content).digest("hex");
  return `${ENTRY.file} ${digest}`;
}

/** The version of the install the copy links, read through the link. */
function linkedVitestVersion(root: string): string {
  const manifest = join(root, LINKED_VITEST_MANIFEST);
  const { version } = JSON.parse(readFileSync(manifest, "utf8")) as {
    version?: unknown;
  };
  if (typeof version !== "string") {
    throw new Error(`${manifest} names no version`);
  }
  return version;
}

/** Each definition's `new` text, read from the copy's definition files before the daemon starts. */
function mutationTexts(root: string): MutationText[] {
  return DEFINITION_FILES.flatMap((definitionFile) => {
    const { defects } = JSON.parse(
      readFileSync(join(root, definitionFile), "utf8"),
    ) as { defects: { id: string; mutation: { new: string } }[] };
    return defects.map(({ id, mutation }) => ({
      id,
      definitionFile,
      text: mutation.new,
    }));
  });
}

/** Every entry beneath `directory` but those `leftOut` names and what they hold; no link is followed. */
function entriesUnder(
  directory: string,
  leftOut: (name: string, path: string) => boolean,
): Entry[] {
  return readdirSync(directory).flatMap((name): Entry[] => {
    const path = join(directory, name);
    if (leftOut(name, path)) return [];
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [{ path, kind: ENTRY.link }];
    if (stat.isFile()) return [{ path, kind: ENTRY.file }];
    if (!stat.isDirectory()) return [{ path, kind: ENTRY.other }];
    return [{ path, kind: ENTRY.directory }, ...entriesUnder(path, leftOut)];
  });
}

/**
 * The copy's tree outside `.git`, any directory named `node_modules` and the state directory, which the daemon and a
 * run write to: each entry with a file's digest, a link's target, or its kind.
 */
function treeEntries(root: string, stateDirectory: string): TreeEntry[] {
  const leftOut = (name: string, path: string): boolean =>
    LEFT_OUT_OF_THE_TREE.includes(name) || path === stateDirectory;
  return entriesUnder(root, leftOut).map(({ path, kind }) => ({
    path: relativePosixPath(root, path),
    holds: heldBy(path, kind),
  }));
}

function heldBy(path: string, kind: Entry["kind"]): string {
  switch (kind) {
    case ENTRY.file:
      return fileHolding(readFileSync(path));
    case ENTRY.link:
      return `${kind} ${readlinkSync(path)}`;
    case ENTRY.directory:
    case ENTRY.other:
      return kind;
  }
}

/** Every regular file beneath `root` with its bytes, `.git`, `node_modules` and the state directory included. */
function regularFiles(root: string): SearchedFile[] {
  return entriesUnder(root, () => false)
    .filter(({ kind }) => kind === ENTRY.file)
    .map(({ path }) => ({
      path: relativePosixPath(root, path),
      content: readFileSync(path),
    }));
}
