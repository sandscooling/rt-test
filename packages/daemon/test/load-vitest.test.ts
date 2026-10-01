import { mkdirSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspaceVitest } from "../src/vitest/load-vitest.js";
import {
  fakeVitest,
  inTempDir,
  linkVitest,
  settle,
  writeFakeVitest,
} from "./harness.js";

const SUPPORTED_RANGE = "4.1.x || 5.x";

function resolveFake(version: string) {
  return inTempDir((dir) => {
    fakeVitest(dir, version);
    return resolveWorkspaceVitest(dir);
  });
}

function resolveManifest(manifest: string) {
  return inTempDir((dir) => {
    writeFakeVitest(dir, manifest);
    return settle(() => resolveWorkspaceVitest(dir));
  });
}

describe("resolving a workspace's Vitest", () => {
  it("D1020: a prerelease of a supported line is unsupported, naming the version and the range", async () => {
    expect(await resolveFake("5.1.0-beta.1")).toMatchObject({
      supported: false,
      version: "5.1.0-beta.1",
      supportedRange: SUPPORTED_RANGE,
    });
  });

  it("D1021: a 4.x release other than 4.1 is unsupported", async () => {
    expect(await resolveFake("4.0.0")).toMatchObject({
      supported: false,
      version: "4.0.0",
    });
  });

  it("D1022: a release below 4.1 is unsupported", async () => {
    expect(await resolveFake("3.2.4")).toMatchObject({
      supported: false,
      version: "3.2.4",
    });
  });

  it("D1023: a release above 5.x is unsupported", async () => {
    expect(await resolveFake("6.0.0")).toMatchObject({
      supported: false,
      version: "6.0.0",
    });
  });

  it("D1024: the Vitest installed for the workspace is used, not the daemon's own", async () => {
    expect(
      await inTempDir((dir) => {
        linkVitest(dir, "vitest-4");
        return resolveWorkspaceVitest(dir);
      }),
    ).toMatchObject({ supported: true, version: "4.1.11" });
  });

  it("D1025: a 5.0 release is supported", async () => {
    expect(
      await inTempDir((dir) => {
        linkVitest(dir, "vitest");
        return resolveWorkspaceVitest(dir);
      }),
    ).toMatchObject({ supported: true, version: "5.0.1" });
  });

  it("D1026: a workspace with no resolvable Vitest is unsupported with no version, not an error", async () => {
    expect(
      await inTempDir((dir) => settle(() => resolveWorkspaceVitest(dir))),
    ).toEqual({
      supported: false,
      supportedRange: SUPPORTED_RANGE,
      reason: expect.any(String),
    });
  });

  it("D1028: a supported Vitest whose vitest/node does not resolve is unsupported, not an error", async () => {
    expect(
      await resolveManifest(
        JSON.stringify({
          name: "vitest",
          version: "5.0.1",
          exports: { "./package.json": "./package.json" },
        }),
      ),
    ).toMatchObject({ supported: false, version: "5.0.1" });
  });

  it("D4115: a workspace that reaches its Vitest through a directory link resolves the package's real directory, beside its version", async () => {
    const { resolved, install } = await inTempDir((dir) => {
      const store = join(dir, "store");
      fakeVitest(store, "5.0.1");
      const install = join(store, "node_modules", "vitest");
      const workspace = join(dir, "workspace");
      mkdirSync(join(workspace, "node_modules"), { recursive: true });
      symlinkSync(
        install,
        join(workspace, "node_modules", "vitest"),
        "junction",
      );
      return { resolved: resolveWorkspaceVitest(workspace), install };
    });
    expect(resolved).toMatchObject({
      supported: true,
      directory: install,
      version: "5.0.1",
    });
  });
});

const MODULES = "node_modules";
const VITEST = "vitest";

/** A stand-in install of `version` in a store of its own under `dir`; its directory. */
function storedInstall(dir: string, store: string, version: string): string {
  fakeVitest(join(dir, store), version);
  return join(dir, store, MODULES, VITEST);
}

/** A workspace `name` under `dir` that reaches `install` through a directory link, as a store layout links it. */
function linkedTo(dir: string, name: string, install: string): string {
  const workspace = join(dir, name);
  mkdirSync(join(workspace, MODULES), { recursive: true });
  symlinkSync(install, join(workspace, MODULES, VITEST), "junction");
  return workspace;
}

/** Points the workspace's link at `install`, as an upgrade does. */
function repoint(workspace: string, install: string): void {
  const link = join(workspace, MODULES, VITEST);
  unlinkSync(link);
  symlinkSync(install, link, "junction");
}

/** The install a workspace resolves, or its whole resolution when it resolves no supported one. */
function installOf(workspace: string): unknown {
  const resolved = resolveWorkspaceVitest(workspace);
  return resolved.supported
    ? { directory: resolved.directory, version: resolved.version }
    : resolved;
}

describe("resolving a workspace's Vitest again in one process", () => {
  it("D4198: a link pointed at another install gives that install's directory and version at the next resolution, with the first install in place or gone, and a directory from which none resolved gives the install that has since appeared", async () => {
    const { read, expected } = await inTempDir((dir) => {
      const first = storedInstall(dir, "first", "5.0.1");
      const removed = storedInstall(dir, "removed", "5.0.1");
      const second = storedInstall(dir, "second", "4.1.11");
      const firstKept = linkedTo(dir, "first-kept", first);
      const firstGone = linkedTo(dir, "first-gone", removed);
      const appearing = join(dir, "appearing");
      mkdirSync(appearing);
      const before = {
        firstKept: installOf(firstKept),
        firstGone: installOf(firstGone),
        appearing: resolveWorkspaceVitest(appearing).supported,
      };
      repoint(firstKept, second);
      repoint(firstGone, second);
      rmSync(join(dir, "removed"), { recursive: true });
      fakeVitest(appearing, "5.0.1");
      const now = { directory: second, version: "4.1.11" };
      return {
        read: {
          before,
          after: {
            firstKept: installOf(firstKept),
            firstGone: installOf(firstGone),
            appearing: installOf(appearing),
          },
        },
        expected: {
          before: {
            firstKept: { directory: first, version: "5.0.1" },
            firstGone: { directory: removed, version: "5.0.1" },
            appearing: false,
          },
          after: {
            firstKept: now,
            firstGone: now,
            appearing: {
              directory: join(appearing, MODULES, VITEST),
              version: "5.0.1",
            },
          },
        },
      };
    });
    expect(read).toEqual(expected);
  });

  it("D4199: a link pointed at another install of the same version gives that install's real directory, never the link's own path", async () => {
    const { read, installs } = await inTempDir((dir) => {
      const first = storedInstall(dir, "first", "5.0.1");
      const second = storedInstall(dir, "second", "5.0.1");
      const workspace = linkedTo(dir, "workspace", first);
      const before = installOf(workspace);
      repoint(workspace, second);
      return {
        read: [before, installOf(workspace)],
        installs: [
          { directory: first, version: "5.0.1" },
          { directory: second, version: "5.0.1" },
        ],
      };
    });
    expect(read).toEqual(installs);
  });

  it("D4200: a workspace that holds no Vitest of its own resolves the one a directory above it holds", async () => {
    const { read, install } = await inTempDir((dir) => {
      fakeVitest(dir, "5.0.1");
      const workspace = join(dir, "packages", "a");
      mkdirSync(workspace, { recursive: true });
      return {
        read: installOf(workspace),
        install: { directory: join(dir, MODULES, VITEST), version: "5.0.1" },
      };
    });
    expect(read).toEqual(install);
  });
});
