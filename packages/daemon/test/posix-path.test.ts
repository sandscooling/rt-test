import { describe, expect, it, vi } from "vitest";
import { relativePosixPath } from "../src/vitest/find-workspaces.js";

vi.mock("node:path", async () => {
  const { win32 } =
    await vi.importActual<typeof import("node:path")>("node:path");
  return { ...win32, default: win32 };
});

describe("stored paths on a platform whose separator is a backslash", () => {
  it("D1042: a relative path is stored '/'-separated", () => {
    expect(
      relativePosixPath("C:\\consumer", "C:\\consumer\\packages\\lib"),
    ).toBe("packages/lib");
  });
});
