import { describe, expect, it } from "vitest";
import { requirementsIndex } from "../../../scripts/lib/planning/requirements-index.mjs";
import {
  failsWith,
  lineFor,
  REQUIREMENTS,
  run,
  STATUS,
  type Edit,
} from "./fixture.js";

function stateOf(id: string, ...edits: Edit[]): string | undefined {
  const line = lineFor(run(requirementsIndex, edits).out, `${id}: `);
  return line?.split(" | ")[1];
}

describe("requirements-index", () => {
  it("D224: derives implemented when every linked ticket is done", () => {
    expect(stateOf("FR1")).toBe("implemented");
  });

  it("D225: derives in-progress when only some linked tickets are done", () => {
    expect(stateOf("FR2")).toBe("in-progress");
  });

  it("D226: derives planned for a ticket that is only ready for dev", () => {
    expect(stateOf("FR3")).toBe("planned");
  });

  it("D227: derives unclaimed for a sprint link whose sprint is done", () => {
    expect(
      stateOf("FR5", {
        path: STATUS,
        from: "sprint-2: backlog",
        to: "sprint-2: done",
      }),
    ).toBe("unclaimed");
  });

  it("D240: derives planned for a sprint link whose sprint is still open", () => {
    expect(stateOf("FR5")).toBe("planned");
  });

  it("D241: derives in-progress for an in-progress ticket before any is done", () => {
    expect(stateOf("NFR2")).toBe("in-progress");
  });

  it("D242: derives unscheduled for an Unscheduled marker", () => {
    expect(stateOf("FR6")).toBe("unscheduled");
  });

  it("D228: derives partial, not implemented, when a Partial marker's tickets are done", () => {
    expect(stateOf("NFR1")).toBe("partial");
  });

  it("D229: fails rather than derive a state from a link with no status key", () => {
    expect(
      run(requirementsIndex, [
        { path: REQUIREMENTS, from: "[Ticket 2.1]", to: "[Ticket 2.2]" },
      ]),
    ).toEqual(failsWith("FR3 links Ticket 2.2"));
  });

  it("D230: fails on an --ids id that names no requirement", () => {
    expect(run(requirementsIndex, [], ["--ids", "FR1,FR4"])).toEqual(
      failsWith("no such requirement id: FR4"),
    );
  });

  it("D231: offers the id after the highest one, not after the count", () => {
    expect(
      lineFor(run(requirementsIndex, [], ["--next"]).out, "NEXT_FR:"),
    ).toBe("NEXT_FR: FR7");
  });
});
