import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Git } from "../../../scripts/lib/git.mjs";
import {
  defaultJobs,
  parseOptions,
  runVerification,
} from "../../../scripts/lib/defects/verify.mjs";
import {
  CALC_TEST,
  catalogOf,
  fakeVitest,
  LINK,
  linkIn,
  LINKED,
  LINKED_TREE,
  OTHER,
  OTHER_TEST,
  TREE,
  withScratch,
  writeRoot,
  type Tree,
} from "./harness.js";

const quiet = () => {};

const CALC_RECORDS = "test/calc/defects.json";
const WHOLE_SUITE = "the whole suite";

const headCalcRecords = () =>
  catalogOf()
    .defects.filter((defect) => defect.test === CALC_TEST)
    .map(({ source: _source, test: _test, ...record }) => record);

function headWithChangedD1(): Git {
  const head = headCalcRecords().map((record) =>
    record.id === "D1" ? { ...record, defect: "an older wording" } : record,
  );
  const answers: Record<string, string> = {
    diff: "test/calc/defects.json\0",
    "ls-files": "",
    show: JSON.stringify(head),
  };
  return (args) => ({ ok: true, out: answers[args[0]!] ?? "" });
}

const TEMP_VARIABLES = ["TEMP", "TMP", "TMPDIR"] as const;

async function withTemp<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const saved = TEMP_VARIABLES.map((name) => ({
    name,
    value: process.env[name],
  }));
  for (const name of TEMP_VARIABLES) process.env[name] = dir;
  try {
    return await run();
  } finally {
    for (const { name, value } of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const outcomeOf = (run: Promise<number>) =>
  run.then(
    (code) => `exited ${code}`,
    (error: Error) => error.message,
  );

function verifyWithTemp(root: string, temp: string): Promise<string> {
  writeRoot(root);
  mkdirSync(temp, { recursive: true });
  return withTemp(temp, () =>
    outcomeOf(
      runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf()),
        cores: 2,
      }),
    ),
  );
}

const brokenGit: Git = () => ({ ok: false, out: "fatal: broken repository" });

function gitChanging(paths: readonly string[], calls: string[]): Git {
  const answers: Record<string, string> = {
    diff: paths.map((path) => `${path}\0`).join(""),
    "ls-files": "",
    show: JSON.stringify(headCalcRecords()),
  };
  return (args) => {
    calls.push(args[0]!);
    return { ok: true, out: answers[args[0]!] ?? "" };
  };
}

const refusalOf = (argv: readonly string[], git: Git) =>
  withScratch(async (root) => {
    writeRoot(root);
    return outcomeOf(
      runVerification({
        root,
        argv,
        git,
        log: quiet,
        runTests: fakeVitest(catalogOf()),
        cores: 2,
      }),
    );
  });

interface SelectionRun {
  readonly logs: readonly string[];
  readonly verified: readonly string[];
  readonly baselineFiles: readonly string[];
}

async function selectionRun(
  argv: readonly string[],
  git: Git,
  tree: Tree = TREE,
): Promise<SelectionRun> {
  const logs: string[] = [];
  const verified = new Set<string>();
  const baselineFiles = new Set<string>();
  await withScratch(async (root) => {
    writeRoot(root, tree);
    return runVerification({
      root,
      argv,
      git,
      cores: 2,
      log: (line) => logs.push(line),
      runTests: fakeVitest(catalogOf(tree), {
        before: (request) => {
          if (request.pattern) verified.add(request.pattern);
          else {
            for (const file of request.files ?? [WHOLE_SUITE]) {
              baselineFiles.add(file);
            }
          }
        },
      }),
    });
  });
  return {
    logs,
    verified: [...verified].sort(),
    baselineFiles: [...baselineFiles].sort(),
  };
}

describe("the --ids selector", () => {
  it("D2611: verifies only the records --ids names, not the others in their test file", async () => {
    const run = await selectionRun(["--ids", "D1"], brokenGit);
    expect(run.verified).toEqual(["D1"]);
  });

  it("D2612: reads every --ids occurrence, not only the first", () => {
    expect(parseOptions(["--ids", "D1", "--ids", "D3"], 4).ids).toEqual([
      "D1",
      "D3",
    ]);
  });

  it("D2613: collapses an id named twice into one", () => {
    expect(parseOptions(["--ids", "D1,D1", "--ids", "D1"], 4).ids).toEqual([
      "D1",
    ]);
  });

  it("D2614: splits a comma-separated --ids list", () => {
    expect(parseOptions(["--ids", "D1,D2,D3"], 4).ids).toEqual([
      "D1",
      "D2",
      "D3",
    ]);
  });

  it("D2615: splits a quoted space-separated --ids list", () => {
    expect(parseOptions(["--ids", "D1 D2  D3"], 4).ids).toEqual([
      "D1",
      "D2",
      "D3",
    ]);
  });

  it("D2616: names every id no defects.json records when it refuses --ids", async () => {
    const outcome = await refusalOf(["--ids", "D1,D404,D405"], brokenGit);
    expect(outcome).toMatch(/D404.*D405/);
  });

  it("D2617: refuses an empty --ids occurrence beside a valid one", () => {
    expect(() => parseOptions(["--ids", "D1", "--ids", ""], 4)).toThrow(
      /names no defect/,
    );
  });

  it("D2618: refuses a stray positional argument, naming it and the comma form", () => {
    expect(() => parseOptions(["--ids", "D1", "D2"], 4)).toThrow(
      /D2 is not an option.*D\d+,D\d+/,
    );
  });

  it("D2641: tells a positional given without --ids to name defects with --ids", () => {
    expect(() => parseOptions(["D12"], 4)).toThrow(/name defects with --ids/);
  });

  it("D2619: refuses an unknown id before it asks git for the changeset", async () => {
    const calls: string[] = [];
    await refusalOf(["--ids", "D404", "--changed"], gitChanging([], calls));
    expect(calls).toEqual([]);
  });
});

describe("selectors combined and reported", () => {
  it("D2620: selects the union of --ids and --changed", async () => {
    const run = await selectionRun(
      ["--ids", "D3", "--changed"],
      gitChanging([CALC_TEST], []),
    );
    expect(run.verified).toEqual(["D1", "D2", "D3"]);
  });

  it("D2621: selects the union of --ids and --edited", async () => {
    const run = await selectionRun(
      ["--ids", "D3", "--edited"],
      gitChanging([CALC_TEST], []),
    );
    expect(run.verified).toEqual(["D1", "D2", "D3"]);
  });

  it("D2622: logs a record chosen by two selectors once, with both reasons", async () => {
    const run = await selectionRun(
      ["--ids", "D1", "--edited"],
      gitChanging([CALC_TEST], []),
    );
    const lines = run.logs.filter((line) => line.startsWith("  D1:"));
    expect(
      lines.map(
        (line) => line.includes("--ids") && line.includes("test file changed"),
      ),
    ).toEqual([true]);
  });

  it("D2623: reports how many of the catalog's defects the selectors chose", async () => {
    const run = await selectionRun(["--ids", "D1"], brokenGit);
    const opening = "--ids selected 1 of 3 defects";
    expect(
      run.logs
        .filter((line) => line.startsWith("--ids selected"))
        .map((line) => line.slice(0, opening.length)),
    ).toEqual([opening]);
  });

  it("D2624: baselines only the test files of the selected records", async () => {
    const run = await selectionRun(["--ids", "D3"], brokenGit);
    expect(run.baselineFiles).toEqual([OTHER_TEST]);
  });

  it("D2625: calls a filtered run's defects selected in its summary", async () => {
    const run = await selectionRun(["--ids", "D1"], brokenGit);
    expect(
      run.logs.find((line) => line.includes("defects detected in")),
    ).toMatch(/^1\/1 selected defects detected/);
  });

  it("D2626: ends a filtered run by saying it is not the full run", async () => {
    const run = await selectionRun(["--ids", "D1"], brokenGit);
    expect(run.logs.at(-1)).toBe(
      "Selected by --ids: 1 of 3 defects; this is not the full run.",
    );
  });

  it("D2627: ends a full run with the bootstrap summary, not the not-the-full-run line", async () => {
    const run = await selectionRun([], brokenGit);
    expect(run.logs.at(-1)).toMatch(/^3\/3 bootstrap defects detected/);
  });

  it("D2628: names both git-backed selectors when git cannot list changes", async () => {
    const outcome = await refusalOf(["--changed", "--edited"], brokenGit);
    expect(outcome).toMatch(/^--changed with --edited needs git/);
  });

  it("D2629: names --edited when it alone needs git and git cannot list changes", async () => {
    const outcome = await refusalOf(["--edited"], brokenGit);
    expect(outcome).toMatch(/^--edited needs git/);
  });

  it("D2630: reads the records at HEAD once for both selectors", async () => {
    const calls: string[] = [];
    await selectionRun(
      ["--changed", "--edited"],
      gitChanging([CALC_RECORDS], calls),
    );
    expect(calls.filter((call) => call === "show")).toHaveLength(1);
  });

  it("D2638: ends a filtered run that selects no defect by saying it is not the full run", async () => {
    const run = await selectionRun(
      ["--edited"],
      gitChanging(["test/fixtures/calc/data.txt"], []),
    );
    expect(run.logs.at(-1)).toBe(
      "Selected by --edited: 0 of 3 defects; this is not the full run.",
    );
  });

  it("D2639: keeps --edited alone from widening for a changed file no import reaches", async () => {
    const run = await selectionRun(
      ["--edited"],
      gitChanging(["test/fixtures/calc/data.txt"], []),
    );
    expect(run.verified).toEqual([]);
  });

  it("D2640: ends a filtered run whose mutation survives by saying it is not the full run", async () => {
    const records = JSON.parse(TREE[CALC_RECORDS]!);
    const surviving: Tree = {
      ...TREE,
      [CALC_RECORDS]: JSON.stringify([
        { ...records[0], new: records[0].old },
        records[1],
      ]),
    };
    const run = await selectionRun(["--ids", "D1"], brokenGit, surviving);
    expect(run.logs.at(-1)).toBe(
      "Selected by --ids: 1 of 3 defects; this is not the full run.",
    );
  });
});

describe("the verification entry point", () => {
  it("D929: refuses a job count of zero", () => {
    expect(() => parseOptions(["--jobs", "0"], 16)).toThrow(/at least 1/);
  });

  it("D979: refuses a job count not written in decimal digits", () => {
    expect(() => parseOptions(["--jobs", "0x4"], 16)).toThrow(/whole number/);
  });

  it("D930: bounds the default job count by the cores", () => {
    expect(parseOptions([], 16).jobs).toBeLessThanOrEqual(16);
  });

  it("D931: defaults to one sandbox on a single core", () => {
    expect(defaultJobs(1)).toBe(1);
  });

  it("D932: gives a --changed baseline every named test in the files it runs", async () => {
    const code = await withScratch(async (root) => {
      writeRoot(root);
      return runVerification({
        root,
        argv: ["--changed"],
        log: quiet,
        runTests: fakeVitest(catalogOf()),
        git: headWithChangedD1(),
        cores: 2,
      });
    });
    expect(code).toBe(0);
  });

  it("D933: fails when a working file changes during verification", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root);
      const editing = fakeVitest(catalogOf(), {
        before: () => writeFileSync(join(root, OTHER), "edited\n"),
      });
      return runVerification({ root, log: quiet, runTests: editing }).then(
        () => "passed",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toMatch(/Working files changed/);
  });

  it("D934: exits nonzero when a mutation survives", async () => {
    const records = JSON.parse(TREE["test/other/defects.json"]!);
    const tree: Tree = {
      ...TREE,
      "test/other/defects.json": JSON.stringify([
        { ...records[0], new: records[0].old },
      ]),
    };
    const code = await withScratch(async (root) => {
      writeRoot(root, tree);
      return runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf(tree)),
        cores: 2,
      });
    });
    expect(code).toBe(1);
  });

  it("D935: fails a full run over a passing test file with no named test", async () => {
    const plain = "test/plain/plain.test.ts";
    const tree: Tree = { ...TREE, [plain]: "it(`plain probe`, () => {});\n" };
    const code = await withScratch(async (root) => {
      writeRoot(root, tree);
      return runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf(tree), { plain: [plain] }),
        cores: 2,
      });
    });
    expect(code).toBe(1);
  });

  it("D936: fails when no named defect exists", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, {});
      return runVerification({
        root,
        log: quiet,
        runTests: fakeVitest(catalogOf({})),
      }).then(
        () => "passed",
        (error: Error) => error.message,
      );
    });
    expect(outcome).toMatch(/No named defect/);
  });

  it("D994: carries the working tree's workspace links into the sandboxes", async () => {
    const linked = new Set<boolean>();
    await withScratch(async (root) => {
      writeRoot(root, LINKED_TREE);
      linkIn(root, LINK, LINKED);
      const probing = fakeVitest(catalogOf(LINKED_TREE), {
        before: ({ sandbox }) =>
          linked.add(existsSync(join(sandbox, LINK, "src/index.ts"))),
      });
      return runVerification({ root, log: quiet, runTests: probing, cores: 2 });
    });
    expect([...linked]).toEqual([true]);
  });

  it("D1112: refuses a temp directory inside the repository", async () => {
    const outcome = await withScratch((root) =>
      verifyWithTemp(root, join(root, "tmp")),
    );
    expect(outcome).toMatch(/temp directory .* lies inside/);
  });

  it("D1113: refuses a temp directory that is the repository itself", async () => {
    const outcome = await withScratch((root) => verifyWithTemp(root, root));
    expect(outcome).toMatch(/temp directory .* lies inside/);
  });

  it("D1129: fails when a dependency link appears during verification", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, { ...TREE, "node_modules/dep/index.js": "" });
      const installing = fakeVitest(catalogOf(), {
        before: () =>
          mkdirSync(join(root, "node_modules/late"), { recursive: true }),
      });
      return outcomeOf(
        runVerification({ root, log: quiet, runTests: installing, cores: 2 }),
      );
    });
    expect(outcome).toMatch(/Dependency links changed.*node_modules\/late/);
  });

  it("D1150: fails when a dependency link disappears during verification", async () => {
    const outcome = await withScratch(async (root) => {
      writeRoot(root, { ...TREE, "node_modules/dep/index.js": "" });
      const uninstalling = fakeVitest(catalogOf(), {
        before: () =>
          rmSync(join(root, "node_modules/dep"), {
            recursive: true,
            force: true,
          }),
      });
      return outcomeOf(
        runVerification({ root, log: quiet, runTests: uninstalling, cores: 2 }),
      );
    });
    expect(outcome).toMatch(/Dependency links changed.*node_modules\/dep/);
  });

  it("D1151: refuses a temp directory below a node_modules directory", async () => {
    const outcome = await withScratch(async (scratch) => {
      mkdirSync(join(scratch, "outer/node_modules"), { recursive: true });
      return verifyWithTemp(join(scratch, "repo"), join(scratch, "outer/tmp"));
    });
    expect(outcome).toMatch(/outer[\\/]node_modules would answer any import/);
  });
});
