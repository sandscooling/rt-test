import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FLOW_CONFIG_FILE,
  loadFlowConfig,
  type FlowConfig,
} from "../../../scripts/lib/flow-config.mjs";
import type { Result } from "../../../scripts/lib/standards/result.mjs";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = join(REPO, "test/fixtures/standards");

export type Files = Readonly<Record<string, string>>;

function writeTree(root: string, files: Files): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

export function inTree<T>(
  files: Files,
  body: (config: FlowConfig, root: string) => T,
  base?: string,
): T {
  const root = mkdtempSync(join(tmpdir(), "rt-test-standards-"));
  try {
    if (base !== undefined)
      cpSync(join(FIXTURES, base), root, { recursive: true });
    cpSync(join(REPO, FLOW_CONFIG_FILE), join(root, FLOW_CONFIG_FILE));
    writeTree(root, files);
    return body(loadFlowConfig(root), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function repoConfig(): FlowConfig {
  return loadFlowConfig(REPO);
}

export const SECTIONS = "test/fixtures/standards/sections.md";

export const ENGINE = "packages/demo/src/engine.mjs";
export const LIB_ENGINE = "packages/demo/lib/engine.mjs";
export const USE_FETCH = "packages/demo/src/use-fetch.mjs";
const SOURCE_LINES = 30;

export function source(name: string): string {
  const lines = Array.from(
    { length: SOURCE_LINES },
    (_, index) => `export const ${name}${index + 1} = ${index + 1};`,
  );
  return `${lines.join("\n")}\n`;
}

export interface SourceEdit {
  readonly file: string;
  readonly at: number;
  readonly remove: number;
  readonly insert: readonly string[];
}

export const INSERT_TWO_AT_10: SourceEdit = {
  file: ENGINE,
  at: 10,
  remove: 0,
  insert: ["export const added1 = 1;", "export const added2 = 2;"],
};

function applyEdit(root: string, edit: SourceEdit): void {
  const path = join(root, edit.file);
  const lines = readFileSync(path, "utf8").split("\n");
  lines.splice(edit.at - 1, edit.remove, ...edit.insert);
  writeFileSync(path, lines.join("\n"));
}

function git(root: string, args: readonly string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore", windowsHide: true });
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message]);
}

export interface Scenario {
  readonly docs?: Files;
  readonly edit?: SourceEdit;
  readonly commitEdit?: boolean;
  readonly args?: readonly string[];
}

type Command = (config: FlowConfig, args: readonly string[]) => Result;

export function citations(command: Command, scenario: Scenario = {}): Result {
  const files: Files = {
    [ENGINE]: source("engine"),
    [LIB_ENGINE]: source("lib"),
    [USE_FETCH]: source("fetch"),
    ...scenario.docs,
  };
  return inTree(
    files,
    (config, root) => {
      git(root, ["init", "-q"]);
      git(root, ["config", "user.name", "RT Test fixture"]);
      git(root, ["config", "user.email", "fixture@example.invalid"]);
      git(root, ["config", "core.autocrlf", "false"]);
      commitAll(root, "base");
      applyEdit(root, scenario.edit ?? INSERT_TWO_AT_10);
      if (scenario.commitEdit === true) commitAll(root, "edit");
      return command(config, scenario.args ?? []);
    },
    "citations",
  );
}
