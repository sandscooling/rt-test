import { describe, expect, it, vi } from "vitest";
import { absoluteInputPath, InputFilter } from "../src/inputs/input-filter.js";
import { testModuleFile } from "../src/inputs/non-inputs.js";

/** Windows' path rules on either host, so a path on another drive is absolute and outside the root wherever this runs. */
vi.mock("node:path", async (importActual) => {
  const actual = await importActual<typeof import("node:path")>();
  return { ...actual.win32, default: actual.win32 };
});

/** A consumer root no host holds, so no repository encloses it. */
const ROOT = "C:\\rt-test-absent-consumer";
const OTHER_DRIVE_MODULE = "D:/shared/x.test.ts";

describe("a test module on another Windows drive", () => {
  it("D2118: a module on another Windows drive keeps its absolute path, never joined under its workspace", () => {
    expect(testModuleFile("packages/app", "D:/shared/setup.ts")).toBe(
      "D:/shared/setup.ts",
    );
  });

  it("D2123: its input path is read where it lies, never joined under the consumer root", () => {
    expect(absoluteInputPath(ROOT, OTHER_DRIVE_MODULE)).toBe(
      OTHER_DRIVE_MODULE,
    );
  });

  it("D2124: the input filter counts it outside the consumer root, so it never enters the inventory", async () => {
    const filter = await InputFilter.open(
      ROOT,
      [],
      () => undefined,
      new AbortController().signal,
    );
    expect(filter.excludes("D:\\shared\\x.test.ts")).toBe(true);
  });
});
