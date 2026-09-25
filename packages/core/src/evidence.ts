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
  const freshness = assessFreshness(evidence, currentFingerprint);
  return {
    outcome,
    freshness,
    isCurrentPass: freshness === "current" && outcome === "passed",
  };
}

function assessFreshness(
  evidence: TestEvidence | undefined,
  currentFingerprint: string | undefined,
): Freshness {
  if (!evidence || !currentFingerprint || !evidence.fingerprint)
    return "unknown";
  return evidence.fingerprint === currentFingerprint ? "current" : "stale";
}
