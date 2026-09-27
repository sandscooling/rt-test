export type TestOutcome = "passed" | "failed" | "skipped" | "error";
export type Freshness = "current" | "stale" | "unknown";

export interface TestEvidence {
  readonly fingerprint: string;
  readonly outcome: TestOutcome;
}

export interface EvidenceAssessment {
  readonly outcome: TestOutcome | "never-run";
  readonly freshness: Freshness;
  readonly isCurrentPass: boolean;
}

export function assessEvidence(
  evidence: TestEvidence | undefined,
  currentFingerprint: string | undefined,
): EvidenceAssessment {
  const outcome = evidence?.outcome ?? "never-run";
  const freshness = assessFreshness(evidence?.fingerprint, currentFingerprint);
  return {
    outcome,
    freshness,
    isCurrentPass: freshness === "current" && outcome === "passed",
  };
}

/**
 * Whether a record made under `fingerprint` still describes the inputs whose fingerprint is `currentFingerprint`;
 * unknown when either is absent or empty, since an empty digest stands for none.
 */
export function assessFreshness(
  fingerprint: string | undefined,
  currentFingerprint: string | undefined,
): Freshness {
  if (!currentFingerprint || !fingerprint) return "unknown";
  return fingerprint === currentFingerprint ? "current" : "stale";
}
