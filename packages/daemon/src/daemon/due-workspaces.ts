import type { TestOutcome } from "@rt-test/core";
import { workspaceTestModules } from "../inputs/non-inputs.js";
import { CURRENT, DUE_REASON, type DueReason } from "../query/answer.js";
import {
  isCurrentAdapterVersion,
  recordFreshness,
} from "../query/test-states.js";
import { NOT_FINGERPRINTED } from "../store/schema.js";
import type { StoredRun } from "../store/stored-records.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";

/** How the log's `due:` line gives each due reason. */
export const DUE_REASON_TEXT: Readonly<Record<DueReason, string>> = {
  [DUE_REASON.noRun]: "it has no stored run",
  [DUE_REASON.anotherAdapterVersion]:
    "its latest run was stored under another adapter version",
  [DUE_REASON.notFingerprinted]: "its latest run was stored not fingerprinted",
  [DUE_REASON.noCurrentFingerprint]:
    "its current input fingerprint cannot be computed",
  [DUE_REASON.inputsChanged]: "its inputs differ from those of its latest run",
  [DUE_REASON.failedRun]:
    "its latest run failed with no input change to blame, so the periodic reconciliation retries it",
  [DUE_REASON.crashedRun]:
    "its latest run's executor process ended during the run with no input change to blame, so the periodic reconciliation retries it",
};

/** Why the periodic reconciliation retries a workspace by its latest run: that run failed or crashed. Undefined for any other run. */
export function retryReason(
  latest: StoredRun | undefined,
): DueReason | undefined {
  switch (latest?.run.status) {
    case "failed":
      return DUE_REASON.failedRun;
    case "crashed":
      return DUE_REASON.crashedRun;
    default:
      return undefined;
  }
}

/**
 * Whether the next periodic reconciliation retries the workspace: its latest run failed or crashed, or its last run
 * attempted stored nothing while it is still not current.
 */
export function retryOwed(
  latest: StoredRun | undefined,
  stale: DueReason | undefined,
  attemptStoredNothing: boolean,
): boolean {
  return (
    retryReason(latest) !== undefined ||
    (attemptStoredNothing && stale !== undefined)
  );
}

export const QUEUE_GROUP = {
  directTarget: "direct-target",
  priorFailure: "prior-failure",
  rest: "rest",
} as const;

export type QueueGroup = (typeof QUEUE_GROUP)[keyof typeof QUEUE_GROUP];

/** The order the groups run in within a round. */
const GROUP_ORDER: readonly QueueGroup[] = [
  QUEUE_GROUP.directTarget,
  QUEUE_GROUP.priorFailure,
  QUEUE_GROUP.rest,
];

export const GROUP_REASON: Readonly<Record<QueueGroup, string>> = {
  [QUEUE_GROUP.directTarget]:
    "it owns a path that changed since the previous round",
  [QUEUE_GROUP.priorFailure]: "its latest run holds a failed or errored test",
  [QUEUE_GROUP.rest]:
    "no changed path names it and its latest run holds no failed test",
};

const FAILING_OUTCOMES: readonly TestOutcome[] = ["failed", "error"];

/** A workspace to run, with why it is due and where it falls in the round's order. */
export interface QueuedWorkspace {
  readonly entry: WorkspaceDiscovery;
  readonly reason: DueReason;
  readonly group: QueueGroup;
}

/**
 * Why the workspace's latest stored run is not bound to its current fingerprint, compared as an answer rates a finished
 * result; undefined when it is bound to it, even when its tests read unknown because the run finished none.
 */
export function staleReason(
  latest: StoredRun | undefined,
  currentDigest: string | undefined,
): DueReason | undefined {
  if (latest === undefined) return DUE_REASON.noRun;
  if (recordFreshness(latest, currentDigest) === CURRENT) return undefined;
  if (!isCurrentAdapterVersion(latest.adapterVersion)) {
    return DUE_REASON.anotherAdapterVersion;
  }
  if (latest.inputFingerprint.kind === NOT_FINGERPRINTED) {
    return DUE_REASON.notFingerprinted;
  }
  return currentDigest === undefined
    ? DUE_REASON.noCurrentFingerprint
    : DUE_REASON.inputsChanged;
}

/** Whether the run recorded a test whose outcome is `failed` or `error`; a run with no test result holds none. */
export function holdsFailingTest(latest: StoredRun | undefined): boolean {
  if (latest === undefined || latest.run.status !== "ran") return false;
  return latest.run.modules.some(
    (module) =>
      module.state === "ran" &&
      module.tests.some(
        (test) =>
          test.execution === "finished" &&
          FAILING_OUTCOMES.includes(test.outcome),
      ),
  );
}

export function queueGroup(
  workspacePath: string,
  latest: StoredRun | undefined,
  directTargets: ReadonlySet<string>,
): QueueGroup {
  if (directTargets.has(workspacePath)) return QUEUE_GROUP.directTarget;
  return holdsFailingTest(latest) ? QUEUE_GROUP.priorFailure : QUEUE_GROUP.rest;
}

/** Each group in turn, each in the order given, which is the discovery's workspace order. */
export function orderQueue(
  queue: readonly QueuedWorkspace[],
): QueuedWorkspace[] {
  return GROUP_ORDER.flatMap((group) =>
    queue.filter((queued) => queued.group === group),
  );
}

/** The workspace's listed test modules as one comparable value: a change of the list makes a new one. */
export function testModulesKey(entry: WorkspaceDiscovery): string {
  return JSON.stringify([...workspaceTestModules(entry)].sort());
}
