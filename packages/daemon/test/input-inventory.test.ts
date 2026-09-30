import { writeFileSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readEntryDigest } from "../src/inputs/input-inventory.js";
import { inTempDir } from "./harness.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn<typeof actual.lstat>(actual.lstat) };
});

/** What `lstat` throws on Linux for a path below a file, which Windows reports as ENOENT. */
function belowAFile(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOTDIR: not a directory, lstat '${path}'`), {
    code: "ENOTDIR",
  });
}

describe("reading one entry", () => {
  it("D3386: a path below a file, which Linux reports as ENOTDIR, reads as absent, not unreadable", async () => {
    const entry = await inTempDir(async (root) => {
      writeFileSync(join(root, "src"), "a file where a folder was\n");
      const below = join(root, "src", "a.ts");
      vi.mocked(lstat).mockRejectedValueOnce(belowAFile(below));
      try {
        return await readEntryDigest(below);
      } finally {
        vi.mocked(lstat).mockReset();
      }
    });
    expect(entry).toStrictEqual({ kind: "absent" });
  });
});
