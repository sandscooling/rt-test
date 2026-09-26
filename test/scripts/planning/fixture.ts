import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import {
  FLOW_CONFIG_FILE,
  loadFlowConfig,
  type FlowConfig,
} from "../../../scripts/lib/flow-config.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = join(REPO, "test/fixtures/planning/base");

export interface Result {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

type Command = (config: FlowConfig, args: readonly string[]) => Result;

export type Edit =
  | { readonly path: string; readonly from: string; readonly to: string }
  | { readonly path: string; readonly content: string };

export function run(
  command: Command,
  edits: readonly Edit[] = [],
  args: readonly string[] = [],
  prepare: (root: string) => void = () => {},
): Result {
  const root = mkdtempSync(join(tmpdir(), "rt-test-planning-"));
  try {
    cpSync(BASE, root, { recursive: true });
    cpSync(join(REPO, FLOW_CONFIG_FILE), join(root, FLOW_CONFIG_FILE));
    prepare(root);
    for (const edit of edits) apply(root, edit);
    return command(loadFlowConfig(root), args);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function apply(root: string, edit: Edit): void {
  const file = join(root, edit.path);
  if ("content" in edit) {
    writeFileSync(file, edit.content);
    return;
  }
  const text = readFileSync(file, "utf8");
  if (!text.includes(edit.from)) {
    throw new Error(`Fixture ${edit.path} lacks ${edit.from}`);
  }
  writeFileSync(file, text.replace(edit.from, edit.to));
}

export function failsWith(text: string): unknown {
  return expect.objectContaining({
    code: 1,
    err: expect.stringContaining(text),
  });
}

export function lineFor(out: string, prefix: string): string | undefined {
  return out.split("\n").find((line) => line.startsWith(prefix));
}

export const STATUS = "_agent-docs/sprint-status.yaml";
export const SPRINT_1 = "_agent-docs/sprints/sprint-1-queryable-results.md";
export const SPRINT_2 = "_agent-docs/sprints/sprint-2-selective-runs.md";
export const TICKET = "_agent-docs/tickets/1-1-parse-events.md";
export const REQUIREMENTS = "docs/requirements.md";
export const ADR_1 = "docs/adr/0001-json-state.md";
export const ADR_2 = "docs/adr/0002-sqlite-state.md";
