import { describe, expect, it } from "vitest";
import {
  CHECKLIST,
  CONFIG,
  append,
  hygiene,
  read,
  replace,
  withCorpus,
  write,
} from "./harness.js";

const ALPHA = `${CHECKLIST}/alpha.md`;
const C1_TEXT = "A write replaces the whole record in one step.";
const C1_KEY = `${ALPHA}::C1::PROVENANCE`;
const BASELINE = "scripts/rule-hygiene-baseline.json";

function editC1(root: string, addition: string): void {
  replace(root, ALPHA, C1_TEXT, `${C1_TEXT} ${addition}`);
}

function checkAfter(edit: (root: string) => void, argv: string[] = []) {
  return withCorpus(edit, (root) => hygiene(argv, root));
}

function bigRule(root: string): void {
  append(
    root,
    `${CHECKLIST}/gamma.md`,
    `\nC13. **Big**: ${"x".repeat(61_000)}\n`,
  );
}

function fillerRules(count: number): (root: string) => void {
  return (root) => {
    const rules = Array.from(
      { length: count },
      (_, index) => `\nC${index + 13}. **Filler**: A small rule.\n`,
    );
    append(root, `${CHECKLIST}/gamma.md`, rules.join(""));
  };
}

const manyRules = fillerRules(290);

function fourthShard(root: string): void {
  write(
    root,
    `${CHECKLIST}/delta.md`,
    "# Delta\n\n## More\n\nC13. **Extra**: A fourth shard.\n",
  );
}

function menuMode(root: string, fanout: string): void {
  replace(root, CONFIG, "rule_selection: whole", "rule_selection: menu");
  replace(root, CONFIG, "checklist_fanout: 1", `checklist_fanout: ${fanout}`);
}

describe("rule hygiene provenance", () => {
  it("D132: a date in a rule fails the check", () => {
    expect(
      checkAfter((root) => editC1(root, "Settled on 2026-01-02.")).code,
    ).toBe(1);
  });

  it("D133: an origin note in a rule fails the check", () => {
    expect(
      checkAfter((root) => editC1(root, "Ported from another repository."))
        .code,
    ).toBe(1);
  });

  it("D134: a date in AGENTS.md fails the check", () => {
    const run = checkAfter((root) =>
      write(root, "AGENTS.md", "# Agents\n\nDecided on 2026-01-02.\n"),
    );
    expect(run.code).toBe(1);
  });

  it("D135: a date inside a fenced block of guidance is exempt", () => {
    const run = checkAfter((root) =>
      write(
        root,
        "AGENTS.md",
        "# Agents\n\n```sh\ngit log --since 2026-01-02\n```\n",
      ),
    );
    expect(run.code).toBe(0);
  });

  it("D136: the rule maintenance guide named in the flow config is scanned", () => {
    const run = checkAfter((root) =>
      write(
        root,
        "_agent-docs/rule-maintenance-guide.md",
        "# Guide\n\nTighten it (from sprint review).\n",
      ),
    );
    expect(run.code).toBe(1);
  });

  it("D137: skill files under .claude/skills are scanned", () => {
    const run = checkAfter((root) =>
      write(
        root,
        ".claude/skills/demo/SKILL.md",
        "# Demo\n\nSettled in Ticket 12.\n",
      ),
    );
    expect(run.code).toBe(1);
  });
});

describe("rule hygiene rules folder", () => {
  it("D152: markdown under the flow config's rules_dir is scanned", () => {
    const run = checkAfter((root) =>
      write(
        root,
        "_agent-docs/rules/demo.md",
        "# Demo\n\nSettled in Ticket 12.\n",
      ),
    );
    expect(run.code).toBe(1);
  });
});

describe("rule hygiene citations", () => {
  it("D138: a rule citing an id that does not exist fails the check", () => {
    expect(checkAfter((root) => editC1(root, "See C77.")).code).toBe(1);
  });

  it("D139: a rule citing an existing id passes", () => {
    expect(checkAfter((root) => editC1(root, "See C3.")).code).toBe(0);
  });
});

describe("rule hygiene baseline", () => {
  it("D140: a baselined violation does not fail the check", () => {
    const run = checkAfter((root) => {
      editC1(root, "Settled on 2026-01-02.");
      write(root, BASELINE, JSON.stringify({ accepted: [C1_KEY] }));
    });
    expect(run.code).toBe(0);
  });

  it("D141: --update-baseline records the current violations", () => {
    const accepted = withCorpus(
      (root) => editC1(root, "Settled on 2026-01-02."),
      (root) => {
        write(root, BASELINE, JSON.stringify({ accepted: [] }));
        hygiene(["--update-baseline"], root);
        return JSON.parse(read(root, BASELINE)).accepted;
      },
    );
    expect(accepted).toEqual([C1_KEY]);
  });

  it("D142: a baselined violation that no longer occurs is reported as fixed", () => {
    const run = checkAfter((root) =>
      write(root, BASELINE, JSON.stringify({ accepted: [C1_KEY] })),
    );
    expect(run.out).toContain("1 baselined violation(s) are fixed");
  });

  it("D143: an unknown argument fails", () => {
    expect(hygiene(["--bogus"]).code).toBe(1);
  });
});

describe("rule hygiene scale signal", () => {
  it("D144: the scale line counts the rules of both docs", () => {
    expect(hygiene([]).out).toContain(
      "scale: 15 rules (12 checklist, 3 project-context)",
    );
  });

  it("D145: rule docs past the size threshold warn while rule_selection is whole", () => {
    expect(checkAfter(bigRule).out).toMatch(
      /SCALE WARNING: rule docs total \d+ chars/,
    );
  });

  it("D146: a scale warning never fails the check", () => {
    expect(checkAfter(bigRule).code).toBe(0);
  });

  it("D147: a corpus past the rule-count threshold warns while rule_selection is whole", () => {
    expect(checkAfter(manyRules).out).toMatch(
      /the corpus holds \d+ rules, above 300/,
    );
  });

  it("D148: no selection warning is given once rule_selection is menu", () => {
    const run = checkAfter((root) => {
      bigRule(root);
      menuMode(root, "4");
    });
    expect(run.out).not.toContain("SCALE WARNING");
  });

  it("D149: four shards warn while menu is on and checklist_fanout is 1", () => {
    const run = checkAfter((root) => {
      menuMode(root, "1");
      fourthShard(root);
    });
    expect(run.out).toContain("checklist_fanout is 1");
  });

  it("D153: over 400 checklist rules in three shards warn while menu is on and checklist_fanout is 1", () => {
    const run = checkAfter((root) => {
      menuMode(root, "1");
      fillerRules(390)(root);
    });
    expect(run.out).toContain("checklist_fanout is 1");
  });

  it("D154: no fan-out warning is given once checklist_fanout is 4", () => {
    const run = checkAfter((root) => {
      menuMode(root, "4");
      fourthShard(root);
    });
    expect(run.out).not.toContain("SCALE WARNING");
  });
});

describe("rule hygiene positive control", () => {
  it("D155: a rule doc holding no rules fails the check instead of passing unread", () => {
    const run = checkAfter((root) =>
      write(root, "_agent-docs/project-context.md", "# Project Context\n"),
    );
    expect(run.code).toBe(1);
  });
});
