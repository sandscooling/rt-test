import { describe, expect, it } from "vitest";
import { docSection } from "../../../scripts/lib/standards/doc-section.mjs";
import { inTree, repoConfig, SECTIONS } from "./harness.js";

function sections(...wanted: string[]) {
  return docSection(repoConfig(), [SECTIONS, ...wanted]);
}

describe("doc-section", () => {
  it("D420: ends a section at the next heading of the same level", () => {
    expect(sections("Lint ratchet").out).toBe(
      "### Lint ratchet\n\nRatchet text.\n",
    );
  });

  it("D421: prefers the exact heading over a longer heading it prefixes", () => {
    expect(sections("Lint").out).toBe("### Lint\n\nLint text.\n");
  });

  it("D422: matches a unique heading prefix", () => {
    expect(sections("Third-Party").out).toBe(
      "## Third-Party Semantics Verification (MANDATORY)\n\nVerify text.\n",
    );
  });

  it("D423: exits 1 naming a heading that matches nothing", () => {
    expect(sections("Nope")).toMatchObject({
      code: 1,
      err: expect.stringContaining('no heading matches "Nope"'),
    });
  });

  it("D424: exits 1 on a prefix that matches two headings", () => {
    expect(sections("L")).toMatchObject({
      code: 1,
      err: expect.stringContaining('"L" matches 2 headings'),
    });
  });

  it("D425: treats a # line inside a code fence as text, not a heading", () => {
    expect(sections("Targeted Typecheck").out).toBe(
      "### Targeted Typecheck\n\nTypecheck text.\n\n```sh\n# not a heading\necho done\n```\n\nAfter the fence.\n",
    );
  });

  it("D426: lists every heading with its depth", () => {
    expect(sections("--list").out).toBe(
      [
        "#\tStandards",
        "##\tUniversal gates",
        "##\tPost-Change Validation",
        "###\tLint",
        "###\tLint ratchet",
        "###\tTargeted Typecheck",
        "##\tThird-Party Semantics Verification (MANDATORY)",
        "",
      ].join("\n"),
    );
  });

  it("D427: prints several sections in the order they were asked for", () => {
    expect(sections("Universal gates", "Lint ratchet").out).toBe(
      "## Universal gates\n\nGate text.\n\n### Lint ratchet\n\nRatchet text.\n",
    );
  });

  it("D428: carries a section's subsections with it", () => {
    expect(sections("Post-Change Validation").out).toContain(
      "### Lint ratchet",
    );
  });

  it("D429: refuses a call that names no heading", () => {
    expect(sections().code).toBe(1);
  });

  it("D447: keeps a longer fence open across a shorter fence inside it", () => {
    const doc =
      "# Doc\n\n## Example\n\n````md\n```sh\n# not a heading\n```\n````\n\n## After\n";
    const outcome = inTree({ "doc.md": doc }, (config) =>
      docSection(config, ["doc.md", "--list"]),
    );
    expect(outcome.out).toBe("#\tDoc\n##\tExample\n##\tAfter\n");
  });
});
