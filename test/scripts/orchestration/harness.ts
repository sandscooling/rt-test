import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLOW_CONFIG_FILE,
  loadFlowConfig,
  type FlowConfig,
} from "../../../scripts/lib/flow-config.mjs";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const FIXTURES = join(REPO, "test/fixtures/orchestration");

export function withTemp<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "rt-test-orchestration-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeIn(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function initRepo(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q");
  for (const [key, value] of [
    ["user.name", "fixture"],
    ["user.email", "fixture@example.invalid"],
    ["core.autocrlf", "false"],
    ["commit.gpgsign", "false"],
  ] as const) {
    git(root, "config", key, value);
  }
  for (const [path, text] of Object.entries(files)) writeIn(root, path, text);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
}

export function flowConfigIn(root: string): FlowConfig {
  mkdirSync(join(root, "_agent-docs"), { recursive: true });
  cpSync(join(REPO, FLOW_CONFIG_FILE), join(root, FLOW_CONFIG_FILE));
  return loadFlowConfig(root);
}
