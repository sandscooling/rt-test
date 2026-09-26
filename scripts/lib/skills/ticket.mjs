// Ticket files: section fills, rule-id markers, and the structure every
// ticket and the template must keep. Every byte a fill writes comes from its
// input verbatim, and any problem aborts the whole batch.

export const TEMPLATE_FILE = ".claude/skills/create-ticket/template.md";

export const ID_MARKERS = Object.freeze({
  checklist: "CHECKLIST_RULE_IDS",
  "project-context": "PROJECT_CONTEXT_RULE_IDS",
});

// Headings other skills find by exact text. A reworded one silently drops
// what the reader was looking for, so the template must carry each once.
export const CONTRACT_HEADINGS = Object.freeze([
  "## Ticket",
  "## Acceptance Criteria",
  "## Unverified Assumptions",
  "## Tasks / Subtasks",
  "## Reusable Code",
  "## Dev Notes",
  "### References",
  "## Checklist Rules",
  "## Project Context Rules",
  "## Execution Metadata",
  "## Dev Agent Record",
  "### Dev Handoff",
  "#### Test Files This Change Broke",
  "#### ACs Owed a Test",
  "#### Tests Owed",
  "### Tests Record",
  "#### Named Defects",
  "#### Deliberately Untested",
  "### Review Record",
  "#### Test Coverage Gaps",
  "### Completion Notes",
  "### File List",
]);

export const METADATA_KEYS = Object.freeze([
  "area",
  "is_consolidation",
  "sizing_ac_count",
  "files_to_modify",
  "files_to_create",
]);

const DOWNSTREAM_SECTION = "Dev Agent Record";
const FENCE = /^\s*(`{3,}|~{3,})/;
const DATA_FENCE = /^\s*```(ya?ml|json|toml)\b/i;
const PLACEHOLDER = /\{\{[a-z_0-9]+\}\}/gi;
const PENDING = /RULE_IDS:\s*PENDING\s*-->/;
const EMPTY_MARKER = /RULE_IDS:\s*-->/;
const TITLE = /^# Ticket [1-9]\d*\.[1-9]\d*[a-z]?: \S/;
// State lives only in the status file, so a ticket header never carries it.
const STATUS_LINE = /^(?:\*\*)?Status(?:\*\*)?:/i;

const splitLines = (text) => text.split(/\r?\n/);
const normalize = (text) => splitLines(text).join("\n");
const hasDataFence = (lines) => lines.some((line) => DATA_FENCE.test(line));

// Heading level per line, 0 for a non-heading or a line inside a code fence.
function headingLevels(lines) {
  let fence;
  return lines.map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker[0];
      else if (marker[0] === fence) fence = undefined;
      return 0;
    }
    if (fence !== undefined) return 0;
    return /^(#{1,6}) \S/.exec(line)?.[1].length ?? 0;
  });
}

const headingText = (line) => line.replace(/^#{1,6}\s+/, "").trim();

function sectionEnd(levels, start) {
  const level = levels[start];
  for (let index = start + 1; index < levels.length; index += 1) {
    if (levels[index] !== 0 && levels[index] <= level) return index;
  }
  return levels.length;
}

function findSection(lines, levels, name) {
  const hits = [];
  lines.forEach((line, index) => {
    if (levels[index] !== 0 && headingText(line) === name) hits.push(index);
  });
  if (hits.length === 0) return { error: `no heading matches "${name}"` };
  if (hits.length > 1) {
    const where = hits.map((index) => index + 1).join(", ");
    return {
      error: `heading "${name}" appears ${hits.length} times (lines ${where})`,
    };
  }
  const [headingIndex] = hits;
  return {
    headingIndex,
    bodyStart: headingIndex + 1,
    bodyEnd: sectionEnd(levels, headingIndex),
  };
}

function leadingComment(body) {
  let start = 0;
  while (start < body.length && body[start].trim() === "") start += 1;
  if (start >= body.length || !body[start].trimStart().startsWith("<!--"))
    return [];
  for (let end = start; end < body.length; end += 1) {
    if (body[end].includes("-->")) return body.slice(start, end + 1);
  }
  return [];
}

export function parseSectionsFile(text) {
  const blocks = [];
  const errors = [];
  let current;
  splitLines(text).forEach((line, index) => {
    if (current === undefined) {
      const open = /^<<<\s+(.+?)\s*$/.exec(line);
      if (open) current = { name: open[1], body: [], line: index + 1 };
      else if (line.trim() !== "")
        errors.push(
          `line ${index + 1}: expected "<<< <heading>", got: ${line}`,
        );
      return;
    }
    if (/^>>>\s*$/.test(line)) {
      blocks.push(current);
      current = undefined;
    } else current.body.push(line);
  });
  if (current)
    errors.push(
      `block "${current.name}" at line ${current.line} never closes with ">>>"`,
    );
  if (blocks.length === 0 && errors.length === 0) errors.push("no blocks");
  const names = blocks.map((block) => block.name);
  for (const name of new Set(names)) {
    if (names.indexOf(name) !== names.lastIndexOf(name))
      errors.push(`"${name}" is named twice; the second would silently win`);
  }
  return errors.length > 0 ? { errors } : { blocks };
}

function nestingErrors(targets) {
  const errors = [];
  for (const outer of targets) {
    for (const inner of targets) {
      const inside =
        inner.at.headingIndex > outer.at.headingIndex &&
        inner.at.headingIndex < outer.at.bodyEnd;
      if (inside) {
        errors.push(
          `"${inner.block.name}" is nested inside "${outer.block.name}", and a parent fill replaces its children. Put it inside the "${outer.block.name}" block's body, or drop "${outer.block.name}" from the batch.`,
        );
      }
    }
  }
  return errors;
}

function dataFenceErrors(targets, lines) {
  return targets
    .filter(
      ({ block, at }) =>
        hasDataFence(lines.slice(at.bodyStart, at.bodyEnd)) &&
        !hasDataFence(block.body),
    )
    .map(
      ({ block }) =>
        `"${block.name}" holds a machine-read fenced block and your body has none, so this fill would DELETE it. Edit that section directly, or include the block verbatim.`,
    );
}

function trimBlankEdges(lines) {
  const out = [...lines];
  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out.at(-1).trim() === "") out.pop();
  return out;
}

export function applyFills(text, blocks) {
  const source = normalize(text);
  const trailing = source.endsWith("\n");
  let lines = splitLines(trailing ? source.slice(0, -1) : source);
  const levels = headingLevels(lines);
  const located = blocks.map((block) => ({
    block,
    at: findSection(lines, levels, block.name),
  }));
  const missing = located
    .filter(({ at }) => at.error)
    .map(({ block, at }) => `${block.name}: ${at.error}`);
  if (missing.length > 0) return { errors: missing };
  const errors = [
    ...nestingErrors(located),
    ...dataFenceErrors(located, lines),
  ];
  if (errors.length > 0) return { errors };
  const applied = [];
  const descending = [...located].sort(
    (a, b) => b.at.headingIndex - a.at.headingIndex,
  );
  for (const { block, at } of descending) {
    const existing = lines.slice(at.bodyStart, at.bodyEnd);
    const suppliesComment = block.body.some((line) =>
      line.trimStart().startsWith("<!--"),
    );
    const kept = suppliesComment ? [] : leadingComment(existing);
    const body = trimBlankEdges(block.body);
    const replacement =
      kept.length > 0 ? ["", ...kept, "", ...body, ""] : ["", ...body, ""];
    lines = [
      ...lines.slice(0, at.bodyStart),
      ...replacement,
      ...lines.slice(at.bodyEnd),
    ];
    applied.unshift({
      name: block.name,
      lines: body.length,
      keptComment: kept.length > 0,
    });
  }
  return { text: lines.join("\n") + (trailing ? "\n" : ""), applied };
}

function topSections(lines, levels) {
  const sections = [];
  levels.forEach((level, index) => {
    if (level === 2)
      sections.push({
        name: headingText(lines[index]),
        body: lines.slice(index + 1, sectionEnd(levels, index)),
        bodyLevels: levels.slice(index + 1, sectionEnd(levels, index)),
      });
  });
  return sections;
}

function skipReason(section) {
  if (section.name === DOWNSTREAM_SECTION)
    return "later workflow sessions fill it";
  if (section.body.some((line) => line.includes("RULE_IDS:")))
    return "use --ids, never --fill";
  if (hasDataFence(section.body))
    return "machine-read block; edit it directly, never --fill";
  return undefined;
}

export function scaffold(text) {
  const lines = splitLines(normalize(text));
  const out = [];
  const skipped = [];
  for (const section of topSections(lines, headingLevels(lines))) {
    const reason = skipReason(section);
    if (reason !== undefined) {
      skipped.push(`${section.name} (${reason})`);
      continue;
    }
    out.push(`<<< ${section.name}`, "");
    section.body.forEach((line, index) => {
      if (section.bodyLevels[index] === 3) out.push(line, "");
    });
    out.push(">>>");
  }
  return { sections: `${out.join("\n")}\n`, skipped };
}

export function applyIds(text, assignments) {
  let out = normalize(text);
  const errors = [];
  const applied = [];
  for (const [doc, ids] of Object.entries(assignments)) {
    const marker = ID_MARKERS[doc];
    if (marker === undefined) {
      errors.push(
        `unknown doc "${doc}"; use ${Object.keys(ID_MARKERS).join(" or ")}`,
      );
      continue;
    }
    if (ids.trim() === "") {
      errors.push(`${marker}: no ids given; write none for an empty selection`);
      continue;
    }
    const pattern = new RegExp(`<!--\\s*${marker}:[^>]*-->`, "g");
    const count = out.match(pattern)?.length ?? 0;
    if (count !== 1) {
      errors.push(`${marker}: expected exactly 1 marker, found ${count}`);
      continue;
    }
    out = out.replace(pattern, `<!-- ${marker}: ${ids} -->`);
    applied.push(`${marker} = ${ids}`);
  }
  return errors.length > 0 ? { errors } : { text: out, applied };
}

function missingHeadings(ticketLines, templateLines) {
  const ticketLevels = headingLevels(ticketLines);
  const have = new Set(
    ticketLines.filter((_, index) => ticketLevels[index] >= 2).map(headingText),
  );
  const templateLevels = headingLevels(templateLines);
  return templateLines
    .filter((_, index) => templateLevels[index] >= 2)
    .map(headingText)
    .filter((name) => !have.has(name))
    .map((name) => `missing section "${name}", which the template ships`);
}

function lostDataFences(ticketLines, templateLines) {
  const ticketLevels = headingLevels(ticketLines);
  return topSections(templateLines, headingLevels(templateLines))
    .filter((section) => hasDataFence(section.body))
    .flatMap((section) => {
      const at = findSection(ticketLines, ticketLevels, section.name);
      if (at.error) return [];
      if (hasDataFence(ticketLines.slice(at.bodyStart, at.bodyEnd))) return [];
      return [
        `section "${section.name}" lost the machine-read block the template ships there; restore it`,
      ];
    });
}

function headerProblems(lines, levels) {
  const first = lines.findIndex((line) => line.trim() !== "");
  const problems =
    first !== -1 && TITLE.test(lines[first])
      ? []
      : ['the first line is not "# Ticket <N>.<M>: <title>"'];
  const firstSection = levels.findIndex((level) => level === 2);
  const header = firstSection === -1 ? lines : lines.slice(0, firstSection);
  header.forEach((line, index) => {
    if (STATUS_LINE.test(line))
      problems.push(
        `line ${index + 1}: a Status line; state lives only in the status file`,
      );
  });
  return problems;
}

export function checkTicket(text, templateText) {
  const lines = splitLines(normalize(text));
  const levels = headingLevels(lines);
  const problems = headerProblems(lines, levels);
  let downstream = false;
  lines.forEach((line, index) => {
    if (levels[index] === 2)
      downstream = headingText(line) === DOWNSTREAM_SECTION;
    if (PENDING.test(line))
      problems.push(`line ${index + 1}: rule-id marker still PENDING`);
    if (EMPTY_MARKER.test(line))
      problems.push(
        `line ${index + 1}: rule-id marker is empty; write the ids or none`,
      );
    if (downstream) return;
    for (const match of line.matchAll(PLACEHOLDER))
      problems.push(`line ${index + 1}: unfilled placeholder ${match[0]}`);
  });
  const templateLines = splitLines(normalize(templateText));
  problems.push(...missingHeadings(lines, templateLines));
  problems.push(...lostDataFences(lines, templateLines));
  problems.push(...lostMetadataKeys(lines, templateLines));
  return problems;
}

function metadataBody(lines, levels) {
  const at = findSection(lines, levels, "Execution Metadata");
  return at.error ? undefined : lines.slice(at.bodyStart, at.bodyEnd);
}

const hasKey = (body, key) => body.some((line) => line.startsWith(`${key}:`));

// A ticket keeps every metadata key the template ships, since dev-ticket
// parses them; values stay unchecked because create-ticket fills them last.
function lostMetadataKeys(ticketLines, templateLines) {
  const template = metadataBody(templateLines, headingLevels(templateLines));
  const ticket = metadataBody(ticketLines, headingLevels(ticketLines));
  if (template === undefined || ticket === undefined) return [];
  if (!hasDataFence(ticket)) return [];
  return METADATA_KEYS.filter(
    (key) => hasKey(template, key) && !hasKey(ticket, key),
  ).map((key) => `"Execution Metadata" yaml block lost the ${key} key`);
}

function metadataProblems(lines, levels) {
  const body = metadataBody(lines, levels);
  if (body === undefined) return [];
  if (!hasDataFence(body))
    return ['"Execution Metadata" has no yaml block for dev-ticket to parse'];
  return METADATA_KEYS.filter((key) => !hasKey(body, key)).map(
    (key) => `"Execution Metadata" yaml block lacks the ${key} key`,
  );
}

export function templateProblems(templateText) {
  const lines = splitLines(normalize(templateText));
  const levels = headingLevels(lines);
  const problems = [];
  for (const heading of CONTRACT_HEADINGS) {
    const count = lines.filter(
      (line, index) => levels[index] !== 0 && line.trim() === heading,
    ).length;
    if (count !== 1)
      problems.push(
        `template carries "${heading}" ${count} times; expected once`,
      );
  }
  for (const marker of Object.values(ID_MARKERS)) {
    const count = lines.filter((line) =>
      new RegExp(`<!--\\s*${marker}:\\s*PENDING\\s*-->`).test(line),
    ).length;
    if (count !== 1)
      problems.push(
        `template carries ${count} PENDING ${marker} markers; expected 1`,
      );
  }
  problems.push(...metadataProblems(lines, levels));
  return problems;
}
