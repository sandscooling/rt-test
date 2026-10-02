import { writeFileSync, type PathLike } from "node:fs";
import { lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { InputFilter } from "../src/inputs/input-filter.js";
import {
  readEntryDigest,
  readTogether,
  takeInventory,
  type InventoryResult,
  type InventoryScope,
} from "../src/inputs/input-inventory.js";
import { DAEMON_TEST_TIMEOUT_MS } from "./daemon-harness.js";
import { inTempDir, oneShot } from "./harness.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn<typeof actual.lstat>(actual.lstat) };
});

const { lstat: realLstat } =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

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

/** `count` empty files in `root`, each with a base name of its own. */
function writeFiles(root: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    writeFileSync(join(root, `n${index}.ts`), "");
  }
}

/**
 * The inventory of `root`, a directory outside any repository, under a filter that excludes and declares nothing,
 * with each `lstat` of an entry answered by `stat`.
 */
async function inventoryOf(
  root: string,
  stat: (path: string) => ReturnType<typeof realLstat>,
): Promise<InventoryResult> {
  const signal = new AbortController().signal;
  const scope: InventoryScope = {
    root,
    filter: await InputFilter.open(root, [], () => undefined, signal),
    signal,
    beforeListing: () => undefined,
  };
  vi.mocked(lstat).mockImplementation(((path: PathLike) =>
    stat(String(path))) as typeof lstat);
  try {
    return await takeInventory(scope, root);
  } finally {
    vi.mocked(lstat).mockReset();
  }
}

describe(
  "reading many entries together",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4282: an inventory of twenty files reads sixteen of them at once and no more", async () => {
      const inFlight = await inTempDir(async (root) => {
        writeFiles(root, 20);
        const firstBegun = oneShot();
        const counted = oneShot();
        let begun = 0;
        const inventory = inventoryOf(root, async (path) => {
          begun += 1;
          firstBegun.fire();
          await counted.done;
          return realLstat(path);
        });
        try {
          await firstBegun.done;
          await new Promise((resolve) => setImmediate(resolve));
          return begun;
        } finally {
          counted.fire();
          await inventory;
        }
      });
      expect(inFlight).toBe(16);
    });

    it("D4288: once one of the reads the pool runs has failed, a path still waiting its turn is never begun", async () => {
      const paths = Array.from({ length: 17 }, (_, index) => `p${index}`);
      const begun: string[] = [];
      const failed = oneShot();
      const released = oneShot();
      const pool = readTogether(
        paths,
        new AbortController().signal,
        async (path) => {
          begun.push(path);
          if (path !== "p0") return released.done;
          await failed.done;
          throw new Error("a planted read failure");
        },
      ).catch(() => undefined);
      failed.fire();
      await new Promise((resolve) => setImmediate(resolve));
      const begunAfterTheFailure = begun.length;
      released.fire();
      await pool;
      expect(begunAfterTheFailure).toBe(16);
    });

    it("D4291: an inventory that meets a file it cannot read gives no inputs at all, the reason naming the file", async () => {
      const inventory = await inTempDir((root) => {
        writeFiles(root, 2);
        writeFileSync(join(root, "locked.ts"), "");
        return inventoryOf(root, (path) =>
          basename(path) === "locked.ts"
            ? Promise.reject(
                Object.assign(new Error("EACCES: permission denied"), {
                  code: "EACCES",
                }),
              )
            : realLstat(path),
        );
      });
      expect(inventory).toStrictEqual({
        ok: false,
        reason: "locked.ts cannot be read: EACCES: permission denied",
      });
    });
  },
);
