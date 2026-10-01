import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IgnoredListing } from "../../src/selection/git-ignored.js";

/** Each absolute path whose `opendir` or `readFile` fails with its code, and a listing answered in place of git's. */
const scripted = vi.hoisted(() => ({
  failing: new Map<string, string>(),
  listing: undefined as IgnoredListing | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const path = await import("node:path");
  const failure = (target: unknown): Error | undefined => {
    const code = scripted.failing.get(path.resolve(String(target)));
    return code === undefined
      ? undefined
      : Object.assign(new Error(`${code}: refused by the test`), { code });
  };
  return {
    ...actual,
    opendir: ((target, options) => {
      const error = failure(target);
      return error === undefined
        ? actual.opendir(target, options)
        : Promise.reject(error);
    }) as typeof actual.opendir,
    readFile: ((target, options) => {
      const error = failure(target);
      return error === undefined
        ? actual.readFile(target, options)
        : Promise.reject(error);
    }) as typeof actual.readFile,
  };
});

vi.mock("../../src/selection/git-ignored.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/selection/git-ignored.js")>();
  return {
    ...actual,
    readIgnoredPaths: (repository: string, signal: AbortSignal) =>
      scripted.listing === undefined
        ? actual.readIgnoredPaths(repository, signal)
        : Promise.resolve(scripted.listing),
  };
});

import {
  readDefinitionFiles,
  type DefinitionFiles,
} from "../../src/defects/definition-files.js";
import {
  checkDefinitions,
  type CheckedDefinition,
} from "../../src/defects/definitions.js";
import {
  resolveDefinitions,
  type ResolvedDefinition,
} from "../../src/defects/resolve-definitions.js";
import type {
  DiscoveredTest,
  TestDiscovery,
} from "../../src/vitest/discover-tests.js";
import { DAEMON_TEST_TIMEOUT_MS } from "../daemon-harness.js";
import { fixtureRepository, HAND_BUILT_ROOT, inTempDir } from "../harness.js";

/** Files by their path relative to a root, `/`-separated, with their text. */
type Tree = Readonly<Record<string, string>>;

const CONSUMER = "consumer";
const OUTSIDE = "elsewhere";
const STATE_DIRECTORY = ".rt-test";
const SETTINGS = "rt-test.json";
const DEFINITION_FILE = "defects/a.defects.json";
const TEST_MODULE = "src/a.test.ts";
const SOURCE = "src/a.ts";
const SOURCE_TEXT = "export function a() {\n  return 1;\n}\n";
const NOT_JSON = '{"secret": nope}';

/** Writes each file of `tree` under `root`, creating `root` and every directory on the way. */
function writeTree(root: string, tree: Tree): void {
  mkdirSync(root, { recursive: true });
  for (const [file, text] of Object.entries(tree)) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}

/** Links `link`, a path under `dir`, to the directory `target` under `dir`: a junction on Windows, a symbolic link elsewhere. */
function linkDirectory(dir: string, link: string, target: string): void {
  const targetPath = join(dir, target);
  mkdirSync(targetPath, { recursive: true });
  mkdirSync(dirname(join(dir, link)), { recursive: true });
  symlinkSync(targetPath, join(dir, link), "junction");
}

function settings(patterns: unknown): string {
  return JSON.stringify({ defects: patterns });
}

/** A well-formed definition naming the test `t` in `TEST_MODULE`, whose mutation replaces `return 1;` in `SOURCE`. */
function definition(
  id: unknown,
  parts: { test?: object; mutation?: object } = {},
): Record<string, unknown> {
  return {
    id,
    defect: "a returns 2",
    required: "a returns 1",
    test: { module: TEST_MODULE, name: ["t"], ...parts.test },
    mutation: {
      file: SOURCE,
      old: "return 1;",
      new: "return 2;",
      ...parts.mutation,
    },
  };
}

function definitionFile(...definitions: readonly unknown[]): string {
  return JSON.stringify({ defects: definitions });
}

/** Writes `tree` under a consumer root in `dir`, then reads its definition files as the daemon does. */
function definitionFilesIn(dir: string, tree: Tree): Promise<DefinitionFiles> {
  const root = join(dir, CONSUMER);
  writeTree(root, tree);
  return readDefinitionFiles(
    root,
    join(root, STATE_DIRECTORY),
    new AbortController().signal,
  );
}

/** Each definition read by its file and position, and each invalid entry by its kind and path. */
function outline(read: DefinitionFiles): {
  definitions: string[];
  entries: string[];
} {
  return {
    definitions: read.definitions.map(
      ({ file, position }) => `${file}#${position}`,
    ),
    entries: read.invalidEntries.map(({ kind, path }) => `${kind} ${path}`),
  };
}

/** Runs `body` while `opendir` and `readFile` of each of `paths` fail with `code`. */
async function withFailing<T>(
  paths: readonly string[],
  code: string,
  body: () => Promise<T>,
): Promise<T> {
  for (const path of paths) scripted.failing.set(resolve(path), code);
  try {
    return await body();
  } finally {
    scripted.failing.clear();
  }
}

/** A path of `depth` directories named `d`, one inside the next. */
function nested(depth: number): string {
  return Array.from({ length: depth }, () => "d").join("/");
}

describe(
  "the definition files rt-test.json names",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D3654: with no rt-test.json, or one with no defects member, there are no definitions and no invalid entry", async () => {
      const reads = await inTempDir(async (dir) => [
        outline(
          await definitionFilesIn(join(dir, "a"), {
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
        outline(
          await definitionFilesIn(join(dir, "b"), {
            [SETTINGS]: JSON.stringify({ nonInputs: ["docs/**"] }),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      ]);
      expect(reads).toStrictEqual([
        { definitions: [], entries: [] },
        { definitions: [], entries: [] },
      ]);
    });

    it("D3655: an rt-test.json that is not JSON is one invalid entry naming it, and no definition is read", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: '{ "defects": [',
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: [],
        entries: ["settings-unusable rt-test.json"],
      });
    });

    it("D3656: a defects pattern the non-inputs grammar refuses is one invalid entry naming the pattern, never a pattern matching nothing", async () => {
      const read = await inTempDir((dir) =>
        definitionFilesIn(dir, {
          [SETTINGS]: settings(["/defects/*.defects.json"]),
          [DEFINITION_FILE]: definitionFile(definition("D1")),
        }),
      );
      expect(
        read.invalidEntries.map(({ kind, path, reason }) => ({
          kind,
          path,
          namesPattern: reason.includes('"/defects/*.defects.json"'),
        })),
      ).toStrictEqual([
        { kind: "settings-unusable", path: "rt-test.json", namesPattern: true },
      ]);
    });

    it("D3657: a file two patterns match is read once", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["defects/*.json", "**/a.defects.json"]),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: [`${DEFINITION_FILE}#0`],
        entries: [],
      });
    });

    it("D3658: a matched file that is not JSON is one invalid entry, and the other matched files' definitions are still read", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["defects/*.json"]),
            "defects/a.json": NOT_JSON,
            "defects/b.json": definitionFile(
              definition("D1"),
              definition("D2"),
            ),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: ["defects/b.json#0", "defects/b.json#1"],
        entries: ["not-json defects/a.json"],
      });
    });

    it("D3659: a parse failure's reason quotes no text of the file, whatever the parser's message quotes", async () => {
      const read = await inTempDir((dir) =>
        definitionFilesIn(dir, {
          [SETTINGS]: settings(["defects/*.json"]),
          "defects/a.json": NOT_JSON,
        }),
      );
      expect(read.invalidEntries[0]?.reason).toMatch(
        /^it is not valid JSON(?: at position \d+(?: \(line \d+, column \d+\))?)?$/,
      );
    });

    it("D3660: a parse failure's reason gives the position the parser gives", async () => {
      const read = await inTempDir((dir) =>
        definitionFilesIn(dir, {
          [SETTINGS]: settings(["defects/*.json"]),
          "defects/a.json": '{"a": 1,}',
        }),
      );
      expect(read.invalidEntries[0]?.reason).toMatch(
        /^it is not valid JSON at position 8(?: \(line 1, column 9\))?$/,
      );
    });

    it("D3661: a matched file holding no defects array at its top level is one invalid entry naming it", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["defects/*.json"]),
            "defects/a.json": JSON.stringify({ defect: [definition("D1")] }),
            "defects/b.json": JSON.stringify([definition("D2")]),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: [],
        entries: [
          "no-defects-array defects/a.json",
          "no-defects-array defects/b.json",
        ],
      });
    });

    it("D3662: a link a pattern matches is one invalid entry naming it, and is never followed", async () => {
      const read = await inTempDir(async (dir) => {
        linkDirectory(dir, `${CONSUMER}/defects/linked.json`, OUTSIDE);
        writeTree(join(dir, OUTSIDE), {
          "a.json": definitionFile(definition("D1")),
        });
        return outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["defects/*.json"]),
          }),
        );
      });
      expect(read).toStrictEqual({
        definitions: [],
        entries: ["not-a-regular-file defects/linked.json"],
      });
    });

    it("D3663: a directory link below which a pattern could match is one invalid entry naming it, and nothing under it is read", async () => {
      const read = await inTempDir(async (dir) => {
        linkDirectory(dir, `${CONSUMER}/defects/shared`, OUTSIDE);
        writeTree(join(dir, OUTSIDE), {
          "a.defects.json": definitionFile(definition("D1")),
        });
        return outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["defects/**/*.defects.json"]),
          }),
        );
      });
      expect(read).toStrictEqual({
        definitions: [],
        entries: ["directory-link defects/shared"],
      });
    });

    it("D3664: a directory link under node_modules is never an invalid entry, as the other walks never enter node_modules", async () => {
      const read = await inTempDir(async (dir) => {
        linkDirectory(dir, `${CONSUMER}/node_modules/pkg`, OUTSIDE);
        writeTree(join(dir, OUTSIDE), {
          "b.defects.json": definitionFile(definition("D2")),
        });
        return outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["**/*.defects.json"]),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        );
      });
      expect(read).toStrictEqual({
        definitions: [`${DEFINITION_FILE}#0`],
        entries: [],
      });
    });

    it("D3665: a directory the walk would enter but cannot list is one invalid entry naming it", async () => {
      const read = await inTempDir((dir) =>
        withFailing(
          [join(dir, CONSUMER, "defects", "locked")],
          "EACCES",
          async () =>
            outline(
              await definitionFilesIn(dir, {
                [SETTINGS]: settings(["defects/**/*.defects.json"]),
                "defects/locked/a.defects.json": definitionFile(
                  definition("D1"),
                ),
                "defects/b.defects.json": definitionFile(definition("D2")),
              }),
            ),
        ),
      );
      expect(read).toStrictEqual({
        definitions: ["defects/b.defects.json#0"],
        entries: ["directory-not-listed defects/locked"],
      });
    });

    it("D3666: a directory more than 40 levels below the root, below which a pattern could match, is one invalid entry naming it", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["**/*.defects.json"]),
            [`${nested(41)}/x.defects.json`]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: [],
        entries: [`depth-bound-passed ${nested(41)}`],
      });
    });

    it("D3667: a matched file that cannot be read is one invalid entry naming it", async () => {
      const read = await inTempDir((dir) =>
        withFailing(
          [join(dir, CONSUMER, "defects", "a.json")],
          "EACCES",
          async () =>
            outline(
              await definitionFilesIn(dir, {
                [SETTINGS]: settings(["defects/*.json"]),
                "defects/a.json": definitionFile(definition("D1")),
                "defects/b.json": definitionFile(definition("D2")),
              }),
            ),
        ),
      );
      expect(read).toStrictEqual({
        definitions: ["defects/b.json#0"],
        entries: ["unreadable defects/a.json"],
      });
    });

    it("D3668: a file in a directory git ignores is neither read nor an invalid entry", async () => {
      const read = await inTempDir(async (dir) => {
        const root = join(dir, CONSUMER);
        writeTree(root, { ".gitignore": "build/\n" });
        fixtureRepository(root);
        return outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["**/*.defects.json"]),
            "build/a.defects.json": NOT_JSON,
            "src/b.defects.json": definitionFile(definition("D1")),
          }),
        );
      });
      expect(read).toStrictEqual({
        definitions: ["src/b.defects.json#0"],
        entries: [],
      });
    });

    it("D3669: an ignored file in a directory git listed as holding only ignored entries, created after that listing, is never read", async () => {
      const read = await inTempDir(async (dir) => {
        const root = join(dir, CONSUMER);
        writeTree(root, { ".gitignore": "defects/late.defects.json\n" });
        fixtureRepository(root);
        scripted.listing = {
          ok: true,
          paths: new Set(),
          unconfirmed: new Set([join(root, "defects")]),
        };
        try {
          return outline(
            await definitionFilesIn(dir, {
              [SETTINGS]: settings(["defects/*.defects.json"]),
              "defects/late.defects.json": NOT_JSON,
              "defects/kept.defects.json": definitionFile(definition("D1")),
            }),
          );
        } finally {
          scripted.listing = undefined;
        }
      });
      expect(read).toStrictEqual({
        definitions: ["defects/kept.defects.json#0"],
        entries: [],
      });
    });
  },
);

/** Checks each of `values` as a definition at its position in `DEFINITION_FILE`. */
function checked(
  values: readonly unknown[],
  root: string = HAND_BUILT_ROOT,
): CheckedDefinition[] {
  return checkDefinitions(
    values.map((value, position) => ({
      file: DEFINITION_FILE,
      position,
      value,
    })),
    root,
  );
}

function problemsOf(...values: readonly unknown[]): (readonly string[])[] {
  return checked(values).map((definition) => definition.problems);
}

describe("checking each definition", () => {
  it("D3670: a definition whose defect or required text is missing or not a string is invalid, naming each", () => {
    const { required: _required, ...withoutRequired } = definition("D1");
    expect(problemsOf({ ...withoutRequired, defect: 7 })).toStrictEqual([
      [
        expect.stringMatching(/\bdefect\b/),
        expect.stringMatching(/\brequired\b/),
      ],
    ]);
  });

  it("D3671: a definition whose id is an empty string has no usable id and is invalid", () => {
    const [only] = checked([definition("")]);
    expect({ id: only?.id, problems: only?.problems }).toStrictEqual({
      id: undefined,
      problems: [expect.stringMatching(/\bid\b/)],
    });
  });

  it("D3672: a mutation whose old text is empty is invalid", () => {
    expect(
      problemsOf(definition("D1", { mutation: { old: "" } })),
    ).toStrictEqual([[expect.stringMatching(/old text is empty/)]]);
  });

  it("D3673: a mutation whose old text equals its new text is invalid, with a reason quoting neither", () => {
    const text = "const secretAnchor = 1;";
    expect(
      problemsOf(definition("D1", { mutation: { old: text, new: text } })),
    ).toStrictEqual([
      [expect.stringMatching(/^(?!.*secretAnchor).*changes nothing/)],
    ]);
  });

  it("D3674: a mutation whose old and new differ only in LF against CRLF is invalid as changing nothing", () => {
    expect(
      problemsOf(
        definition("D1", {
          mutation: { old: "a();\nb();", new: "a();\r\nb();" },
        }),
      ),
    ).toStrictEqual([[expect.stringMatching(/changes nothing/)]]);
  });

  it("D3675: a mutation whose file climbs out of the consumer root by its spelling is invalid", () => {
    const definitions = checked([
      definition("D1", { mutation: { file: "../outside.ts" } }),
      definition("D2", { mutation: { file: "src/../../outside.ts" } }),
    ]);
    expect(
      definitions.map(({ mutationPath, problems }) => ({
        mutationPath,
        problems,
      })),
    ).toStrictEqual([
      {
        mutationPath: undefined,
        problems: [expect.stringMatching(/outside the consumer root/)],
      },
      {
        mutationPath: undefined,
        problems: [expect.stringMatching(/outside the consumer root/)],
      },
    ]);
  });

  it("D3676: a mutation whose file resolves through a link to a path outside the consumer root is invalid", async () => {
    const problems = await inTempDir((dir) => {
      linkDirectory(dir, `${CONSUMER}/linked`, OUTSIDE);
      writeTree(join(dir, OUTSIDE), { "a.ts": SOURCE_TEXT });
      return checked(
        [definition("D1", { mutation: { file: "linked/a.ts" } })],
        join(dir, CONSUMER),
      ).map((definition) => definition.problems);
    });
    expect(problems).toStrictEqual([
      [expect.stringMatching(/outside the consumer root/)],
    ]);
  });

  it("D3677: every definition carrying a repeated id is invalid, each naming the other definitions' files", () => {
    const definitions = checkDefinitions(
      [
        { file: "defects/a.json", position: 0, value: definition("D1") },
        { file: "defects/b.json", position: 0, value: definition("D1") },
        { file: "defects/b.json", position: 1, value: definition("D2") },
      ],
      HAND_BUILT_ROOT,
    );
    expect(definitions.map((definition) => definition.problems)).toStrictEqual([
      [expect.stringMatching(/"D1".*defects\/b\.json/)],
      [expect.stringMatching(/"D1".*defects\/a\.json/)],
      [],
    ]);
  });

  it("D3678: a test module spelled with backslashes or a leading ./ names its root-relative module path", () => {
    const definitions = checked(
      ["src\\a.test.ts", "./src/a.test.ts", "src/./a.test.ts"].map(
        (module, index) => definition(`D${index}`, { test: { module } }),
      ),
    );
    expect(
      definitions.map((definition) => definition.modulePath),
    ).toStrictEqual([TEST_MODULE, TEST_MODULE, TEST_MODULE]);
  });
});

interface Place {
  readonly workspacePath?: string;
  readonly projectName?: string;
  readonly modulePath?: string;
  readonly occurrence?: number;
  readonly isDuplicate?: boolean;
}

function discoveredTest(
  name: readonly string[],
  place: Place = {},
): DiscoveredTest {
  return {
    identity: {
      workspacePath: place.workspacePath ?? ".",
      projectName: place.projectName ?? "unit",
      modulePath: place.modulePath ?? TEST_MODULE,
      namePath: name,
      occurrence: place.occurrence ?? 0,
    },
    isDuplicate: place.isDuplicate ?? false,
    mode: "run",
  };
}

/** A discovery listing `tests`, each in the workspace its identity names. */
function discoveryOf(tests: readonly DiscoveredTest[]): TestDiscovery {
  const paths = [...new Set(tests.map((test) => test.identity.workspacePath))];
  return {
    workspaces: paths.map((path) => ({
      status: "discovered",
      workspace: { path, directory: resolve(sep, CONSUMER, path) },
      vitestVersion: "5.0.1",
      tests: tests.filter((test) => test.identity.workspacePath === path),
      failedModules: [],
      typecheckModules: [],
      unsupportedProjects: [],
      unhandledErrors: [],
      selectionFacts: { reported: true, projects: [] },
    })),
    notRead: [],
  };
}

/** Writes `files` under a consumer root in `dir`, then checks `values` and resolves them against a discovery of `tests`. */
async function resolvedIn(
  dir: string,
  values: readonly unknown[],
  tests: readonly DiscoveredTest[],
  options: { files?: Tree; current?: boolean } = {},
): Promise<ResolvedDefinition[]> {
  const root = join(dir, CONSUMER);
  writeTree(root, options.files ?? { [SOURCE]: SOURCE_TEXT });
  return resolveDefinitions(
    checked(values, root),
    discoveryOf(tests),
    options.current ?? true,
    new AbortController().signal,
  );
}

const TEST_T = discoveredTest(["t"]);

describe("resolving each definition's test and reading its anchor", () => {
  it("D3679: a definition whose test is not discovered is invalid, its reason saying whether the discovery lists that module", async () => {
    const definitions = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [
          definition("D1", { test: { name: ["missing"] } }),
          definition("D2", { test: { module: "src/b.test.ts" } }),
        ],
        [TEST_T],
      ),
    );
    expect(
      definitions.map(({ state, reason }) => ({ state, reason })),
    ).toStrictEqual([
      {
        state: "invalid-definition",
        reason: expect.stringMatching(/the latest discovery lists that module/),
      },
      {
        state: "invalid-definition",
        reason: expect.stringMatching(
          /the latest discovery does not list that module/,
        ),
      },
    ]);
  });

  it("D3680: a not-discovered reason says when the latest discovery is not current, and only then", async () => {
    const reasons = await inTempDir(async (dir) => {
      const missing = [definition("D1", { test: { name: ["missing"] } })];
      const stale = await resolvedIn(join(dir, "a"), missing, [TEST_T], {
        current: false,
      });
      const current = await resolvedIn(join(dir, "b"), missing, [TEST_T]);
      return [stale, current].map(([only]) =>
        /not current/.test(only?.reason ?? ""),
      );
    });
    expect(reasons).toStrictEqual([true, false]);
  });

  it("D3681: a definition naming two same-named tests resolves to neither and is invalid, asking for its occurrence", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1")],
        [
          discoveredTest(["t"], { isDuplicate: true }),
          discoveredTest(["t"], { occurrence: 1, isDuplicate: true }),
        ],
      ),
    );
    expect({
      state: only?.state,
      resolved: only?.resolved,
      reason: only?.reason,
    }).toStrictEqual({
      state: "invalid-definition",
      resolved: undefined,
      reason: expect.stringMatching(/\b2 discovered tests\b.*\boccurrence\b/),
    });
  });

  it("D3682: a definition giving its occurrence resolves to the test at that occurrence", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1", { test: { occurrence: 1 } })],
        [
          discoveredTest(["t"], { isDuplicate: true }),
          discoveredTest(["t"], { occurrence: 1, isDuplicate: true }),
        ],
      ),
    );
    expect({
      state: only?.state,
      occurrence: only?.resolved?.identity.occurrence,
    }).toStrictEqual({ state: "never-verified", occurrence: 1 });
  });

  it("D3683: a definition giving its project resolves to the test in that project, and one leaving it out is ambiguous, asking for it", async () => {
    const definitions = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1", { test: { project: "e2e" } }), definition("D2")],
        [discoveredTest(["t"]), discoveredTest(["t"], { projectName: "e2e" })],
      ),
    );
    expect(
      definitions.map(({ state, resolved, reason }) => ({
        state,
        project: resolved?.identity.projectName,
        reason,
      })),
    ).toStrictEqual([
      { state: "never-verified", project: "e2e", reason: undefined },
      {
        state: "invalid-definition",
        project: undefined,
        reason: expect.stringMatching(/\bgive its project\b/),
      },
    ]);
  });

  it("D3684: a module two Vitest workspaces collect under one project name is ambiguous, the reason saying no field of the format tells them apart", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1", { test: { module: "packages/a/src/a.test.ts" } })],
        [
          discoveredTest(["t"], { modulePath: "packages/a/src/a.test.ts" }),
          discoveredTest(["t"], { workspacePath: "packages/a" }),
        ],
      ),
    );
    expect(only?.reason).toMatch(
      /no field of the definition format tells them apart/,
    );
  });

  it("D3685: a definition invalid for a repeated id still resolves its test", async () => {
    const definitions = await inTempDir((dir) =>
      resolvedIn(dir, [definition("D1"), definition("D1")], [TEST_T]),
    );
    expect(
      definitions.map((definition) => definition.resolved?.identity.namePath),
    ).toStrictEqual([["t"], ["t"]]);
  });

  it("D3686: a definition invalid for a repeated id reads invalid though its test resolves and its anchor matches", async () => {
    const definitions = await inTempDir((dir) =>
      resolvedIn(dir, [definition("D1"), definition("D1")], [TEST_T]),
    );
    expect(definitions.map((definition) => definition.state)).toStrictEqual([
      "invalid-definition",
      "invalid-definition",
    ]);
  });

  it("D3687: a line break in old matches a CRLF line break in the file, so the definition reads never verified", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [
          definition("D1", {
            mutation: { old: "{\n  return 1;", new: "{\n  return 2;" },
          }),
        ],
        [TEST_T],
        {
          files: { [SOURCE]: "export function a() {\r\n  return 1;\r\n}\r\n" },
        },
      ),
    );
    expect(only?.state).toBe("never-verified");
  });

  it("D3688: an old occurring twice reads anchor missing, the reason giving the count and not the text", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(dir, [definition("D1")], [TEST_T], {
        files: {
          [SOURCE]: `${SOURCE_TEXT}export function b() {\n  return 1;\n}\n`,
        },
      }),
    );
    expect({ state: only?.state, reason: only?.reason }).toStrictEqual({
      state: "anchor-missing",
      reason: expect.stringMatching(/^(?!.*return 1;).*\b2 times\b/),
    });
  });

  it("D3689: occurrences of old never overlap, so an old found once reads never verified though overlapping matches would count two", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1", { mutation: { old: "aa", new: "bb" } })],
        [TEST_T],
        { files: { [SOURCE]: "export const s = 'aaa';\n" } },
      ),
    );
    expect(only?.state).toBe("never-verified");
  });

  it("D3690: a mutation file that cannot be read reads anchor missing, the reason giving the read failure", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1", { mutation: { file: "src/gone.ts" } })],
        [TEST_T],
      ),
    );
    expect({ state: only?.state, reason: only?.reason }).toStrictEqual({
      state: "anchor-missing",
      reason: expect.stringMatching(
        /^its mutation's file src\/gone\.ts cannot be read: /,
      ),
    });
  });
});
