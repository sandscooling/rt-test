import {
  RECONCILIATION_COMPLETE,
  RECONCILIATION_INCOMPLETE,
  SELECTION_REFUSED,
  WATCHER_HEALTHY,
  WATCHER_UNHEALTHY,
  type InputFacts,
  type InputsNotNarrowed,
} from "../query/answer.js";
import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import {
  discoveryFingerprint,
  protectedFileChangedSince,
  SnapshotReads,
  workspaceFingerprint,
  type FingerprintResult,
  type ProjectInputs,
} from "./fingerprint.js";
import type { CurrentInputs } from "./input-tracker.js";
import {
  NARROWING,
  narrowingAt,
  type QueryNarrowing,
  type WorkspaceNarrowing,
} from "./narrowed-inputs.js";

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
  /** The environment's digest under the declaration in effect, which every fingerprint of the moment takes. */
  readonly environment: string;
  /** The dependency builds' state for the discovery the query reads; undefined for every input of the project. */
  readonly narrowing: QueryNarrowing | undefined;
  /** Read only when a fingerprint can be computed. */
  readonly project: () => ProjectInputs;
}

/**
 * Every fingerprint the view gives is computed from one snapshot of the inputs, one `SnapshotReads` and one reading
 * of the narrowing at the moment's revision.
 */
export function currentInputs({
  facts,
  unavailable,
  nonInputsUnusable,
  environment,
  narrowing,
  project,
}: InputsMoment): CurrentInputs {
  const workspaces =
    narrowing === undefined
      ? undefined
      : narrowingAt(narrowing, facts.revision);
  const notNarrowed = notNarrowedFact(workspaces);
  const declaration =
    nonInputsUnusable === undefined ? {} : { nonInputsUnusable };
  if (unavailable !== undefined) {
    const none: FingerprintResult = { ok: false, reason: unavailable };
    return {
      ...notNarrowed,
      facts,
      ...declaration,
      unavailable,
      snapshot: undefined,
      workspaceFingerprint: () => none,
      discoveryFingerprint: () => none,
      protectedFileChangedSince: () => unavailable,
    };
  }
  const inputs = project();
  const reads = new SnapshotReads(inputs.root, environment);
  const selected = unlessRefused(workspaces, inputs);
  return {
    ...notNarrowedFact(selected),
    facts,
    ...declaration,
    snapshot: inputs,
    workspaceFingerprint: (entry) =>
      narrowedFingerprint(selected, inputs, entry, reads),
    discoveryFingerprint: (discovery) =>
      discoveryFingerprint(inputs, discovery, reads),
    protectedFileChangedSince: (discovery, since) =>
      protectedFileChangedSince(inputs, discovery, since),
  };
}

/** A narrowing whose selection refuses the snapshot's paths widens every workspace and says why. */
function unlessRefused(
  workspaces: WorkspaceNarrowing | undefined,
  project: ProjectInputs,
): WorkspaceNarrowing | undefined {
  if (workspaces?.kind !== NARROWING.narrowed) return workspaces;
  const reason = workspaces.narrowing.refusal(project);
  if (reason === undefined) return workspaces;
  return {
    kind: NARROWING.widened,
    notNarrowed: { kind: SELECTION_REFUSED, reason },
  };
}

/** Why no workspace's inputs are narrowed, which every answer carries until a later build succeeds. */
function notNarrowedFact(workspaces: WorkspaceNarrowing | undefined): {
  readonly inputsNotNarrowed?: InputsNotNarrowed;
} {
  if (workspaces === undefined || workspaces.kind === NARROWING.narrowed) {
    return {};
  }
  const { notNarrowed } = workspaces;
  return notNarrowed === undefined ? {} : { inputsNotNarrowed: notNarrowed };
}

/** While the build deciding the narrowing runs, the workspace has no fingerprint, and the reason names the build. */
function narrowedFingerprint(
  workspaces: WorkspaceNarrowing | undefined,
  project: ProjectInputs,
  entry: WorkspaceDiscovery,
  reads: SnapshotReads,
): FingerprintResult {
  if (workspaces?.kind === NARROWING.building) {
    return { ok: false, reason: workspaces.reason };
  }
  const narrowed =
    workspaces?.kind === NARROWING.narrowed
      ? workspaces.narrowing.workspaceInputs(project, entry.workspace.path)
      : undefined;
  return workspaceFingerprint(project, entry, reads, narrowed);
}
