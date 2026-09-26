import { describe, expect, it } from "vitest";
import { checkRequirementMarkers } from "../../../scripts/lib/planning/requirement-markers.mjs";
import {
  failsWith,
  REQUIREMENTS,
  run,
  SPRINT_1,
  TICKET,
  type Edit,
} from "./fixture.js";

function check(...edits: Edit[]) {
  return run(checkRequirementMarkers, edits);
}

function marker(from: string, to: string): Edit {
  return { path: REQUIREMENTS, from, to };
}

describe("check-requirement-markers", () => {
  it("D213: passes a requirements doc whose fenced example links nothing real", () => {
    expect(check().code).toBe(0);
  });

  it("D859: keeps a fenced example hidden across a shorter marker inside its longer fence", () => {
    const example = "```md\n- FR9: A fenced example [Sprint 99]\n```";
    const longer =
      "````md\n```\n- FR9: A fenced example [Sprint 99]\n```\n````";
    expect(check(marker(example, longer)).code).toBe(0);
  });

  it("D860: still reads the requirements after an opener that never closes", () => {
    expect(
      check(
        marker("## Non-functional requirements", "```text"),
        marker("- NFR2: Stay fast [Ticket 1.2]", "- NFR2: Stay fast"),
      ),
    ).toEqual(failsWith("NFR2 has no marker"));
  });

  it("D214: rejects a requirement with no marker", () => {
    expect(check(marker("Watch files [Sprint 2]", "Watch files"))).toEqual(
      failsWith("FR5 has no marker"),
    );
  });

  it("D215: rejects a marker that stores a state beside its link", () => {
    expect(check(marker("[Ticket 1.1]", "[Implemented, Ticket 1.1]"))).toEqual(
      failsWith("FR1 has a malformed marker"),
    );
  });

  it("D216: rejects an Unscheduled marker with no reason", () => {
    expect(
      check(
        marker("[Unscheduled: waits on the defect engine]", "[Unscheduled: ]"),
      ),
    ).toEqual(failsWith("FR6 has a malformed marker"));
  });

  it("D217: rejects a Partial marker that names no remainder", () => {
    expect(
      check(
        marker(
          "[Partial: Ticket 1.1; remainder: no network audit yet]",
          "[Partial: Ticket 1.1]",
        ),
      ),
    ).toEqual(failsWith("NFR1 has a malformed marker"));
  });

  it("D218: rejects a link to a sprint with no status key", () => {
    expect(check(marker("[Sprint 2]", "[Sprint 4]"))).toEqual(
      failsWith("FR5 links Sprint 4, which has no status key"),
    );
  });

  it("D219: rejects a link to a ticket with no status key", () => {
    expect(check(marker("[Ticket 2.1]", "[Ticket 2.2]"))).toEqual(
      failsWith("FR3 links Ticket 2.2, which has no status key"),
    );
  });

  it("D220: rejects a requirement id defined twice", () => {
    expect(check(marker("- FR6: Report gaps", "- FR5: Report gaps"))).toEqual(
      failsWith("FR5 is already defined"),
    );
  });

  it("D221: rejects a requirement line whose id breaks the id format", () => {
    expect(
      check(marker("- FR3: Select tests", "- FR03: Select tests")),
    ).toEqual(failsWith("malformed requirement line"));
  });

  it("D222: rejects a sprint file citing an unknown requirement id", () => {
    expect(
      check({
        path: SPRINT_1,
        from: "Deliver FR1 and FR2",
        to: "Deliver FR1 and FR4",
      }),
    ).toEqual(failsWith("unknown requirement FR4"));
  });

  it("D223: rejects a ticket file citing an unknown requirement id", () => {
    expect(
      check({ path: TICKET, from: "part of NFR1", to: "part of NFR7" }),
    ).toEqual(failsWith("unknown requirement NFR7"));
  });
});
