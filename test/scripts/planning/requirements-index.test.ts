import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requirementsIndex } from "../../../scripts/lib/planning/requirements-index.mjs";
import {
  apply,
  failsWith,
  lineFor,
  REQUIREMENTS,
  run,
  STATUS,
  type Edit,
  type Result,
} from "./fixture.js";

const ADD_FR8: Edit = {
  path: REQUIREMENTS,
  from: "- FR6: Report gaps",
  to: "- FR8: Watch the network [Sprint 2]\n- FR6: Report gaps",
};
const DROP_FR8: Edit = {
  path: REQUIREMENTS,
  from: ADD_FR8.to,
  to: ADD_FR8.from,
};

function git(root: string, ...args: string[]): string {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=RT Test",
      "-c",
      "user.email=rt-test@example.invalid",
      "-c",
      "core.autocrlf=false",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout;
}

function commit(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

// FR8 is committed, then deleted and committed again, so only history holds it.
function deletedFr8(root: string): void {
  git(root, "init", "-q");
  apply(root, ADD_FR8);
  commit(root, "add FR8");
  apply(root, DROP_FR8);
  commit(root, "delete FR8");
}

function next(prepare: (root: string) => void): Result {
  return run(requirementsIndex, [], ["--next"], prepare);
}

function stateOf(id: string, ...edits: Edit[]): string | undefined {
  const line = lineFor(run(requirementsIndex, edits).out, `${id}: `);
  return line?.split(" | ")[1];
}

describe("requirements-index", () => {
  it("D224: derives implemented when every linked ticket is done", () => {
    expect(stateOf("FR1")).toBe("implemented");
  });

  it("D225: derives in-progress when only some linked tickets are done", () => {
    expect(stateOf("FR2")).toBe("in-progress");
  });

  it("D226: derives planned for a ticket that is only ready for dev", () => {
    expect(stateOf("FR3")).toBe("planned");
  });

  it("D227: derives unclaimed for a sprint link whose sprint is done", () => {
    expect(
      stateOf("FR5", {
        path: STATUS,
        from: "sprint-2: backlog",
        to: "sprint-2: done",
      }),
    ).toBe("unclaimed");
  });

  it("D240: derives planned for a sprint link whose sprint is still open", () => {
    expect(stateOf("FR5")).toBe("planned");
  });

  it("D241: derives in-progress for an in-progress ticket before any is done", () => {
    expect(stateOf("NFR2")).toBe("in-progress");
  });

  it("D242: derives unscheduled for an Unscheduled marker", () => {
    expect(stateOf("FR6")).toBe("unscheduled");
  });

  it("D228: derives partial, not implemented, when a Partial marker's tickets are done", () => {
    expect(stateOf("NFR1")).toBe("partial");
  });

  it("D229: fails rather than derive a state from a link with no status key", () => {
    expect(
      run(requirementsIndex, [
        { path: REQUIREMENTS, from: "[Ticket 2.1]", to: "[Ticket 2.2]" },
      ]),
    ).toEqual(failsWith("FR3 links Ticket 2.2"));
  });

  it("D230: fails on an --ids id that names no requirement", () => {
    expect(run(requirementsIndex, [], ["--ids", "FR1,FR4"])).toEqual(
      failsWith("no such requirement id: FR4"),
    );
  });

  it("D231: offers the id after the highest one, not after the count", () => {
    const result = next((root) => git(root, "init", "-q"));
    expect(lineFor(result.out, "NEXT_FR:")).toBe("NEXT_FR: FR7");
  });
});

describe("requirements-index --next history", () => {
  it("D800: never offers an id that exists only in the file's history", () => {
    expect(lineFor(next(deletedFr8).out, "NEXT_FR:")).toBe("NEXT_FR: FR9");
  });

  it("D801: fails when the file's history cannot be read", () => {
    const result = next((root) =>
      writeFileSync(join(root, ".git"), "gitdir: missing\n"),
    );
    expect(result).toEqual(
      failsWith("cannot read the history of docs/requirements.md"),
    );
  });

  it("D802: fails in a shallow clone, whose history is truncated", () => {
    const result = next((root) => {
      deletedFr8(root);
      writeFileSync(
        join(root, ".git", "shallow"),
        git(root, "rev-parse", "HEAD"),
      );
    });
    expect(result).toEqual(failsWith("shallow"));
  });

  it("D803: follows the file's history across a rename", () => {
    const result = next((root) => {
      git(root, "init", "-q");
      apply(root, ADD_FR8);
      renameSync(
        join(root, REQUIREMENTS),
        join(root, "docs/product-requirements.md"),
      );
      commit(root, "add FR8 under the old name");
      git(root, "mv", "docs/product-requirements.md", REQUIREMENTS);
      apply(root, DROP_FR8);
      commit(root, "rename, deleting FR8");
    });
    expect(lineFor(result.out, "NEXT_FR:")).toBe("NEXT_FR: FR9");
  });

  it("D804: counts an id that only a merge commit ever held", () => {
    const addFr10: Edit = {
      path: REQUIREMENTS,
      from: "- FR6: Report gaps",
      to: "- FR10: Resolve a merge [Sprint 2]\n- FR6: Report gaps",
    };
    const result = next((root) => {
      git(root, "init", "-q");
      commit(root, "base");
      git(root, "switch", "-q", "-c", "side");
      apply(root, ADD_FR8);
      commit(root, "add FR8 on a side branch");
      git(root, "switch", "-q", "-");
      git(root, "merge", "-q", "--no-ff", "--no-commit", "side");
      apply(root, addFr10);
      commit(root, "merge, adding FR10 in the merge itself");
      apply(root, { path: REQUIREMENTS, from: addFr10.to, to: addFr10.from });
      apply(root, DROP_FR8);
      commit(root, "delete FR8 and FR10");
    });
    expect(lineFor(result.out, "NEXT_FR:")).toBe("NEXT_FR: FR11");
  });

  it("D808: follows a rename that also rewrote most of the file", () => {
    const scaffolding = Array.from(
      { length: 9 },
      (_, index) =>
        `Draft note ${index}: this paragraph is scaffolding the restructure removed.\n`,
    ).join("");
    const result = next((root) => {
      git(root, "init", "-q");
      apply(root, ADD_FR8);
      const old = join(root, "docs/product-requirements.md");
      renameSync(join(root, REQUIREMENTS), old);
      writeFileSync(old, readFileSync(old, "utf8") + scaffolding);
      commit(root, "add FR8 under the old name, with scaffolding");
      writeFileSync(
        join(root, REQUIREMENTS),
        readFileSync(old, "utf8").replace(scaffolding, ""),
      );
      rmSync(old);
      apply(root, DROP_FR8);
      commit(root, "restructure into the new name, deleting FR8");
    });
    expect(lineFor(result.out, "NEXT_FR:")).toBe("NEXT_FR: FR9");
  });

  it("D809: keeps the ids of a path that was deleted and recreated by renaming another file", () => {
    const result = next((root) => {
      git(root, "init", "-q");
      apply(root, ADD_FR8);
      commit(root, "add FR8");
      apply(root, DROP_FR8);
      const draft = readFileSync(join(root, REQUIREMENTS), "utf8");
      rmSync(join(root, REQUIREMENTS));
      commit(root, "delete the requirements file");
      writeFileSync(join(root, "docs/draft.md"), draft);
      commit(root, "add a draft");
      git(root, "mv", "docs/draft.md", REQUIREMENTS);
      commit(root, "promote the draft");
    });
    expect(lineFor(result.out, "NEXT_FR:")).toBe("NEXT_FR: FR9");
  });

  it("D810: reads an earlier name that holds non-ASCII characters", () => {
    const result = next((root) => {
      git(root, "init", "-q");
      apply(root, ADD_FR8);
      renameSync(join(root, REQUIREMENTS), join(root, "docs/réq.md"));
      commit(root, "add FR8 under a non-ASCII name");
      git(root, "mv", "docs/réq.md", REQUIREMENTS);
      apply(root, DROP_FR8);
      commit(root, "rename, deleting FR8");
    });
    expect(lineFor(result.out, "NEXT_FR:")).toBe("NEXT_FR: FR9");
  });

  it("D811: fails when git cannot return every version it listed", () => {
    // A quote in a path stays quoted in git log output, so cat-file cannot resolve that version.
    const result = next((root) => {
      git(root, "init", "-q");
      apply(root, ADD_FR8);
      const blob = git(root, "hash-object", "-w", REQUIREMENTS).trim();
      apply(root, DROP_FR8);
      git(root, "add", "-A");
      git(root, "rm", "-q", "--cached", REQUIREMENTS);
      // The quoted path lives only in the index, so Windows' NTFS guard does not apply.
      git(
        root,
        "-c",
        "core.protectNTFS=false",
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${blob},docs/a"b.md`,
      );
      git(root, "commit", "-q", "-m", "add FR8 under a quoted name");
      git(root, "rm", "-q", "--cached", 'docs/a"b.md');
      git(root, "add", REQUIREMENTS);
      git(root, "commit", "-q", "-m", "rename, deleting FR8");
    });
    expect(result).toEqual(failsWith("cat-file returned"));
  });
});
