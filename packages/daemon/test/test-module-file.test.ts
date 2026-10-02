import { describe, expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";
import { absoluteInputPath, InputFilter } from "../src/inputs/input-filter.js";
import { testModuleFile } from "../src/inputs/non-inputs.js";
import { placeSetupFileFirst } from "../src/vitest/workspace-session.js";

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

/** A setup file of RT Test's own as Windows spells it, in a build no host holds. */
const PLACED_FILE = "C:\\rt-test-absent-build\\vitest\\snapshot-guard.js";

describe("the directory a placed setup file adds to a project's allow list on Windows", () => {
  it("D4300: the directory joins the allow list spelled with forward slashes, as Vite spells each path it compares", () => {
    const allowed: string[] = [];
    const project = {
      config: { setupFiles: [] },
      vite: { config: { server: { fs: { allow: allowed } } } },
    } as unknown as TestProject;
    placeSetupFileFirst(project, PLACED_FILE);
    expect(allowed).toEqual(["C:/rt-test-absent-build/vitest"]);
  });
});
