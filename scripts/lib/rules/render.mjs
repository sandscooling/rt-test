import { loadBlocks } from "./blocks.mjs";
import { classifyLines, readSource, sources } from "./docs.mjs";

// Titles alone are too thin to judge relevance from; past this length an excerpt stops paying for itself.
const MENU_BODY_CHARS = 140;

export function parseIdList(raw) {
  return raw
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export function normalizeIds(spec, ids) {
  const repaired = [];
  const normalized = ids.map((id) => {
    if (!/^\d+$/.test(id)) return id;
    repaired.push(`${id} to ${spec.prefix}${id}`);
    return `${spec.prefix}${id}`;
  });
  return { ids: normalized, repaired };
}

const demote = (heading) => `#${heading}`;

export function renderRules(spec, wanted) {
  const blocks = loadBlocks(spec);
  const known = new Set(blocks.map((block) => block.anchor));
  const missing = wanted.filter((id) => !known.has(id));
  const selected = new Set(wanted.filter((id) => known.has(id)));
  const out = [];
  let lastHeading;
  let lastSub;
  for (const block of blocks.filter((b) => selected.has(b.anchor))) {
    if (block.heading && block.heading !== lastHeading) {
      if (out.length > 0) out.push("");
      out.push(demote(block.heading), "");
      [lastHeading, lastSub] = [block.heading, undefined];
    }
    if (block.sub && block.sub !== lastSub) {
      out.push(demote(block.sub));
      lastSub = block.sub;
    }
    out.push(...block.lines);
  }
  return { text: out.join("\n"), count: selected.size, missing };
}

function menuLine(anchor, bodyLines) {
  const body = bodyLines.join(" ").replace(/\s+/g, " ").trim();
  const label = /^\*\*(.+?)\*\*:?/.exec(body);
  const title = label ? label[1] : "";
  const rest = (label ? body.slice(label[0].length) : body)
    .replace(/→\s*lint-hardening candidate.*$/i, "")
    .trim()
    .slice(0, MENU_BODY_CHARS);
  return `${anchor}. ${title}${rest ? `: ${rest}` : ""}`;
}

// Unfiltered menus replay every heading, since an apparently empty heading scopes the rules beneath it.
// Filtered menus replay only each kept rule's ancestors, so a short list is not buried in headings.
function menuForSource(source, spec, wanted, seen) {
  const out = wanted ? [] : [`\n## ${source.name}`];
  const emitted = new Set();
  let shardEmitted = false;
  let stack = [];
  let pending;
  const flush = () => {
    if (!pending || (wanted && !wanted.has(pending.anchor))) {
      pending = undefined;
      return;
    }
    seen.add(pending.anchor);
    if (wanted) {
      if (!shardEmitted) out.push(`\n## ${source.name}`);
      shardEmitted = true;
      for (const heading of stack.filter((h) => !emitted.has(h.text))) {
        out.push(`### ${heading.text}`);
        emitted.add(heading.text);
      }
    }
    out.push(menuLine(pending.anchor, pending.body));
    pending = undefined;
  };
  for (const entry of classifyLines(readSource(source), spec)) {
    if (entry.kind === "rule") {
      flush();
      pending = {
        anchor: entry.anchor,
        body: [entry.line.slice(entry.start[0].length)],
      };
    } else if (["heading", "divider", "comment"].includes(entry.kind)) {
      flush();
      stack = pushHeading(stack, entry.line, wanted, out);
    } else if (pending) {
      pending.body.push(entry.line);
    }
  }
  flush();
  return out;
}

function pushHeading(stack, line, wanted, out) {
  const match = /^(#{2,4})\s(.*)$/.exec(line);
  if (!match) return stack;
  const level = match[1].length;
  const kept = stack.filter((heading) => heading.level < level);
  if (!wanted) out.push(`### ${match[2]}`);
  return [...kept, { level, text: match[2] }];
}

export function renderMenu(spec, wanted, shard) {
  const seen = new Set();
  const out = sources(spec, shard).flatMap((source) =>
    menuForSource(source, spec, wanted, seen),
  );
  const text = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, seen };
}
