import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RULE = "rt-test(no-nonlocal-comment)";
const KIND_PREFIXES = {
  issueRef: "Issue or rule reference",
  adrRef: "ADR reference",
  ticketRef: "Ticket, sprint, issue, or PR reference",
  dateRef: "Date in a comment",
  lineCitation: "file:line citation",
  tooLong: "Block comment runs",
} as const;
type Kind = keyof typeof KIND_PREFIXES;

const block = (lines: number, prose = " * x\n") =>
  `/**\n${prose.repeat(lines - 2)} */\nexport const a = 1;\n`;

const FIXTURES: Record<string, string> = {
  "d009.ts":
    "// @ts-expect-error upstream types lag, tracked in #123\nexport const a = 1;\n",
  "d010.ts":
    "// Guard with `@ts-expect-error` until 2026-01-02.\nexport const a = 1;\n",
  "d011.ts": "// Retry covers the race in #123.\nexport const a = 1;\n",
  "d012.ts": "// Keeps ADR-0012 ordering.\nexport const a = 1;\n",
  "d013.ts": "// Added for Sprint 14.\nexport const a = 1;\n",
  "d014.ts": "// Measured on 2026-08-13.\nexport const a = 1;\n",
  "d015.ts": "// Mirrors evidence.ts:42.\nexport const a = 1;\n",
  "d016.ts": block(12),
  "d017.ts": block(13),
  "d018.ts": "// See ADR-0012, decided 2026-08-13.\nexport const a = 1;\n",
  "d019.ts":
    "// Retries 3 times over 250 ms, per v1.2.3 (item 42).\nexport const a = 1;\n",
  "manual-d020.mjs": block(14).replace(" * x\n", " * Written 2026-08-13.\n"),
};

interface Diagnostic {
  readonly code: string;
  readonly filename: string;
  readonly message: string;
}

let findings: Map<string, Kind[]> | undefined;

function lintFixtures(): Map<string, Kind[]> {
  if (findings) return findings;
  const dir = mkdtempSync(join(tmpdir(), "rt-test-lint-"));
  try {
    for (const [name, code] of Object.entries(FIXTURES)) {
      writeFileSync(join(dir, name), code);
    }
    writeFileSync(join(dir, "config.json"), JSON.stringify(fixtureConfig()));
    const report = runOxlint(dir);
    findings = groupByFile(report.diagnostics.filter((d) => d.code === RULE));
    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fixtureConfig() {
  const rule = "rt-test/no-nonlocal-comment";
  return {
    categories: { correctness: "off" },
    jsPlugins: [
      fileURLToPath(new URL("../../lint/plugin.mjs", import.meta.url)),
    ],
    rules: { [rule]: "error" },
    overrides: [
      {
        files: ["manual-*.mjs"],
        rules: { [rule]: ["error", { maxBlockLines: 0 }] },
      },
    ],
  };
}

function runOxlint(cwd: string): { diagnostics: Diagnostic[] } {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("oxlint/package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    bin: { oxlint: string };
  };
  const entry = resolve(dirname(manifestPath), manifest.bin.oxlint);
  const result = spawnSync(
    process.execPath,
    [entry, "--format", "json", "-c", "config.json", "."],
    { cwd, encoding: "utf8", timeout: 60_000, windowsHide: true },
  );
  if (result.error || result.signal) {
    throw new Error(`oxlint interrupted: ${result.error ?? result.signal}`);
  }
  return JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };
}

function groupByFile(diagnostics: Diagnostic[]): Map<string, Kind[]> {
  const grouped = new Map<string, Kind[]>();
  for (const diagnostic of diagnostics) {
    const file = diagnostic.filename.replace(/^.*[\\/]/, "");
    const kinds = grouped.get(file) ?? [];
    kinds.push(kindOf(diagnostic.message));
    grouped.set(file, kinds);
  }
  return grouped;
}

function kindOf(message: string): Kind {
  const entry = Object.entries(KIND_PREFIXES).find(([, prefix]) =>
    message.startsWith(prefix),
  );
  if (!entry) throw new Error(`Unrecognized rule message: ${message}`);
  return entry[0] as Kind;
}

const kindsIn = (file: string) => [...(lintFixtures().get(file) ?? [])].sort();

describe("no-nonlocal-comment", () => {
  it("D009: a directive carrying a reference must not be reported", () => {
    expect(kindsIn("d009.ts")).toEqual([]);
  });

  it("D010: a backtick-quoted directive must not exempt its comment", () => {
    expect(kindsIn("d010.ts")).toEqual(["dateRef"]);
  });

  it("D011: an issue reference must be reported", () => {
    expect(kindsIn("d011.ts")).toEqual(["issueRef"]);
  });

  it("D012: an ADR reference must be reported", () => {
    expect(kindsIn("d012.ts")).toEqual(["adrRef"]);
  });

  it("D013: a sprint reference must be reported", () => {
    expect(kindsIn("d013.ts")).toEqual(["ticketRef"]);
  });

  it("D014: a date must be reported", () => {
    expect(kindsIn("d014.ts")).toEqual(["dateRef"]);
  });

  it("D015: a file:line citation must be reported", () => {
    expect(kindsIn("d015.ts")).toEqual(["lineCitation"]);
  });

  it("D016: a block at the cap must not be reported", () => {
    expect(kindsIn("d016.ts")).toEqual([]);
  });

  it("D017: a block one line past the cap must be reported", () => {
    expect(kindsIn("d017.ts")).toEqual(["tooLong"]);
  });

  it("D018: every banned pattern in one comment must be reported", () => {
    expect(kindsIn("d018.ts")).toEqual(["adrRef", "dateRef"]);
  });

  it("D019: bare numbers and versions must not be reported", () => {
    expect(kindsIn("d019.ts")).toEqual([]);
  });

  it("D020: a zero cap must disable length while keeping citations", () => {
    expect(kindsIn("manual-d020.mjs")).toEqual(["dateRef"]);
  });
});
