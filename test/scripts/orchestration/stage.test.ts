import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFlowConfig } from "../../../scripts/lib/flow-config.mjs";
import { claimPaths } from "../../../scripts/lib/orchestration/claims.mjs";
import { pathRules } from "../../../scripts/lib/orchestration/paths.mjs";
import {
  indexNumstat,
  stageLane,
  type HunkSpec,
  type StageOptions,
} from "../../../scripts/lib/orchestration/stage.mjs";
import { git, initRepo, REPO, withTemp, writeIn } from "./harness.js";

const DOC = "notes/shared doc.md";
const SLUG_PAGE = "app/[...slug]/page.tsx";
const DOC_LINES = 40;

const docLines = () =>
  Array.from({ length: DOC_LINES }, (_, i) => `line ${i + 1}`);

function laneADoc(): string {
  const lines = docLines();
  lines[19] = "line 20 LANE_A_MARK edit";
  lines.splice(35, 2);
  lines.splice(30, 0, "LANE_A_ADD one", "LANE_A_ADD two");
  return `${lines.join("\n")}\n`;
}

function buildRepo(base: string) {
  const root = join(base, "repo");
  const claimsDir = join(base, "claims");
  initRepo(root, {
    "src/keep.ts": "export const a = 1;\n",
    "src/gone.ts": "export const b = 2;\n",
    "src/other.ts": "export const c = 3;\n",
    "app/s/page.tsx": "export default 1;\n",
    [DOC]: `${docLines().join("\n")}\n`,
    "notes/untouched.md": "x\n",
  });
  writeIn(root, "src/keep.ts", "export const a = 10;\n");
  unlinkSync(join(root, "src/gone.ts"));
  writeIn(root, "src/other.ts", "export const c = 30;\n");
  writeIn(root, "app/s/page.tsx", "export default 2;\n");
  writeIn(root, SLUG_PAGE, "export default function Page() {}\n");
  writeIn(root, "notes/new.md", "a new note\n");
  const shared = laneADoc().split("\n");
  shared.unshift("LANE_B_MARK one", "LANE_B_MARK two", "LANE_B_MARK three");
  writeIn(root, DOC, shared.join("\n"));
  const rules = pathRules(loadFlowConfig(REPO));
  claimPaths(claimsDir, rules, { lane: "lane-a", thread: "t-a" }, [
    "src/keep.ts",
    "src/gone.ts",
    SLUG_PAGE,
  ]);
  claimPaths(claimsDir, rules, { lane: "lane-b", thread: "t-b" }, [
    "src/other.ts",
  ]);
  return { root, claimsDir };
}

const hunk = (substring: string, path = DOC): HunkSpec => ({ path, substring });

function stageIn(
  base: string,
  options: Partial<StageOptions> = {},
): { root: string; result: ReturnType<typeof stageLane> } {
  const { root, claimsDir } = buildRepo(base);
  const result = stageLane({ root, claimsDir, lane: "lane-a", ...options });
  return { root, result };
}

function stagedStatus(root: string): Map<string, string> {
  const fields = git(root, "diff", "--cached", "--name-status", "-z")
    .split("\0")
    .filter(Boolean);
  const staged = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) {
    staged.set(fields[i + 1] ?? "", fields[i] ?? "");
  }
  return staged;
}

describe("stage-lane", () => {
  it("D320: leaves another lane's claimed file unstaged", () => {
    const staged = withTemp((base) => {
      const { root } = stageIn(base);
      return stagedStatus(root).has("src/other.ts");
    });
    expect(staged).toBe(false);
  });

  it("D321: stages nothing when any hunk substring matches no hunk", () => {
    const rows = withTemp((base) => {
      const { root } = stageIn(base, {
        hunkSpecs: [hunk("LANE_A_MARK"), hunk("NO_SUCH_TEXT")],
      });
      return indexNumstat(root).length;
    });
    expect(rows).toBe(0);
  });

  it("D322: stages only the hunks whose changed lines contain the substring", () => {
    const indexed = withTemp((base) => {
      const { root } = stageIn(base, {
        hunkSpecs: [hunk("LANE_A_MARK"), hunk("LANE_A_ADD"), hunk("line 36")],
      });
      return git(root, "show", `:${DOC}`);
    });
    expect(indexed).toBe(laneADoc());
  });

  it("D323: places a selected hunk by its own offsets when an unselected hunk sits above it", () => {
    const indexed = withTemp((base) => {
      const { root } = stageIn(base, { hunkSpecs: [hunk("LANE_A_ADD")] });
      return git(root, "show", `:${DOC}`).split("\n").indexOf("LANE_A_ADD one");
    });
    expect(indexed).toBe(30);
  });

  it("D324: stages nothing on a dry run", () => {
    const rows = withTemp((base) => {
      const { root } = stageIn(base, {
        hunkSpecs: [hunk("LANE_A")],
        dryRun: true,
      });
      return indexNumstat(root).length;
    });
    expect(rows).toBe(0);
  });

  it("D325: refuses an --also path that has no change to stage", () => {
    const code = withTemp(
      (base) => stageIn(base, { also: ["notes/untouched.md"] }).result.code,
    );
    expect(code).toBe(1);
  });

  it("D326: stages a bracketed path literally rather than as a glob", () => {
    const staged = withTemp((base) => {
      const { root } = stageIn(base);
      return stagedStatus(root).has("app/s/page.tsx");
    });
    expect(staged).toBe(false);
  });

  it("D327: refuses a hunk on a file with no unstaged change, naming why", () => {
    const err = withTemp(
      (base) =>
        stageIn(base, { hunkSpecs: [hunk("x", "notes/untouched.md")] }).result
          .err,
    );
    expect(err.some((line) => line.includes("no unstaged change"))).toBe(true);
  });

  it("D328: stages a lane's deletion and a new untracked --also file", () => {
    const staged = withTemp((base) => {
      const { root } = stageIn(base, { also: ["notes/new.md"] });
      const status = stagedStatus(root);
      return [status.get("src/gone.ts"), status.get("notes/new.md")];
    });
    expect(staged).toEqual(["D", "A"]);
  });

  it("D704: stages no whole file when git apply --check refuses a hunk patch", () => {
    const rows = withTemp((base) => {
      const { root, claimsDir } = buildRepo(base);
      git(root, "config", "apply.whitespace", "error");
      const doc = readFileSync(join(root, DOC), "utf8");
      writeIn(root, DOC, `${doc}\nLANE_A_WS trailing   \n`);
      stageLane({
        root,
        claimsDir,
        lane: "lane-a",
        hunkSpecs: [hunk("LANE_A_WS")],
      });
      return indexNumstat(root).length;
    });
    expect(rows).toBe(0);
  });
});
