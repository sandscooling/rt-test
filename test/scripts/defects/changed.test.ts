import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedPaths,
  headRecordsIn,
  selectChanged,
} from "../../../scripts/lib/defects/changed.mjs";
import { gitIn, type Git } from "../../../scripts/lib/unbuilt/unbuilt-work.mjs";
import { git, initRepo } from "../orchestration/harness.js";
import {
  CALC,
  CALC_TEST,
  catalogOf,
  OTHER_TEST,
  TREE,
  withScratch,
  type Tree,
} from "./harness.js";

const unchangedHead = () => new Map<string, string>();

const IMPORTING: Tree = {
  ...TREE,
  [CALC_TEST]: [
    'import { h } from "./harness.js";',
    'import { s } from "../shared/helper.js";',
    TREE[CALC_TEST],
  ].join("\n"),
  "test/calc/harness.ts":
    'import { d } from "../shared/deep.js";\nexport const h = d;\n',
  "test/shared/helper.ts": "export const s = 1;\n",
  "test/shared/deep.ts": "export const d = 1;\n",
};

const idsFor = (changed: readonly string[], tree: Tree = TREE) =>
  selectChanged(catalogOf(tree), new Set(changed), unchangedHead).picks.map(
    (pick) => pick.defect.id,
  );

const fakeGit =
  (answers: Readonly<Record<string, { ok: boolean; out: string }>>): Git =>
  (args) =>
    answers[args[0]!] ?? { ok: false, out: "unexpected" };

describe("the --changed selection", () => {
  it("D922: selects every defect whose test file changed", () => {
    expect(idsFor([OTHER_TEST])).toEqual(["D3"]);
  });

  it("D923: selects every defect whose mutated file changed", () => {
    expect(idsFor([CALC])).toEqual(["D1", "D2"]);
  });

  it("D924: selects a record whose only change is its replacement text", () => {
    const { defects } = catalogOf();
    const head = defects
      .filter((defect) => defect.test === CALC_TEST)
      .map(({ source: _source, test: _test, ...record }) =>
        record.id === "D2" ? { ...record, new: "two = 9" } : record,
      );
    const repo = fakeGit({ show: { ok: true, out: JSON.stringify(head) } });
    const { picks } = selectChanged(
      catalogOf(),
      new Set(["test/calc/defects.json"]),
      headRecordsIn(repo),
    );
    expect(picks.map((pick) => pick.defect.id)).toEqual(["D2"]);
  });

  it("D925: counts an untracked file as changed", () => {
    const repo = fakeGit({
      diff: { ok: true, out: "" },
      "ls-files": { ok: true, out: `${OTHER_TEST}\0` },
    });
    expect([...changedPaths(repo)]).toEqual([OTHER_TEST]);
  });

  it("D926: refuses to select when git cannot list untracked files", () => {
    const repo = fakeGit({
      diff: { ok: true, out: "" },
      "ls-files": { ok: false, out: "fatal: broken index" },
    });
    expect(() => changedPaths(repo)).toThrow(/needs git/);
  });

  it("D951: refuses to select when git cannot diff against HEAD", () => {
    const repo = fakeGit({
      diff: { ok: false, out: "fatal: bad revision 'HEAD'" },
      "ls-files": { ok: true, out: "" },
    });
    expect(() => changedPaths(repo)).toThrow(/needs git/);
  });

  it("D927: selects the defects of a test whose helper in another folder changed", () => {
    expect(idsFor(["test/shared/helper.ts"], IMPORTING)).toEqual(["D1", "D2"]);
  });

  it("D928: counts a staged change as changed", async () => {
    const changed = await withScratch(async (dir) => {
      initRepo(dir, { [CALC_TEST]: "one\n" });
      writeFileSync(join(dir, CALC_TEST), "two\n");
      git(dir, "add", "-A");
      return [...changedPaths(gitIn(dir))];
    });
    expect(changed).toEqual([CALC_TEST]);
  });

  it("D939: counts both paths of a staged move as changed", async () => {
    const changed = await withScratch(async (dir) => {
      initRepo(dir, { "test/a/helper.ts": "export const h = 1;\n" });
      mkdirSync(join(dir, "test/b"));
      git(dir, "mv", "test/a/helper.ts", "test/b/helper.ts");
      return [...changedPaths(gitIn(dir))].sort();
    });
    expect(changed).toEqual(["test/a/helper.ts", "test/b/helper.ts"]);
  });

  it("D940: selects every defect when a changed input is reached by no import", () => {
    expect(idsFor(["test/fixtures/calc/data.txt"])).toEqual(["D1", "D2", "D3"]);
  });

  it("D941: selects nothing for a changed type declaration", () => {
    expect(idsFor(["scripts/calc.d.mts"])).toEqual([]);
  });

  it("D942: selects nothing for a changed path outside the verifier's inputs", () => {
    expect(idsFor(["docs/notes.md"])).toEqual([]);
  });

  it("D943: attributes a .js specifier to the .ts source it names", () => {
    expect(idsFor(["test/calc/harness.ts"], IMPORTING)).toEqual(["D1", "D2"]);
  });

  it("D944: attributes a change two imports deep", () => {
    expect(idsFor(["test/shared/deep.ts"], IMPORTING)).toEqual(["D1", "D2"]);
  });
});
