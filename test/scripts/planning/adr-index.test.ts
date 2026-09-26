import { describe, expect, it } from "vitest";
import { adrIndex } from "../../../scripts/lib/planning/adr-index.mjs";
import { ADR_1, ADR_2, failsWith, lineFor, run, type Edit } from "./fixture.js";

function index(...edits: Edit[]) {
  return run(adrIndex, edits);
}

describe("adr-index", () => {
  it("D232: derives supersedes on the successor from the superseded ADR", () => {
    expect(lineFor(index().out, "- ADR-0002:")).toBe(
      "- ADR-0002: Keep state in SQLite (accepted; supersedes ADR-0001)",
    );
  });

  it("D233: rejects a supersession naming an ADR that does not exist", () => {
    expect(
      index({
        path: ADR_1,
        from: "superseded by ADR-0002",
        to: "superseded by ADR-0009",
      }),
    ).toEqual(
      failsWith("superseded by ADR-0009, which is not another ADR here"),
    );
  });

  it("D234: rejects a supersession naming an ADR that is itself superseded", () => {
    expect(
      index(
        {
          path: ADR_2,
          from: "Status: accepted",
          to: "Status: superseded by ADR-0003",
        },
        {
          path: "docs/adr/0003-sqlite-per-project.md",
          content: "# One SQLite file per project\n\nStatus: accepted\n",
        },
      ),
    ).toEqual(failsWith("which is itself superseded"));
  });

  it("D235: rejects an ADR with no Status line", () => {
    expect(index({ path: ADR_2, from: "Status: accepted", to: "" })).toEqual(
      failsWith('missing "Status: <state>" line'),
    );
  });

  it("D236: rejects an ADR with an unknown status", () => {
    expect(
      index({ path: ADR_2, from: "Status: accepted", to: "Status: approved" }),
    ).toEqual(failsWith('unknown status "approved"'));
  });

  it("D237: rejects an ADR whose first line is not its title", () => {
    expect(
      index({
        path: ADR_2,
        from: "# Keep state in SQLite",
        to: "Keep state in SQLite",
      }),
    ).toEqual(failsWith('first line must be "# <title>"'));
  });

  it("D238: rejects two ADRs sharing a number", () => {
    expect(
      index({
        path: "docs/adr/0002-other.md",
        content: "# Other\n\nStatus: proposed\n",
      }),
    ).toEqual(failsWith("repeats ADR-0002"));
  });

  it("D239: rejects a file in the ADR folder that is not named as an ADR", () => {
    expect(
      index({
        path: "docs/adr/adr-3-cache.md",
        content: "# Cache\n\nStatus: proposed\n",
      }),
    ).toEqual(failsWith("not an ADR file name"));
  });
});
