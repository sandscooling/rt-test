import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { citationScope, liveRoots } from "./citation-scope.mjs";
import { result } from "./result.mjs";

const USAGE =
  "Usage: check-line-citations.mjs [--base <ref>] [--strict] [--list-live-roots]";
const EXIT = { OK: 0, HITS: 1, FAILED: 2 };
const DEFAULT_BASE = "HEAD";
const GIT_BUFFER_BYTES = 64 * 1024 * 1024;
const CITABLE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const CITATION =
  /([\w./\-[\]]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)):(\d+)(?:-(\d+))?/g;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

class CitationError extends Error {}

function parseArgs(argv) {
  const args = { base: DEFAULT_BASE, strict: false, listRoots: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") args.strict = true;
    else if (arg === "--list-live-roots") args.listRoots = true;
    else if (arg === "--base" && argv[index + 1] !== undefined) {
      args.base = argv[index + 1];
      index += 1;
    } else
      throw new CitationError(
        `unknown or incomplete argument ${arg}\n${USAGE}`,
      );
  }
  return args;
}

function gitRunner(root) {
  return (args) =>
    execFileSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: GIT_BUFFER_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
}

const lines = (text) => text.split("\n").filter((line) => line !== "");

// A pure insertion's header names the old line it follows, not one it replaces.
const firstOldLine = (start, count) => (count === 0 ? start + 1 : start);

function readHunks(diff) {
  return lines(diff).flatMap((line) => {
    const match = HUNK.exec(line);
    if (!match) return [];
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    return [
      {
        oldStart: firstOldLine(Number(match[1]), oldCount),
        oldCount,
        newCount: match[4] === undefined ? 1 : Number(match[4]),
      },
    ];
  });
}

function baseLineCount(git, base, file) {
  try {
    return git(["show", `${base}:${file}`]).split("\n").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function analyze(git, base, file) {
  const hunks = readHunks(git(["diff", base, "-U0", "--", file]));
  if (hunks.length === 0) return undefined;
  return { hunks, oldLineCount: baseLineCount(git, base, file) };
}

function translate(line, hunks) {
  let shift = 0;
  for (const hunk of hunks) {
    const end = hunk.oldStart + hunk.oldCount;
    if (line >= hunk.oldStart && line < end) return undefined;
    if (line >= end) shift += hunk.newCount - hunk.oldCount;
  }
  return line + shift;
}

function qualifiedByLeaf(text) {
  const byLeaf = new Map();
  for (const [, cited] of text.matchAll(CITATION)) {
    if (!cited.includes("/")) continue;
    const leaf = basename(cited);
    byLeaf.set(leaf, (byLeaf.get(leaf) ?? new Set()).add(cited));
  }
  return byLeaf;
}

function resolveTarget(analyses, byLeaf, cited, line) {
  const forms = cited.includes("/")
    ? [cited]
    : [...(byLeaf.get(basename(cited)) ?? [cited])];
  return [...analyses.keys()].find(
    (file) =>
      forms.some((form) => file === form || file.endsWith(`/${form}`)) &&
      line <= analyses.get(file).oldLineCount,
  );
}

function findingsIn(artifact, text, analyses) {
  const byLeaf = qualifiedByLeaf(text);
  const findings = [];
  text.split("\n").forEach((lineText, index) => {
    for (const [, cited, start, end] of lineText.matchAll(CITATION)) {
      const line = Number(start);
      const target = resolveTarget(analyses, byLeaf, cited, line);
      if (target === undefined || target === artifact) continue;
      const moved = translate(line, analyses.get(target).hunks);
      if (moved === line) continue;
      findings.push({
        artifact,
        line: index + 1,
        target,
        cited: end === undefined ? start : `${start}-${end}`,
        suggestion:
          moved === undefined
            ? "the cited lines were themselves edited"
            : `now ~${moved}`,
      });
    }
  });
  return findings;
}

function report(findings) {
  const out = [
    "SHIFTED LINE CITATIONS: this diff moved lines that live artifacts cite.",
    "They still resolve, to the wrong content. Re-point each by name (the function, the rule, the",
    "heading), never by the suggested number.",
    "",
  ];
  const artifacts = [...new Set(findings.map((finding) => finding.artifact))];
  for (const artifact of artifacts) {
    out.push(artifact);
    for (const finding of findings.filter(
      (each) => each.artifact === artifact,
    )) {
      const leaf = basename(finding.target);
      out.push(
        `  :${finding.line}  cites ${leaf}:${finding.cited}  (${finding.suggestion})`,
      );
    }
  }
  out.push(
    "",
    `${findings.length} citation(s) across ${artifacts.length} artifact(s).`,
  );
  return out;
}

function scan(config, args) {
  const git = gitRunner(config.root);
  const scope = citationScope(config);
  const changed = lines(git(["diff", args.base, "--name-only"])).filter(
    (file) => CITABLE.test(file) && !scope.isSkipped(file),
  );
  if (changed.length === 0) {
    return result(EXIT.OK, [
      "line-citations: no citable source file changed, nothing to check.",
    ]);
  }
  const analyses = new Map();
  for (const file of changed) {
    const analysis = analyze(git, args.base, file);
    if (analysis !== undefined) analyses.set(file, analysis);
  }
  const findings = lines(git(["ls-files"]))
    .filter((file) => scope.isLive(file))
    .flatMap((file) =>
      findingsIn(file, readFileSync(join(config.root, file), "utf8"), analyses),
    );
  if (findings.length === 0) {
    return result(EXIT.OK, [
      `line-citations: clean. No live artifact cites a shifted line in ${changed.length} changed file(s).`,
    ]);
  }
  return result(args.strict ? EXIT.HITS : EXIT.OK, report(findings));
}

export function checkLineCitations(config, argv) {
  try {
    const args = parseArgs(argv);
    if (args.listRoots) return result(EXIT.OK, liveRoots(config));
    return scan(config, args);
  } catch (error) {
    if (error instanceof CitationError) {
      return result(
        EXIT.FAILED,
        [],
        [`check-line-citations: ${error.message}`],
      );
    }
    if (error?.status !== undefined) {
      return result(
        EXIT.FAILED,
        [],
        [`check-line-citations: git failed: ${error.message}`],
      );
    }
    throw error;
  }
}
