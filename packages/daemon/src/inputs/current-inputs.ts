import type { InputFacts } from "../query/answer.js";
import {
  discoveryFingerprint,
  SnapshotReads,
  testModuleChangedSince,
  workspaceFingerprint,
  type FingerprintResult,
  type ProjectInputs,
} from "./fingerprint.js";
import type { CurrentInputs } from "./input-tracker.js";

/** What the tracker knows at one moment, from which a query's view of the inputs is built. */
export interface InputsMoment {
  readonly facts: InputFacts;
  /** Why no fingerprint can be computed now; undefined when one can. */
  readonly unavailable: string | undefined;
  /** Why `rt-test.json` cannot be used; undefined when it can. */
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
      testModuleChangedSince: () => unavailable,
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
    testModuleChangedSince: (discovery, since) =>
      testModuleChangedSince(inputs, discovery, since),
  };
}
