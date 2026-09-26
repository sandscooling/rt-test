// Finds the references a skill's prose makes, line by line, so the wiring
// check can confirm each still points at something real.

const FENCE = /^\s*(`{3,}|~{3,})/;
const INLINE_CODE = /`([^`]+)`/g;
const COMMAND_BREAK = /\s(?:&&|\|\||\||;)\s/;
const SCRIPT_CALL = /scripts\/([A-Za-z0-9_-]+\.mjs)\b(.*)$/;
const FLAG = /(?:^|\s)(--[a-z][a-z0-9-]*)/g;
const QUOTED = /"([^"]+)"/g;

const PATTERNS = Object.freeze({
  script: /(?<![\w./-])scripts\/([A-Za-z0-9_./-]+\.mjs)\b/g,
  agentPath: /\.claude\/agents\/([a-z0-9-]+)(?:\.md)?\b/g,
  agentName: /`(ctx-[a-z0-9-]+)`/g,
  cfg: /\{cfg\.([a-z_]+)\}/g,
  cfgPath:
    /(\{cfg\.[a-z_]+\}\/[A-Za-z0-9_./-]+\.(?:md|yaml|json|mjs|cjs))(?![\w/-])/g,
  scale: /\bscale\.([a-z_]+)\b/g,
  docPath:
    /(?<![\w./-])((?:_agent-docs|docs|\.claude)\/[A-Za-z0-9_./-]+\.(?:md|yaml|json|mjs|cjs))(?![\w/-])/g,
  link: /\]\((?!https?:|#)([^)\s]+\.md)\)/g,
});

function commandUnits(lines) {
  const units = [];
  let fence;
  let pending;
  lines.forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      return;
    }
    if (fence !== undefined) {
      const text = line.replace(/\\\s*$/, "");
      pending = pending
        ? { ...pending, text: `${pending.text} ${text.trim()}` }
        : { line: index + 1, text };
      if (!/\\\s*$/.test(line)) {
        units.push(pending);
        pending = undefined;
      }
      return;
    }
    for (const match of line.matchAll(INLINE_CODE))
      units.push({ line: index + 1, text: match[1] });
  });
  if (pending) units.push(pending);
  return units;
}

function scriptCall(unit) {
  const call = SCRIPT_CALL.exec(unit.text);
  if (!call) return undefined;
  const rest = call[2].split(COMMAND_BREAK)[0];
  return {
    line: unit.line,
    script: call[1],
    flags: [...rest.matchAll(FLAG)].map((match) => match[1]),
    firstArg: rest.trim().split(/\s+/)[0] ?? "",
    quoted: [...rest.matchAll(QUOTED)].map((match) => match[1]),
  };
}

function lineMatches(lines, pattern) {
  return lines.flatMap((line, index) =>
    [...line.matchAll(pattern)].map((match) => ({
      line: index + 1,
      value: match[1],
    })),
  );
}

export function findReferences(text) {
  const lines = text.split(/\r?\n/);
  const refs = {};
  for (const [kind, pattern] of Object.entries(PATTERNS))
    refs[kind] = lineMatches(lines, pattern);
  refs.calls = commandUnits(lines)
    .map(scriptCall)
    .filter((call) => call !== undefined);
  return refs;
}
