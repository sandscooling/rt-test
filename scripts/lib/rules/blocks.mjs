import { classifyLines, readSource, sources } from "./docs.mjs";

const CLOSERS = new Set(["heading", "divider", "comment"]);

function trimTrailingBlanks(lines) {
  const out = [...lines];
  while (out.length > 0 && out.at(-1).trim() === "") out.pop();
  return out;
}

export function parseBlocks(text, file, spec) {
  const blocks = [];
  let heading;
  let sub;
  let current;
  const close = () => {
    if (current)
      blocks.push({ ...current, lines: trimTrailingBlanks(current.lines) });
    current = undefined;
  };
  for (const entry of classifyLines(text, spec)) {
    if (entry.kind === "rule") {
      close();
      current = {
        anchor: entry.anchor,
        file,
        heading,
        sub,
        line: entry.number,
        lines: [entry.line],
      };
    } else if (CLOSERS.has(entry.kind)) {
      close();
      if (/^##\s/.test(entry.line)) [heading, sub] = [entry.line, undefined];
      else if (/^###\s/.test(entry.line)) sub = entry.line;
    } else if (current) {
      current.lines.push(entry.line);
    }
  }
  close();
  return blocks;
}

export function loadBlocks(spec, shard) {
  return sources(spec, shard).flatMap((source) =>
    parseBlocks(readSource(source), source.name, spec),
  );
}

export function duplicateAnchors(blocks) {
  const claims = new Map();
  for (const block of blocks) {
    claims.set(block.anchor, [...(claims.get(block.anchor) ?? []), block]);
  }
  return [...claims.entries()]
    .filter(([, claimed]) => claimed.length > 1)
    .map(([anchor, claimed]) => ({
      anchor,
      where: claimed.map((block) => `${block.file}:${block.line}`),
    }));
}

export function orphanLines(spec) {
  const orphans = [];
  for (const source of sources(spec)) {
    for (const entry of classifyLines(readSource(source), spec)) {
      if (entry.probe) {
        orphans.push(`${source.name}:${entry.number}  ${entry.probe}`);
      }
    }
  }
  return orphans;
}

export function strayProse(spec) {
  const stray = [];
  for (const source of sources(spec)) {
    let inRule = false;
    for (const entry of classifyLines(readSource(source), spec)) {
      if (entry.kind === "rule") inRule = true;
      else if (CLOSERS.has(entry.kind)) inRule = false;
      else if (entry.kind === "text" && !inRule) {
        stray.push(
          `${source.name}:${entry.number}  ${entry.line.slice(0, 100)}`,
        );
      }
    }
  }
  return stray;
}
