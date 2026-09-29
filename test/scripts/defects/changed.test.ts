import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  headRecordsIn,
  type HeadRecords,
  requireChangeset,
  selectChanged,
  selectEdited,
} from "../../../scripts/lib/defects/changed.mjs";
import { gitIn, type Git } from "../../../scripts/lib/git.mjs";
import { git, initRepo } from "../orchestration/harness.js";
import { PROCESS_SCENARIO } from "../timeouts.js";
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

const CALC_RECORDS = "test/calc/defects.json";

const calcRecordsAtHead = () =>
  catalogOf()
    .defects.filter((defect) => defect.test === CALC_TEST)
    .map(({ source: _source, test: _test, ...record }) => record);

const DIFF_HEAD = "diff --name-only --no-renames -z HEAD --";

// An answer keyed by the whole command wins over one keyed by its subcommand.
const fakeGit =
  (answers: Readonly<Record<string, { ok: boolean; out: string }>>): Git =>
  (args) =>
    answers[args.join(" ")] ??
    answers[args[0]!] ?? { ok: false, out: "unexpected" };

describe("the --changed selection", PROCESS_SCENARIO, () => {
  it("D922: selects every defect whose test file changed", () => {
    expect(idsFor([OTHER_TEST])).toEqual(["D3"]);
  });

  it("D923: selects every defect whose mutated file changed", () => {
    expect(idsFor([CALC])).toEqual(["D1", "D2"]);
  });

  it("D924: selects a record whose only change is its replacement text", () => {
    const head = calcRecordsAtHead().map((record) =>
      record.id === "D2" ? { ...record, new: "two = 9" } : record,
    );
    const repo = fakeGit({ show: { ok: true, out: JSON.stringify(head) } });
    const { picks } = selectChanged(
      catalogOf(),
      new Set([CALC_RECORDS]),
      headRecordsIn(repo),
    );
    expect(picks.map((pick) => pick.defect.id)).toEqual(["D2"]);
  });

  it("D925: counts an untracked file as changed", () => {
    const repo = fakeGit({
      diff: { ok: true, out: "" },
      "ls-files": { ok: true, out: `${OTHER_TEST}\0` },
    });
    expect([...requireChangeset(repo)]).toEqual([OTHER_TEST]);
  });

  it("D926: refuses to select when git cannot list untracked files", () => {
    const repo = fakeGit({
      diff: { ok: true, out: "" },
      "ls-files": { ok: false, out: "fatal: broken index" },
    });
    expect(() => requireChangeset(repo)).toThrow(/needs git/);
  });

  it("D951: refuses to select when git cannot diff against an existing HEAD", () => {
    const repo = fakeGit({
      [DIFF_HEAD]: { ok: false, out: "fatal: cannot read the index" },
      "rev-parse": { ok: true, out: "abc123\n" },
      diff: { ok: true, out: "" },
      "ls-files": { ok: true, out: "" },
    });
    expect(() => requireChangeset(repo)).toThrow(/needs git/);
  });

  it("D957: a changeset git could not read throws with git's error rather than selecting nothing", () => {
    const repo = fakeGit({
      diff: { ok: true, out: "" },
      "ls-files": { ok: false, out: "fatal: broken index" },
    });
    expect(() => requireChangeset(repo)).toThrow(
      /^--changed needs git to compare with HEAD: .*fatal: broken index/,
    );
  });

  it("D927: selects the defects of a test whose helper in another folder changed", () => {
    expect(idsFor(["test/shared/helper.ts"], IMPORTING)).toEqual(["D1", "D2"]);
  });

  it("D928: counts a staged change as changed", async () => {
    const changed = await withScratch(async (dir) => {
      initRepo(dir, { [CALC_TEST]: "one\n" });
      writeFileSync(join(dir, CALC_TEST), "two\n");
      git(dir, "add", "-A");
      return [...requireChangeset(gitIn(dir))];
    });
    expect(changed).toEqual([CALC_TEST]);
  });

  it("D939: counts both paths of a staged move as changed", async () => {
    const changed = await withScratch(async (dir) => {
      initRepo(dir, { "test/a/helper.ts": "export const h = 1;\n" });
      mkdirSync(join(dir, "test/b"));
      git(dir, "mv", "test/a/helper.ts", "test/b/helper.ts");
      return [...requireChangeset(gitIn(dir))].sort();
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

const editedIds = (
  changed: readonly string[],
  tree: Tree = TREE,
  headRecords: HeadRecords = unchangedHead,
) =>
  selectEdited(catalogOf(tree), new Set(changed), headRecords).map(
    (pick) => pick.defect.id,
  );

const headShowing = (records: readonly object[]): HeadRecords =>
  headRecordsIn(fakeGit({ show: { ok: true, out: JSON.stringify(records) } }));

describe("the --edited selection", () => {
  it("D2631: selects every defect whose test file changed", () => {
    expect(editedIds([OTHER_TEST])).toEqual(["D3"]);
  });

  it("D2632: does not select a defect whose test only imports a changed helper", () => {
    expect(editedIds(["test/shared/helper.ts"], IMPORTING)).toEqual([]);
  });

  it("D2633: does not widen to every defect for a changed file no import reaches", () => {
    expect(editedIds(["test/fixtures/calc/data.txt"])).toEqual([]);
  });

  it("D2634: selects a record whose text differs from HEAD", () => {
    const head = calcRecordsAtHead().map((record) =>
      record.id === "D2" ? { ...record, new: "two = 9" } : record,
    );
    expect(editedIds([CALC_RECORDS], TREE, headShowing(head))).toEqual(["D2"]);
  });

  it("D2635: does not select the records of a changed defects.json that match HEAD", () => {
    expect(
      editedIds([CALC_RECORDS], TREE, headShowing(calcRecordsAtHead())),
    ).toEqual([]);
  });
});

describe("the records at HEAD", () => {
  it("D2636: reads one source's records with one git show however often it is asked", () => {
    const commands: string[] = [];
    const repo: Git = (args) => {
      commands.push(args.join(" "));
      return { ok: true, out: JSON.stringify(calcRecordsAtHead()) };
    };
    const headRecords = headRecordsIn(repo);
    headRecords(CALC_RECORDS);
    headRecords(CALC_RECORDS);
    expect(commands).toHaveLength(1);
  });
});
