import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildCatalog,
  SANDBOX_DIRS,
  SANDBOX_FILES,
  type Catalog,
} from "../../../scripts/lib/defects/catalog.mjs";
import {
  verifyInSandboxes,
  writeTree,
  type PoolResult,
} from "../../../scripts/lib/defects/pool.mjs";
import type {
  RunRequest,
  RunResult,
  RunTests,
} from "../../../scripts/lib/defects/vitest.mjs";

export type Tree = Readonly<Record<string, string>>;

const record = (
  id: string,
  file: string,
  old: string,
  replacement: string,
) => ({
  id,
  defect: `${id} defect`,
  file,
  old,
  new: replacement,
});

export const CALC = "scripts/calc.mjs";
export const CALC_TEST = "test/calc/calc.test.ts";
export const OTHER = "scripts/other.mjs";
export const OTHER_TEST = "test/other/other.test.ts";

export const TREE: Tree = {
  [CALC]: "export const one = 1;\nexport const two = 2;\n",
  [OTHER]: "export const three = 3;\n",
  [CALC_TEST]: 'it("D1: one", () => {});\nit("D2: two", () => {});\n',
  [OTHER_TEST]: 'it("D3: three", () => {});\n',
  "test/calc/defects.json": JSON.stringify([
    record("D1", CALC, "one = 1", "one = 0"),
    record("D2", CALC, "two = 2", "two = 0"),
  ]),
  "test/other/defects.json": JSON.stringify([
    record("D3", OTHER, "three = 3", "three = 0"),
  ]),
};

export const filesOf = (tree: Tree): Map<string, Buffer> =>
  new Map(
    Object.entries(tree).map(([path, text]) => [path, Buffer.from(text)]),
  );

export const catalogOf = (tree: Tree = TREE): Catalog =>
  buildCatalog(filesOf(tree));

export interface FakeHooks {
  readonly wait?: (request: RunRequest) => number | Promise<void>;
  readonly before?: (request: RunRequest) => void;
  readonly fails?: (id: string, request: RunRequest) => boolean;
  readonly plain?: readonly string[];
}

const plainResults = (request: RunRequest, hooks: FakeHooks) =>
  (hooks.plain ?? [])
    .filter((file) => !request.files || request.files.includes(file))
    .map((file) => ({
      name: join(request.sandbox, file),
      assertionResults: [
        {
          title: "plain probe",
          status: request.pattern ? "skipped" : "passed",
          failureMessages: [],
        },
      ],
    }));

function outcome(
  catalog: Catalog,
  id: string,
  request: RunRequest,
  hooks: FakeHooks,
): string {
  if (request.pattern && request.pattern !== id) return "skipped";
  const defect = catalog.defects.find((each) => each.id === id)!;
  const source = readFileSync(join(request.sandbox, defect.file), "utf8");
  const broken = hooks.fails?.(id, request) ?? false;
  return source.includes(defect.old) && !broken ? "passed" : "failed";
}

export function fakeVitest(catalog: Catalog, hooks: FakeHooks = {}): RunTests {
  return async (request): Promise<RunResult> => {
    hooks.before?.(request);
    const pause = hooks.wait?.(request) ?? 5;
    await (typeof pause === "number" ? delay(pause) : pause);
    const chosen = catalog.defects.filter(
      (defect) => !request.files || request.files.includes(defect.test),
    );
    const files = [...new Set(chosen.map((defect) => defect.test))];
    const named = files.map((file) => ({
      name: join(request.sandbox, file),
      assertionResults: chosen
        .filter((defect) => defect.test === file)
        .map((defect) => {
          const status = outcome(catalog, defect.id, request, hooks);
          return {
            title: `${defect.id}: behaves`,
            status,
            failureMessages:
              status === "failed" ? ["AssertionError: expected 0 to be 1"] : [],
          };
        }),
    }));
    const testResults = [...named, ...plainResults(request, hooks)];
    const tests = testResults.flatMap((file) => file.assertionResults);
    const count = (status: string) =>
      tests.filter((test) => test.status === status).length;
    return {
      status: count("failed") ? 1 : 0,
      report: {
        numPassedTests: count("passed"),
        numFailedTests: count("failed"),
        testResults,
      },
    };
  };
}

export async function withScratch<T>(
  run: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "rt-test-defects-"));
  try {
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function inSandboxes(
  scratch: string,
  runTests: RunTests,
  jobs: number,
  catalog: Catalog = catalogOf(),
): Promise<PoolResult> {
  return verifyInSandboxes({
    files: catalog.files,
    baseline: catalog.defects,
    selected: catalog.defects,
    jobs,
    runTests,
    scratch,
    log: () => {},
  });
}

export function writeRoot(root: string, tree: Tree = TREE): void {
  for (const dir of SANDBOX_DIRS)
    mkdirSync(join(root, dir), { recursive: true });
  const files = filesOf(tree);
  for (const file of SANDBOX_FILES) {
    if (!files.has(file)) files.set(file, Buffer.from("{}\n"));
  }
  writeTree(root, files);
}
