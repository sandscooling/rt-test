import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFlowConfig } from "../../../scripts/lib/flow-config.mjs";
import {
  docIntegrity,
  namedByToolCalls,
  readTranscripts,
  scopeToSession,
  selectGates,
} from "../../../scripts/lib/orchestration/doc-integrity.mjs";
import {
  FIXTURES,
  flowConfigIn,
  initRepo,
  REPO,
  withTemp,
  writeIn,
} from "./harness.js";

const ADR = "docs/adr/0001-first.md";
const HYGIENE = "scripts/check-rule-hygiene.mjs";

const gatesFor = (...paths: string[]) =>
  selectGates(loadFlowConfig(REPO), paths).map((gate) => gate.script);

const toolUse = (name: string, input: Record<string, string>) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input }] },
  });

function runHook(dirtyAdr: "modified" | "untracked", stopHookActive = false) {
  return withTemp((root) => {
    const config = flowConfigIn(root);
    const tracked = { "docs/adr/README.md": "index\n" };
    initRepo(
      root,
      dirtyAdr === "modified" ? { ...tracked, [ADR]: "a\n" } : tracked,
    );
    writeIn(root, ADR, "b\n");
    mkdirSync(join(root, "scripts"), { recursive: true });
    cpSync(
      join(FIXTURES, "failing-gate.mjs"),
      join(root, "scripts/adr-index.mjs"),
    );
    const transcript = join(root, "session.jsonl");
    writeIn(
      root,
      "session.jsonl",
      toolUse("Edit", { file_path: join(root, ADR) }),
    );
    return docIntegrity(config, {
      stop_hook_active: stopHookActive,
      transcript_path: transcript,
    });
  });
}

describe("doc-integrity hook", () => {
  it("D329: runs both sprint gates for a sprint file", () => {
    expect(gatesFor("_agent-docs/sprints/sprint-1.md")).toEqual([
      "scripts/check-sprint-keys.mjs",
      "scripts/check-requirement-markers.mjs",
    ]);
  });

  it("D330: ignores a folder that only shares a watched folder's prefix", () => {
    expect(gatesFor("docs/adr-old/0001-x.md")).toEqual([]);
  });

  it("D331: ignores a file that only shares a watched file's prefix", () => {
    expect(gatesFor("_agent-docs/sprint-status.yaml.bak")).toEqual([]);
  });

  it("D332: matches a watched path named in another case", () => {
    expect(gatesFor("DOCS/ADR/0001-x.md")).toEqual(["scripts/adr-index.mjs"]);
  });

  it("D333: does not count a file the session only read", () => {
    expect(
      namedByToolCalls([toolUse("Read", { file_path: "docs/adr/0001-x.md" })]),
    ).toEqual([]);
  });

  it("D334: reports an unknown scope when the transcript holds no tool call", () => {
    expect(namedByToolCalls(['{"type":"user"}'])).toBeNull();
  });

  it("D335: keeps only the dirty paths this session named", () => {
    expect(
      scopeToSession(
        ["docs/adr/0001-a.md", "docs/adr/0002-b.md"],
        ["c:/repo/docs/adr/0001-a.md"],
      ),
    ).toEqual(["docs/adr/0001-a.md"]);
  });

  it("D336: counts a file named only by a subagent's tool call", () => {
    const named = withTemp((dir) => {
      const main = join(dir, "session.jsonl");
      writeIn(dir, "session.jsonl", toolUse("Read", { file_path: "x" }));
      writeIn(
        dir,
        "session/subagents/agent-1.jsonl",
        toolUse("Write", { file_path: ADR }),
      );
      return namedByToolCalls(readTranscripts(main));
    });
    expect(named).toEqual([ADR]);
  });

  it("D337: blocks the stop when a gate fails on a modified file the session named", () => {
    expect(runHook("modified").code).toBe(2);
  });

  it("D338: blocks the stop when a gate fails on a new untracked file the session named", () => {
    expect(runHook("untracked").code).toBe(2);
  });

  it("D339: never blocks a stop the hook already blocked once", () => {
    expect(runHook("modified", true).code).toBe(0);
  });

  it("D353: runs rule hygiene for an AGENTS.md edit", () => {
    expect(gatesFor("AGENTS.md")).toEqual([HYGIENE]);
  });

  it("D354: runs rule hygiene for a file in the flow config's rules folder", () => {
    expect(gatesFor("_agent-docs/rules/r-1.md")).toEqual([HYGIENE]);
  });

  it("D355: runs rule hygiene for a skill nested in the skills folder", () => {
    expect(gatesFor(".claude/skills/orchestrator/SKILL.md")).toEqual([HYGIENE]);
  });

  it("D356: runs rule hygiene for a project context edit", () => {
    expect(gatesFor("_agent-docs/project-context.md")).toEqual([HYGIENE]);
  });
});
