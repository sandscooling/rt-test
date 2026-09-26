import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FLOW_CONFIG_FILE,
  loadFlowConfig,
  type FlowConfig,
} from "../../../scripts/lib/flow-config.mjs";

const VALID = `# Workflow path config.
ticket_dir: _agent-docs/tickets
sprints_dir: _agent-docs/sprints
sprint_status: _agent-docs/sprint-status.yaml
sprint_context_dir: _agent-docs/sprint-context
requirements: docs/requirements.md
adr_dir: docs/adr
glossary: docs/glossary.md
design_decisions_dir: docs/design-decisions
checklist_dir: _agent-docs/code-review-checklist
project_context: _agent-docs/project-context.md
rule_maintenance_guide: _agent-docs/rule-maintenance-guide.md
rules_dir: _agent-docs/rules
code_change_standards: _agent-docs/code-change-standards.md
adversarial_review_prompt: _agent-docs/adversarial-review-prompt.md

scale:
  # Switches.
  rule_selection: whole
  checklist_fanout: 1
  sprint_context: off
  ctx_agents: off
  doc_sections: off
  prototype_ui: off
`;

interface Outcome {
  readonly root: string;
  readonly result: FlowConfig | string;
}

function load(yaml: string | undefined): Outcome {
  const root = mkdtempSync(join(tmpdir(), "rt-test-flow-config-"));
  try {
    if (yaml !== undefined) {
      const file = join(root, FLOW_CONFIG_FILE);
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, yaml);
    }
    return { root, result: loadFlowConfig(root) };
  } catch (error) {
    return { root, result: error instanceof Error ? error.message : "?" };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function edited(from: string, to: string): string {
  if (!VALID.includes(from)) throw new Error(`Fixture lacks ${from}`);
  return VALID.replace(from, to);
}

function failure(yaml: string | undefined): string {
  const { result } = load(yaml);
  return typeof result === "string" ? result : "loaded";
}

function scale(yaml: string): FlowConfig["scale"] | string {
  const { result } = load(yaml);
  return typeof result === "string" ? result : result.scale;
}

function path(yaml: string, key: keyof FlowConfig, relative: string) {
  const { root, result } = load(yaml);
  return { actual: result, expected: { [key]: resolve(root, relative) } };
}

describe("flow config required content", () => {
  it("D021: a missing config file fails and names the file", () => {
    expect(failure(undefined)).toMatch(
      /Cannot read flow config .*_flow-config\.yaml/,
    );
  });

  it("D022: a missing path key fails", () => {
    expect(failure(edited("glossary: docs/glossary.md\n", ""))).toMatch(
      /missing required key glossary\./,
    );
  });

  it("D023: a missing scale switch fails", () => {
    expect(failure(edited("  prototype_ui: off\n", ""))).toMatch(
      /missing required key scale\.prototype_ui\./,
    );
  });

  it("D024: an unknown scale key fails", () => {
    expect(failure(`${VALID}  ctx_agent: on\n`)).toMatch(
      /unknown scale key ctx_agent\./,
    );
  });

  it("D025: a scale value outside its set fails", () => {
    expect(
      failure(edited("sprint_context: off", "sprint_context: yes")),
    ).toMatch(/scale\.sprint_context must be off \| on, not yes\./);
  });

  it("D040: an unknown top-level key fails", () => {
    expect(failure(`tickets_dir: _agent-docs/t\n${VALID}`)).toMatch(
      /unknown key\(s\) tickets_dir\./,
    );
  });

  it("D043: a scalar scale value fails", () => {
    expect(failure(VALID.replace(/scale:[\s\S]*$/, "scale: on\n"))).toMatch(
      /scale must be a map of switches\./,
    );
  });

  it("D044: a map given for a path key fails", () => {
    expect(
      failure(edited("glossary: docs/glossary.md", "glossary:\n  a: b")),
    ).toMatch(/glossary must be a non-empty path\./);
  });

  it("D045: an empty quoted path fails", () => {
    expect(
      failure(edited("glossary: docs/glossary.md", 'glossary: ""')),
    ).toMatch(/glossary must be a non-empty path\./);
  });

  it("D033: a path climbing out of the repository fails", () => {
    expect(failure(edited("adr_dir: docs/adr", "adr_dir: ../adr"))).toMatch(
      /adr_dir must stay inside the repository\./,
    );
  });
});

describe("flow config values", () => {
  it("D026: an off switch reads as false", () => {
    expect(scale(VALID)).toHaveProperty("ctx_agents", false);
  });

  it("D028: an on switch reads as true", () => {
    expect(
      scale(edited("doc_sections: off", "doc_sections: on")),
    ).toHaveProperty("doc_sections", true);
  });

  it("D027: a checklist fanout of 4 reads as a number", () => {
    expect(
      scale(edited("checklist_fanout: 1", "checklist_fanout: 4")),
    ).toHaveProperty("checklist_fanout", 4);
  });

  it("D029: rule selection menu reads as menu", () => {
    expect(
      scale(edited("rule_selection: whole", "rule_selection: menu")),
    ).toHaveProperty("rule_selection", "menu");
  });

  it("D030: paths resolve against the given root", () => {
    const { actual, expected } = path(
      VALID,
      "ticket_dir",
      "_agent-docs/tickets",
    );
    expect(actual).toMatchObject(expected);
  });

  it("D151: the rules folder is read from rules_dir", () => {
    const { actual, expected } = path(VALID, "rules_dir", "_agent-docs/rules");
    expect(actual).toMatchObject(expected);
  });

  it("D031: the config object is frozen", () => {
    const { result } = load(VALID);
    expect(typeof result === "object" && Object.isFrozen(result)).toBe(true);
  });

  it("D032: the scale block is frozen", () => {
    const value = scale(VALID);
    expect(typeof value === "object" && Object.isFrozen(value)).toBe(true);
  });
});

describe("flow config YAML subset", () => {
  it("D034: a trailing comment is not part of the path", () => {
    const { actual, expected } = path(
      edited("docs/glossary.md", "docs/glossary.md  # terms"),
      "glossary",
      "docs/glossary.md",
    );
    expect(actual).toMatchObject(expected);
  });

  it("D035: a hash inside a path is kept", () => {
    const { actual, expected } = path(
      edited("docs/glossary.md", "docs/c#.md"),
      "glossary",
      "docs/c#.md",
    );
    expect(actual).toMatchObject(expected);
  });

  it("D036: quotes around a value are removed", () => {
    const { actual, expected } = path(
      edited("adr_dir: docs/adr", 'adr_dir: "docs/a #b" # note'),
      "adr_dir",
      "docs/a #b",
    );
    expect(actual).toMatchObject(expected);
  });

  it("D046: a double-quoted escape fails", () => {
    expect(
      failure(edited("adr_dir: docs/adr", 'adr_dir: "docs\\tadr"')),
    ).toMatch(/unsupported value syntax/);
  });

  it("D037: a flow sequence fails", () => {
    expect(
      failure(
        edited("requirements: docs/requirements.md", "requirements: [a, b]"),
      ),
    ).toMatch(/unsupported value syntax: \[a, b\]/);
  });

  it("D038: a line that is not a key fails", () => {
    expect(failure(`${VALID}stray words\n`)).toMatch(
      /:\d+: unsupported syntax: stray words/,
    );
  });

  it("D039: a duplicated key fails", () => {
    expect(failure(`glossary: docs/other.md\n${VALID}`)).toMatch(
      /duplicate key glossary\./,
    );
  });

  it("D041: an indented key under a scalar key fails", () => {
    expect(
      failure(edited("adr_dir: docs/adr\n", "adr_dir: docs/adr\n  extra: x\n")),
    ).toMatch(/indented key outside a map\./);
  });

  it("D042: a second level of nesting fails", () => {
    expect(
      failure(
        edited(
          "  rule_selection: whole\n",
          "  rule_selection:\n    deep: whole\n",
        ),
      ),
    ).toMatch(/only one level of nesting is supported\./);
  });

  it("D047: a key without a space after its colon fails", () => {
    expect(failure(edited("adr_dir: docs/adr", "adr_dir:docs/adr"))).toMatch(
      /expected a space after the colon\./,
    );
  });

  it("D049: a YAML null given for a path fails", () => {
    expect(failure(edited("adr_dir: docs/adr", "adr_dir: ~"))).toMatch(
      /unsupported value syntax: ~/,
    );
  });
});

describe("committed flow config", () => {
  it("D048: the repository config holds the agreed paths and switches", () => {
    const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    const at = (relative: string) => resolve(root, relative);
    let actual: FlowConfig | string;
    try {
      actual = loadFlowConfig();
    } catch (error) {
      actual = error instanceof Error ? error.message : "?";
    }
    expect(actual).toEqual({
      root,
      ticket_dir: at("_agent-docs/tickets"),
      sprints_dir: at("_agent-docs/sprints"),
      sprint_status: at("_agent-docs/sprint-status.yaml"),
      sprint_context_dir: at("_agent-docs/sprint-context"),
      requirements: at("docs/requirements.md"),
      adr_dir: at("docs/adr"),
      glossary: at("docs/glossary.md"),
      design_decisions_dir: at("docs/design-decisions"),
      checklist_dir: at("_agent-docs/code-review-checklist"),
      project_context: at("_agent-docs/project-context.md"),
      rule_maintenance_guide: at("_agent-docs/rule-maintenance-guide.md"),
      rules_dir: at("_agent-docs/rules"),
      code_change_standards: at("_agent-docs/code-change-standards.md"),
      adversarial_review_prompt: at("_agent-docs/adversarial-review-prompt.md"),
      scale: {
        rule_selection: "whole",
        checklist_fanout: 1,
        sprint_context: false,
        ctx_agents: false,
        doc_sections: false,
        prototype_ui: false,
      },
    });
  });
});
