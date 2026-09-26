import { describe, expect, it } from "vitest";
import {
  changedPaths,
  gitIn,
  trackedPaths,
} from "../../../scripts/lib/git.mjs";
import { git, initRepo, withTemp, writeIn } from "../orchestration/harness.js";

const NON_ASCII = "café.ts";

describe("reading paths from git", () => {
  it("D953: an untracked non-ASCII path arrives exactly as named", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { "a.ts": "" });
      writeIn(dir, NON_ASCII, "");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual([NON_ASCII]);
  });

  it("D954: a staged change to a non-ASCII path arrives exactly as named", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { [NON_ASCII]: "one\n" });
      writeIn(dir, NON_ASCII, "two\n");
      git(dir, "add", "-A");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual([NON_ASCII]);
  });

  it("D980: an unstaged edit to a tracked file is in the changeset", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { "a.ts": "one\n" });
      writeIn(dir, "a.ts", "two\n");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual(["a.ts"]);
  });

  it("D955: before the first commit the staged and untracked paths are the changeset", () => {
    const paths = withTemp((dir) => {
      git(dir, "init", "-q");
      writeIn(dir, "staged.ts", "");
      git(dir, "add", "staged.ts");
      writeIn(dir, "untracked.ts", "");
      return changedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual(["staged.ts", "untracked.ts"]);
  });

  it("D956: a tracked non-ASCII path is listed exactly as named", () => {
    const paths = withTemp((dir) => {
      initRepo(dir, { [NON_ASCII]: "" });
      return trackedPaths(gitIn(dir)).paths;
    });
    expect(paths).toEqual([NON_ASCII]);
  });
});
