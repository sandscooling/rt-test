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
});
