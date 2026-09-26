import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  snapshotFiles,
} from "../../../scripts/lib/defects/catalog.mjs";
import {
  CALC_TEST,
  filesOf,
  OTHER,
  OTHER_TEST,
  TREE,
  withScratch,
  writeRoot,
} from "./harness.js";

describe("the defect catalog", () => {
  it("D900: rejects a named test that has no defect record", () => {
    const unrecorded = 'it("D' + '4: four", () => {});\n';
    const tree = { ...TREE, [CALC_TEST]: TREE[CALC_TEST] + unrecorded };
    expect(() => buildCatalog(filesOf(tree))).toThrow(/exactly one named/);
  });

  it("D901: rejects a mutation anchor that matches twice", () => {
    const tree = {
      ...TREE,
      [OTHER]: "export const three = 3;\n// three = 3\n",
    };
    expect(() => buildCatalog(filesOf(tree))).toThrow(/exactly once/);
  });

  it("D950: rejects an id that two tests and two records share", () => {
    const [record] = JSON.parse(TREE["test/other/defects.json"]!);
    const tree = {
      ...TREE,
      [OTHER_TEST]: TREE[OTHER_TEST]!.repeat(2),
      "test/other/defects.json": JSON.stringify([record, record]),
    };
    expect(() => buildCatalog(filesOf(tree))).toThrow(/exactly one named/);
  });

  it("D902: rejects a record whose mutated file the sandbox does not copy", () => {
    const { [OTHER]: _removed, ...tree } = TREE;
    expect(() => buildCatalog(filesOf(tree))).toThrow(/not in the sandbox/);
  });

  it("D903: snapshots the root files the tests read", async () => {
    const paths = await withScratch(async (root) => {
      writeRoot(root);
      return [...snapshotFiles(root).keys()];
    });
    expect(paths).toContain("_agent-docs/_flow-config.yaml");
  });

  it("D904: leaves dependency directories out of the snapshot", async () => {
    const paths = await withScratch(async (root) => {
      writeRoot(root, {
        ...TREE,
        "packages/core/node_modules/dep/index.js": "export {};\n",
      });
      return [...snapshotFiles(root).keys()];
    });
    expect(paths.filter((path) => path.includes("node_modules"))).toEqual([]);
  });
});
