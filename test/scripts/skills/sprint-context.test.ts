import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checklistStamp,
  sprintContext,
} from "../../../scripts/lib/skills/sprint-context.mjs";
import { inTree, type Files } from "./harness.js";

const RULES = 60;
const ids = Array.from({ length: RULES }, (_, index) => `C${index + 1}`);
const shard = ids.map((id) => `${id}. **Rule ${id}**: Text.\n`).join("\n");
const CANDIDATES = ids.slice(0, 15);
const LIVE = checklistStamp(ids);
const BUNDLE_DIR = "_agent-docs/sprint-context";

const BASE: Files = {
  "_agent-docs/code-review-checklist/core.md": `# Core\n\n## Rules\n\n${shard}`,
  "_agent-docs/project-context.md": "# Project Context\n\nP1. **One**: Text.\n",
  "_agent-docs/sprint-status.yaml":
    "sprint-1: in-progress\n1-1-parse-events: backlog\n",
  "docs/requirements.md": "# Requirements\n\n- FR1: Parse events. [Sprint 1]\n",
  "docs/adr/0001-json-state.md": "# JSON state\n\nStatus: accepted\n",
  "docs/fixture-only.md": "# Only in the fixture\n",
  "scripts/tool.mjs": "export const inTree = 1;\n",
};

interface BundleFields {
  readonly count?: number | null;
  readonly sha?: string | null;
  readonly checklist?: readonly string[];
  readonly docIds?: readonly string[];
  readonly testInfra?: readonly string[];
  readonly extra?: string;
}

function bundle(fields: BundleFields = {}): string {
  const lines = ["sprint: 1"];
  const count = fields.count === undefined ? LIVE.count : fields.count;
  const sha = fields.sha === undefined ? LIVE.sha : fields.sha;
  if (count !== null) lines.push(`checklist_rule_count: ${count}`);
  if (sha !== null) lines.push(`checklist_ids_sha: ${sha}`);
  lines.push(`checklist: [${(fields.checklist ?? CANDIDATES).join(", ")}]`);
  lines.push(`doc_ids: [${(fields.docIds ?? ["FR1"]).join(", ")}]`);
  lines.push("requirements: [FR1]");
  lines.push(`test_infra: [${(fields.testInfra ?? []).join(", ")}]`);
  if (fields.extra !== undefined) lines.push(fields.extra);
  return `${lines.join("\n")}\n`;
}

function check(bundles: Files, argv: readonly string[] = []) {
  const files: Record<string, string> = { ...BASE };
  for (const [name, text] of Object.entries(bundles))
    files[`${BUNDLE_DIR}/${name}`] = text;
  return inTree(files, ({ config }) => sprintContext(config, argv));
}

describe("check-sprint-context", () => {
  it("D530: an absent bundle directory passes and says so", () => {
    expect(check({}).out).toBe(
      "No sprint-context bundles in _agent-docs/sprint-context.\n",
    );
  });

  it("D531: flags only the candidate id no rule carries", () => {
    const result = check({
      "sprint-1.yaml": bundle({ checklist: [...CANDIDATES, "C999"] }),
    });
    expect(result.err).toBe("UNKNOWN-ID sprint-1.yaml C999\n");
  });

  it("D532: a requirement pointer with no definition is dead", () => {
    const result = check({ "sprint-1.yaml": bundle({ docIds: ["FR9"] }) });
    expect(result.err).toBe(
      "DEAD-DOC sprint-1.yaml FR9: no such requirement\n",
    );
  });

  it("D533: an ADR pointer resolves through the ADR file name", () => {
    const result = check({ "sprint-1.yaml": bundle({ docIds: ["ADR-0001"] }) });
    expect(result.code).toBe(0);
  });

  it("D534: a path pointer resolves against the repository root", () => {
    const result = check({
      "sprint-1.yaml": bundle({ docIds: ["docs/fixture-only.md"] }),
    });
    expect(result.code).toBe(0);
  });

  it("D535: a test_infra anchor naming a missing symbol is dead", () => {
    const result = check({
      "sprint-1.yaml": bundle({ testInfra: ["scripts/tool.mjs#nope"] }),
    });
    expect(result.err).toBe(
      "DEAD-ANCHOR sprint-1.yaml scripts/tool.mjs#nope: no nope in that file\n",
    );
  });

  it("D536: a bundle for a sprint with no status key is orphaned", () => {
    const orphan = bundle().replace("sprint: 1", "sprint: 2");
    expect(check({ "sprint-2.yaml": orphan }).err).toBe(
      "ORPHAN sprint-2.yaml sprint-2 has no status key\n",
    );
  });

  it("D538: a bundle missing half its stamp is malformed", () => {
    const result = check({ "sprint-1.yaml": bundle({ sha: null }) });
    expect(result.err).toBe(
      "MALFORMED sprint-1.yaml missing: stamp (checklist_rule_count and checklist_ids_sha)\n",
    );
  });

  it("D541: a stamp with the live count but another id set is stale", () => {
    const result = check({ "sprint-1.yaml": bundle({ sha: "000000000000" }) });
    expect(result.out).toContain("warning: STALE sprint-1.yaml");
  });

  it("D542: a partial bundle warns as thin however many ids it holds", () => {
    const result = check({
      "sprint-1.yaml": bundle({ extra: "partial: true" }),
    });
    expect(result.out).toContain(
      "warning: THIN sprint-1.yaml: 15 candidate ids (partial)",
    );
  });
});

describe("check-sprint-context --restamp", () => {
  it("D543: writes a fingerprint of the sorted id set", () => {
    const sorted = [...ids].sort().join(",");
    const sha = createHash("sha256").update(sorted).digest("hex").slice(0, 12);
    const files: Record<string, string> = {
      ...BASE,
      [`${BUNDLE_DIR}/sprint-1.yaml`]: bundle({ count: 0, sha: "unset" }),
    };
    const written = inTree(files, ({ config, read }) => {
      sprintContext(config, ["--restamp", "1"]);
      return read(`${BUNDLE_DIR}/sprint-1.yaml`);
    });
    expect(written).toContain(`checklist_ids_sha: ${sha}`);
  });

  it("D544: refuses a bundle that lacks a stamp key to fill", () => {
    const result = check({ "sprint-1.yaml": bundle({ sha: null }) }, [
      "--restamp",
      "1",
    ]);
    expect(result.err).toBe(
      "check-sprint-context: sprint-1.yaml lacks the two stamp keys to fill\n",
    );
  });
});
