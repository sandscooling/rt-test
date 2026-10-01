import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestIdentity } from "@rt-test/core";
import { isStringArray } from "../json-guards.js";
import { objectField, readJson, ROOT_PATH } from "../vitest/find-workspaces.js";
import type {
  DefectExperiment,
  ExperimentJudgement,
  FalsificationJob,
} from "./experiment-record.js";
import type { Mutation } from "./mutation-transform.js";

/** RT Test's own canary fixtures, two levels above this module whether it runs from `src` or from `dist`. */
export const BUNDLED_CANARY_DIRECTORY = fileURLToPath(
  new URL("../../canaries/", import.meta.url),
);

const CANARY_FILE = "canaries.json";
/** The members of the canary file, as it spells them. */
const MEMBER = {
  projectName: "projectName",
  assertionErrors: "assertionErrors",
  canaries: "canaries",
  id: "id",
  test: "test",
  modulePath: "modulePath",
  namePath: "namePath",
  mutation: "mutation",
  file: "file",
  old: "old",
  new: "new",
  judgement: "judgement",
  verdict: "verdict",
  reason: "reason",
} as const;
/** The canary file names a test by its name path alone, which is the first test of that path in its module. */
const FIRST_OCCURRENCE = 0;
const DETAIL_SEPARATOR = ": ";

export const CANARY_READING = {
  confirmed: "confirmed",
  disagreed: "disagreed",
  none: "no-reading",
} as const;

/** Why a job over the canary set says nothing of an install, in the order the first that holds is given. */
export const NO_READING_KIND = {
  setUnusable: "set-unusable",
  setNotPlaced: "set-not-placed",
  noReply: "no-reply",
  notRan: "not-ran",
  interrupted: "interrupted",
  otherVitestVersion: "other-vitest-version",
} as const;

type NoReadingKind = (typeof NO_READING_KIND)[keyof typeof NO_READING_KIND];

/** A verdict and a reason, each absent where there is none. */
interface CanaryJudgement {
  readonly verdict?: string;
  readonly reason?: string;
}

interface DisagreedCanary {
  readonly id: string;
  /** What the job's reply gave the canary; empty when the reply held no judgement of it. */
  readonly read: CanaryJudgement;
  /** What the canary file names for it. */
  readonly named: CanaryJudgement;
}

type NoReading =
  | { readonly kind: typeof NO_READING_KIND.interrupted }
  | {
      readonly kind: Exclude<NoReadingKind, typeof NO_READING_KIND.interrupted>;
      readonly detail: string;
    };

/** What one falsification job over the canary set showed under a Vitest install. */
export type CanaryReading =
  | {
      readonly status: typeof CANARY_READING.confirmed;
      readonly vitestVersion: string;
    }
  | {
      readonly status: typeof CANARY_READING.disagreed;
      readonly vitestVersion: string;
      /** In the canary file's order. */
      readonly canaries: readonly DisagreedCanary[];
    }
  | ({ readonly status: typeof CANARY_READING.none } & NoReading);

interface Canary {
  readonly id: string;
  readonly test: Pick<TestIdentity, "modulePath" | "namePath">;
  /** Its `file` is relative to the canary directory. */
  readonly mutation: Mutation;
  readonly judgement: CanaryJudgement;
}

export interface CanarySet {
  readonly projectName: string;
  readonly assertionErrors: readonly string[];
  /** In the file's order, which is the order their job runs them in. */
  readonly canaries: readonly Canary[];
}

type CanarySetRead =
  | { readonly usable: true; readonly set: CanarySet }
  | { readonly usable: false; readonly reason: string };

export function noReading(
  kind: Exclude<NoReadingKind, typeof NO_READING_KIND.interrupted>,
  detail: string,
): CanaryReading {
  return { status: CANARY_READING.none, kind, detail };
}

/** Reads the canary file of `directory`, or says why it cannot be used. */
export function readCanarySet(directory: string): CanarySetRead {
  const file = join(directory, CANARY_FILE);
  const json = readJson(file);
  if (!json.ok) return { usable: false, reason: `${file} ${json.reason}` };
  const set = checkedSet(json.value);
  return typeof set === "string"
    ? { usable: false, reason: `${file} ${set}` }
    : { usable: true, set };
}

/** The set's canaries as a job's experiments over the copy at `root`, in the file's order. */
export function canaryExperiments(
  set: CanarySet,
  root: string,
): DefectExperiment[] {
  return set.canaries.map((canary) => ({
    defectId: canary.id,
    test: {
      workspacePath: ROOT_PATH,
      projectName: set.projectName,
      modulePath: canary.test.modulePath,
      namePath: canary.test.namePath,
      occurrence: FIRST_OCCURRENCE,
    },
    mutation: { ...canary.mutation, file: join(root, canary.mutation.file) },
  }));
}

/** Reads the reply of a job over the set against what the file names and the version of the install it was sent for. */
export function readCanaryJob(
  set: CanarySet,
  job: FalsificationJob,
  installVersion: string,
): CanaryReading {
  if (job.status !== "ran") {
    return noReading(NO_READING_KIND.notRan, notRanDetail(job));
  }
  if (job.interrupted) {
    return { status: CANARY_READING.none, kind: NO_READING_KIND.interrupted };
  }
  if (job.vitestVersion !== installVersion) {
    return noReading(NO_READING_KIND.otherVitestVersion, job.vitestVersion);
  }
  const disagreed = set.canaries.flatMap((canary) =>
    disagreement(canary, job.judgements),
  );
  return disagreed.length === 0
    ? { status: CANARY_READING.confirmed, vitestVersion: installVersion }
    : {
        status: CANARY_READING.disagreed,
        vitestVersion: installVersion,
        canaries: disagreed,
      };
}

type JobNotRan = Exclude<FalsificationJob, { readonly status: "ran" }>;

function notRanDetail(job: JobNotRan): string {
  const text = notRanText(job);
  return text === undefined
    ? job.status
    : `${job.status}${DETAIL_SEPARATOR}${text}`;
}

/** The reply's own words for why it did not run; undefined when it has none. */
function notRanText(job: JobNotRan): string | undefined {
  switch (job.status) {
    case "failed":
      return job.error;
    case "refused":
      return job.refusal.kind === "not-prepared"
        ? `${job.refusal.kind}${DETAIL_SEPARATOR}${job.refusal.error}`
        : job.refusal.kind;
    case "unsupported":
      return job.vitest.reason;
    case "not-confirmed":
      return job.reason;
    case "interrupted-before-load":
      return undefined;
  }
}

/** The canary when the reply's judgement of it is not the verdict and the reason the file names, and nothing else. */
function disagreement(
  canary: Canary,
  judgements: readonly ExperimentJudgement[],
): DisagreedCanary[] {
  const found = judgements.find(({ defectId }) => defectId === canary.id);
  const verdict = found?.verdict;
  const reason =
    found !== undefined && "reason" in found ? found.reason : undefined;
  const named = canary.judgement;
  if (verdict === named.verdict && reason === named.reason) return [];
  const read = {
    ...(verdict === undefined ? {} : { verdict }),
    ...(reason === undefined ? {} : { reason }),
  };
  return [{ id: canary.id, read, named }];
}

/** The set, or what is wrong with the file's value, worded to follow the file's path. */
function checkedSet(value: unknown): CanarySet | string {
  const projectName = objectField(value, MEMBER.projectName);
  if (typeof projectName !== "string") {
    return `holds no ${MEMBER.projectName} that is a string`;
  }
  const assertionErrors = objectField(value, MEMBER.assertionErrors);
  if (!isStringArray(assertionErrors)) {
    return `holds no ${MEMBER.assertionErrors} that is an array of strings`;
  }
  const listed = objectField(value, MEMBER.canaries);
  if (!Array.isArray(listed) || listed.length === 0) {
    return `holds no ${MEMBER.canaries} that is a non-empty array`;
  }
  const canaries: Canary[] = [];
  for (const [position, entry] of listed.entries()) {
    const canary = checkedCanary(entry);
    if (canary === undefined) {
      return `holds at position ${position} of its ${MEMBER.canaries} a canary with a member missing or of another type`;
    }
    canaries.push(canary);
  }
  return { projectName, assertionErrors, canaries };
}

function checkedCanary(value: unknown): Canary | undefined {
  const id = objectField(value, MEMBER.id);
  const test = checkedTest(objectField(value, MEMBER.test));
  const mutation = checkedMutation(objectField(value, MEMBER.mutation));
  const judgement = checkedJudgement(objectField(value, MEMBER.judgement));
  if (
    typeof id !== "string" ||
    test === undefined ||
    mutation === undefined ||
    judgement === undefined
  ) {
    return undefined;
  }
  return { id, test, mutation, judgement };
}

function checkedTest(value: unknown): Canary["test"] | undefined {
  const modulePath = objectField(value, MEMBER.modulePath);
  const namePath = objectField(value, MEMBER.namePath);
  return typeof modulePath === "string" && isStringArray(namePath)
    ? { modulePath, namePath }
    : undefined;
}

function checkedMutation(value: unknown): Mutation | undefined {
  const file = objectField(value, MEMBER.file);
  const old = objectField(value, MEMBER.old);
  const replacement = objectField(value, MEMBER.new);
  return typeof file === "string" &&
    typeof old === "string" &&
    typeof replacement === "string"
    ? { file, old, new: replacement }
    : undefined;
}

function checkedJudgement(value: unknown): CanaryJudgement | undefined {
  const verdict = objectField(value, MEMBER.verdict);
  const reason = objectField(value, MEMBER.reason);
  if (typeof verdict !== "string") return undefined;
  if (reason === undefined) return { verdict };
  return typeof reason === "string" ? { verdict, reason } : undefined;
}
