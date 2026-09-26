import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOW_CONFIG_FILE } from "../../../scripts/lib/flow-config.mjs";
import { checkLineCitations } from "../../../scripts/lib/standards/line-citations.mjs";
import {
  citations,
  ENGINE,
  inTree,
  REPO,
  USE_FETCH,
  type Scenario,
} from "./harness.js";

const ARCHITECTURE = "docs/architecture.md";

function check(scenario: Scenario = {}) {
  return citations(checkLineCitations, scenario);
}

function architecture(...lines: string[]): Scenario {
  return {
    docs: { [ARCHITECTURE]: `# Architecture\n\n${lines.join("\n")}\n` },
  };
}

describe("check-line-citations", () => {
  it("D430: reports a citation below an insertion with its shifted line", () => {
    const outcome = check(architecture("See `src/engine.mjs:20`."));
    expect(outcome.out).toContain(
      `${ARCHITECTURE}\n  :3  cites engine.mjs:20  (now ~22)`,
    );
  });

  it("D431: does not report a citation above the first changed line", () => {
    const outcome = check(architecture("See `src/engine.mjs:5`."));
    expect(outcome.out).not.toContain(ARCHITECTURE);
  });

  it("D432: says so when the cited line was itself edited", () => {
    const outcome = check({
      ...architecture("See `src/engine.mjs:20`."),
      edit: {
        file: ENGINE,
        at: 20,
        remove: 1,
        insert: ["export const changed = 0;"],
      },
    });
    expect(outcome.out).toContain(
      "cites engine.mjs:20  (the cited lines were themselves edited)",
    );
  });

  it("D433: leaves a done ticket's citations alone", () => {
    expect(check().out).not.toContain(
      "_agent-docs/tickets/1-1-parse-events.md",
    );
  });

  it("D434: leaves a done sprint's citations alone", () => {
    expect(check().out).not.toContain(
      "_agent-docs/sprints/sprint-1-queryable-results.md",
    );
  });

  it("D435: leaves design-decision records alone", () => {
    expect(check().out).not.toContain("docs/design-decisions/cache.md");
  });

  it("D436: does not match a qualified citation to a changed file in another folder", () => {
    const outcome = check({
      docs: { "docs/plan.md": "# Plan\n\nSee `lib/engine.mjs:20`.\n" },
    });
    expect(outcome.out).not.toContain("docs/plan.md");
  });

  it("D437: does not match a citation to a file whose name merely ends the same way", () => {
    const outcome = check({
      docs: { "docs/roadmap.md": "# Roadmap\n\nSee `fetch.mjs:20`.\n" },
      edit: {
        file: USE_FETCH,
        at: 10,
        remove: 0,
        insert: ["export const added = 1;"],
      },
    });
    expect(outcome.out).not.toContain("docs/roadmap.md");
  });

  it("D438: exits 1 on a hit under --strict", () => {
    const outcome = check({
      ...architecture("See `src/engine.mjs:20`."),
      args: ["--strict"],
    });
    expect(outcome.code).toBe(1);
  });

  it("D439: exits 0 on a hit without --strict", () => {
    expect(check(architecture("See `src/engine.mjs:20`.")).code).toBe(0);
  });

  it("D440: lists a live root the flow config moved outside the default roots", () => {
    const moved = readFileSync(join(REPO, FLOW_CONFIG_FILE), "utf8").replace(
      "requirements: docs/requirements.md",
      "requirements: spec/requirements.md",
    );
    const outcome = inTree({ [FLOW_CONFIG_FILE]: moved }, (config) =>
      checkLineCitations(config, ["--list-live-roots"]),
    );
    expect(outcome.out.split("\n")).toContain("spec/requirements.md");
  });

  it("D441: ignores a citation past the end of the file as it was", () => {
    const outcome = check(architecture("See `src/engine.mjs:45`."));
    expect(outcome.out).not.toContain(ARCHITECTURE);
  });

  it("D442: reports a citation in a ticket that is not done", () => {
    expect(check().out).toContain("_agent-docs/tickets/2-1-select-tests.md");
  });

  it("D443: leaves test fixtures alone", () => {
    expect(check().out).not.toContain("test/fixtures/notes.md");
  });

  it("D444: leaves a changed file's citation of itself to its author", () => {
    const outcome = check({
      edit: {
        file: ENGINE,
        at: 10,
        remove: 0,
        insert: ["export const added = 1;", "// Mirrors engine.mjs:25."],
      },
    });
    expect(outcome.out).not.toContain(ENGINE);
  });

  it("D446: does not report a citation that an in-place edit above it left on the same line", () => {
    const outcome = check({
      ...architecture("See `src/engine.mjs:20`."),
      edit: {
        file: ENGINE,
        at: 10,
        remove: 1,
        insert: ["export const changed = 0;"],
      },
    });
    expect(outcome.out).not.toContain(ARCHITECTURE);
  });

  it("D448: does not report a citation of the line an insertion follows", () => {
    const outcome = check(architecture("See `src/engine.mjs:9`."));
    expect(outcome.out).not.toContain(ARCHITECTURE);
  });

  it("D445: diffs against the ref given by --base", () => {
    const outcome = check({
      ...architecture("See `src/engine.mjs:20`."),
      commitEdit: true,
      args: ["--base", "HEAD~1"],
    });
    expect(outcome.out).toContain("cites engine.mjs:20  (now ~22)");
  });
});
