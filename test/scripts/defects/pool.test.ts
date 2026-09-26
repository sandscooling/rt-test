import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  type Catalog,
} from "../../../scripts/lib/defects/catalog.mjs";
import { treeDifference } from "../../../scripts/lib/defects/pool.mjs";
import { openRun } from "../../../scripts/lib/defects/runs.mjs";
import type { RunTests } from "../../../scripts/lib/defects/vitest.mjs";
import {
  catalogOf,
  fakeVitest,
  filesOf,
  inSandboxes,
  LINK,
  linkedCatalog,
  linkIn,
  LINKED,
  TREE,
  withScratch,
} from "./harness.js";

const PACKAGE = "node_modules/dep";
const LEFTOVER = "rt-test-verify-defects-999999-planted";

const quiet = () => {};

const isSandbox = (sandbox: string, index: number) =>
  sandbox.endsWith(`sandbox-${index}`);

function storeIn(parent: string, name: string): string {
  mkdirSync(join(parent, "store", name), { recursive: true });
  return realpathSync.native(join(parent, "store", name));
}

const packageCatalog = (target: string): Catalog =>
  buildCatalog(filesOf(TREE), [{ path: PACKAGE, target }]);

function sweepWith(
  parent: string,
  planted: string,
  running: (pid: number) => boolean,
): string[] {
  const lines: string[] = [];
  mkdirSync(join(parent, planted));
  openRun(parent, (line) => lines.push(line), running);
  return lines;
}

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

  it("D988: passes a clean run over a sandbox with a workspace link", async () => {
    const catalog = linkedCatalog();
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, fakeVitest(catalog), 2, catalog),
    );
    expect(result.ok).toBe(true);
  });

  it("D989: resolves each sandbox's workspace link to that sandbox's own copy", async () => {
    const catalog = linkedCatalog();
    const resolved = new Set<boolean>();
    const probing = fakeVitest(catalog, {
      before: ({ sandbox }) =>
        resolved.add(
          realpathSync(join(sandbox, LINK)) ===
            realpathSync(join(sandbox, LINKED)),
        ),
    });
    await withScratch((scratch) => inSandboxes(scratch, probing, 2, catalog));
    expect([...resolved]).toEqual([true]);
  });

  it("D990: fails a sandbox whose workspace link a run removed", async () => {
    const catalog = linkedCatalog();
    const unlinking = fakeVitest(catalog, {
      before: ({ sandbox, pattern }) => {
        if (pattern === "D2") unlinkSync(join(sandbox, LINK));
      },
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, unlinking, 1, catalog),
    );
    expect(result.ok).toBe(false);
  });

  it("D991: fails a sandbox that a run added a link to", async () => {
    const catalog = linkedCatalog();
    const linking = fakeVitest(catalog, {
      before: ({ sandbox, pattern }) => {
        if (pattern === "D2") linkIn(sandbox, "test/extra", "scripts");
      },
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, linking, 1, catalog),
    );
    expect(result.ok).toBe(false);
  });

  it("D992: fails a sandbox whose workspace link a run pointed elsewhere", async () => {
    const catalog = linkedCatalog();
    const relinking = fakeVitest(catalog, {
      before: ({ sandbox, pattern }) => {
        if (pattern !== "D2") return;
        unlinkSync(join(sandbox, LINK));
        linkIn(sandbox, LINK, "scripts");
      },
    });
    const result = await withScratch((scratch) =>
      inSandboxes(scratch, relinking, 1, catalog),
    );
    expect(result.ok).toBe(false);
  });

  it("D1117: resolves each sandbox's package link to its absolute target", async () => {
    const resolved = new Set<boolean>();
    await withScratch((parent) => {
      const store = storeIn(parent, "dep");
      const catalog = packageCatalog(store);
      const probing = fakeVitest(catalog, {
        before: ({ sandbox }) =>
          resolved.add(realpathSync.native(join(sandbox, PACKAGE)) === store),
      });
      return inSandboxes(parent, probing, 2, catalog);
    });
    expect([...resolved]).toEqual([true]);
  });

  it("D1118: fails a sandbox whose package link a run pointed elsewhere", async () => {
    const result = await withScratch((parent) => {
      const catalog = packageCatalog(storeIn(parent, "dep"));
      const elsewhere = storeIn(parent, "other");
      const relinking = fakeVitest(catalog, {
        before: ({ sandbox, pattern }) => {
          if (pattern !== "D2") return;
          unlinkSync(join(sandbox, PACKAGE));
          symlinkSync(elsewhere, join(sandbox, PACKAGE), "junction");
        },
      });
      return inSandboxes(parent, relinking, 1, catalog);
    });
    expect(result.ok).toBe(false);
  });

  it("D1119: fails a sandbox whose package link a run removed", async () => {
    const result = await withScratch((parent) => {
      const catalog = packageCatalog(storeIn(parent, "dep"));
      const unlinking = fakeVitest(catalog, {
        before: ({ sandbox, pattern }) => {
          if (pattern === "D2") unlinkSync(join(sandbox, PACKAGE));
        },
      });
      return inSandboxes(parent, unlinking, 1, catalog);
    });
    expect(result.ok).toBe(false);
  });
});

describe("a defect run's directory", () => {
  it("D1110: names the run after its owning process", async () => {
    const name = await withScratch(async (parent) =>
      basename(openRun(parent, quiet)),
    );
    expect(name).toMatch(
      new RegExp(`^rt-test-verify-defects-${process.pid}-.`),
    );
  });

  it("D1111: creates the run under the parent's real path, never the path it was given", async () => {
    const [home, real] = await withScratch(async (scratch) => {
      mkdirSync(join(scratch, "real"));
      linkIn(scratch, "alias", "real");
      const run = openRun(join(scratch, "alias"), quiet);
      return [dirname(run), realpathSync.native(join(scratch, "real"))];
    });
    expect(home).toBe(real);
  });

  it("D1122: removes a leftover run whose process has exited", async () => {
    const left = await withScratch(async (parent) => {
      sweepWith(parent, LEFTOVER, () => false);
      return existsSync(join(parent, LEFTOVER));
    });
    expect(left).toBe(false);
  });

  it("D1123: names each leftover run it removes by its path", async () => {
    const { lines, path } = await withScratch(async (parent) => ({
      lines: sweepWith(parent, LEFTOVER, () => false),
      path: join(realpathSync.native(parent), LEFTOVER),
    }));
    expect(lines).toEqual([expect.stringContaining(path)]);
  });

  it("D1124: keeps a leftover run whose process is still alive", async () => {
    const kept = await withScratch(async (parent) => {
      sweepWith(parent, LEFTOVER, () => true);
      return existsSync(join(parent, LEFTOVER));
    });
    expect(kept).toBe(true);
  });

  it("D1125: leaves an entry not named like a run untouched", async () => {
    const kept = await withScratch(async (parent) => {
      sweepWith(parent, "rt-test-defects-abc123", () => false);
      return existsSync(join(parent, "rt-test-defects-abc123"));
    });
    expect(kept).toBe(true);
  });

  it("D1126: logs nothing for a leftover another run removed first", async () => {
    const lines = await withScratch(async (parent) =>
      sweepWith(parent, LEFTOVER, () => {
        rmSync(join(parent, LEFTOVER), { recursive: true });
        return false;
      }),
    );
    expect(lines).toEqual([]);
  });

  it("D1152: keeps a leftover run whose process id cannot be probed", async () => {
    const planted = "rt-test-verify-defects-99999999999-planted";
    const kept = await withScratch(async (parent) => {
      mkdirSync(join(parent, planted));
      openRun(parent, quiet);
      return existsSync(join(parent, planted));
    });
    expect(kept).toBe(true);
  });

  it("D1156: names a removed leftover's process id apart from its path", async () => {
    const rest = await withScratch(async (parent) => {
      const path = join(realpathSync.native(parent), LEFTOVER);
      const lines = sweepWith(parent, LEFTOVER, () => false);
      return lines.map((line) => line.replace(path, ""));
    });
    expect(rest).toEqual([expect.stringContaining("999999")]);
  });
});
