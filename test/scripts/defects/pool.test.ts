import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { treeDifference } from "../../../scripts/lib/defects/pool.mjs";
import type { RunTests } from "../../../scripts/lib/defects/vitest.mjs";
import {
  catalogOf,
  fakeVitest,
  filesOf,
  inSandboxes,
  TREE,
  withScratch,
} from "./harness.js";

const isSandbox = (sandbox: string, index: number) =>
  sandbox.endsWith(`sandbox-${index}`);

function writeIn(sandbox: string, path: string): void {
  mkdirSync(dirname(join(sandbox, path)), { recursive: true });
  writeFileSync(join(sandbox, path), "{}\n");
}

function failsLast(): RunTests {
  let release = () => {};
  const gate = new Promise<void>((open) => (release = open));
  let runs = 0;
  return fakeVitest(catalogOf(), {
    before: ({ sandbox, pattern }) => {
      if (!pattern) return;
      if (isSandbox(sandbox, 1)) {
        writeFileSync(join(sandbox, "test/leak.txt"), "");
      } else if (++runs === 2) release();
    },
    wait: ({ sandbox, pattern }) =>
      isSandbox(sandbox, 1) && pattern ? gate : 5,
  });
}

describe("the sandbox pool", () => {
  it("D912: keeps two parallel defects on one file from clobbering each other", async () => {
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, fakeVitest(catalogOf()), 2),
    );
    expect(result.ok).toBe(true);
  });

  it("D913: fails a sandbox that a run left a file in", async () => {
    const leaky = fakeVitest(catalogOf(), {
      before: ({ sandbox, pattern }) => {
        if (pattern === "D2") writeFileSync(join(sandbox, "test/leak.txt"), "");
      },
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, leaky, 1),
    );
    expect(result.ok).toBe(false);
  });

  it("D914: runs no mutation when the unmodified baseline fails", async () => {
    const broken = fakeVitest(catalogOf(), { fails: (id) => id === "D2" });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, broken, 1),
    );
    expect(result.detected).toEqual([]);
  });

  it("D915: fails when a mutation leaves the baseline red after its restore", async () => {
    let poisoned = false;
    const lingering = fakeVitest(catalogOf(), {
      before: ({ pattern }) => {
        if (pattern === "D2") poisoned = true;
      },
      fails: (id) => poisoned && id === "D1",
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, lingering, 1),
    );
    expect(result.ok).toBe(false);
  });

  it("D916: fails the run when one sandbox fails after the others finish", async () => {
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, failsLast(), 2),
    );
    expect(result.ok).toBe(false);
  });

  it("D917: reports the failure of a sandbox whose work others finished", async () => {
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, failsLast(), 2),
    );
    expect(result.failures).toHaveLength(1);
  });

  it("D918: never uses more sandboxes than its job count", async () => {
    const sandboxes = new Set<string>();
    const counting = fakeVitest(catalogOf(), {
      before: ({ sandbox }) => sandboxes.add(sandbox),
    });
    await withScratch((scratch) => inSandboxes(scratch, counting, 2));
    expect(sandboxes.size).toBe(2);
  });

  it("D919: removes every sandbox when the run ends", async () => {
    const left = await withScratch(async (scratch) => {
      await inSandboxes(scratch, fakeVitest(catalogOf()), 2);
      return readdirSync(scratch);
    });
    expect(left).toEqual([]);
  });

  it("D920: names a file whose content changed", () => {
    const changed = filesOf({ ...TREE, "scripts/other.mjs": "changed\n" });
    expect(treeDifference(filesOf(TREE), changed)).toBe("scripts/other.mjs");
  });

  it("D921: names a file that appeared", () => {
    const grown = filesOf({ ...TREE, "test/new.test.ts": "" });
    expect(treeDifference(filesOf(TREE), grown)).toBe("test/new.test.ts");
  });

  it("D937: fails a sandbox that a run left a build output in", async () => {
    const building = fakeVitest(catalogOf(), {
      before: ({ sandbox, pattern }) => {
        if (pattern === "D2") writeIn(sandbox, "scripts/dist/calc.js");
      },
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, building, 1),
    );
    expect(result.ok).toBe(false);
  });

  it("D938: tolerates the results cache Vitest writes into a sandbox", async () => {
    const caching = fakeVitest(catalogOf(), {
      before: ({ sandbox }) =>
        writeIn(sandbox, "node_modules/.vite/vitest/0a1b/results.json"),
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, caching, 1),
    );
    expect(result.ok).toBe(true);
  });

  it("D945: never counts a run that threw as a detection", async () => {
    const fake = fakeVitest(catalogOf());
    const interrupted: RunTests = (request) =>
      request.pattern
        ? Promise.reject(new Error("Bootstrap runner interrupted: SIGTERM"))
        : fake(request);
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, interrupted, 1),
    );
    expect(result.detected).toEqual([]);
  });
});
