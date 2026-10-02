import {
  activityText,
  roundText,
  type DaemonActivity,
  type DefectCounts,
  type DefectsResponse,
  type ListedDefinition,
  type UnstoredJob,
} from "../src/client.js";
import { CURRENT, EXECUTION_STATE, ROUND } from "../src/query/answer.js";
import type { StoredEvidence } from "../src/store/defect-evidence.js";
import type {
  CorpusStep,
  DeclaredDefinition,
} from "./falsification-corpus-steps.js";

export const FINDING = {
  notSettled: "not-settled",
  stateNotAsDeclared: "state-not-as-declared",
  countNotAsDeclared: "count-not-as-declared",
  definitionNotDeclared: "definition-not-declared",
  declaredDefinitionNotListed: "declared-definition-not-listed",
  falsifiedOutsideDeclaredSet: "falsified-outside-declared-set",
  declaredNotFalsified: "declared-not-falsified",
  evidenceUnderAnotherVitestVersion: "evidence-under-another-vitest-version",
  consumerFileChanged: "consumer-file-changed",
  mutationTextOnDisk: "mutation-text-on-disk",
} as const;

export type FindingKind = (typeof FINDING)[keyof typeof FINDING];

export interface Finding {
  readonly kind: FindingKind;
  /** The step's name. */
  readonly step: string;
  /** The definition, count or path involved. */
  readonly subject: string;
  /** What was declared and what was read. */
  readonly detail: string;
}

/** What the comparisons read of a definition an answer lists. */
export type DefinitionReading = Pick<
  ListedDefinition,
  "id" | "file" | "position" | "state" | "eligible" | "evidence"
>;

export type CountsReading = Pick<
  DefectCounts,
  "total" | "eligible" | "verified" | "states"
>;

/** What of a defects answer says whether the daemon has finished what a step set off. */
export interface SettleReading {
  readonly schedule: Pick<DefectsResponse["schedule"], "round" | "workspaces">;
  readonly inputs: Pick<DefectsResponse["inputs"], "pendingChanges">;
  readonly activity: DaemonActivity;
  readonly unstoredJobs: readonly UnstoredJob[];
  readonly definitions: readonly DefinitionReading[];
}

/** One entry of the consumer copy, by what it holds: a file's digest, a link's target, or that it is a directory. */
export interface TreeEntry {
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
  readonly holds: string;
}

/** A regular file of the consumer copy with its bytes. */
export interface SearchedFile {
  /** Relative to the consumer root, `/`-separated. */
  readonly path: string;
  readonly content: Buffer;
}

/** A definition's `new` text, and the definition file that holds it. */
export interface MutationText {
  readonly id: string;
  /** Relative to the consumer root, `/`-separated. */
  readonly definitionFile: string;
  readonly text: string;
}

const IDLE: DaemonActivity["state"] = "idle";
const COUNTED = ["total", "eligible", "verified"] as const;
const THE_DAEMON = "the daemon";

export function finding(
  kind: FindingKind,
  step: string,
  subject: string,
  detail: string,
): Finding {
  return { kind, step, subject, detail };
}

/** Each eligible definition whose evidence is missing or not current, by its id, or its file and position without one. */
export function waitingDefinitions(
  definitions: readonly DefinitionReading[],
): string[] {
  return definitions
    .filter(
      (definition) =>
        definition.eligible && definition.evidence?.freshness !== CURRENT,
    )
    .map(definitionName);
}

/**
 * Whether the daemon has finished what a step set off: its round planned, each of `workspaces` listed and every listed
 * workspace idle, no change unread, its activity idle, and no definition waiting. A workspace reads idle while it is
 * falsified, so the activity and the waiting definitions are what show a falsification still to come or in progress.
 */
export function isSettled(
  answer: SettleReading,
  workspaces: readonly string[],
): boolean {
  const { round, workspaces: executions } = answer.schedule;
  return (
    round.state === ROUND.planned &&
    workspaces.every((path) =>
      executions.some((execution) => execution.workspacePath === path),
    ) &&
    executions.every((execution) => execution.state === EXECUTION_STATE.idle) &&
    answer.inputs.pendingChanges === 0 &&
    answer.activity.state === IDLE &&
    waitingDefinitions(answer.definitions).length === 0
  );
}

/** The step did not settle for `cause`; `answer` is the last one read, undefined when the daemon gave none. */
export function notSettledFinding(
  step: string,
  cause: string,
  answer: SettleReading | undefined,
): Finding {
  const pending =
    answer === undefined ? "no defects answer was read" : pendingText(answer);
  return finding(FINDING.notSettled, step, THE_DAEMON, `${cause}; ${pending}`);
}

function pendingText(answer: SettleReading): string {
  const { round, workspaces } = answer.schedule;
  const states = workspaces.map(
    (workspace) => `${workspace.workspacePath} ${workspace.state}`,
  );
  return [
    `waiting definitions: ${listText(waitingDefinitions(answer.definitions))}`,
    `activity: ${activityText(answer.activity)}`,
    roundText(round),
    `workspaces: ${listText(states)}`,
    `${answer.inputs.pendingChanges} change(s) unread`,
    `jobs ended with nothing stored: ${listText(answer.unstoredJobs.map(unstoredJobText))}`,
  ].join("; ");
}

function unstoredJobText(job: UnstoredJob): string {
  const kind = job.kind === undefined ? "" : ` (${job.kind})`;
  return `${job.workspacePath ?? "the discovery"}${kind}: ${job.reason}`;
}

function listText(items: readonly string[]): string {
  return items.length === 0 ? "none" : items.join(", ");
}

/**
 * Each listed definition whose state, eligibility, evidence freshness or reason is not the step's, each one listed
 * that the step does not declare, and each one declared that the answer does not list.
 */
export function stateFindings(
  step: CorpusStep,
  definitions: readonly DefinitionReading[],
): Finding[] {
  const listedIds = new Set(definitions.map((definition) => definition.id));
  const notListed = Object.entries(step.definitions)
    .filter(([id]) => !listedIds.has(id))
    .map(([id, declared]) =>
      finding(
        FINDING.declaredDefinitionNotListed,
        step.name,
        id,
        `declared ${readingText(declared)}; the answer does not list it`,
      ),
    );
  return [
    ...definitions.flatMap((definition) => listedFinding(step, definition)),
    ...notListed,
  ];
}

function listedFinding(
  step: CorpusStep,
  definition: DefinitionReading,
): Finding[] {
  const declared =
    definition.id === null ? undefined : step.definitions[definition.id];
  if (declared === undefined) {
    return [
      finding(
        FINDING.definitionNotDeclared,
        step.name,
        definitionName(definition),
        `the answer lists it as ${readingText(definition)}; the step declares no such definition`,
      ),
    ];
  }
  if (sameReading(declared, definition)) return [];
  return [
    finding(
      FINDING.stateNotAsDeclared,
      step.name,
      definitionName(definition),
      `declared ${readingText(declared)}; the answer reads ${readingText(definition)}`,
    ),
  ];
}

function sameReading(
  declared: DeclaredDefinition,
  read: DefinitionReading,
): boolean {
  return (
    declared.state === read.state &&
    declared.eligible === read.eligible &&
    declared.evidence?.freshness === read.evidence?.freshness &&
    declared.evidence?.reason === read.evidence?.reason
  );
}

function readingText(reading: DeclaredDefinition | DefinitionReading): string {
  const { state, eligible, evidence } = reading;
  const reason =
    evidence?.reason === undefined ? "" : `, reason ${evidence.reason}`;
  return [
    state,
    eligible ? "eligible" : "not eligible",
    evidence === undefined
      ? "no evidence"
      : `evidence ${evidence.freshness}${reason}`,
  ].join(", ");
}

function definitionName(definition: DefinitionReading): string {
  return definition.id ?? `${definition.file}#${definition.position}`;
}

/**
 * Each of the total, eligible and verified counts, and each state's count, that is not the step's number, and each
 * state the answer counts a definition in that the step does not declare.
 */
export function countFindings(
  step: CorpusStep,
  counts: CountsReading,
): Finding[] {
  const declaredStates: Readonly<Record<string, number | undefined>> =
    step.counts.states;
  const readStates: Readonly<Record<string, number | undefined>> =
    counts.states;
  const states = new Set([
    ...Object.keys(declaredStates),
    ...Object.keys(readStates),
  ]);
  return [
    ...COUNTED.flatMap((name) =>
      countFinding(step.name, name, step.counts[name], counts[name]),
    ),
    ...[...states].flatMap((state) =>
      countFinding(
        step.name,
        `state ${state}`,
        declaredStates[state],
        readStates[state],
      ),
    ),
  ];
}

function countFinding(
  step: string,
  subject: string,
  declared: number | undefined,
  read: number | undefined,
): Finding[] {
  if (declared === read) return [];
  if (declared === undefined) {
    if (read === 0) return [];
    return [
      finding(
        FINDING.countNotAsDeclared,
        step,
        subject,
        `the answer counts ${read}; the step declares no such state`,
      ),
    ];
  }
  const answered = read === undefined ? "gives no count" : `counts ${read}`;
  return [
    finding(
      FINDING.countNotAsDeclared,
      step,
      subject,
      `declared ${declared}; the answer ${answered}`,
    ),
  ];
}

/**
 * A definition was falsified at a step when the evidence the store holds for it after the step is not the record it
 * held before, or it held none before. Reports each one falsified that the step does not declare, each one declared
 * that was not falsified, and each undeclared one whose record the store held before and holds no more.
 */
export function falsifiedFindings(
  step: CorpusStep,
  before: readonly Pick<StoredEvidence, "defectId" | "evidenceId">[],
  after: readonly Pick<StoredEvidence, "defectId" | "evidenceId">[],
): Finding[] {
  const heldBefore = new Map(
    before.map((record) => [record.defectId, record.evidenceId]),
  );
  const heldAfter = new Map(
    after.map((record) => [record.defectId, record.evidenceId]),
  );
  const falsified = [...heldAfter]
    .filter(([id, evidenceId]) => heldBefore.get(id) !== evidenceId)
    .map(([id]) => id);
  const outside = falsified
    .filter((id) => !step.falsified.includes(id))
    .map((id) => {
      const earlier = heldBefore.get(id);
      const held =
        earlier === undefined
          ? "which held none before the step"
          : `in place of ${earlier}`;
      return finding(
        FINDING.falsifiedOutsideDeclaredSet,
        step.name,
        id,
        `the store holds evidence ${heldAfter.get(id)} for it, ${held}; the step declares falsified: ${listText(step.falsified)}`,
      );
    });
  const lost = [...heldBefore]
    .filter(([id]) => !heldAfter.has(id) && !step.falsified.includes(id))
    .map(([id, earlier]) =>
      finding(
        FINDING.falsifiedOutsideDeclaredSet,
        step.name,
        id,
        `the store no longer holds the evidence ${earlier} it held for it before the step; the step declares falsified: ${listText(step.falsified)}`,
      ),
    );
  const missing = step.falsified
    .filter((id) => !falsified.includes(id))
    .map((id) => {
      const later = heldAfter.get(id);
      const held =
        later === undefined
          ? "the store holds no evidence for it"
          : `the store still holds evidence ${later} for it, as before the step`;
      return finding(
        FINDING.declaredNotFalsified,
        step.name,
        id,
        `declared falsified; ${held}`,
      );
    });
  return [...outside, ...lost, ...missing];
}

/** Each evidence record stored under another Vitest version than the install the replay linked. */
export function versionFindings(
  step: CorpusStep,
  linkedVersion: string,
  evidence: readonly Pick<StoredEvidence, "defectId" | "vitestVersion">[],
): Finding[] {
  return evidence
    .filter((record) => record.vitestVersion !== linkedVersion)
    .map((record) =>
      finding(
        FINDING.evidenceUnderAnotherVitestVersion,
        step.name,
        record.defectId,
        `its evidence was stored under Vitest ${record.vitestVersion}; the replay linked Vitest ${linkedVersion}`,
      ),
    );
}

/**
 * Compares the reading taken once the step settled with the one before it: each file the step edited holds what the
 * step wrote, `written`, and every other entry holds what it held. Reports each entry added or removed, each other
 * entry that differs, and each edited file that holds other bytes than the step's, the bytes it held before among them.
 */
export function treeFindings(
  step: CorpusStep,
  before: readonly TreeEntry[],
  after: readonly TreeEntry[],
  written: readonly TreeEntry[],
): Finding[] {
  const earlier = new Map(before.map((entry) => [entry.path, entry.holds]));
  const later = new Map(after.map((entry) => [entry.path, entry.holds]));
  const edited = new Map(written.map((entry) => [entry.path, entry.holds]));
  const paths = new Set([...earlier.keys(), ...later.keys(), ...edited.keys()]);
  return [...paths].sort().flatMap((path) => {
    const [held, holds, wrote] = [
      earlier.get(path),
      later.get(path),
      edited.get(path),
    ];
    const difference =
      wrote === undefined
        ? untouchedDifference(held, holds)
        : editedDifference(held, holds, wrote);
    return difference === undefined
      ? []
      : [finding(FINDING.consumerFileChanged, step.name, path, difference)];
  });
}

/** What is wrong with a path the step does not edit, or undefined when it holds what it held. */
function untouchedDifference(
  before: string | undefined,
  after: string | undefined,
): string | undefined {
  if (before === after) return undefined;
  if (before === undefined) {
    return `added since the reading before, holding ${after}`;
  }
  if (after === undefined) return `removed; it held ${before}`;
  return `held ${before} before the step and holds ${after} after it; the step does not edit it`;
}

/** What is wrong with a file the step edited, or undefined when it holds what the step wrote. */
function editedDifference(
  before: string | undefined,
  after: string | undefined,
  written: string,
): string | undefined {
  if (after === written) return undefined;
  if (after === undefined) {
    return `the step wrote ${written} to it, and the reading does not list it`;
  }
  if (after === before) {
    return "the step edited it, and the reading holds the bytes it held before";
  }
  return `the step wrote ${written} to it, and the reading holds ${after}`;
}

/**
 * Each file, other than a definition file, that holds a definition's `new` text. Throws when a definition's `new`
 * text is not found in its own definition file among `files`, since a search that read nothing would find nothing.
 */
export function mutationTextFindings(
  step: CorpusStep,
  mutations: readonly MutationText[],
  files: readonly SearchedFile[],
): Finding[] {
  for (const mutation of mutations) requireOwnFileHolds(mutation, files);
  const definitionFiles = new Set(
    mutations.map((mutation) => mutation.definitionFile),
  );
  const texts = [...new Set(mutations.map((mutation) => mutation.text))];
  return files
    .filter((file) => !definitionFiles.has(file.path))
    .flatMap((file) =>
      texts
        .filter((text) => file.content.includes(text))
        .map((text) => {
          const ids = mutations
            .filter((mutation) => mutation.text === text)
            .map((mutation) => mutation.id);
          return finding(
            FINDING.mutationTextOnDisk,
            step.name,
            file.path,
            `holds the new text of ${listText(ids)}`,
          );
        }),
    );
}

function requireOwnFileHolds(
  mutation: MutationText,
  files: readonly SearchedFile[],
): void {
  const own = files.find((file) => file.path === mutation.definitionFile);
  if (own?.content.includes(mutation.text) !== true) {
    throw new Error(
      `The search did not find the new text of ${mutation.id} in its own definition file, ${mutation.definitionFile}, among the ${files.length} files it read, so it cannot say the text is nowhere else`,
    );
  }
}
