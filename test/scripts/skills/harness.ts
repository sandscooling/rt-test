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
import { runFillTicket } from "../../../scripts/lib/skills/fill-ticket-cli.mjs";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));

export type Files = Readonly<Record<string, string>>;

export interface Tree {
  readonly config: FlowConfig;
  readonly root: string;
  readonly read: (path: string) => string;
}

export function inTree<T>(files: Files, body: (tree: Tree) => T): T {
  const root = mkdtempSync(join(tmpdir(), "rt-test-skills-"));
  try {
    mkdirSync(dirname(join(root, FLOW_CONFIG_FILE)), { recursive: true });
    cpSync(join(REPO, FLOW_CONFIG_FILE), join(root, FLOW_CONFIG_FILE));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return body({
      config: loadFlowConfig(root),
      root,
      read: (path) => readFileSync(join(root, path), "utf8"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export function fillTicket(root: string, argv: readonly string[]): Run {
  const out: string[] = [];
  const err: string[] = [];
  const code = runFillTicket(argv, {
    root,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
