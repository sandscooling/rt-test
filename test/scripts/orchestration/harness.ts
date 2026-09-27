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
import { writeFixtureGitConfig } from "../git-fixture.js";
import { PROCESS_SCENARIO_TIMEOUT_MS } from "../timeouts.js";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const FIXTURES = join(REPO, "test/fixtures/orchestration");
// The prompt header's clock, `[YYYY-MM-DD HH:MM Day]`, standing alone.
export const CLOCK_ONLY = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2} [A-Z][a-z]{2}\]$/;

const makeTemp = () => mkdtempSync(join(tmpdir(), "rt-test-orchestration-"));

export function withTemp<T>(run: (dir: string) => T): T {
  const dir = makeTemp();
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function withTempAsync<T>(
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = makeTemp();
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function writeIn(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    timeout: PROCESS_SCENARIO_TIMEOUT_MS,
    windowsHide: true,
  });
}

export function initRepo(root: string, files: Record<string, string>): void {
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q");
  writeFixtureGitConfig(root);
  for (const [path, text] of Object.entries(files)) writeIn(root, path, text);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
}

export function flowConfigIn(root: string): FlowConfig {
  mkdirSync(join(root, "_agent-docs"), { recursive: true });
  cpSync(join(REPO, FLOW_CONFIG_FILE), join(root, FLOW_CONFIG_FILE));
  return loadFlowConfig(root);
}
