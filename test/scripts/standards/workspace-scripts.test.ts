import { describe, expect, it } from "vitest";
import type { Result } from "../../../scripts/lib/standards/result.mjs";
import { checkWorkspaceScripts } from "../../../scripts/lib/standards/workspace-scripts.mjs";
import { inTree, type Files } from "./harness.js";

const BOTH = { build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" };
const FIELD_SHAPE_FAIL =
  'FAIL: package.json workspaces must be an array or { "packages": [...] }.\n';
const EXCLUSION_REFUSAL = "; this check does not apply exclusions";

function manifest(workspaces: unknown): string {
  return JSON.stringify({ name: "root", private: true, workspaces });
}

function workspace(name: string, scripts: Record<string, string>): string {
  return JSON.stringify({ name, scripts });
}

function check(files: Files) {
  return inTree(files, checkWorkspaceScripts);
}

type Settled = Result | { readonly thrown: string };

// A crash must reach the assertion as a value: the defect checker counts only an assertion failure.
function settle(files: Files): Settled {
  try {
    return check(files);
  } catch (error) {
    return { thrown: String(error) };
  }
}

const TWO_VALID: Files = {
  "packages/a/package.json": workspace("@x/a", BOTH),
  "packages/b/package.json": workspace("@x/b", BOTH),
};

describe("check-workspace-scripts", () => {
  it("D400: names a workspace that lacks a typecheck script", () => {
    const outcome = check({
      "package.json": manifest(["packages/*"]),
      "packages/a/package.json": workspace("@x/a", BOTH),
      "packages/b/package.json": workspace("@x/b", { build: "tsc" }),
    });
    expect(outcome).toMatchObject({
      code: 1,
      out: expect.stringContaining(
        "MISSING  @x/b (packages/b): no typecheck script",
      ),
    });
  });

  it("D401: passes when every workspace defines build and typecheck", () => {
    const outcome = check({
      "package.json": manifest(["packages/*"]),
      "packages/a/package.json": workspace("@x/a", BOTH),
      "packages/b/package.json": workspace("@x/b", BOTH),
    });
    expect(outcome).toMatchObject({
      code: 0,
      out: expect.stringContaining(
        "PASS: all 2 workspaces define build and typecheck.",
      ),
    });
  });

  it("D402: treats a blank script as missing", () => {
    const outcome = check({
      "package.json": manifest(["packages/*"]),
      "packages/a/package.json": workspace("@x/a", {
        build: "tsc",
        typecheck: "  ",
      }),
    });
    expect(outcome.code).toBe(1);
  });

  it("D403: fails when it finds no workspace to examine", () => {
    const outcome = check({ "package.json": manifest(["packages/*"]) });
    expect(outcome).toMatchObject({
      code: 1,
      err: expect.stringContaining("found no workspaces"),
    });
  });

  it("D404: passes a declared pattern whose parent folder does not exist yet", () => {
    const outcome = check({
      "package.json": manifest(["packages/*", "apps/*"]),
      "packages/a/package.json": workspace("@x/a", BOTH),
    });
    expect(outcome.code).toBe(0);
  });

  it("D405: skips a folder with no package.json rather than failing on it", () => {
    const outcome = check({
      "package.json": manifest(["packages/*"]),
      "packages/a/package.json": workspace("@x/a", BOTH),
      "packages/notes/README.md": "# Notes\n",
    });
    expect(outcome.code).toBe(0);
  });

  it("D406: reads the object form of the workspaces field", () => {
    const outcome = check({
      "package.json": manifest({ packages: ["packages/*"] }),
      "packages/a/package.json": workspace("@x/a", BOTH),
    });
    expect(outcome).toMatchObject({
      code: 0,
      out: expect.stringContaining("ok       @x/a (packages/a)"),
    });
  });

  it("D407: refuses a pattern it cannot expand instead of skipping it", () => {
    const outcome = check({
      "package.json": manifest(["packages/*/*"]),
      "packages/a/b/package.json": workspace("@x/b", BOTH),
    });
    expect(outcome).toMatchObject({
      code: 1,
      err: expect.stringContaining(
        'unsupported workspaces pattern "packages/*/*"',
      ),
    });
  });

  it("D408: examines a workspace listed by its literal path", () => {
    const outcome = check({
      "package.json": manifest(["tools/gen"]),
      "tools/gen/package.json": workspace("@x/gen", BOTH),
    });
    expect(outcome.out).toContain("ok       @x/gen (tools/gen)");
  });

  it("D1130: refuses a negated pattern beside a glob and examines no workspace", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*", "!packages/b"]),
      ...TWO_VALID,
    });
    expect(outcome).toMatchObject({
      code: 1,
      out: "",
      err: expect.stringContaining(
        `FAIL: unsupported workspaces pattern "!packages/b"${EXCLUSION_REFUSAL}`,
      ),
    });
  });

  it("D1131: refuses a lone negated glob rather than reporting no workspaces", () => {
    const outcome = settle({
      "package.json": manifest(["!packages/*"]),
      ...TWO_VALID,
    });
    expect(outcome).toMatchObject({
      code: 1,
      out: "",
      err: expect.stringContaining(
        `FAIL: unsupported workspaces pattern "!packages/*"${EXCLUSION_REFUSAL}`,
      ),
    });
  });

  it("D1132: fails on a null workspaces field instead of crashing", () => {
    const outcome = settle({ "package.json": manifest(null), ...TWO_VALID });
    expect(outcome).toEqual({ code: 1, out: "", err: FIELD_SHAPE_FAIL });
  });

  it("D1133: fails on a string workspaces field instead of reading it as one pattern", () => {
    const outcome = settle({
      "package.json": manifest("packages/*"),
      ...TWO_VALID,
    });
    expect(outcome).toEqual({ code: 1, out: "", err: FIELD_SHAPE_FAIL });
  });

  it("D1134: fails on an object workspaces field whose packages is not an array", () => {
    const outcome = settle({
      "package.json": manifest({ packages: null }),
      ...TWO_VALID,
    });
    expect(outcome).toEqual({ code: 1, out: "", err: FIELD_SHAPE_FAIL });
  });

  it("D1135: fails on a non-string workspaces entry, naming it", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*", 7]),
      ...TWO_VALID,
    });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: "FAIL: workspaces pattern 7 names no directory.\n",
    });
  });

  it("D1136: fails on an empty workspaces entry instead of examining the root", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*", ""]),
      ...TWO_VALID,
    });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: 'FAIL: workspaces pattern "" names no directory.\n',
    });
  });

  it("D1137: fails on a whitespace-only workspaces entry", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*", "  "]),
      ...TWO_VALID,
    });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: 'FAIL: workspaces pattern "  " names no directory.\n',
    });
  });

  it("D1138: fails on a member package.json holding null instead of crashing", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*"]),
      ...TWO_VALID,
      "packages/a/package.json": "null",
    });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: "FAIL: packages/a/package.json is not a JSON object.\n",
    });
  });

  it("D1139: fails on a member package.json holding an array", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*"]),
      ...TWO_VALID,
      "packages/a/package.json": "[]",
    });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: "FAIL: packages/a/package.json is not a JSON object.\n",
    });
  });

  it("D1140: fails on a member package.json holding a string", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*"]),
      ...TWO_VALID,
      "packages/a/package.json": '"text"',
    });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: "FAIL: packages/a/package.json is not a JSON object.\n",
    });
  });

  it("D1141: reports both scripts missing when a member's scripts is null", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*"]),
      ...TWO_VALID,
      "packages/a/package.json": JSON.stringify({
        name: "@x/a",
        scripts: null,
      }),
    });
    expect(outcome).toMatchObject({
      code: 1,
      out: expect.stringContaining(
        "MISSING  @x/a (packages/a): no build, typecheck script\n",
      ),
    });
  });

  it("D1142: labels a member whose name is not a string by its directory", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*"]),
      ...TWO_VALID,
      "packages/a/package.json": JSON.stringify({
        name: { x: 1 },
        scripts: BOTH,
      }),
    });
    expect(outcome).toMatchObject({
      code: 0,
      out: expect.stringContaining("ok       packages/a (packages/a)\n"),
    });
  });

  it("D1143: examines and counts a workspace matched by two patterns once", () => {
    const outcome = settle({
      "package.json": manifest(["packages/*", "packages/a"]),
      ...TWO_VALID,
    });
    expect(outcome).toEqual({
      code: 0,
      out: "ok       @x/a (packages/a)\nok       @x/b (packages/b)\nPASS: all 2 workspaces define build and typecheck.\n",
      err: "",
    });
  });

  it("D1144: names a root package.json holding null as not a JSON object", () => {
    const outcome = settle({ "package.json": "null", ...TWO_VALID });
    expect(outcome).toEqual({
      code: 1,
      out: "",
      err: "FAIL: package.json is not a JSON object.\n",
    });
  });
});
