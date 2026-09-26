import {
  display,
  failed,
  passed,
  planningFiles,
  proseLines,
  readText,
} from "./files.mjs";

const ADR_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const TITLE = /^# (\S.*)$/;
const STATUS = /^Status: (.*)$/;
const SUPERSEDED = /^superseded by ADR-(\d{4})$/;
const PLAIN_STATUSES = new Set(["proposed", "accepted", "deprecated"]);

export function adrIndex(config, args) {
  if (args.length > 0) return failed(["usage: adr-index.mjs"]);
  const { adrs, problems } = readAdrs(config);
  problems.push(...supersessionProblems(adrs));
  if (problems.length > 0) return failed(problems);
  const successors = new Map();
  for (const adr of adrs.values()) {
    if (adr.supersededBy === undefined) continue;
    successors.set(adr.supersededBy, [
      ...(successors.get(adr.supersededBy) ?? []),
      adr.number,
    ]);
  }
  return passed([
    `ADRs: ${adrs.size} (generated from ${display(config, config.adr_dir)}; do not store this index)`,
    ...[...adrs.values()].map((adr) =>
      indexLine(adr, successors.get(adr.number)),
    ),
  ]);
}

function indexLine(adr, supersedes = []) {
  const numbers = supersedes.map((number) => `ADR-${number}`).join(", ");
  const replaced = numbers ? `; supersedes ${numbers}` : "";
  return `- ADR-${adr.number}: ${adr.title} (${adr.status}${replaced})`;
}

function readAdrs(config) {
  const adrs = new Map();
  const problems = [];
  for (const { name, path } of planningFiles(config.adr_dir)) {
    const where = display(config, path);
    const number = ADR_FILE.exec(name)?.[1];
    if (number === undefined) {
      problems.push(`${where}: not an ADR file name (NNNN-slug.md).`);
    } else if (adrs.has(number)) {
      problems.push(
        `${where}: repeats ADR-${number} from ${adrs.get(number).where}.`,
      );
    } else {
      const adr = readAdr(readText(path), number, where, problems);
      if (adr) adrs.set(number, adr);
    }
  }
  return { adrs, problems };
}

function readAdr(text, number, where, problems) {
  const lines = proseLines(text).filter((line) => line.text.trim() !== "");
  const title = TITLE.exec(lines[0]?.text ?? "")?.[1];
  if (title === undefined) {
    problems.push(`${where}: first line must be "# <title>".`);
    return undefined;
  }
  const status = lines.map((line) => STATUS.exec(line.text)?.[1]).find(Boolean);
  if (status === undefined) {
    problems.push(`${where}: missing "Status: <state>" line.`);
    return undefined;
  }
  const supersededBy = SUPERSEDED.exec(status)?.[1];
  if (!PLAIN_STATUSES.has(status) && supersededBy === undefined) {
    problems.push(
      `${where}: unknown status "${status}"; use proposed | accepted | deprecated | superseded by ADR-NNNN.`,
    );
    return undefined;
  }
  return { number, title, status, supersededBy, where };
}

function supersessionProblems(adrs) {
  const problems = [];
  for (const adr of adrs.values()) {
    const target = adr.supersededBy;
    if (target === undefined) continue;
    if (target === adr.number || !adrs.has(target)) {
      problems.push(
        `${adr.where}: superseded by ADR-${target}, which is not another ADR here.`,
      );
    } else if (adrs.get(target)?.supersededBy !== undefined) {
      problems.push(
        `${adr.where}: superseded by ADR-${target}, which is itself superseded; name the current one.`,
      );
    }
  }
  return problems;
}
