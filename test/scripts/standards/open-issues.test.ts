import { describe, expect, it } from "vitest";
import { listOpenIssues } from "../../../scripts/lib/standards/open-issues.mjs";

const GITHUB_REMOTE =
  "origin\thttps://github.com/sandscooling/rt-test.git (fetch)\n";

interface Fake {
  readonly remote?: string;
  readonly authenticated?: boolean;
  readonly issues?: unknown;
  readonly failure?: string;
}

interface Issue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly { readonly name: string }[];
  readonly updatedAt: string;
}

function issue(number: number, ...labels: string[]): Issue {
  return {
    number,
    title: `Issue ${number}`,
    labels: labels.map((name) => ({ name, id: `L${name}`, color: "ffffff" })),
    updatedAt: "2000-01-01T00:00:00Z",
  };
}

function fakeGithub(fake: Fake) {
  const calls: string[][] = [];
  const run = (file: string, args: readonly string[]): string => {
    calls.push([file, ...args]);
    if (file === "git") return fake.remote ?? GITHUB_REMOTE;
    if (args[0] === "auth") {
      if (fake.authenticated === false) throw new Error("not logged in");
      return "";
    }
    if (fake.failure !== undefined) {
      throw Object.assign(new Error("Command failed"), {
        stderr: fake.failure,
      });
    }
    return JSON.stringify(fake.issues ?? []);
  };
  return { run, calls };
}

function list(args: readonly string[], fake: Fake = {}) {
  const github = fakeGithub(fake);
  return { ...listOpenIssues(args, github.run), calls: github.calls };
}

const issueListCall = (calls: readonly string[][]) =>
  calls.find((call) => call[0] === "gh" && call[1] === "issue");

describe("list-open-issues", () => {
  it("D410: exits 1 when the result fills the cap", () => {
    const outcome = list(["--cap", "2"], { issues: [issue(1), issue(2)] });
    expect(outcome.code).toBe(1);
  });

  it("D411: says complete on its first line when the result is under the cap", () => {
    const outcome = list(["--cap", "2"], { issues: [issue(1)] });
    expect(outcome.out.split("\n")[0]).toBe("1 open issue, complete");
  });

  it("D412: skips with exit 0 when the repository has no GitHub remote", () => {
    const outcome = list([], {
      remote: "origin\thttps://gitlab.example/x.git (fetch)\n",
      issues: [issue(1)],
    });
    expect(outcome).toMatchObject({
      code: 0,
      out: "SKIP: no GitHub remote on this repository, so there are no issues to read.\n",
    });
  });

  it("D413: skips with exit 0 when gh is not authenticated", () => {
    const outcome = list([], { authenticated: false, issues: [issue(1)] });
    expect(outcome.out).toBe(
      "SKIP: `gh auth status` did not exit 0, so the open issues could not be read.\n",
    );
  });

  it("D414: asks gh for open issues up to a default cap of 1000", () => {
    const outcome = list([], { issues: [] });
    expect(issueListCall(outcome.calls)).toEqual([
      "gh",
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      "number,title,labels,updatedAt",
    ]);
  });

  it("D415: passes the search and every repeated label through to gh", () => {
    const outcome = list([
      "--search",
      "freshness",
      "--label",
      "bug",
      "--label",
      "cli",
    ]);
    expect(issueListCall(outcome.calls)?.slice(9)).toEqual([
      "--search",
      "freshness",
      "--label",
      "bug",
      "--label",
      "cli",
    ]);
  });

  it("D416: exits 2 and reports gh's own error when the listing fails", () => {
    const outcome = list([], { failure: "HTTP 502: bad gateway" });
    expect(outcome).toMatchObject({
      code: 2,
      err: expect.stringContaining("HTTP 502: bad gateway"),
    });
  });

  it("D417: rejects a cap below one", () => {
    const outcome = list(["--cap", "0"], { issues: [] });
    expect(outcome.code).toBe(2);
  });

  it("D418: prints label names, not gh's label objects, under --json", () => {
    const outcome = list(["--json"], { issues: [issue(7, "bug", "cli")] });
    const body = outcome.out.slice(outcome.out.indexOf("\n") + 1);
    expect(JSON.parse(body)).toEqual([
      {
        number: 7,
        title: "Issue 7",
        labels: ["bug", "cli"],
        updatedAt: "2000-01-01T00:00:00Z",
      },
    ]);
  });
});
