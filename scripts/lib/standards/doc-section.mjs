import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { result } from "./result.mjs";

const USAGE =
  'Usage: doc-section.mjs <file> "Heading" ["Heading"...]  |  doc-section.mjs <file> --list';

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

class SectionError extends Error {}

const closes = (open, marker) =>
  marker[0] === open[0] && marker.length >= open.length;

function readHeadings(lines) {
  const headings = [];
  let fence;
  lines.forEach((line, index) => {
    const marker = FENCE.exec(line)?.[1];
    if (marker !== undefined && fence === undefined) fence = marker;
    else if (marker !== undefined && closes(fence, marker)) fence = undefined;
    if (fence !== undefined || marker !== undefined) return;
    const match = HEADING.exec(line);
    if (match) headings.push({ index, level: match[1].length, text: match[2] });
  });
  return headings;
}

function findHeading(headings, wanted, file) {
  const exact = headings.filter((heading) => heading.text === wanted);
  const hits =
    exact.length > 0
      ? exact
      : headings.filter((heading) => heading.text.startsWith(wanted));
  if (hits.length === 0) {
    throw new SectionError(
      `no heading matches "${wanted}" in ${file}. Run with --list to see them.`,
    );
  }
  if (hits.length > 1) {
    const names = hits.map((heading) => `"${heading.text}"`).join(", ");
    throw new SectionError(
      `"${wanted}" matches ${hits.length} headings in ${file}: ${names}`,
    );
  }
  return hits[0];
}

function sectionText(lines, headings, start) {
  const next = headings.find(
    (heading) => heading.index > start.index && heading.level <= start.level,
  );
  return lines
    .slice(start.index, next === undefined ? lines.length : next.index)
    .join("\n")
    .trimEnd();
}

function readLines(root, file) {
  const path = resolve(root, file);
  if (!existsSync(path)) throw new SectionError(`no such file: ${file}`);
  return readFileSync(path, "utf8").split(/\r?\n/);
}

export function docSection(config, argv) {
  try {
    const [file, ...wanted] = argv;
    if (file === undefined || wanted.length === 0)
      throw new SectionError(USAGE);
    const lines = readLines(config.root, file);
    const headings = readHeadings(lines);
    if (wanted.length === 1 && wanted[0] === "--list") {
      return result(
        0,
        headings.map(
          (heading) => `${"#".repeat(heading.level)}\t${heading.text}`,
        ),
      );
    }
    const sections = wanted.map((want) =>
      sectionText(lines, headings, findHeading(headings, want, file)),
    );
    const text = sections.join("\n\n");
    return result(
      0,
      [text],
      [
        `SECTIONS: ${wanted.length} of ${headings.length} in ${file}, ${text.length} chars.`,
      ],
    );
  } catch (error) {
    if (!(error instanceof SectionError)) throw error;
    return result(1, [], [`doc-section: ${error.message}`]);
  }
}
