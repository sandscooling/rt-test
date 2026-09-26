import {
  appendFileSync,
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
  runExpandRules,
  type RuleIo,
} from "../../../scripts/lib/rules/expand-cli.mjs";
import { runRuleHygiene } from "../../../scripts/lib/rules/hygiene-cli.mjs";

export const FIXTURE = fileURLToPath(
  new URL("../../fixtures/rules/sharded/", import.meta.url),
);
export const CHECKLIST = "_agent-docs/code-review-checklist";
export const CONFIG = "_agent-docs/_flow-config.yaml";

export interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly lines: readonly string[];
}

type Runner = (argv: readonly string[], io: RuleIo) => number;

function capture(
  runner: Runner,
  argv: readonly string[],
  root: string,
  stdin: string,
): Run {
  const out: string[] = [];
  const err: string[] = [];
  const code = runner(argv, {
    root,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    stdin: () => stdin,
  });
  const text = out.join("\n");
  return { code, out: text, err: err.join("\n"), lines: text.split("\n") };
}

export function expand(argv: readonly string[], root = FIXTURE, stdin = "") {
  return capture(runExpandRules, argv, root, stdin);
}

export function hygiene(argv: readonly string[], root = FIXTURE) {
  return capture(runRuleHygiene, argv, root, "");
}

export function ticket(name: string): string {
  return join(FIXTURE, "tickets", `${name}.md`);
}

export function ruleIds(run: Run): string[] {
  return run.lines.flatMap((line) => /^(C\d+)[.\t]/.exec(line)?.[1] ?? []);
}

export function withCorpus<T>(
  edit: (root: string) => void,
  use: (root: string) => T,
): T {
  const root = mkdtempSync(join(tmpdir(), "rt-test-rules-"));
  try {
    cpSync(FIXTURE, root, { recursive: true });
    edit(root);
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export function append(root: string, file: string, text: string): void {
  appendFileSync(join(root, file), text);
}

export function write(root: string, file: string, text: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

export function replace(
  root: string,
  file: string,
  from: string,
  to: string,
): void {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} lacks ${from}`);
  writeFileSync(path, text.replace(from, to));
}

export function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}
