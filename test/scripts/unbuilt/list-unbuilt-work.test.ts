import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitIn, type Git } from "../../../scripts/lib/git.mjs";
import { listUnbuiltWork } from "../../../scripts/lib/unbuilt/unbuilt-work.mjs";
import type { Result } from "../../../scripts/lib/standards/result.mjs";
import { git } from "../orchestration/harness.js";
import { inTree, type Files } from "../skills/harness.js";

const STATUS = [
  "sprint-1: in-progress",
  "1-1-parse-events: done",
  "1-2-store-results: in-progress",
  "1-3-query-status: backlog",
  "1-4-watch-files: deferred",
  "",
].join("\n");

const SPRINT = "_agent-docs/sprints/sprint-1-queryable-results.md";
const QUERY_LINE = 17;

const SPRINT_TEXT = [
  "# Sprint 1: Queryable results",
  "",
  "**Milestone:** M1",
  "",
  "Sequencing: packages/core/src/store.ts moves first.",
  "",
  "## Ticket 1.1: Parse events",
  "",
  "Scope: read reporter events.",
  "",
  "## Ticket 1.2: Store results",
  "",
  "Scope: persist results.",
  "",
  "## Ticket 1.3: Query status",
  "",
  "Scope: answer queries from packages/core/src/query.ts.",
  "",
  "```md",
  "## Ticket 7.7: A fenced example",
  "```",
  "",
  "Also reads packages/core/src/fenced.ts.",
  "",
  "## Ticket 1.4: Watch files",
  "",
  "Scope: watch the tree.",
  "",
].join("\n");

const TREE: Files = {
  "_agent-docs/sprint-status.yaml": STATUS,
  [SPRINT]: SPRINT_TEXT,
  "_agent-docs/tickets/1-1-parse-events.md":
    "# Ticket 1.1: Parse events\n\nEdits packages/core/src/done.ts.\n",
  "_agent-docs/tickets/1-2-store-results.md": [
    "# Ticket 1.2: Store results",
    "",
    "Reads lib/data.ts and the src/view.tsx component.",
    "The index.ts barrel re-exports evidence.ts.",
    "Moves src/suffix.ts, packages/core/src/norm.ts and packages/core/src/abs.ts.",
    "Adds packages/core/src/untracked.ts.",
    "",
  ].join("\n"),
  "_agent-docs/tickets/1-4-watch-files.md":
    "# Ticket 1.4: Watch files\n\nEdits packages/core/src/watch.ts.\n",
  "_agent-docs/tickets/1-9-orphan.md":
    "# Ticket 1.9: Orphan\n\nEdits packages/core/src/orphan.ts.\n",
};

const TRACKED = [
  "packages/core/src/done.ts",
  "packages/core/src/store.ts",
  "packages/core/src/query.ts",
  "packages/core/src/fenced.ts",
  "packages/core/src/watch.ts",
  "packages/core/src/orphan.ts",
  "packages/core/src/a.ts",
  "packages/core/src/view.ts",
  "packages/core/src/evidence.ts",
  "packages/core/src/norm.ts",
  "packages/core/src/abs.ts",
  "packages/core/src/suffix.ts",
  "packages/x/suffix.ts",
  "packages/a/index.ts",
  "packages/b/index.ts",
];

const TRACKED_LISTING = "ls-files --full-name -z";
const DIFF_HEAD = "diff --name-only --no-renames -z HEAD --";
const UNTRACKED_LISTING = "ls-files --others --exclude-standard --full-name -z";

interface FakeGit {
  readonly tracked?: readonly string[];
  readonly untracked?: readonly string[];
  readonly failing?: string;
}

function fakeGit({
  tracked = TRACKED,
  untracked = [],
  failing,
}: FakeGit = {}): Git {
  const outputs: Record<string, readonly string[]> = {
    [TRACKED_LISTING]: tracked,
    [DIFF_HEAD]: [],
    [UNTRACKED_LISTING]: untracked,
  };
  return (args) => {
    const command = args.join(" ");
    if (command === failing) return { ok: false, out: "fatal: failed" };
    return {
      ok: true,
      out: (outputs[command] ?? []).map((path) => `${path}\0`).join(""),
    };
  };
}

function unbuilt(
  argv: readonly string[],
  git: Git = fakeGit(),
  files: Files = TREE,
): Result {
  return inTree(files, ({ config }) => listUnbuiltWork(config, argv, git));
}

describe("which tickets count as unbuilt", () => {
  it("D600: a done ticket naming the path is not reported", () => {
    expect(unbuilt(["packages/core/src/done.ts"]).out).toContain(
      "unbuilt-work: clean.",
    );
  });

  it("D601: a deferred ticket naming the path is reported", () => {
    expect(unbuilt(["packages/core/src/watch.ts"]).out).toContain(
      "Ticket 1.4 (deferred)",
    );
  });

  it("D602: a ticket file with no status key is reported, not skipped", () => {
    expect(unbuilt(["packages/core/src/orphan.ts"]).out).toContain(
      "Ticket 1.9 (no status key)",
    );
  });

  it("D626: a ticket file whose name matches no ticket key is still searched", () => {
    const files: Files = {
      ...TREE,
      "_agent-docs/tickets/1-5-Misnamed.md": "Edits packages/core/src/a.ts.\n",
    };
    expect(unbuilt(["packages/core/src/a.ts"], fakeGit(), files).out).toContain(
      "_agent-docs/tickets/1-5-Misnamed.md (file name matches no key)",
    );
  });
});

describe("sprint files", () => {
  it("D603: a path named in the sprint preamble is reported under the sprint", () => {
    expect(unbuilt(["packages/core/src/store.ts"]).out).toContain(
      "Sprint 1 preamble (in-progress)",
    );
  });

  it("D604: a hit reports its line number in the sprint file", () => {
    expect(unbuilt(["packages/core/src/query.ts"]).out).toContain(
      `${SPRINT}:${QUERY_LINE} names packages/core/src/query.ts`,
    );
  });

  it("D605: a path named in a ticket section is attributed to that ticket", () => {
    expect(unbuilt(["packages/core/src/query.ts"]).out).toContain(
      "Ticket 1.3 (backlog)",
    );
  });

  it("D606: a ticket heading inside a code fence starts no section", () => {
    expect(unbuilt(["packages/core/src/fenced.ts"]).out).not.toContain(
      "Ticket 7.7",
    );
  });

  it("D624: an unclosed fence in a done ticket does not hide the tickets after it", () => {
    const files: Files = {
      "_agent-docs/sprint-status.yaml": "1-1-a: done\n1-2-b: backlog\n",
      "_agent-docs/sprints/sprint-1-fences.md": [
        "## Ticket 1.1: A",
        "```ts",
        "## Ticket 1.2: B",
        "Edits packages/core/src/store.ts.",
      ].join("\n"),
    };
    expect(
      unbuilt(["packages/core/src/store.ts"], fakeGit(), files).out,
    ).toContain("Ticket 1.2 (backlog)");
  });

  it("D625: a shorter marker inside a longer fence does not close it", () => {
    const files: Files = {
      "_agent-docs/sprint-status.yaml": "1-1-a: backlog\n",
      "_agent-docs/sprints/sprint-1-fences.md": [
        "## Ticket 1.1: A",
        "````md",
        "```",
        "## Ticket 7.7: A fenced example",
        "Edits packages/core/src/store.ts.",
        "```",
        "````",
      ].join("\n"),
    };
    expect(
      unbuilt(["packages/core/src/store.ts"], fakeGit(), files).out,
    ).toContain("Ticket 1.1 (backlog)");
  });

  it("D627: a sprint file whose name matches no sprint key is still searched", () => {
    const files: Files = {
      "_agent-docs/sprint-status.yaml": STATUS,
      "_agent-docs/sprints/sprint-one.md":
        "Edits packages/core/src/store.ts.\n",
    };
    expect(
      unbuilt(["packages/core/src/store.ts"], fakeGit(), files).out,
    ).toContain("_agent-docs/sprints/sprint-one.md (file name matches no key)");
  });
});

describe("matching a path in prose", () => {
  it("D607: a bare file name does not match inside a longer name", () => {
    expect(unbuilt(["packages/core/src/a.ts"]).out).toContain(
      "unbuilt-work: clean.",
    );
  });

  it("D608: a path does not match the start of a longer file name", () => {
    expect(unbuilt(["packages/core/src/view.ts"]).out).toContain(
      "unbuilt-work: clean.",
    );
  });

  it("D609: a file name two tracked files share does not match bare", () => {
    expect(unbuilt(["packages/a/index.ts"]).out).toContain(
      "unbuilt-work: clean.",
    );
  });

  it("D610: a file name unique among tracked files matches bare", () => {
    expect(unbuilt(["packages/core/src/evidence.ts"]).out).toContain(
      "Ticket 1.2 (in-progress)",
    );
  });

  it("D611: a path matches when the prose cites it by a shorter directory suffix", () => {
    expect(unbuilt(["packages/core/src/suffix.ts"]).out).toContain(
      "Ticket 1.2 (in-progress)",
    );
  });

  it("D612: a path given with Windows separators still matches", () => {
    expect(unbuilt(["packages\\core\\src\\norm.ts"]).out).toContain(
      "Ticket 1.2 (in-progress)",
    );
  });

  it("D621: an absolute path inside the repository is reported repo-relative", () => {
    const out = inTree(
      TREE,
      ({ config, root }) =>
        listUnbuiltWork(
          config,
          [join(root, "packages/core/src/abs.ts")],
          fakeGit(),
        ).out,
    );
    expect(out).toContain("names packages/core/src/abs.ts");
  });
});

describe("what gets searched", () => {
  it("D613: a changed planning file is not searched for", () => {
    expect(unbuilt(["_agent-docs/tickets/1-2-store-results.md"]).out).toContain(
      "Nothing to search.",
    );
  });

  it("D614: a bare name shared by several tracked files is reported as not searched", () => {
    const git = fakeGit({ tracked: [...TRACKED, "packages/c/index.ts"] });
    expect(unbuilt(["index.ts"], git).out).toContain("NOT SEARCHED: index.ts.");
  });

  it("D1100: an untracked path whose bare name a tracked file shares does not match that name", () => {
    const git = fakeGit({
      tracked: [...TRACKED, "packages/core/src/intro.ts"],
      untracked: ["packages/new/intro.ts"],
    });
    const files: Files = {
      "_agent-docs/sprint-status.yaml": "1-5-new-module: backlog\n",
      "_agent-docs/tickets/1-5-new-module.md":
        "# Ticket 1.5: New module\n\nExtends intro.ts.\n",
    };
    expect(unbuilt([], git, files).out).toContain("unbuilt-work: clean.");
  });

  it("D615: with no paths, untracked files from git are searched", () => {
    const git = fakeGit({ untracked: ["packages/core/src/untracked.ts"] });
    expect(unbuilt([], git).out).toContain("Ticket 1.2 (in-progress)");
  });

  it("D616: a git failure while reading the changeset exits 1", () => {
    const git = fakeGit({ failing: DIFF_HEAD });
    expect(unbuilt([], git).code).toBe(1);
  });

  it("D983: a failed changeset read names git's error and the remedy", () => {
    const git = fakeGit({ failing: DIFF_HEAD });
    expect(unbuilt([], git).err).toContain(
      "fatal: failed. Pass the paths instead.",
    );
  });

  it("D622: a directory path with a trailing slash matches the files cited under it", () => {
    expect(unbuilt(["packages/core/"]).out).toContain(
      "Ticket 1.2 (in-progress)",
    );
  });

  it("D623: the old path of a staged rename is searched", () => {
    const files: Files = {
      ...TREE,
      "packages/core/src/renamed.ts": "export {};\n",
      "_agent-docs/tickets/1-3-query-status.md":
        "# Ticket 1.3: Query status\n\nReads packages/core/src/renamed.ts.\n",
    };
    const out = inTree(files, ({ config, root }) => {
      git(root, "init", "-q");
      git(root, "add", "-A");
      git(
        root,
        "-c",
        "user.name=fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "-qm",
        "fixture",
      );
      git(
        root,
        "mv",
        "packages/core/src/renamed.ts",
        "packages/core/src/moved.ts",
      );
      return listUnbuiltWork(config, [], gitIn(root)).out;
    });
    expect(out).toContain("Ticket 1.3 (backlog)");
  });

  it("D620: a failed tracked-file listing is reported, not silently dropped", () => {
    const git = fakeGit({ failing: TRACKED_LISTING });
    expect(unbuilt(["packages/core/src/evidence.ts"], git).out).toContain(
      "Bare file names were not matched",
    );
  });

  it("D958: a failed tracked-file listing's caveat names git's error", () => {
    const git = fakeGit({ failing: TRACKED_LISTING });
    expect(unbuilt(["packages/core/src/evidence.ts"], git).out).toContain(
      "fatal: failed",
    );
  });

  it("D959: when no given path could be searched, the report says so rather than clean", () => {
    const git = fakeGit({ tracked: [...TRACKED, "packages/c/index.ts"] });
    expect(unbuilt(["index.ts"], git).out).toContain(
      "unbuilt-work: no path could be searched. Nothing was checked.",
    );
  });

  it("D960: a path read from git is searched untrimmed, as the file it names", () => {
    const git = fakeGit({ untracked: ["packages/core/src/query.ts "] });
    expect(unbuilt([], git).out).toContain("unbuilt-work: clean.");
  });

  it("D961: a path passed as an argument is trimmed", () => {
    expect(unbuilt(["packages/core/src/query.ts "]).out).toContain(
      "Ticket 1.3 (backlog)",
    );
  });
});

describe("exit codes and inputs", () => {
  it("D617: hits are an input to review and exit 0", () => {
    expect(unbuilt(["packages/core/src/query.ts"]).code).toBe(0);
  });

  it("D618: a repository with no ticket directory yet is searched without error", () => {
    const noTickets: Files = {
      "_agent-docs/sprint-status.yaml": STATUS,
      [SPRINT]: SPRINT_TEXT,
    };
    expect(() =>
      unbuilt(["packages/core/src/query.ts"], fakeGit(), noTickets),
    ).not.toThrow();
  });

  it("D619: an unknown flag is a usage error, not a path", () => {
    expect(unbuilt(["--json"]).code).toBe(2);
  });
});

function citing(
  path: string,
  citation: string,
  git: Git = fakeGit(),
  extra: Files = {},
): Result {
  const files: Files = {
    "_agent-docs/sprint-status.yaml": "1-5-new-module: backlog\n",
    "_agent-docs/tickets/1-5-new-module.md": `# Ticket 1.5: New module\n\n${citation}\n`,
    ...extra,
  };
  return unbuilt([path], git, files);
}

describe("matching a folder in prose", () => {
  it("D868: a ticket citing a two-segment folder is reported for a file inside it", () => {
    expect(
      citing("packages/core/src/new.ts", "Adds a module to packages/core.").out,
    ).toContain("Ticket 1.5 (backlog)");
  });

  it("D869: a folder cited with a trailing slash is reported for a file inside it", () => {
    expect(
      citing(
        "packages/core/src/store/index.ts",
        "Adds a module under packages/core/src/store/ for the store.",
      ).out,
    ).toContain("Ticket 1.5 (backlog)");
  });

  it("D870: a one-segment folder matches nothing", () => {
    expect(
      citing("packages/core/src/new.ts", "Touches every folder in packages/.")
        .out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D871: a folder does not match a sibling that shares its prefix", () => {
    expect(
      citing("packages/core/src/new.ts", "Adds packages/core-extra/ helpers.")
        .out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D872: a cited file inside a folder does not cite the folder", () => {
    expect(
      citing("packages/core/src/new.ts", "Edits packages/core/src/other.ts.")
        .out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D873: a line naming only a folder says it names a folder holding the path", () => {
    expect(
      citing("packages/core/src/new.ts", "Adds a module to packages/core.").out,
    ).toContain("names a folder holding packages/core/src/new.ts");
  });

  it("D874: a folder cited through a relative link is reported for a file inside it", () => {
    expect(
      citing(
        "packages/core/src/store/new.ts",
        "See [store](../../packages/core/src/store/).",
      ).out,
    ).toContain("Ticket 1.5 (backlog)");
  });
});

describe("matching a module cited without its extension", () => {
  it("D962: a module cited by its full path without the extension is reported", () => {
    expect(
      citing(
        "packages/core/src/evidence.ts",
        "Extends packages/core/src/evidence with a reader.",
      ).out,
    ).toContain("Ticket 1.5 (backlog)");
  });

  it("D963: a module cited by a shorter directory suffix without the extension is reported", () => {
    expect(
      citing("packages/core/src/evidence.ts", "Extends core/src/evidence.").out,
    ).toContain("Ticket 1.5 (backlog)");
  });

  it("D964: an extensionless module path followed by a slash names a folder, not the module", () => {
    expect(
      citing(
        "packages/core/src/evidence.ts",
        "Adds packages/core/src/evidence/ helpers.",
      ).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D965: an extensionless module path does not match a longer dotted file name", () => {
    expect(
      citing(
        "packages/core/src/evidence.ts",
        "Edits packages/core/src/evidence.test.ts.",
      ).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D966: a module's bare name without a directory is not a citation", () => {
    expect(
      citing("packages/core/src/evidence.ts", "Extends the evidence module.")
        .out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D967: a non-module file gets no extensionless citation", () => {
    expect(
      citing("docs/guide/intro.md", "See docs/guide/intro for the tour.").out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D968: an .mjs module cited without its extension is reported", () => {
    expect(
      citing(
        "scripts/lib/git.mjs",
        "Reads the changeset through scripts/lib/git.",
      ).out,
    ).toContain("Ticket 1.5 (backlog)");
  });
});

const ROOT_SHARED = fakeGit({
  tracked: [...TRACKED, "package.json", "packages/core/package.json"],
});

describe("matching a file at the repository root", () => {
  it("D969: a tracked root file whose name other files share matches its bare name", () => {
    expect(
      citing("package.json", "Adds a script to `package.json`.", ROOT_SHARED)
        .out,
    ).toContain("Ticket 1.5 (backlog)");
  });

  it("D970: a root file matches its name after a relative link", () => {
    expect(
      citing(
        "package.json",
        "See [the manifest](../../package.json).",
        ROOT_SHARED,
      ).out,
    ).toContain("Ticket 1.5 (backlog)");
  });

  it("D971: a root file does not match the same name inside a folder", () => {
    expect(
      citing(
        "package.json",
        "Adds a script to packages/core/package.json.",
        ROOT_SHARED,
      ).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D981: a root file's bare name does not match inside a longer name", () => {
    expect(
      citing("package.json", "Edits the-package.json.", ROOT_SHARED).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D972: a root file on disk matches its bare name when the tracked listing failed", () => {
    expect(
      citing(
        "package.json",
        "Adds a script to `package.json`.",
        fakeGit({ failing: TRACKED_LISTING }),
        { "package.json": "{}\n" },
      ).out,
    ).toContain("Ticket 1.5 (backlog)");
  });
});

describe("leaving a ticket out", () => {
  it("D973: --except drops the ticket's own ticket file", () => {
    expect(
      unbuilt(["--except", "1.2", "packages/core/src/evidence.ts"]).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D974: --except drops the ticket's sprint-file section", () => {
    expect(
      unbuilt(["--except", "1.3", "packages/core/src/query.ts"]).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D975: --except leaves the other tickets in", () => {
    expect(
      unbuilt(["--except", "1.2", "packages/core/src/query.ts"]).out,
    ).toContain("Ticket 1.3 (backlog)");
  });

  it("D976: --except can be given more than once", () => {
    expect(
      unbuilt([
        "--except",
        "1.3",
        "--except",
        "1.2",
        "packages/core/src/query.ts",
        "packages/core/src/evidence.ts",
      ]).out,
    ).toContain("unbuilt-work: clean.");
  });

  it("D982: --except accepts a lettered ticket id", () => {
    expect(
      unbuilt(["--except", "1.2b", "packages/core/src/query.ts"]).code,
    ).toBe(0);
  });

  it("D977: --except with no value is a usage error", () => {
    expect(unbuilt(["--except"]).code).toBe(2);
  });

  it("D978: --except with a value that is not a ticket id is a usage error", () => {
    expect(unbuilt(["--except", "1", "packages/core/src/query.ts"]).code).toBe(
      2,
    );
  });
});

function barePathTree(extra: Files = {}): Files {
  return {
    "_agent-docs/sprint-status.yaml": "1-5-new-module: backlog\n",
    "_agent-docs/tickets/1-5-new-module.md":
      "# Ticket 1.5: New module\n\nThe fences helper.\n",
    ...extra,
  };
}

describe("directory arguments", () => {
  it("D881: a directory argument's last segment is not matched as a bare file name", () => {
    const files = barePathTree({ "test/scripts/fences/a.test.ts": "" });
    expect(unbuilt(["test/scripts/fences/"], fakeGit(), files).out).toContain(
      "unbuilt-work: clean.",
    );
  });

  it("D882: a path that does not exist on disk still matches its unique bare name", () => {
    expect(
      unbuilt(["test/scripts/gone/fences"], fakeGit(), barePathTree()).out,
    ).toContain("Ticket 1.5 (backlog)");
  });
});
