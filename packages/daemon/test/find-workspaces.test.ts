import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findVitestWorkspaces,
  type WorkspaceListing,
} from "../src/vitest/find-workspaces.js";
import { copyFixture, inTempDir, settle } from "./harness.js";

const UNPARSEABLE_JSON = "{";

type Listing = WorkspaceListing | { thrown: string };

function listFixture(
  fixture: string,
  edits: Readonly<Record<string, string>> = {},
): Promise<Listing> {
  return inTempDir((dir) => {
    copyFixture(fixture, dir);
    for (const [file, text] of Object.entries(edits)) {
      writeFileSync(join(dir, file), text);
    }
    return settle(() => findVitestWorkspaces(dir));
  });
}

function paths(listing: Listing): string[] | Listing {
  return "workspaces" in listing
    ? listing.workspaces.map((workspace) => workspace.path)
    : listing;
}

function unreadSources(listing: Listing): string[] | Listing {
  return "notRead" in listing
    ? listing.notRead.map((entry) => entry.source)
    : listing;
}

describe("finding a consumer's Vitest workspaces", () => {
  it("D1030: a directory holding a vitest.config file is a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain("packages/cfg");
  });

  it("D1031: a vite.config directory whose devDependencies list vitest is a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain(
      "packages/vite-dev",
    );
  });

  it("D1032: a vite.config directory whose dependencies list vitest is a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain(
      "packages/vite-prod",
    );
  });

  it("D1033: a vite.config directory that does not depend on vitest is not a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).not.toContain(
      "packages/vite-nodep",
    );
  });

  it("D1034: a directory depending on vitest with no config file is reported as not read", async () => {
    const listing = await listFixture("workspaces");
    expect(
      "notRead" in listing
        ? listing.notRead.find((entry) => entry.source === "packages/dep-only")
        : listing,
    ).toEqual({
      source: "packages/dep-only",
      reason:
        "depends on Vitest but holds no Vitest or Vite config file, so it is not a Vitest workspace and its tests were not discovered",
    });
  });

  it("D1036: a root pnpm-workspace.yaml is reported as not read", async () => {
    expect(unreadSources(await listFixture("workspaces"))).toContain(
      "pnpm-workspace.yaml",
    );
  });

  it("D1037: a ** pattern and a pattern with * inside a segment are reported as not read", async () => {
    expect(unreadSources(await listFixture("workspaces"))).toEqual(
      expect.arrayContaining(["tools/**", "a*b/*"]),
    );
  });

  it("D1038: a negation pattern is reported as not applied", async () => {
    expect(unreadSources(await listFixture("workspaces"))).toContain(
      "!packages/skip",
    );
  });

  it("D1039: a literal directory pattern is searched for a workspace", async () => {
    expect(paths(await listFixture("workspaces"))).toContain("tools/lit");
  });

  it("D1040: workspaces given as { packages: [...] } are searched", async () => {
    expect(paths(await listFixture("workspaces-object"))).toContain("apps/web");
  });

  it("D1041: a consumer root holding a Vitest config is the workspace '.'", async () => {
    expect(paths(await listFixture("workspaces-object"))).toContain(".");
  });

  it("D1043: an unreadable package.json beside a vite.config is reported as not read", async () => {
    expect(
      unreadSources(
        await listFixture("workspaces", {
          "packages/vite-bad/package.json": UNPARSEABLE_JSON,
        }),
      ),
    ).toContain("packages/vite-bad/package.json");
  });

  it("D1044: an unreadable root package.json is reported as not read when the root holds a Vitest config", async () => {
    expect(
      unreadSources(
        await listFixture("workspaces-object", {
          "package.json": UNPARSEABLE_JSON,
        }),
      ),
    ).toContain("package.json");
  });

  it("D1045: a workspaces field of any other shape is reported as not read", async () => {
    expect(
      unreadSources(
        await listFixture("workspaces", {
          "package.json": JSON.stringify({ workspaces: "packages/*" }),
        }),
      ),
    ).toContain("package.json workspaces");
  });

  it("D1081: a non-string entry in workspaces is reported as not read", async () => {
    const listing = await listFixture("workspaces-object", {
      "package.json": JSON.stringify({ workspaces: ["apps/*", 7] }),
    });
    expect("notRead" in listing ? listing.notRead : listing).toEqual([
      {
        source: "package.json workspaces",
        reason: "pattern 7 is not a string",
      },
    ]);
  });

  it("D1082: a plain file beside the workspaces a parent/* pattern matches is neither a workspace nor reported", async () => {
    const listing = await listFixture("workspaces-object", {
      "apps/notes.txt": "not a workspace",
    });
    expect(listing).toEqual({
      workspaces: [
        expect.objectContaining({ path: "." }),
        expect.objectContaining({ path: "apps/web" }),
      ],
      notRead: [],
    });
  });

  it("D1078: a directory link loop under a parent/* pattern is reported as not read and the other workspaces are still found", async () => {
    const listing = await inTempDir((dir) => {
      copyFixture("workspaces-object", dir);
      symlinkSync(
        join(dir, "apps/loop-b"),
        join(dir, "apps/loop-a"),
        "junction",
      );
      symlinkSync(
        join(dir, "apps/loop-a"),
        join(dir, "apps/loop-b"),
        "junction",
      );
      return settle(() => findVitestWorkspaces(dir));
    });
    expect(
      "workspaces" in listing
        ? {
            paths: listing.workspaces.map((workspace) => workspace.path),
            unread: listing.notRead.map((entry) => entry.source),
          }
        : listing,
    ).toEqual({ paths: [".", "apps/web"], unread: ["apps/*", "apps/*"] });
  });
});
