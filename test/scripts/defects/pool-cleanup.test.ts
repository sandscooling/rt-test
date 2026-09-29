import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EXIT_ENTRY } from "../../../scripts/lib/defects/run-evidence.mjs";
import { openRun } from "../../../scripts/lib/defects/runs.mjs";
import { EXIT_RECORD_SUFFIX } from "../../../scripts/lib/defects/vitest.mjs";
import { holdsWithin } from "../processes.js";
import {
  orphansOf,
  removeDirectory,
  stillRunning,
  type ProcessRecord,
} from "../run-cleanup.mjs";
import { catalogOf, fakeVitest, inSandboxes, withScratch } from "./harness.js";

vi.mock(import("node:fs"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rmSync: vi.fn<typeof actual.rmSync>(actual.rmSync) };
});

vi.mock("../processes.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../processes.js")>();
  return {
    ...actual,
    holdsWithin: vi.fn<typeof actual.holdsWithin>(actual.holdsWithin),
  };
});

vi.mock("../run-cleanup.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../run-cleanup.mjs")>();
  return {
    ...actual,
    orphansOf: vi.fn<typeof actual.orphansOf>(actual.orphansOf),
    removeDirectory: vi.fn<typeof actual.removeDirectory>(
      actual.removeDirectory,
    ),
    stillRunning: vi.fn<typeof actual.stillRunning>(actual.stillRunning),
  };
});

const LEFTOVER = "rt-test-verify-defects-999999-planted";

const isOwnRun = (path: string) =>
  basename(path).startsWith(`rt-test-verify-defects-${process.pid}-`);

const codedError = (code: string) =>
  Object.assign(new Error(`${code}: removal refused`), { code });

async function whileRemovalFails<T>(
  fails: (path: string) => boolean,
  error: Error,
  body: () => Promise<T>,
): Promise<T> {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  vi.mocked(rmSync).mockImplementation((path, options) => {
    if (fails(String(path))) throw error;
    actual.rmSync(path, options);
  });
  try {
    return await body();
  } finally {
    vi.mocked(rmSync).mockImplementation(actual.rmSync);
  }
}

describe("the end of a defect run", () => {
  it("D1127: fails a run whose own directory could not be removed", async () => {
    const result = await withScratch((parent) =>
      whileRemovalFails(isOwnRun, codedError("EBUSY"), () =>
        inSandboxes(parent, fakeVitest(catalogOf()), 1),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("D1128: keeps the detected defects when the run's directory could not be removed", async () => {
    const detected = await withScratch((parent) =>
      whileRemovalFails(isOwnRun, codedError("EBUSY"), () =>
        inSandboxes(parent, fakeVitest(catalogOf()), 1).then(
          (result) => result.detected,
          (error: Error) => error.message,
        ),
      ),
    );
    expect(detected).toEqual(["D1", "D2", "D3"]);
  });
});

/** The process ids of the Vitest runs whose exit record the held-scratch tests plant. */
const VITEST_RUNS = [4001, 4002];
/** A process one of those runs started that still runs, as Vite's `net use` shell does. */
const ORPHAN: ProcessRecord = {
  pid: 4100,
  parent: 4001,
  startedAt: 5n,
  commandLine: "net use",
};
/** The bound the wait for a run's orphans to end must have, in milliseconds. */
const ORPHAN_WAIT_MS = 10_000;

interface HeldScratch {
  /** The processes the runs started that `orphansOf` finds, and that still run while they are listed. */
  readonly orphans: readonly ProcessRecord[];
  /** How the wait for the orphans to end answers. */
  readonly holds: typeof holdsWithin;
  /** Whether `removeDirectory` removes the folder. */
  readonly removed: boolean;
}

/** A wait that answers at once, as though the orphans ended, after asking `checks` times. */
const endsAfter =
  (checks: number): typeof holdsWithin =>
  async (ready) => {
    for (let check = 0; check < checks; check++) ready();
    return true;
  };

/**
 * Runs `withScratch` around `body`, with the scratch folder held as Windows holds one: after `body` writes the exit
 * record of each of `VITEST_RUNS` there, every removal of the folder but `removeDirectory`'s is refused as busy. Says
 * what `withScratch` threw, how often `orphansOf` was asked and which folders `removeDirectory` was asked to remove.
 */
async function withHeldScratch(
  held: HeldScratch,
  body: (dir: string) => Promise<void>,
): Promise<{
  dir: string;
  thrown: string | undefined;
  queries: number;
  removals: string[];
}> {
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
  const actualProcesses =
    await vi.importActual<typeof import("../processes.js")>("../processes.js");
  const actualRun =
    await vi.importActual<typeof import("../run-cleanup.mjs")>(
      "../run-cleanup.mjs",
    );
  let dir = "";
  vi.mocked(orphansOf).mockClear();
  vi.mocked(removeDirectory).mockClear();
  vi.mocked(orphansOf).mockReturnValue([...held.orphans]);
  vi.mocked(stillRunning).mockImplementation((records) => [...records]);
  vi.mocked(holdsWithin).mockImplementation(held.holds);
  vi.mocked(removeDirectory).mockResolvedValue(held.removed);
  vi.mocked(rmSync).mockImplementation((path, options) => {
    if (String(path) === dir) throw codedError("EBUSY");
    actualFs.rmSync(path, options);
  });
  try {
    const thrown = await withScratch(async (scratch) => {
      dir = scratch;
      const started = VITEST_RUNS.map((pid) =>
        JSON.stringify({ kind: EXIT_ENTRY.STARTED, pid }),
      );
      writeFileSync(
        join(scratch, `report${EXIT_RECORD_SUFFIX}`),
        `${started.join("\n")}\n`,
      );
      await body(scratch);
    }).then(
      () => undefined,
      (error: Error) => error.message,
    );
    return {
      dir,
      thrown,
      queries: vi.mocked(orphansOf).mock.calls.length,
      removals: vi.mocked(removeDirectory).mock.calls.map(([path]) => path),
    };
  } finally {
    vi.mocked(rmSync).mockImplementation(actualFs.rmSync);
    vi.mocked(orphansOf).mockImplementation(actualRun.orphansOf);
    vi.mocked(stillRunning).mockImplementation(actualRun.stillRunning);
    vi.mocked(removeDirectory).mockImplementation(actualRun.removeDirectory);
    vi.mocked(holdsWithin).mockImplementation(actualProcesses.holdsWithin);
    actualFs.rmSync(dir, { recursive: true, force: true });
  }
}

/** What `console.error` was given while `act` ran, one string per call. */
async function loggedErrors(act: () => Promise<unknown>): Promise<string[]> {
  const logged: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
    logged.push(args.map(String).join(" "));
  });
  try {
    await act();
  } finally {
    spy.mockRestore();
  }
  return logged;
}

const NEVER_ENDS = async () => false;
const ORPHANS_ENDED: HeldScratch = {
  orphans: [],
  holds: endsAfter(1),
  removed: true,
};

describe("removing a scratch folder that Windows holds", () => {
  it("D2570: waits for the processes a run started for at most ten seconds", async () => {
    const bounds: number[] = [];
    await withHeldScratch(
      {
        ...ORPHANS_ENDED,
        holds: async (ready, boundMs) => {
          bounds.push(boundMs);
          return ready();
        },
      },
      async () => undefined,
    );
    expect(bounds).toEqual([ORPHAN_WAIT_MS]);
  });

  it("D2571: fails naming the folder, the runs and each process of theirs still running once the wait is over", async () => {
    const { dir, thrown } = await withHeldScratch(
      { orphans: [ORPHAN], holds: NEVER_ENDS, removed: true },
      async () => undefined,
    );
    const named = [dir, ...VITEST_RUNS, ORPHAN.pid, ORPHAN.commandLine].map(
      (text) => thrown?.includes(String(text)),
    );
    expect(named).toEqual([true, true, true, true, true]);
  });

  it("D2572: asks once which processes the runs started, however often it checks that they ended", async () => {
    const { queries } = await withHeldScratch(
      { ...ORPHANS_ENDED, holds: endsAfter(3) },
      async () => undefined,
    );
    expect(queries).toBe(1);
  });

  it("D2573: removes the folder through removeDirectory once the processes ended", async () => {
    const { dir, removals } = await withHeldScratch(
      ORPHANS_ENDED,
      async () => undefined,
    );
    expect(removals).toEqual([dir]);
  });

  it("D2574: fails with the test body's own error when the folder stays held behind it", async () => {
    let thrown: string | undefined;
    await loggedErrors(async () => {
      ({ thrown } = await withHeldScratch(
        { orphans: [ORPHAN], holds: NEVER_ENDS, removed: true },
        async () => {
          throw new Error("the test body failed");
        },
      ));
    });
    expect(thrown).toBe("the test body failed");
  });

  it("D2575: logs the cleanup failure behind the test body's own error", async () => {
    let dir = "";
    const logged = await loggedErrors(async () => {
      ({ dir } = await withHeldScratch(
        { orphans: [ORPHAN], holds: NEVER_ENDS, removed: true },
        async () => {
          throw new Error("the test body failed");
        },
      ));
    });
    expect(logged).toEqual([expect.stringContaining(dir)]);
  });
});

describe("the leftover sweep", () => {
  it("D1153: logs nothing for a leftover another run is still removing", async () => {
    const lines = await withScratch((parent) => {
      const found: string[] = [];
      mkdirSync(join(parent, LEFTOVER));
      const isLeftover = (path: string) =>
        basename(path) === LEFTOVER && existsSync(path);
      return whileRemovalFails(isLeftover, codedError("ENOENT"), async () => {
        openRun(
          parent,
          (line) => found.push(line),
          () => false,
        );
        return found;
      });
    });
    expect(lines).toEqual([]);
  });
});
