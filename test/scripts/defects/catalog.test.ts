import { describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildCatalog,
  loadCatalog,
  snapshotFiles,
} from "../../../scripts/lib/defects/catalog.mjs";
import {
  CALC_TEST,
  CLI_LINK,
  filesOf,
  LINK,
  linkIn,
  LINKED,
  LINKED_TREE,
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

  it("D984: records a workspace link to a copied package, as a junction and as a symlink", async () => {
    const links = await withScratch(async (root) => {
      writeRoot(root, LINKED_TREE);
      linkIn(root, LINK, LINKED, "junction");
      linkIn(root, CLI_LINK, LINKED, "dir");
      return loadCatalog(root).links;
    });
    expect(links).toEqual([
      { path: CLI_LINK, target: LINKED },
      { path: LINK, target: LINKED },
    ]);
  });

  it("D985: leaves out a link to a directory the sandbox does not copy", async () => {
    const links = await withScratch(async (root) => {
      writeRoot(root, { ...TREE, "node_modules/dep/index.js": "export {};\n" });
      linkIn(root, "packages/daemon/node_modules/dep", "node_modules/dep");
      return loadCatalog(root).links;
    });
    expect(links).toEqual([]);
  });

  it("D996: leaves out a link to a build output the sandbox does not copy", async () => {
    const links = await withScratch(async (root) => {
      writeRoot(root, {
        ...LINKED_TREE,
        [`${LINKED}/dist/index.js`]: "export {};\n",
      });
      linkIn(root, LINK, `${LINKED}/dist`);
      return loadCatalog(root).links;
    });
    expect(links).toEqual([]);
  });

  it("D986: skips a link whose target is gone", async () => {
    const links = await withScratch(async (root) => {
      writeRoot(root, LINKED_TREE);
      linkIn(root, LINK, LINKED);
      rmSync(join(root, LINKED), { recursive: true });
      try {
        return loadCatalog(root).links;
      } catch (error) {
        return String(error);
      }
    });
    expect(links).toEqual([]);
  });

  it("D987: never snapshots the content behind a link", async () => {
    const paths = await withScratch(async (root) => {
      writeRoot(root, LINKED_TREE);
      linkIn(root, "packages/daemon/src/core", LINKED);
      return [...snapshotFiles(root).keys()];
    });
    expect(paths.filter((path) => path.startsWith("packages/daemon"))).toEqual(
      [],
    );
  });

  it("D993: indexes a named test whose title is wrapped onto its own line", () => {
    const wrapped = 'it(\n  "D3: three",\n  () => {},\n);\n';
    const files = filesOf({ ...TREE, [OTHER_TEST]: wrapped });
    const indexed = (() => {
      try {
        return buildCatalog(files).defects.find(({ id }) => id === "D3")?.test;
      } catch (error) {
        return String(error);
      }
    })();
    expect(indexed).toBe(OTHER_TEST);
  });
});
