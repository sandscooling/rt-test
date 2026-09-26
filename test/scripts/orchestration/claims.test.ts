import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFlowConfig } from "../../../scripts/lib/flow-config.mjs";
import {
  claimPaths,
  endGrants,
  grantPaths,
  listClaims,
  listGrants,
  releasePaths,
} from "../../../scripts/lib/orchestration/claims.mjs";
import { runClaimsCli } from "../../../scripts/lib/orchestration/claims-cli.mjs";
import {
  classifyPath,
  pathRules,
  toRepoPath,
} from "../../../scripts/lib/orchestration/paths.mjs";
import { REPO, withTemp } from "./harness.js";

const A = { lane: "lane-a", thread: "thread-a" };
const B = { lane: "lane-b", thread: "thread-b" };
const X = "scripts/x.mjs";
const Y = "scripts/y.mjs";
const SPRINTS = "_agent-docs/sprints";
const SPRINT = `${SPRINTS}/sprint-1.md`;
const ADR = "docs/adr/0002-next.md";

const rules = () => pathRules(loadFlowConfig(REPO));
const claim = (dir: string, owner: typeof A, paths: string[]) =>
  claimPaths(dir, rules(), owner, paths);
const grant = (dir: string, owner: typeof A, paths: string[]) =>
  grantPaths(dir, rules(), owner, paths);
const lanes = (dir: string) =>
  listClaims(dir).map((c) => `${c.lane} ${c.path}`);

describe("file claims", () => {
  it("D300: refuses a path another lane holds and names the holder", () => {
    const holder = withTemp((dir) => {
      claim(dir, A, [X]);
      return claim(dir, B, [X]).conflicts[0]?.holder.lane;
    });
    expect(holder).toBe("lane-a");
  });

  it("D301: keeps none of a claim's paths when one of them conflicts", () => {
    const held = withTemp((dir) => {
      claim(dir, A, [X]);
      claim(dir, B, [Y, X]);
      return lanes(dir);
    });
    expect(held).toEqual(["lane-a scripts/x.mjs"]);
  });

  it("D302: treats paths differing only in case as one file", () => {
    const ok = withTemp((dir) => {
      claim(dir, A, [X]);
      return claim(dir, B, ["Scripts/X.mjs"]).ok;
    });
    expect(ok).toBe(false);
  });

  it("D303: normalizes a backslash path to the forward-slash repo path", () => {
    expect(toRepoPath(REPO, "scripts\\lib\\x.mjs")).toBe("scripts/lib/x.mjs");
  });

  it("D304: claims nothing when the set includes an orchestrator-only file", () => {
    const held = withTemp((dir) => {
      claim(dir, A, [X, "AGENTS.md"]);
      return lanes(dir);
    });
    expect(held).toEqual([]);
  });

  it("D305: refuses a top-level _agent-docs markdown file", () => {
    expect(classifyPath(rules(), "_agent-docs/next-session.md")).toBe(
      "orchestrator-only",
    );
  });

  it("D306: lets a lane claim a ticket file nested under _agent-docs", () => {
    expect(classifyPath(rules(), "_agent-docs/tickets/1-1-store.md")).toBe(
      "claimable",
    );
  });

  it("D307: refuses an orchestrator-only directory named in another case", () => {
    expect(classifyPath(rules(), "Docs/Plan.md")).toBe("orchestrator-only");
  });

  it("D308: lets a lane claim a path that only shares a prefix with an owned directory", () => {
    expect(classifyPath(rules(), "docsite/index.md")).toBe("claimable");
  });

  it("D309: lets the lane holding a grant claim a file beneath it", () => {
    const ok = withTemp((dir) => {
      grant(dir, A, [SPRINTS]);
      return claim(dir, A, [SPRINT]).ok;
    });
    expect(ok).toBe(true);
  });

  it("D310: refuses a granted file to a lane that does not hold the grant", () => {
    const ok = withTemp((dir) => {
      grant(dir, A, [SPRINTS]);
      return claim(dir, B, [SPRINT]).ok;
    });
    expect(ok).toBe(false);
  });

  it("D311: keeps orchestrator-only files outside a grant refused to its holder", () => {
    const ok = withTemp((dir) => {
      grant(dir, A, [SPRINTS]);
      return claim(dir, A, ["AGENTS.md"]).ok;
    });
    expect(ok).toBe(false);
  });

  it("D312: refuses a folder grant while another lane holds a file inside it", () => {
    const ok = withTemp((dir) => {
      grant(dir, A, [ADR]);
      return grant(dir, B, ["docs/adr"]).ok;
    });
    expect(ok).toBe(false);
  });

  it("D313: takes the orchestrator-only rules folder from the flow config", () => {
    const config = {
      ...loadFlowConfig(REPO),
      rules_dir: join(REPO, "plans/rules"),
    };
    expect(classifyPath(pathRules(config), "plans/rules/r-1.md")).toBe(
      "orchestrator-only",
    );
  });

  it("D314: refuses to release another lane's claim", () => {
    const held = withTemp((dir) => {
      claim(dir, A, [X]);
      releasePaths(dir, { lane: "lane-b" }, [X]);
      return lanes(dir);
    });
    expect(held).toEqual(["lane-a scripts/x.mjs"]);
  });

  it("D315: releases only the named lane's claims when no path is given", () => {
    const held = withTemp((dir) => {
      claim(dir, A, [X]);
      claim(dir, B, [Y]);
      releasePaths(dir, { lane: "lane-a" }, []);
      return lanes(dir);
    });
    expect(held).toEqual(["lane-b scripts/y.mjs"]);
  });

  it("D316: treats a lane re-claiming its own path as already held", () => {
    const result = withTemp((dir) => {
      claim(dir, A, [X]);
      const again = claim(dir, A, [X]);
      return { ok: again.ok, held: again.held };
    });
    expect(result).toEqual({ ok: true, held: [X] });
  });

  it("D317: rejects a path outside the repository", () => {
    expect(toRepoPath(REPO, "../elsewhere.ts")).toBeNull();
  });

  it("D318: refuses to claim a directory, since claims are per file", () => {
    const code = withTemp((root) => {
      mkdirSync(join(root, "src"));
      const dir = join(root, "claims");
      const ctx = { root, dir, rules: rules() };
      return runClaimsCli(["claim", "--lane", "a", "--thread", "t", "src"], ctx)
        .code;
    });
    expect(code).toBe(2);
  });

  it("D319: reports an unreadable claim as held by another lane", () => {
    const ok = withTemp((dir) => {
      claim(dir, A, [X]);
      const [record] = listClaims(dir);
      writeFileSync(record?.file ?? join(dir, "missing"), "");
      return claim(dir, A, [X]).ok;
    });
    expect(ok).toBe(false);
  });

  it("D347: refuses a file grant while another lane holds its folder", () => {
    const ok = withTemp((dir) => {
      grant(dir, A, ["docs/adr"]);
      return grant(dir, B, [ADR]).ok;
    });
    expect(ok).toBe(false);
  });

  it("D348: grants none of a request's paths when one of them conflicts", () => {
    const held = withTemp((dir) => {
      grant(dir, A, ["docs/adr"]);
      grant(dir, B, ["README.md", ADR]);
      return listGrants(dir, "lane-b").length;
    });
    expect(held).toBe(0);
  });

  it("D349: refuses to grant a path any lane may claim without one", () => {
    expect(withTemp((dir) => grant(dir, A, [X]).ok)).toBe(false);
  });

  it("D350: keeps the rules, checklist, sprints, and sprint status orchestrator-only", () => {
    const classes = [
      "_agent-docs/rules/r-1.md",
      "_agent-docs/code-review-checklist/c-1.md",
      SPRINT,
      "_agent-docs/sprint-status.yaml",
    ].map((path) => classifyPath(rules(), path));
    expect(new Set(classes)).toEqual(new Set(["orchestrator-only"]));
  });

  it("D351: ends every grant a lane holds when grant-end names no path", () => {
    const left = withTemp((dir) => {
      grant(dir, A, ["docs/adr", "README.md"]);
      endGrants(dir, { lane: "lane-a" }, []);
      return listGrants(dir).length;
    });
    expect(left).toBe(0);
  });

  it("D352: grants a whole folder from the command line", () => {
    const code = withTemp((root) => {
      mkdirSync(join(root, "docs/adr"), { recursive: true });
      const ctx = { root, dir: join(root, "claims"), rules: rules() };
      return runClaimsCli(
        ["grant", "--lane", "a", "--thread", "t", "docs/adr"],
        ctx,
      ).code;
    });
    expect(code).toBe(0);
  });
});
