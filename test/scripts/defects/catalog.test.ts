import { describe, expect, it } from "vitest";
import { realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  buildCatalog,
  loadCatalog,
  snapshotFiles,
  type Link,
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

const STORE = "node_modules/.bun/dep@1.0.0/node_modules/dep";
const STORE_TREE = { ...TREE, [`${STORE}/index.js`]: "export {};\n" };

function linksOf(root: string): readonly Link[] | string {
  try {
    return loadCatalog(root).links;
  } catch (error) {
    return String(error);
  }
}

const pathsOf = (links: readonly Link[] | string) =>
  typeof links === "string" ? links : links.map((link) => link.path);

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

  it("D985: leaves out a link to a repository directory the sandbox does not copy", async () => {
    const links = await withScratch(async (root) => {
      writeRoot(root, { ...TREE, "vendor/dep/index.js": "export {};\n" });
      linkIn(root, "packages/daemon/node_modules/dep", "vendor/dep");
      return loadCatalog(root).links;
    });
    expect(links).toEqual([]);
  });

  it("D1116: records a workspace link into the root package store by its absolute target", async () => {
    const [links, store] = await withScratch(async (root) => {
      writeRoot(root, STORE_TREE);
      linkIn(root, "packages/daemon/node_modules/dep", STORE);
      return [linksOf(root), realpathSync.native(join(root, STORE))];
    });
    expect(links).toEqual([
      { path: "packages/daemon/node_modules/dep", target: store },
    ]);
  });

  it("D1114: records each package of a scope in the root package store", async () => {
    const paths = await withScratch(async (root) => {
      writeRoot(root, { ...TREE, "node_modules/@scope/pkg/index.js": "" });
      return pathsOf(linksOf(root));
    });
    expect(paths).toEqual(["node_modules/@scope/pkg"]);
  });

  it("D1115: records no root package entry whose name starts with a dot", async () => {
    const paths = await withScratch(async (root) => {
      writeRoot(root, {
        ...TREE,
        "node_modules/.vite/vitest/results.json": "{}\n",
        "node_modules/pkg/index.js": "",
      });
      return pathsOf(linksOf(root));
    });
    expect(paths).toEqual(["node_modules/pkg"]);
  });

  it("D1120: refuses a root package entry that resolves into repository source", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, LINKED_TREE);
      linkIn(root, "node_modules/@rt-test/core", LINKED);
      const links = linksOf(root);
      return typeof links === "string" ? links : "recorded";
    });
    expect(outcome).toMatch(
      /node_modules\/@rt-test\/core resolves to packages\/core.*isolated linker/,
    );
  });

  it("D1154: refuses a root package entry that resolves to the repository root itself", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root);
      linkIn(root, "node_modules/self", ".");
      const links = linksOf(root);
      return typeof links === "string" ? links : "recorded";
    });
    expect(outcome).toMatch(/node_modules\/self resolves to \., live source/);
  });

  it("D1155: skips a root package entry whose target is gone", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, { ...TREE, "vendor/gone/index.js": "" });
      linkIn(root, "node_modules/gone", "vendor/gone");
      rmSync(join(root, "vendor/gone"), { recursive: true });
      return pathsOf(linksOf(root));
    });
    expect(outcome).toEqual([]);
  });

  it("D1121: accepts a root package entry that resolves into the root package store", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, STORE_TREE);
      linkIn(root, "node_modules/dep", STORE);
      return linksOf(root);
    });
    expect(pathsOf(outcome)).toEqual(["node_modules/dep"]);
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
