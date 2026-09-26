import { existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openRun } from "../../../scripts/lib/defects/runs.mjs";
import { catalogOf, fakeVitest, inSandboxes, withScratch } from "./harness.js";

vi.mock(import("node:fs"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rmSync: vi.fn<typeof actual.rmSync>(actual.rmSync) };
});

const LEFTOVER = "rt-test-verify-defects-999999-planted";

const isOwnRun = (path: string) =>
  basename(path).startsWith(`rt-test-verify-defects-${process.pid}-`);

const codedError = (code: string) =>
  Object.assign(new Error(`${code}: removal refused`), { code });

async function whileRemovalFails<T>(
  fails: (path: string) => boolean,
  error: Error,
  body: () => Promise<T>,
): Promise<T> {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(rmSync).mockImplementation((path, options) => {
    if (fails(String(path))) throw error;
    actual.rmSync(path, options);
  });
  try {
    return await body();
  } finally {
    vi.mocked(rmSync).mockImplementation(actual.rmSync);
  }
}

describe("the end of a defect run", () => {
  it("D1127: fails a run whose own directory could not be removed", async () => {
    const result = await withScratch((parent) =>
      whileRemovalFails(isOwnRun, codedError("EBUSY"), () =>
        inSandboxes(parent, fakeVitest(catalogOf()), 1),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("D1128: keeps the detected defects when the run's directory could not be removed", async () => {
    const detected = await withScratch((parent) =>
      whileRemovalFails(isOwnRun, codedError("EBUSY"), () =>
        inSandboxes(parent, fakeVitest(catalogOf()), 1).then(
          (result) => result.detected,
          (error: Error) => error.message,
        ),
      ),
    );
    expect(detected).toEqual(["D1", "D2", "D3"]);
  });
});

describe("the leftover sweep", () => {
  it("D1153: logs nothing for a leftover another run is still removing", async () => {
    const lines = await withScratch((parent) => {
      const found: string[] = [];
      mkdirSync(join(parent, LEFTOVER));
      const isLeftover = (path: string) =>
        basename(path) === LEFTOVER && existsSync(path);
      return whileRemovalFails(isLeftover, codedError("ENOENT"), async () => {
        openRun(
          parent,
          (line) => found.push(line),
          () => false,
        );
        return found;
      });
    });
    expect(lines).toEqual([]);
  });
});
