import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fenceKinds } from "../fences.mjs";
import { result } from "./result.mjs";

const USAGE =
  'Usage: doc-section.mjs <file> "Heading" ["Heading"...]  |  doc-section.mjs <file> --list';

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;

class SectionError extends Error {}

function readHeadings(lines) {
  const headings = [];
  const kinds = fenceKinds(lines);
  lines.forEach((line, index) => {
    if (kinds[index] !== "prose") return;
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
  if (!statSync(path).isFile()) throw new SectionError(`not a file: ${file}`);
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
