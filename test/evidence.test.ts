import { describe, expect, it } from "vitest";
import { assessEvidence } from "../src/evidence.js";

describe("result freshness", () => {
  it("D001: an unexecuted test must not count as a pass", () => {
    expect(assessEvidence(undefined, "revision-a")).toEqual({
      outcome: "never-run",
      freshness: "unknown",
      isCurrentPass: false,
    });
  });

  it("D002: a relevant edit must retire an old passing result", () => {
    expect(
      assessEvidence(
        { fingerprint: "revision-a", outcome: "passed" },
        "revision-b",
      ),
    ).toEqual({ outcome: "passed", freshness: "stale", isCurrentPass: false });
  });

  it("D003: unavailable current inputs must not certify a historical pass", () => {
    expect(
      assessEvidence(
        { fingerprint: "revision-a", outcome: "passed" },
        undefined,
      ),
    ).toEqual({
      outcome: "passed",
      freshness: "unknown",
      isCurrentPass: false,
    });
  });

  it("D004: a current skipped test must not count as a pass", () => {
    expect(
      assessEvidence(
        { fingerprint: "revision-a", outcome: "skipped" },
        "revision-a",
      ),
    ).toEqual({
      outcome: "skipped",
      freshness: "current",
      isCurrentPass: false,
    });
  });

  it("D005: a runner error must not count as a pass", () => {
    expect(
      assessEvidence(
        { fingerprint: "revision-a", outcome: "error" },
        "revision-a",
      ),
    ).toEqual({ outcome: "error", freshness: "current", isCurrentPass: false });
  });

  it("D006: an edit must preserve the last failure while marking it stale", () => {
    expect(
      assessEvidence(
        { fingerprint: "revision-a", outcome: "failed" },
        "revision-b",
      ),
    ).toEqual({ outcome: "failed", freshness: "stale", isCurrentPass: false });
  });

  it("D007: a pass for matching inputs must be recognized as current", () => {
    expect(
      assessEvidence(
        { fingerprint: "revision-a", outcome: "passed" },
        "revision-a",
      ),
    ).toEqual({ outcome: "passed", freshness: "current", isCurrentPass: true });
  });

  it("D008: empty fingerprints must not certify matching inputs", () => {
    expect(assessEvidence({ fingerprint: "", outcome: "passed" }, "")).toEqual({
      outcome: "passed",
      freshness: "unknown",
      isCurrentPass: false,
    });
  });
});
