import { display, planningFiles, proseLines, readText } from "./files.mjs";
import { parseMarker, unresolvedLinks } from "./markers.mjs";
import { readStatus } from "./status.mjs";

const DEFINITION_LIKE = /^\s*[-*+]\s+\W*N?FR\d/;
const DEFINITION = /^- ((?:N?FR)[1-9]\d*): (.*\S)$/;
const TRAILING_MARKER = /^(.*?)\s*\[([^[\]]*)\]$/;
const REFERENCE = /\bN?FR\d+\b/g;

export function analyzeRequirements(config) {
  const status = readStatus(config);
  const doc = readRequirements(config);
  const problems = [...status.problems, ...doc.problems];
  for (const requirement of doc.requirements) {
    for (const link of unresolvedLinks(requirement.marker, status)) {
      problems.push(
        `${requirement.where}: ${requirement.id} links ${link}, which has no status key.`,
      );
    }
  }
  return { status, requirements: doc.requirements, problems };
}

function readRequirements(config) {
  const doc = { requirements: [], problems: [] };
  const name = display(config, config.requirements);
  const seen = new Map();
  for (const line of proseLines(readText(config.requirements))) {
    if (!DEFINITION_LIKE.test(line.text)) continue;
    const where = `${name}:${line.number}`;
    const requirement = readDefinition(line.text, where, doc.problems);
    if (!requirement) continue;
    const previous = seen.get(requirement.id);
    if (previous) {
      doc.problems.push(
        `${where}: ${requirement.id} is already defined at ${previous}.`,
      );
      continue;
    }
    seen.set(requirement.id, where);
    doc.requirements.push(requirement);
  }
  return doc;
}

function readDefinition(text, where, problems) {
  const definition = DEFINITION.exec(text);
  if (!definition) {
    problems.push(
      `${where}: malformed requirement line; use "- FR<n>: <text> [<marker>]".`,
    );
    return undefined;
  }
  const [, id, rest] = definition;
  const trailing = TRAILING_MARKER.exec(rest);
  if (!trailing) {
    problems.push(`${where}: ${id} has no marker.`);
    return undefined;
  }
  const marker = parseMarker(trailing[2]);
  if (!marker) {
    problems.push(`${where}: ${id} has a malformed marker [${trailing[2]}].`);
    return undefined;
  }
  return { id, title: trailing[1], marker, markerText: trailing[2], where };
}

export function unknownReferences(config, requirements) {
  const known = new Set(requirements.map((requirement) => requirement.id));
  const files = [
    ...planningFiles(config.sprints_dir),
    ...planningFiles(config.ticket_dir, { optional: true }),
  ];
  const problems = [];
  for (const { path } of files) {
    for (const line of proseLines(readText(path))) {
      for (const [id] of line.text.matchAll(REFERENCE)) {
        if (!known.has(id)) {
          problems.push(
            `${display(config, path)}:${line.number}: unknown requirement ${id}.`,
          );
        }
      }
    }
  }
  return problems;
}
