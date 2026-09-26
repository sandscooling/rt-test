import { describe, expect, it } from "vitest";
import { checkSprintKeys } from "../../../scripts/lib/planning/sprint-keys.mjs";
import {
  failsWith,
  run,
  SPRINT_1,
  SPRINT_2,
  STATUS,
  type Edit,
} from "./fixture.js";

function check(...edits: Edit[]) {
  return run(checkSprintKeys, edits);
}

describe("check-sprint-keys", () => {
  it("D200: passes a tree whose sprints folder holds a README beside its sprint files", () => {
    expect(check().code).toBe(0);
  });

  it("D201: rejects a ticket key with an unknown state", () => {
    expect(
      check({
        path: STATUS,
        from: "1-2-store-results: in-progress",
        to: "1-2-store-results: finished",
      }),
    ).toEqual(failsWith("unknown state finished"));
  });

  it("D202: rejects two status keys for one ticket id", () => {
    expect(
      check({
        path: STATUS,
        from: "sprint-2: backlog",
        to: "1-2-store-more: backlog\nsprint-2: backlog",
      }),
    ).toEqual(failsWith("repeats id 1.2"));
  });

  it("D203: rejects a malformed status key", () => {
    expect(
      check({
        path: STATUS,
        from: "2-1-select-tests:",
        to: "2.1-select-tests:",
      }),
    ).toEqual(failsWith("malformed status key 2.1-select-tests"));
  });

  it("D204: rejects a ticket key whose heading is missing from its sprint file", () => {
    expect(
      check({ path: SPRINT_1, from: "## Ticket 1.3: Query status", to: "" }),
    ).toEqual(failsWith('1-3-query-status has no "## Ticket 1.3:" heading'));
  });

  it("D205: rejects a ticket heading with no status key", () => {
    expect(
      check({
        path: STATUS,
        from: "1-3-query-status: backlog # after 1.2",
        to: "",
      }),
    ).toEqual(failsWith("Ticket 1.3 has no status key"));
  });

  it("D206: rejects a sprint key with no sprint file", () => {
    expect(
      check({
        path: STATUS,
        from: "sprint-2: backlog",
        to: "sprint-2: backlog\nsprint-3: backlog",
      }),
    ).toEqual(failsWith("sprint-3 has no sprint file"));
  });

  it("D207: rejects a sprint file with no sprint status key", () => {
    expect(check({ path: STATUS, from: "sprint-2: backlog", to: "" })).toEqual(
      failsWith("Sprint 2 has no sprint-2 status key"),
    );
  });

  it("D208: rejects a ticket heading filed under another sprint", () => {
    expect(
      check({ path: SPRINT_2, from: "## Ticket 2.1:", to: "## Ticket 1.4:" }),
    ).toEqual(failsWith("Ticket 1.4 belongs in the Sprint 1 file"));
  });

  it("D209: rejects a ticket heading that breaks the heading grammar", () => {
    expect(
      check({ path: SPRINT_1, from: "## Ticket 1.3:", to: "## Ticket 1-3:" }),
    ).toEqual(failsWith("malformed ticket heading"));
  });

  it("D210: rejects a sprint file that names no milestone", () => {
    expect(
      check({ path: SPRINT_2, from: "**Milestone:** M2", to: "" }),
    ).toEqual(failsWith('missing "**Milestone:** M<n>" line'));
  });

  it("D211: rejects a sprint title whose number differs from its file name", () => {
    expect(
      check({ path: SPRINT_2, from: "# Sprint 2:", to: "# Sprint 3:" }),
    ).toEqual(failsWith('first heading must be "# Sprint 2: <title>"'));
  });

  it("D243: rejects a status line that is not key: state", () => {
    expect(
      check({
        path: STATUS,
        from: "sprint-2: backlog",
        to: "sprint-2: backlog\nsprint-3 backlog",
      }),
    ).toEqual(failsWith('expected "key: state", got: sprint-3 backlog'));
  });

  it("D244: rejects two sprint files for one sprint number", () => {
    expect(
      check({
        path: "_agent-docs/sprints/sprint-2-other.md",
        content: "# Sprint 2: Other\n\n**Milestone:** M2\n",
      }),
    ).toEqual(failsWith("repeats Sprint 2"));
  });

  it("D245: rejects a ticket heading repeated in one sprint file", () => {
    expect(
      check({
        path: SPRINT_2,
        from: "Scope: select tests for FR3.",
        to: "Scope: select tests for FR3.\n\n## Ticket 2.1: Select again",
      }),
    ).toEqual(failsWith("repeats Ticket 2.1"));
  });

  it("D212: rejects a sprints folder file that is not named as a sprint", () => {
    expect(
      check({
        path: "_agent-docs/sprints/sprint-three.md",
        content: "# Sprint 3: Unnamed\n\n**Milestone:** M3\n",
      }),
    ).toEqual(failsWith("not a sprint file name"));
  });
});
