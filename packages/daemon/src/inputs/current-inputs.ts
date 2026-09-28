import {
  RECONCILIATION_COMPLETE,
  RECONCILIATION_INCOMPLETE,
  WATCHER_HEALTHY,
  WATCHER_UNHEALTHY,
  type InputFacts,
} from "../query/answer.js";
import {
  discoveryFingerprint,
  protectedFileChangedSince,
  SnapshotReads,
  workspaceFingerprint,
  type FingerprintResult,
  type ProjectInputs,
} from "./fingerprint.js";
import type { CurrentInputs } from "./input-tracker.js";

const FIRST_RECONCILIATION_REASON = "the first reconciliation has not ended";
const RECONCILING_REASON = "a reconciliation of the inputs is running";
const STOPPED_REASON = "the daemon is stopping";
const PROTECTING_REASON =
  "a change of protection is finding the files a declared pattern no longer hides";

/** The tracker's state that decides whether a fingerprint can be computed now. */
export interface TrackerCondition {
  readonly stopped: boolean;
  readonly lastReconciledAt: string | undefined;
  readonly reconciling: boolean;
  readonly establishFailure: string | undefined;
  readonly watchFailure: string | undefined;
  /** Whether a change of protection is still walking for the files it made inputs. */
  readonly protecting: boolean;
  /** Paths queued or being read. */
  readonly pending: number;
}

/** What a query reads of the inputs' state, beside the revision and git's unread listings. */
export function inputFacts(
  condition: TrackerCondition,
  revision: number,
  gitUnread: InputFacts["gitUnread"],
): InputFacts {
  const incomplete = incompleteReason(condition);
  const { lastReconciledAt, watchFailure } = condition;
  return {
    revision,
    reconciliation:
      incomplete === undefined
        ? { state: RECONCILIATION_COMPLETE }
        : { state: RECONCILIATION_INCOMPLETE, reason: incomplete },
    ...(lastReconciledAt === undefined ? {} : { lastReconciledAt }),
    watcher:
      watchFailure === undefined
        ? { state: WATCHER_HEALTHY }
        : { state: WATCHER_UNHEALTHY, reason: watchFailure },
    pendingChanges: condition.pending,
    gitUnread,
  };
}

/** Why no current fingerprint can be computed now; undefined when one can. */
export function unavailableReason(
  condition: TrackerCondition,
): string | undefined {
  const incomplete = incompleteReason(condition);
  if (incomplete !== undefined) return incomplete;
  if (condition.watchFailure !== undefined) {
    return `the input watcher is unhealthy: ${condition.watchFailure}`;
  }
  const { pending } = condition;
  if (pending > 0) return `${pending} changed paths have not been read yet`;
  return undefined;
}

function incompleteReason(condition: TrackerCondition): string | undefined {
  if (condition.stopped) return STOPPED_REASON;
  if (condition.lastReconciledAt === undefined) {
    return FIRST_RECONCILIATION_REASON;
  }
  if (condition.reconciling) return RECONCILING_REASON;
  if (condition.establishFailure !== undefined) {
    return `the input set could not be established: ${condition.establishFailure}`;
  }
  if (condition.protecting) return PROTECTING_REASON;
  return undefined;
}

/** What the tracker knows at one moment, from which a query's view of the inputs is built. */
export interface InputsMoment {
  readonly facts: InputFacts;
  /** Why no fingerprint can be computed now; undefined when one can. */
  readonly unavailable: string | undefined;
  /** Why `rt-test.json` cannot be used or its patterns do not apply; undefined otherwise. */
  readonly nonInputsUnusable: string | undefined;
  /** Read only when a fingerprint can be computed. */
  readonly project: () => ProjectInputs;
}

/** Every fingerprint the view gives is computed from one snapshot of the inputs and one `SnapshotReads`. */
export function currentInputs({
  facts,
  unavailable,
  nonInputsUnusable,
  project,
}: InputsMoment): CurrentInputs {
  const declaration =
    nonInputsUnusable === undefined ? {} : { nonInputsUnusable };
  if (unavailable !== undefined) {
    const none: FingerprintResult = { ok: false, reason: unavailable };
    return {
      facts,
      ...declaration,
      unavailable,
      workspaceFingerprint: () => none,
      discoveryFingerprint: () => none,
      protectedFileChangedSince: () => unavailable,
    };
  }
  const inputs = project();
  const reads = new SnapshotReads(inputs.root);
  return {
    facts,
    ...declaration,
    workspaceFingerprint: (entry) => workspaceFingerprint(inputs, entry, reads),
    discoveryFingerprint: (discovery) =>
      discoveryFingerprint(inputs, discovery, reads),
    protectedFileChangedSince: (discovery, since) =>
      protectedFileChangedSince(inputs, discovery, since),
  };
}
