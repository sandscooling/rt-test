import { renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHECKLIST,
  CONFIG,
  append,
  expand,
  replace,
  ruleIds,
  ticket,
  withCorpus,
} from "./harness.js";

const C2_EXPANDED = [
  "### Storage",
  "",
  "#### Writes",
  "C2. **Named bounds**: A bounded read takes its limit from a named constant.",
  "It never inlines the number.",
].join("\n");

describe("expand-rules explicit ids", () => {
  it("D100: an unresolved id fails instead of emitting a partial set", () => {
    expect(expand(["--doc", "checklist", "C1", "C99"]).code).toBe(1);
  });

  it("D101: a rule expands with its continuation lines", () => {
    expect(expand(["--doc", "checklist", "C2"]).out).toContain(
      "It never inlines the number.",
    );
  });

  it("D102: a heading ends a rule block, so no rule absorbs the next section", () => {
    expect(expand(["--doc", "checklist", "--quiet", "C2"]).out).toBe(
      C2_EXPANDED,
    );
  });

  it("D103: expanded rules nest under their headings demoted one level", () => {
    expect(expand(["--doc", "checklist", "C2"]).out).toMatch(
      /^### Storage\n\n#### Writes\n/,
    );
  });

  it("D104: ids are read from stdin when none are passed", () => {
    expect(expand(["--doc", "checklist"], undefined, "C4").out).toContain(
      "C4. **Versioned output**",
    );
  });

  it("D105: the count line reports how many rules were expanded", () => {
    expect(expand(["--doc", "checklist", "C1", "C12"]).out).toContain(
      "RULE_COUNT: 2",
    );
  });

  it("D106: an unknown flag fails instead of being ignored", () => {
    expect(expand(["--doc", "checklist", "--bogus", "C1"]).code).toBe(1);
  });

  it("D107: the checklist folder comes from the flow config", () => {
    const run = withCorpus(
      (root) => {
        renameSync(join(root, CHECKLIST), join(root, "rules-moved"));
        replace(
          root,
          CONFIG,
          `checklist_dir: ${CHECKLIST}`,
          "checklist_dir: rules-moved",
        );
      },
      (root) => expand(["--doc", "checklist", "--list"], root),
    );
    expect(run.lines).toContain("C1\talpha.md");
  });
});

describe("expand-rules --list gate", () => {
  it("D108: shards are read in _index.md order, then unlisted shards alphabetically", () => {
    expect(ruleIds(expand(["--doc", "checklist", "--list"]))).toEqual([
      "C5",
      "C6",
      "C7",
      "C8",
      "C1",
      "C2",
      "C3",
      "C4",
      "C9",
      "C10",
      "C11",
      "C12",
    ]);
  });

  it("D109: lines inside a multi-line HTML comment are neither rules nor stray prose", () => {
    expect(expand(["--doc", "checklist", "--list"]).code).toBe(0);
  });

  it("D110: an id claimed by two rule blocks fails the list", () => {
    const run = withCorpus(
      (root) =>
        append(root, `${CHECKLIST}/gamma.md`, "\nC3. **Twin**: A second C3.\n"),
      (root) => expand(["--doc", "checklist", "--list"], root),
    );
    expect(run.code).toBe(1);
  });

  it("D111: a line shaped like an id that parses to no anchor fails the list", () => {
    const run = withCorpus(
      (root) =>
        append(
          root,
          `${CHECKLIST}/gamma.md`,
          "\nC13a. **Suffixed**: Not a valid id.\n",
        ),
      (root) => expand(["--doc", "checklist", "--list"], root),
    );
    expect(run.code).toBe(1);
  });

  it("D112: prose outside every rule block fails the list", () => {
    const run = withCorpus(
      (root) =>
        replace(
          root,
          `${CHECKLIST}/beta.md`,
          "## Counting",
          "## Counting\n\nLoose prose.",
        ),
      (root) => expand(["--doc", "checklist", "--list"], root),
    );
    expect(run.code).toBe(1);
  });

  it("D150: --list --quiet prints no anchors, so a clean gate run stays silent", () => {
    expect(expand(["--doc", "checklist", "--list", "--quiet"]).out).toBe("");
  });
});

describe("expand-rules --menu and --shard", () => {
  it("D113: a menu line shows the title and an excerpt of the body", () => {
    expect(expand(["--doc", "checklist", "--menu"]).lines).toContain(
      "C5. Widen on doubt: Uncertain dependency information widens the selection.",
    );
  });

  it("D114: a menu line drops the lint-hardening annotation", () => {
    expect(expand(["--doc", "checklist", "--menu"]).lines).toContain(
      "C12. No telemetry: Nothing uploads results or source.",
    );
  });

  it("D115: a menu excerpt stops at 140 characters of body", () => {
    const body = "x".repeat(300);
    const run = withCorpus(
      (root) =>
        append(root, `${CHECKLIST}/gamma.md`, `\nC13. **Long**: ${body}\n`),
      (root) => expand(["--doc", "checklist", "--menu"], root),
    );
    const line = run.lines.find((text) => text.startsWith("C13. "));
    expect(line?.length).toBe(151);
  });

  it("D116: a menu narrowed to ids lists only those rules", () => {
    expect(
      ruleIds(expand(["--doc", "checklist", "--menu", "C3", "C9", "C77"])),
    ).toEqual(["C3", "C9"]);
  });

  it("D117: a narrowed menu names requested ids that resolve to nothing", () => {
    expect(expand(["--doc", "checklist", "--menu", "C3", "C77"]).out).toContain(
      "UNRESOLVED: C77",
    );
  });

  it("D118: a narrowed menu shows only the kept rule's own ancestor headings", () => {
    expect(expand(["--doc", "checklist", "--menu", "--quiet", "C3"]).out).toBe(
      [
        "## alpha.md",
        "### Storage",
        "### Reads",
        "C3. Fresh reads: A read compares fingerprints before it reports current.",
      ].join("\n"),
    );
  });

  it("D119: --shard restricts the menu to that shard", () => {
    expect(
      ruleIds(expand(["--doc", "checklist", "--menu", "--shard", "gamma"])),
    ).toEqual(["C9", "C10", "C11", "C12"]);
  });

  it("D120: a --shard naming no shard fails instead of rendering nothing", () => {
    expect(
      expand(["--doc", "checklist", "--menu", "--shard", "delta"]).code,
    ).toBe(1);
  });

  it("D121: --shard on the single-file project context fails", () => {
    expect(
      expand(["--doc", "project-context", "--menu", "--shard", "alpha"]).code,
    ).toBe(1);
  });
});

describe("expand-rules --ids and --from-ticket", () => {
  it("D122: --ids fails on an unresolved id", () => {
    expect(expand(["--ids", "checklist=C1,C99"]).code).toBe(1);
  });

  it("D123: a ticket expands its project-context marker as well as its checklist marker", () => {
    expect(expand(["--from-ticket", ticket("full")]).out).toContain(
      "P2. **Linter**: Lint with oxlint; do not add ESLint.",
    );
  });

  it("D124: a PENDING marker fails as an unfinalized ticket", () => {
    expect(expand(["--from-ticket", ticket("pending")]).err).toMatch(
      /never finalized/,
    );
  });

  it("D125: a marker resolving to zero rules fails as malformed", () => {
    expect(expand(["--from-ticket", ticket("unresolvable")]).code).toBe(1);
  });

  it("D126: a ticket citing a retired id warns and names it", () => {
    expect(expand(["--from-ticket", ticket("retired")]).err).toContain("C99");
  });

  it("D127: a ticket citing a retired id still expands the rest", () => {
    expect(expand(["--from-ticket", ticket("retired")]).code).toBe(0);
  });

  it("D128: a none marker selects nothing without failing", () => {
    expect(expand(["--from-ticket", ticket("retired")]).out).toContain(
      "(none selected)",
    );
  });

  it("D129: a bare numeric id resolves under its doc's prefix", () => {
    expect(expand(["--from-ticket", ticket("bare"), "--menu"]).lines).toContain(
      "P3. Agent tooling: Give agent-facing tooling a JSON CLI, never an MCP server.",
    );
  });

  it("D130: normalizing a bare id is reported so its source gets fixed", () => {
    expect(expand(["--from-ticket", ticket("bare")]).err).toContain("3 to P3");
  });

  it("D131: a ticket with no rule markers fails", () => {
    expect(expand(["--from-ticket", ticket("unmarked")]).code).toBe(1);
  });
});
