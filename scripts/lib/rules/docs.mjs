import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadFlowConfig } from "../flow-config.mjs";

export class RuleError extends Error {}

export const DOC_NAMES = ["checklist", "project-context"];

// Any column-0 token shaped like an id, so a malformed or misplaced one is reported rather than lost.
const ID_PROBE = /^(?:- )?([A-Z]+\d+\w*)\.\s/;

export function loadRuleDocs(root) {
  const config = loadFlowConfig(root);
  return {
    config,
    docs: {
      checklist: {
        name: "checklist",
        dir: config.checklist_dir,
        prefix: "C",
        blockStart: /^(C\d+)\.\s/,
        sectionTitle: "## Checklist Rules",
        marker: /<!--\s*CHECKLIST_RULE_IDS:\s*([^>]*?)\s*-->/,
      },
      "project-context": {
        name: "project-context",
        file: config.project_context,
        prefix: "P",
        blockStart: /^(P\d+)\.\s/,
        sectionTitle: "## Project Context Rules",
        marker: /<!--\s*PROJECT_CONTEXT_RULE_IDS:\s*([^>]*?)\s*-->/,
      },
    },
  };
}

export function docSpec(docs, name) {
  const spec = docs[name];
  if (!spec) {
    throw new RuleError(
      `--doc must be one of: ${DOC_NAMES.join(", ")}, got: ${name}`,
    );
  }
  return spec;
}

export function docLabel(spec) {
  return spec.file ?? spec.dir;
}

function shardFileName(shard) {
  return shard.endsWith(".md") ? shard : `${shard}.md`;
}

function shardOrder(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new RuleError(`rule doc folder not found: ${dir}`);
  }
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "_index.md",
  );
  const indexPath = join(dir, "_index.md");
  const indexed = existsSync(indexPath)
    ? [...readFileSync(indexPath, "utf8").matchAll(/\.\/([\w-]+\.md)/g)].map(
        (match) => match[1],
      )
    : [];
  const ranked = [...new Set(indexed)].filter((name) => files.includes(name));
  const rest = files.filter((name) => !ranked.includes(name)).sort();
  return [...ranked, ...rest];
}

export function sources(spec, shard) {
  if (spec.file) {
    if (!existsSync(spec.file)) {
      throw new RuleError(`rule doc not found: ${spec.file}`);
    }
    return [{ path: spec.file, name: basename(spec.file) }];
  }
  const all = shardOrder(spec.dir).map((name) => ({
    path: join(spec.dir, name),
    name,
  }));
  if (!shard) return all;
  return all.filter((source) => source.name === shardFileName(shard));
}

export function readSource(source) {
  return readFileSync(source.path, "utf8");
}

function classifyText(line) {
  if (/^#{1,6}\s/.test(line)) return "heading";
  if (/^---\s*$/.test(line)) return "divider";
  if (line.trim() === "") return "blank";
  if (line.startsWith(">")) return "quote";
  return "text";
}

// One pass shared by every reader, so the parser and each gate agree on what is a rule line.
export function classifyLines(text, spec) {
  const out = [];
  let inComment = false;
  text.split(/\r?\n/).forEach((line, index) => {
    const number = index + 1;
    if (inComment || line.startsWith("<!--")) {
      inComment = !line.includes("-->");
      out.push({ kind: "comment", line, number });
      return;
    }
    const start = spec.blockStart.exec(line);
    if (start) {
      out.push({ kind: "rule", line, number, anchor: start[1], start });
      return;
    }
    const probe = ID_PROBE.exec(line);
    const kind = classifyText(line);
    out.push({ kind, line, number, probe: probe ? probe[1] : undefined });
  });
  return out;
}
