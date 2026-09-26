import { describe, expect, it } from "vitest";
import { checkWorkspaceScripts } from "../../../scripts/lib/standards/workspace-scripts.mjs";
import { inTree, type Files } from "./harness.js";

const BOTH = { build: "tsc -p tsconfig.build.json", typecheck: "tsc --noEmit" };

function manifest(workspaces: unknown): string {
  return JSON.stringify({ name: "root", private: true, workspaces });
}

function workspace(name: string, scripts: Record<string, string>): string {
  return JSON.stringify({ name, scripts });
}

function check(files: Files) {
  return inTree(files, checkWorkspaceScripts);
}

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
});
