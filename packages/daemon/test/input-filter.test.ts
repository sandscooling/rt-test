import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { InputFilter } from "../src/inputs/input-filter.js";
import { readNonInputs } from "../src/inputs/non-inputs.js";
import { inTempDir, onPlatform } from "./harness.js";

const DECLARATION_FILE = "rt-test.json";
const DECLARING_DOCS = JSON.stringify({ nonInputs: ["docs/**"] });

interface LinkedDeclaration {
  readonly link: string;
  readonly target: string;
}

/** Makes `rt-test.json` at `root` a file link to a declaring file under `root`, so the target is a path of its own. */
function linkDeclaration(root: string): LinkedDeclaration {
  const target = join(root, "config", "declaration.json");
  const link = join(root, DECLARATION_FILE);
  mkdirSync(join(root, "config"));
  writeFileSync(target, DECLARING_DOCS);
  symlinkSync(target, link, "file");
  return { link, target };
}

/** Whether the input filter excludes `path`, asked with `process.platform` read as each supported host. */
async function excludedOnEachHost(
  root: string,
  path: string,
): Promise<{ win32: boolean; linux: boolean }> {
  const excluded = async (): Promise<boolean> => {
    const filter = await InputFilter.open(
      root,
      [],
      () => undefined,
      new AbortController().signal,
    );
    return filter.excludes(path);
  };
  return {
    win32: await onPlatform("win32", excluded),
    linux: await onPlatform("linux", excluded),
  };
}

describe("an rt-test.json that is not a regular file", () => {
  it("D2214: a symbolically linked rt-test.json declares nothing, with the reason that it is a link", async () => {
    const declaration = await inTempDir((root) => {
      linkDeclaration(root);
      return readNonInputs(root);
    });
    expect(declaration).toStrictEqual({
      file: "rt-test.json",
      state: "unusable",
      reason:
        "rt-test.json declares no non-inputs, so every file stays an input: it is a symbolic link, and only a regular file at the consumer root is read",
    });
  });

  it("D2217: an rt-test.json that is a directory declares nothing, with the reason that it is not a regular file", async () => {
    const declaration = await inTempDir((root) => {
      mkdirSync(join(root, DECLARATION_FILE));
      return readNonInputs(root);
    });
    expect(declaration).toStrictEqual({
      file: "rt-test.json",
      state: "unusable",
      reason:
        "rt-test.json declares no non-inputs, so every file stays an input: it is not a regular file",
    });
  });
});

describe("the input filter's rt-test.json exclusion", () => {
  it("D2215: with process.platform read as win32 and as linux, a linked rt-test.json is itself excluded though no caller passes it", async () => {
    const excluded = await inTempDir((root) =>
      excludedOnEachHost(root, linkDeclaration(root).link),
    );
    expect(excluded).toStrictEqual({ win32: true, linux: true });
  });

  it("D2216: with process.platform read as win32 and as linux, the file a linked rt-test.json points to stays an input", async () => {
    const excluded = await inTempDir((root) =>
      excludedOnEachHost(root, linkDeclaration(root).target),
    );
    expect(excluded).toStrictEqual({ win32: false, linux: false });
  });
});
