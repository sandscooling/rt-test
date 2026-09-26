import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Git } from "../../../scripts/lib/git.mjs";
import {
  defaultJobs,
  parseOptions,
  runVerification,
} from "../../../scripts/lib/defects/verify.mjs";
import {
  CALC_TEST,
  catalogOf,
  fakeVitest,
  OTHER,
  TREE,
  withScratch,
  writeRoot,
  type Tree,
} from "./harness.js";

const quiet = () => {};

function headWithChangedD1(): Git {
  const head = catalogOf()
    .defects.filter((defect) => defect.test === CALC_TEST)
    .map(({ source: _source, test: _test, ...record }) =>
      record.id === "D1" ? { ...record, defect: "an older wording" } : record,
    );
  const answers: Record<string, string> = {
    diff: "test/calc/defects.json\0",
    "ls-files": "",
    show: JSON.stringify(head),
  };
  return (args) => ({ ok: true, out: answers[args[0]!] ?? "" });
}

describe("the verification entry point", () => {
  it("D929: refuses a job count of zero", () => {
    expect(() => parseOptions(["--jobs", "0"], 16)).toThrow(/at least 1/);
  });

  it("D979: refuses a job count not written in decimal digits", () => {
    expect(() => parseOptions(["--jobs", "0x4"], 16)).toThrow(/whole number/);
  });

  it("D930: bounds the default job count by the cores", () => {
    expect(parseOptions([], 16).jobs).toBeLessThanOrEqual(16);
  });

  it("D931: defaults to one sandbox on a single core", () => {
    expect(defaultJobs(1)).toBe(1);
  });

  it("D932: gives a --changed baseline every named test in the files it runs", async () => {
    const code = await withScratch(async (root) => {
      writeRoot(root);
      return runVerification({
        root,
        argv: ["--changed"],
        log: quiet,
        runTests: fakeVitest(catalogOf()),
        git: headWithChangedD1(),
        cores: 2,
      });
    });
    expect(code).toBe(0);
  });

  it("D933: fails when a working file changes during verification", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root);
      const editing = fakeVitest(catalogOf(), {
        before: () => writeFileSync(join(root, OTHER), "edited\n"),
      });
      return runVerification({ root, log: quiet, runTests: editing }).then(
        () => "passed",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toMatch(/Working files changed/);
  });

  it("D934: exits nonzero when a mutation survives", async () => {
    const records = JSON.parse(TREE["test/other/defects.json"]!);
    const tree: Tree = {
      ...TREE,
      "test/other/defects.json": JSON.stringify([
        { ...records[0], new: records[0].old },
      ]),
    };
    const code = await withScratch(async (root) => {
      writeRoot(root, tree);
      return runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf(tree)),
        cores: 2,
      });
    });
    expect(code).toBe(1);
  });

  it("D935: fails a full run over a passing test file with no named test", async () => {
    const plain = "test/plain/plain.test.ts";
    const tree: Tree = { ...TREE, [plain]: "it(`plain probe`, () => {});\n" };
    const code = await withScratch(async (root) => {
      writeRoot(root, tree);
      return runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf(tree), { plain: [plain] }),
        cores: 2,
      });
    });
    expect(code).toBe(1);
  });

  it("D936: fails when no named defect exists", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, {});
      return runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf({})),
      }).then(
        () => "passed",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toMatch(/No named defect/);
  });
});
