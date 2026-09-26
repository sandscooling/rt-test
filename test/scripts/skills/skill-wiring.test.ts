import { describe, expect, it } from "vitest";
import { skillWiring } from "../../../scripts/lib/skills/skill-wiring.mjs";
import { TEMPLATE_FILE } from "../../../scripts/lib/skills/ticket.mjs";
import { inTree, type Files } from "./harness.js";

const SKILL = ".claude/skills/demo/SKILL.md";

const BASE: Files = {
  "scripts/tool.mjs":
    'import "./lib/tool-lib.mjs";\nconst FLAGS = ["--list-all", "--quiet"];\n',
  "scripts/lib/tool-lib.mjs": 'export const DEEP = "--deep";\n',
  "scripts/doc-section.mjs": "export {};\n",
  "_agent-docs/code-change-standards.md":
    "# Standards\n\n## Universal gates\n\nText.\n",
  "_agent-docs/rules/empty.md": "# Empty\n",
  ".claude/agents/ctx-demo.md": "# Demo agent\n",
  ".claude/skills/demo/LOGIC.md": "# Logic\n",
  "docs/real.md": "# Real\n",
};

function wiring(skill: string, extra: Files = {}) {
  return inTree({ ...BASE, ...extra, [SKILL]: skill }, ({ config }) =>
    skillWiring(config, []),
  );
}

describe("check-skill-wiring", () => {
  it("D560: a skill whose every reference resolves passes", () => {
    const skill = [
      "Run `node scripts/tool.mjs --quiet`, then spawn `ctx-demo`.",
      "Read `{cfg.code_change_standards}` while `scale.ctx_agents` is off.",
      "See `docs/real.md`.",
      "",
    ].join("\n");
    expect(wiring(skill)).toMatchObject({ code: 0, err: "" });
  });

  it("D561: a flag that only prefixes a defined flag is unknown", () => {
    expect(wiring("`node scripts/tool.mjs --list`\n").err).toBe(
      `${SKILL}:1: scripts/tool.mjs has no --list flag\n`,
    );
  });

  it("D562: a flag defined in a module the script imports is known", () => {
    expect(wiring("`node scripts/tool.mjs --deep`\n").code).toBe(0);
  });

  it("D563: a flag after a pipe belongs to the next command", () => {
    expect(
      wiring("`node scripts/tool.mjs --quiet | head --lines 3`\n").code,
    ).toBe(0);
  });

  it("D564: a doc-section heading the doc lacks is reported", () => {
    const skill =
      '`node scripts/doc-section.mjs {cfg.code_change_standards} "Nope"`\n';
    expect(wiring(skill).err).toContain('no heading matches "Nope"');
  });

  it("D565: a flag on a continued fenced line is checked", () => {
    const skill = "```sh\nnode scripts/tool.mjs \\\n  --bogus\n```\n";
    expect(wiring(skill).err).toBe(
      `${SKILL}:2: scripts/tool.mjs has no --bogus flag\n`,
    );
  });

  it("D566: a backticked agent name with no agent file is reported", () => {
    expect(wiring("Spawn `ctx-ghost`.\n").err).toBe(
      `${SKILL}:1: no agent .claude/agents/ctx-ghost.md\n`,
    );
  });

  it("D567: the config root is not a path key a skill may cite", () => {
    expect(wiring("Read `{cfg.root}`.\n").err).toBe(
      `${SKILL}:1: {cfg.root} is not a flow config path key\n`,
    );
  });

  it("D568: a path key is not a scale switch", () => {
    expect(wiring("While `scale.checklist_dir` is on.\n").err).toBe(
      `${SKILL}:1: scale.checklist_dir is not a flow config switch\n`,
    );
  });

  it("D569: a scratch path is disposable and never checked", () => {
    expect(
      wiring("Write `_agent-docs/.scratch/grill-handoff.md`.\n").code,
    ).toBe(0);
  });

  it("D570: a doc path that does not exist is reported", () => {
    expect(wiring("Read `docs/ghost.md`.\n").err).toBe(
      `${SKILL}:1: docs/ghost.md does not exist\n`,
    );
  });

  it("D526: a path under a config key resolves in that key's directory", () => {
    expect(wiring("Read `{cfg.rules_dir}/empty.md`.\n").code).toBe(0);
  });

  it("D528: a path under a config key that does not exist is reported", () => {
    expect(wiring("Read `{cfg.rules_dir}/ghost.md`.\n").err).toBe(
      `${SKILL}:1: {cfg.rules_dir}/ghost.md does not exist\n`,
    );
  });

  it("D571: a link resolves from its own skill folder", () => {
    expect(wiring("Read [the branch](LOGIC.md).\n").code).toBe(0);
  });

  it("D572: a ticket template that breaks the contract fails the check", () => {
    const result = wiring("Nothing.\n", { [TEMPLATE_FILE]: "# Template\n" });
    expect(result.err).toContain(`${TEMPLATE_FILE}: template carries`);
  });
});
