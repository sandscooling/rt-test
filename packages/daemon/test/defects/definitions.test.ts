import { mkdirSync, rmdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { IgnoredListing } from "../../src/selection/git-ignored.js";

/** Each absolute path whose `opendir`, `readFile` or `stat` fails with its code, and a listing answered in place of git's. */
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
    stat: ((target, options) => {
      const error = failure(target);
      return error === undefined
        ? actual.stat(target, options)
        : Promise.reject(error);
    }) as typeof actual.stat,
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
  readAnchors,
  resolveDefinitions,
  type ResolvedDefinition,
} from "../../src/defects/resolve-definitions.js";
import type {
  DiscoveredTest,
  TestDiscovery,
} from "../../src/vitest/discover-tests.js";
import { DAEMON_TEST_TIMEOUT_MS } from "../daemon-harness.js";
import {
  fixtureRepository,
  HAND_BUILT_ROOT,
  inTempDir,
  settle,
} from "../harness.js";
import { createHash } from "node:crypto";
import {
  countDefectStandings,
  defectStandings,
  type DefectStanding,
  type StandingFacts,
} from "../../src/defects/defect-standings.js";
import { DEFECT_STATES } from "../../src/defects/defect-states.js";
import { FALSIFIER_VERSION } from "../../src/falsify/experiment-record.js";
import type { ErrorFact } from "../../src/falsify/fact-types.js";
import type { StoredEvidence } from "../../src/store/defect-evidence.js";
import { VITEST_ADAPTER_VERSION } from "../../src/vitest/adapter-version.js";
import {
  detectionFor,
  ranOnce,
  REJECTING_TEST,
  SURVIVING_TEST,
  TYPE_ERROR,
} from "../experiment-facts.js";

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

/** Runs `body` while `opendir`, `readFile` and `stat` of each of `paths` fail with `code`. */
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

    it("D3663: a directory link below which a pattern could match is an invalid entry naming it, nothing under it is read, and its pattern, matching nothing else, is one too", async () => {
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
        entries: [
          "directory-link defects/shared",
          "pattern-matched-nothing rt-test.json",
        ],
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

    it("D3666: a directory more than 40 levels below the root, below which a pattern could match, is an invalid entry naming it, and its pattern, matching nothing else, is one too", async () => {
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
        entries: [
          `depth-bound-passed ${nested(41)}`,
          "pattern-matched-nothing rt-test.json",
        ],
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

    it("D3711: a usable pattern that matches no entry is one invalid entry at rt-test.json naming it, and a pattern that matches a file is none", async () => {
      const read = await inTempDir((dir) =>
        definitionFilesIn(dir, {
          [SETTINGS]: settings(["defect/*.json", "defects/*.json"]),
          "defects/a.json": definitionFile(definition("D1")),
        }),
      );
      expect({
        definitions: outline(read).definitions,
        entries: read.invalidEntries.map(({ kind, path, reason }) => ({
          kind,
          path,
          namesPattern: reason.includes('"defect/*.json"'),
        })),
      }).toStrictEqual({
        definitions: ["defects/a.json#0"],
        entries: [
          {
            kind: "pattern-matched-nothing",
            path: "rt-test.json",
            namesPattern: true,
          },
        ],
      });
    });

    it("D3712: a link below which a pattern could match, whose target cannot be checked, is an invalid entry naming it, while a link to nothing is none", async () => {
      const read = await inTempDir((dir) => {
        linkDirectory(dir, `${CONSUMER}/defects/unchecked`, OUTSIDE);
        linkDirectory(dir, `${CONSUMER}/defects/dangling`, "gone");
        rmdirSync(join(dir, "gone"));
        return withFailing(
          [join(dir, CONSUMER, "defects", "unchecked")],
          "EACCES",
          async () =>
            outline(
              await definitionFilesIn(dir, {
                [SETTINGS]: settings(["defects/**/*.defects.json"]),
                "defects/a.defects.json": definitionFile(definition("D1")),
              }),
            ),
        );
      });
      expect(read).toStrictEqual({
        definitions: ["defects/a.defects.json#0"],
        entries: ["directory-link defects/unchecked"],
      });
    });

    it("D3716: a parse failure's reason gives no position when the only position is in the file text the parser quotes", async () => {
      const read = await inTempDir((dir) =>
        definitionFilesIn(dir, {
          [SETTINGS]: settings(["defects/*.json"]),
          "defects/a.json": "[at position 7]",
        }),
      );
      expect(read.invalidEntries[0]?.reason).toBe("it is not valid JSON");
    });

    it("D3717: a pattern with a wildcard directory segment reads the definition files below the directories it matches", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settings(["packages/*/defects/*.json"]),
            "packages/a/defects/x.json": definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: ["packages/a/defects/x.json#0"],
        entries: [],
      });
    });

    it("D3718: an rt-test.json that is a link is one invalid entry, never read as absent", async () => {
      const read = await inTempDir(async (dir) => {
        linkDirectory(dir, `${CONSUMER}/${SETTINGS}`, OUTSIDE);
        return outline(
          await definitionFilesIn(dir, {
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        );
      });
      expect(read).toStrictEqual({
        definitions: [],
        entries: ["settings-unusable rt-test.json"],
      });
    });

    it("D3719: an rt-test.json that is a directory is one invalid entry, never read as absent", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [`${SETTINGS}/inside.json`]: settings(["defects/*.json"]),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: [],
        entries: ["settings-unusable rt-test.json"],
      });
    });

    it("D3720: an rt-test.json whose top level is not an object is one invalid entry, never read as declaring nothing", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: JSON.stringify(["defects/*.json"]),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        definitions: [],
        entries: ["settings-unusable rt-test.json"],
      });
    });
  },
);

/** An `rt-test.json` declaring `names` as its assertion error names, with a `defects` member only when `patterns` is given. */
function settingsDeclaring(names: unknown, patterns?: unknown): string {
  return JSON.stringify({ defects: patterns, assertionErrors: names });
}

/** The names a read declares, beside its outline. */
function declared(read: DefinitionFiles) {
  return { names: read.assertionErrors, ...outline(read) };
}

/** The names a read declares, beside each invalid entry whole. */
function namesAndEntries(read: DefinitionFiles) {
  return { names: read.assertionErrors, entries: read.invalidEntries };
}

/** The invalid entry a problem in `rt-test.json` makes, its reason matching `reason`. */
function settingsProblem(reason: RegExp) {
  return {
    kind: "settings-unusable",
    path: SETTINGS,
    reason: expect.stringMatching(reason) as unknown,
  };
}

describe(
  "the assertion error names rt-test.json declares",
  { timeout: DAEMON_TEST_TIMEOUT_MS },
  () => {
    it("D4006: the names rt-test.json declares are read beside the definition files its defects member names", async () => {
      const read = await inTempDir(async (dir) =>
        declared(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(
              ["TestingLibraryElementError", "ZodError"],
              ["defects/*.json"],
            ),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: ["TestingLibraryElementError", "ZodError"],
        definitions: [`${DEFINITION_FILE}#0`],
        entries: [],
      });
    });

    it("D4007: the names are read anew each time the definition files are read, so a list that changed or left rt-test.json since the read before is not declared, and a consumer with no rt-test.json declares none", async () => {
      const names = await inTempDir(async (dir) => {
        const reads: (readonly string[])[] = [];
        for (const text of [
          settingsDeclaring(["TestingLibraryElementError"]),
          settingsDeclaring(["ZodError"]),
          JSON.stringify({ nonInputs: ["docs/**"] }),
        ]) {
          const read = await definitionFilesIn(dir, { [SETTINGS]: text });
          reads.push(read.assertionErrors);
        }
        const bare = await definitionFilesIn(join(dir, "bare"), {});
        return [...reads, bare.assertionErrors];
      });
      expect(names).toStrictEqual([
        ["TestingLibraryElementError"],
        ["ZodError"],
        [],
        [],
      ]);
    });

    it("D4008: a list of exactly 256 names declares every one of them", async () => {
      const names = Array.from({ length: 256 }, (_, index) => `Thrown${index}`);
      const read = await inTempDir(async (dir) =>
        namesAndEntries(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(names),
          }),
        ),
      );
      expect(read).toStrictEqual({ names, entries: [] });
    });

    it("D4009: a list of 257 names declares none and is one invalid entry at rt-test.json saying how many it holds past the 256 allowed", async () => {
      const names = Array.from({ length: 257 }, (_, index) => `Thrown${index}`);
      const read = await inTempDir(async (dir) =>
        namesAndEntries(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(names),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: [],
        entries: [
          settingsProblem(
            /^rt-test\.json declares no assertion error names: .*\b257 names\b.*\b256\b/,
          ),
        ],
      });
    });

    it("D4010: an assertionErrors member that is not an array of strings declares no names and is one invalid entry at rt-test.json saying so", async () => {
      const read = await inTempDir(async (dir) =>
        namesAndEntries(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring("TestingLibraryElementError"),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: [],
        entries: [
          settingsProblem(
            /^rt-test\.json declares no assertion error names: .*\bassertionErrors\b.*not an array of strings/,
          ),
        ],
      });
    });

    it("D4011: a list holding an empty name declares no names and is one invalid entry naming the empty name", async () => {
      const read = await inTempDir(async (dir) =>
        namesAndEntries(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(["TestingLibraryElementError", ""]),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: [],
        entries: [
          settingsProblem(
            /^rt-test\.json declares no assertion error names: .*"".*\bempty\b/,
          ),
        ],
      });
    });

    it("D4012: a list holding the name Error declares no names and is one invalid entry saying an error must have a name or a class of its own to be declared", async () => {
      const read = await inTempDir(async (dir) =>
        namesAndEntries(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring([
              "TestingLibraryElementError",
              "Error",
            ]),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: [],
        entries: [
          settingsProblem(
            /^rt-test\.json declares no assertion error names: .*"Error".*an error must have a name or a class of its own to be declared/,
          ),
        ],
      });
    });

    it("D4040: the entry refusing the name Error gives its reason whole, telling the author to throw an error with a name or a class of its own and declare that name, or to fail through expect", async () => {
      const entries = await inTempDir(
        async (dir) =>
          (
            await definitionFilesIn(dir, {
              [SETTINGS]: settingsDeclaring(["Error"]),
            })
          ).invalidEntries,
      );
      expect(entries).toStrictEqual([
        {
          kind: "settings-unusable",
          path: SETTINGS,
          reason:
            'rt-test.json declares no assertion error names: the name "Error" is what every plain thrown error is called, a setup failure among them, and an error must have a name or a class of its own to be declared; throw an error with a name or a class of its own and declare that name, or fail through expect',
        },
      ]);
    });

    it("D4013: a problem in each member is two invalid entries, the defects member's before the names'", async () => {
      const read = await inTempDir(async (dir) =>
        namesAndEntries(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(["Error"], ["/defects/*.json"]),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: [],
        entries: [
          settingsProblem(/^rt-test\.json names no definition files: /),
          settingsProblem(/^rt-test\.json declares no assertion error names: /),
        ],
      });
    });

    it("D4014: a problem in the names leaves every definition file read", async () => {
      const read = await inTempDir(async (dir) =>
        declared(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(["Error"], ["defects/*.json"]),
            "defects/a.json": definitionFile(definition("D1")),
            "defects/b.json": definitionFile(
              definition("D2"),
              definition("D3"),
            ),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: [],
        definitions: [
          "defects/a.json#0",
          "defects/b.json#0",
          "defects/b.json#1",
        ],
        entries: ["settings-unusable rt-test.json"],
      });
    });

    it("D4015: a problem in the names comes before every invalid entry the walk makes", async () => {
      const read = await inTempDir(async (dir) =>
        outline(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(
              ["Error"],
              ["defects/*.json", "gone/*.json"],
            ),
            "defects/a.json": NOT_JSON,
          }),
        ),
      );
      expect(read.entries).toStrictEqual([
        "settings-unusable rt-test.json",
        "pattern-matched-nothing rt-test.json",
        "not-json defects/a.json",
      ]);
    });

    it("D4016: a problem in the defects member leaves the declared names read", async () => {
      const read = await inTempDir(async (dir) =>
        declared(
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(
              ["TestingLibraryElementError"],
              ["/defects/*.json"],
            ),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          }),
        ),
      );
      expect(read).toStrictEqual({
        names: ["TestingLibraryElementError"],
        definitions: [],
        entries: ["settings-unusable rt-test.json"],
      });
    });

    it("D4017: an rt-test.json that cannot be read at all, as not JSON or not an object, is one invalid entry, never one for each member, and declares no names", async () => {
      const reads = await inTempDir(async (dir) => [
        namesAndEntries(
          await definitionFilesIn(join(dir, "a"), {
            [SETTINGS]:
              '{ "assertionErrors": ["TestingLibraryElementError"], "defects": [',
          }),
        ),
        namesAndEntries(
          await definitionFilesIn(join(dir, "b"), {
            [SETTINGS]: JSON.stringify(["TestingLibraryElementError"]),
          }),
        ),
      ]);
      const oneEntry = {
        names: [],
        entries: [
          settingsProblem(/^rt-test\.json names no definition files: /),
        ],
      };
      expect(reads).toStrictEqual([oneEntry, oneEntry]);
    });

    it("D4028: one read of rt-test.json gives the patterns and the names", async () => {
      const reads = await inTempDir(async (dir) => {
        const asked = vi.spyOn(scripted.failing, "get");
        try {
          await definitionFilesIn(dir, {
            [SETTINGS]: settingsDeclaring(
              ["TestingLibraryElementError"],
              ["defects/*.json"],
            ),
            [DEFINITION_FILE]: definitionFile(definition("D1")),
          });
          const settingsPath = resolve(dir, CONSUMER, SETTINGS);
          return asked.mock.calls.filter(([path]) => path === settingsPath)
            .length;
        } finally {
          asked.mockRestore();
        }
      });
      expect(reads).toBe(1);
    });
  },
);

/** Checks each of `values` as a definition at its position in `file`. */
function checked(
  values: readonly unknown[],
  root: string = HAND_BUILT_ROOT,
  file: string = DEFINITION_FILE,
): CheckedDefinition[] {
  return checkDefinitions(
    values.map((value, position) => ({ file, position, value })),
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
        problems: [expect.stringMatching(/lies outside the consumer root/)],
      },
      {
        mutationPath: undefined,
        problems: [expect.stringMatching(/lies outside the consumer root/)],
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

  it("D3715: each mutation file is judged by its own real path, so one reached through a link outside the root is invalid after one inside it", async () => {
    const problems = await inTempDir((dir) => {
      linkDirectory(dir, `${CONSUMER}/linked`, OUTSIDE);
      writeTree(join(dir, OUTSIDE), { "a.ts": SOURCE_TEXT });
      writeTree(join(dir, CONSUMER), { [SOURCE]: SOURCE_TEXT });
      return checked(
        [
          definition("D1"),
          definition("D2", { mutation: { file: "linked/a.ts" } }),
        ],
        join(dir, CONSUMER),
      ).map((definition) => definition.problems);
    });
    expect(problems).toStrictEqual([
      [],
      [expect.stringMatching(/resolves through a link to a path outside/)],
    ]);
  });

  it("D3726: a test whose name is a string, not a list of names, is invalid", () => {
    expect(problemsOf(definition("D1", { test: { name: "t" } }))).toStrictEqual(
      [[expect.stringMatching(/\bname\b/)]],
    );
  });

  it("D3727: a mutation with no new text is reported invalid, naming it, never thrown on", () => {
    const whole = definition("D1");
    const { new: _new, ...withoutNew } = whole["mutation"] as Record<
      string,
      unknown
    >;
    expect(
      settle(() => problemsOf({ ...whole, mutation: withoutNew })),
    ).toStrictEqual([[expect.stringMatching(/\bnew\b/)]]);
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
  options: { files?: Tree; current?: boolean; definitionFile?: string } = {},
): Promise<ResolvedDefinition[]> {
  const root = join(dir, CONSUMER);
  writeTree(root, options.files ?? { [SOURCE]: SOURCE_TEXT });
  const definitions = checked(values, root, options.definitionFile);
  const anchors = await readAnchors(definitions, new AbortController().signal);
  return resolveDefinitions(
    definitions,
    anchors,
    discoveryOf(tests),
    options.current ?? true,
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

  it("D3714: a valid, resolved definition whose anchor was never read reads anchor missing, never as never verified", () => {
    const [only] = resolveDefinitions(
      checked([definition("D1")]),
      new Map(),
      discoveryOf([TEST_T]),
      true,
    );
    expect(only?.state).toBe("anchor-missing");
  });

  it("D3728: an old that no longer occurs in its file reads anchor missing, the reason giving a count of 0", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [definition("D1", { mutation: { old: "return 3;" } })],
        [TEST_T],
      ),
    );
    expect({ state: only?.state, reason: only?.reason }).toStrictEqual({
      state: "anchor-missing",
      reason: expect.stringMatching(/\b0 times\b/),
    });
  });

  it("D3731: a definition whose test is not discovered and whose anchor is also gone reads invalid, never anchor missing", async () => {
    const [only] = await inTempDir((dir) =>
      resolvedIn(
        dir,
        [
          definition("D1", {
            test: { name: ["missing"] },
            mutation: { old: "return 3;" },
          }),
        ],
        [TEST_T],
      ),
    );
    expect(only?.state).toBe("invalid-definition");
  });
});

/** The digest of the workspace's input fingerprint each stored detection below is bound to. */
const BOUND_PRINT = "sha256:2C26B46B68FFC68F";
const OTHER_PRINT = "sha256:9F86D081884C7D65";
const OTHER_VITEST_VERSION = "4.1.11";
const OTHER_ADAPTER_VERSION = VITEST_ADAPTER_VERSION + 1;
const CURRENT_EVIDENCE = { freshness: "current" };

/** Definitions, the tests they resolve against, and what the query's moment holds beside them. */
interface StandingCase {
  /** One definition `D1` of the test `t` when absent. */
  readonly values?: readonly unknown[];
  readonly tests?: readonly DiscoveredTest[];
  readonly files?: Tree;
  /** The definition file the values are read from; `DEFINITION_FILE` when absent. */
  readonly definitionFile?: string;
  /** Replaces members of a moment in which every test holds a current pass and the store holds no evidence. */
  readonly facts?: Partial<StandingFacts>;
}

function stale(...staleCauses: string[]) {
  return { freshness: "stale", staleCauses };
}

/** Resolves a case's definitions over its files under a consumer root in `dir`, and gives each its standing. */
async function standingsIn(
  dir: string,
  given: StandingCase = {},
): Promise<DefectStanding[]> {
  const tests = given.tests ?? [TEST_T];
  const definitions = await resolvedIn(
    dir,
    given.values ?? [definition("D1")],
    tests,
    {
      ...(given.files === undefined ? {} : { files: given.files }),
      ...(given.definitionFile === undefined
        ? {}
        : { definitionFile: given.definitionFile }),
    },
  );
  return defectStandings(definitions, {
    consumerRoot: join(dir, CONSUMER),
    assertionErrors: [],
    evidence: { evidence: [], evidenceRefusals: [] },
    discovery: discoveryOf(tests),
    discoveryCurrent: true,
    currentFingerprint: () => BOUND_PRINT,
    testStandings: tests.map((test) => ({
      test,
      state: "passed",
      freshness: "current",
    })),
    ...given.facts,
  });
}

/** A detection stored for the definition `standing` describes, bound to what `standingsIn` holds unless a case says otherwise. */
function detectionOf(standing: DefectStanding | undefined): StoredEvidence {
  return detectionFor(standing, BOUND_PRINT);
}

/** A detection stored for a case's first definition while nothing it is bound to had changed. */
async function boundDetection(
  dir: string,
  given: StandingCase = {},
): Promise<StoredEvidence> {
  return detectionOf((await standingsIn(dir, given))[0]);
}

function holding(
  ...evidence: StoredEvidence[]
): Pick<StandingFacts, "evidence"> {
  return { evidence: { evidence, evidenceRefusals: [] } };
}

/** What a case's first definition reads of its stored evidence when the store holds `record`. */
async function evidenceOf(
  dir: string,
  record: StoredEvidence,
  given: StandingCase = {},
) {
  const [standing] = await standingsIn(dir, {
    ...given,
    facts: { ...holding(record), ...given.facts },
  });
  return standing?.evidence;
}

/** What a bound detection reads with nothing changed, then what `changed` reads of it, each over a consumer root of its own. */
function besideCurrent(
  changed: (dir: string, record: StoredEvidence) => Promise<unknown>,
  given: StandingCase = {},
): Promise<unknown[]> {
  return inTempDir(async (dir) => {
    const record = await boundDetection(join(dir, "verified"), given);
    return [
      await evidenceOf(join(dir, "unchanged"), record, given),
      await changed(join(dir, "changed"), record),
    ];
  });
}

/** The definition digest of each case's last definition, each case resolved under a consumer root of its own. */
function lastDigests(
  cases: readonly StandingCase[],
): Promise<(string | undefined)[]> {
  return inTempDir((dir) =>
    Promise.all(
      cases.map(async (given, index) => {
        const standings = await standingsIn(join(dir, `case-${index}`), given);
        return standings.at(-1)?.definitionDigest;
      }),
    ),
  );
}

/** Resolves `values` against `discovery` over `SOURCE` under a consumer root in `dir`. */
async function resolvedAgainst(
  dir: string,
  values: readonly unknown[],
  discovery: TestDiscovery,
): Promise<ResolvedDefinition[]> {
  const root = join(dir, CONSUMER);
  writeTree(root, { [SOURCE]: SOURCE_TEXT });
  const definitions = checked(values, root);
  const anchors = await readAnchors(definitions, new AbortController().signal);
  return resolveDefinitions(definitions, anchors, discovery, true);
}

describe("a definition's digest", () => {
  it("D3932: the digest changes with the definition's id, with the test's workspace, project, module, name path or occurrence, and with the mutation's file, old or new", async () => {
    const twins = [
      discoveredTest(["t"], { isDuplicate: true }),
      discoveredTest(["t"], { occurrence: 1, isDuplicate: true }),
    ];
    const [base, ...changed] = await lastDigests([
      {},
      { values: [definition("D2")] },
      {
        tests: [
          discoveredTest(["t"], {
            workspacePath: "src",
            modulePath: "a.test.ts",
          }),
        ],
      },
      { tests: [discoveredTest(["t"], { projectName: "e2e" })] },
      {
        values: [definition("D1", { test: { module: "src/b.test.ts" } })],
        tests: [discoveredTest(["t"], { modulePath: "src/b.test.ts" })],
      },
      {
        values: [definition("D1", { test: { name: ["u"] } })],
        tests: [discoveredTest(["u"])],
      },
      {
        values: [definition("D1", { test: { occurrence: 1 } })],
        tests: twins,
      },
      {
        values: [definition("D1", { mutation: { file: "src/b.ts" } })],
        files: { [SOURCE]: SOURCE_TEXT, "src/b.ts": SOURCE_TEXT },
      },
      { values: [definition("D1", { mutation: { old: "return 1" } })] },
      { values: [definition("D1", { mutation: { new: "return 3;" } })] },
    ]);
    expect(
      changed.map((digest) => typeof digest === "string" && digest !== base),
    ).toStrictEqual([true, true, true, true, true, true, true, true, true]);
  });

  it("D3933: the digest stays the same whatever the definition's position, its defect and required text, and the spelling of its module or its mutation's file", async () => {
    const [base, ...respelled] = await lastDigests([
      {},
      { values: [definition("D0"), definition("D1")] },
      {
        values: [
          {
            ...definition("D1"),
            defect: "a returns 3",
            required: "a returns one",
          },
        ],
      },
      { values: [definition("D1", { test: { module: `./${TEST_MODULE}` } })] },
      { values: [definition("D1", { mutation: { file: `./${SOURCE}` } })] },
      { values: [definition("D1", { mutation: { file: "src/../src/a.ts" } })] },
    ]);
    expect({
      base: typeof base,
      same: respelled.map((digest) => digest === base),
    }).toStrictEqual({ base: "string", same: [true, true, true, true, true] });
  });

  it("D4000: a definition read from another definition file digests as it does from the first", async () => {
    const [first, second] = await lastDigests([
      {},
      { definitionFile: "defects/b.defects.json" },
    ]);
    expect({ first: typeof first, same: second === first }).toStrictEqual({
      first: "string",
      same: true,
    });
  });
});

/** The digests of two definitions under each list of declared names, each list under a consumer root of its own. */
function digestsDeclaring(
  lists: readonly (readonly string[])[],
): Promise<(string | undefined)[][]> {
  return inTempDir((dir) =>
    Promise.all(
      lists.map(async (assertionErrors, index) => {
        const standings = await standingsIn(join(dir, `case-${index}`), {
          values: [definition("D1"), definition("D2")],
          facts: { assertionErrors },
        });
        return standings.map((standing) => standing.definitionDigest);
      }),
    ),
  );
}

describe("a definition's digest under the declared assertion error names", () => {
  it("D4018: a list that gains or loses a name gives every definition another digest", async () => {
    const [base = [], ...changed] = await digestsDeclaring([
      ["TestingLibraryElementError", "ZodError"],
      ["TestingLibraryElementError", "ZodError", "ConvexError"],
      ["TestingLibraryElementError"],
      [],
    ]);
    expect(
      changed.map((digests) =>
        digests.map(
          (digest, index) =>
            typeof digest === "string" && digest !== base[index],
        ),
      ),
    ).toStrictEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it("D4019: the same names in another order give every definition the same digest", async () => {
    const [base = [], reordered = []] = await digestsDeclaring([
      ["TestingLibraryElementError", "ZodError"],
      ["ZodError", "TestingLibraryElementError"],
    ]);
    expect({
      digests: base.map((digest) => typeof digest),
      same: reordered.map((digest, index) => digest === base[index]),
    }).toStrictEqual({ digests: ["string", "string"], same: [true, true] });
  });

  it("D4020: a list with one name repeated gives every definition the same digest", async () => {
    const [base = [], repeated = []] = await digestsDeclaring([
      ["TestingLibraryElementError", "ZodError"],
      ["TestingLibraryElementError", "ZodError", "TestingLibraryElementError"],
    ]);
    expect({
      digests: base.map((digest) => typeof digest),
      same: repeated.map((digest, index) => digest === base[index]),
    }).toStrictEqual({ digests: ["string", "string"], same: [true, true] });
  });
});

describe("whether stored evidence still describes what it was decided from", () => {
  it("D3934: evidence stored for a definition whose mutation has since changed reads stale, naming the definition", async () => {
    const read = await besideCurrent(async (dir, record) => {
      const before = await boundDetection(join(dir, "as-verified"), {
        values: [definition("D1", { mutation: { new: "return 3;" } })],
      });
      return evidenceOf(dir, {
        ...record,
        definitionDigest: before.definitionDigest,
      });
    });
    expect(read).toStrictEqual([CURRENT_EVIDENCE, stale("definition-changed")]);
  });

  it("D3935: evidence whose mutation's file was edited since, its anchor still matching once, reads stale, naming the file", async () => {
    const read = await besideCurrent((dir, record) =>
      evidenceOf(dir, record, {
        files: { [SOURCE]: `${SOURCE_TEXT}// edited since\n` },
      }),
    );
    expect(read).toStrictEqual([
      CURRENT_EVIDENCE,
      stale("mutation-file-changed"),
    ]);
  });

  it("D3936: evidence stored under another Vitest adapter version reads stale, naming it", async () => {
    const read = await besideCurrent((dir, record) =>
      evidenceOf(dir, { ...record, adapterVersion: OTHER_ADAPTER_VERSION }),
    );
    expect(read).toStrictEqual([
      CURRENT_EVIDENCE,
      stale("another-adapter-version"),
    ]);
  });

  it("D3937: evidence stored under another falsifier version reads stale, naming it, with no reason, detail or errors", async () => {
    const read = await besideCurrent((dir, record) => {
      const { judgement: _unread, ...bindings } = record;
      return evidenceOf(dir, {
        ...bindings,
        falsifierVersion: FALSIFIER_VERSION + 1,
      });
    });
    expect(read).toStrictEqual([
      CURRENT_EVIDENCE,
      stale("another-falsifier-version"),
    ]);
  });

  it("D4041: evidence stored under falsifier version 3, under which an error was called by the name Vitest serialized alone, reads stale, naming the falsifier version", async () => {
    const read = await besideCurrent((dir, record) => {
      const { judgement: _unread, ...bindings } = record;
      return evidenceOf(dir, { ...bindings, falsifierVersion: 3 });
    });
    expect(read).toStrictEqual([
      CURRENT_EVIDENCE,
      stale("another-falsifier-version"),
    ]);
  });

  it("D3938: evidence stored under a Vitest version other than the one the latest discovery reports for the test's workspace reads stale, naming it", async () => {
    const read = await besideCurrent((dir, record) =>
      evidenceOf(dir, { ...record, vitestVersion: OTHER_VITEST_VERSION }),
    );
    expect(read).toStrictEqual([
      CURRENT_EVIDENCE,
      stale("another-vitest-version"),
    ]);
  });

  it("D3939: evidence whose workspace's current input fingerprint differs from the one it ran at reads stale, naming the inputs", async () => {
    const read = await besideCurrent((dir, record) =>
      evidenceOf(dir, record, {
        facts: { currentFingerprint: () => OTHER_PRINT },
      }),
    );
    expect(read).toStrictEqual([CURRENT_EVIDENCE, stale("inputs-changed")]);
  });

  it("D3940: stale evidence names every cause that holds, not the first alone", async () => {
    const evidence = await inTempDir(async (dir) => {
      const record = await boundDetection(join(dir, "verified"));
      return evidenceOf(
        join(dir, "changed"),
        {
          ...record,
          adapterVersion: OTHER_ADAPTER_VERSION,
          vitestVersion: OTHER_VITEST_VERSION,
        },
        { facts: { currentFingerprint: () => OTHER_PRINT } },
      );
    });
    expect(
      evidence !== undefined && "staleCauses" in evidence
        ? [...evidence.staleCauses].sort()
        : evidence,
    ).toStrictEqual([
      "another-adapter-version",
      "another-vitest-version",
      "inputs-changed",
    ]);
  });

  it("D3941: while no current fingerprint can be computed, evidence no cause makes stale reads unknown, and evidence under another adapter version still reads stale, naming it", async () => {
    const noPrint: StandingCase = {
      facts: { currentFingerprint: () => undefined },
    };
    const read = await inTempDir(async (dir) => {
      const record = await boundDetection(join(dir, "verified"));
      return [
        await evidenceOf(join(dir, "unchanged"), record, noPrint),
        await evidenceOf(
          join(dir, "changed"),
          { ...record, adapterVersion: OTHER_ADAPTER_VERSION },
          noPrint,
        ),
      ];
    });
    expect(read).toStrictEqual([
      { freshness: "unknown", unknownReasons: ["no-current-fingerprint"] },
      stale("another-adapter-version"),
    ]);
  });

  it("D3942: evidence for a test told apart only by its position reads unknown while the latest discovery is not current, and current once it is", async () => {
    const twins: StandingCase = {
      values: [definition("D1", { test: { occurrence: 1 } })],
      tests: [
        discoveredTest(["t"], { isDuplicate: true }),
        discoveredTest(["t"], { occurrence: 1, isDuplicate: true }),
      ],
    };
    const read = await besideCurrent(
      (dir, record) =>
        evidenceOf(dir, record, {
          ...twins,
          facts: { discoveryCurrent: false },
        }),
      twins,
    );
    expect(read).toStrictEqual([
      CURRENT_EVIDENCE,
      {
        freshness: "unknown",
        unknownReasons: ["duplicate-test-discovery-not-current"],
      },
    ]);
  });

  it("D3996: evidence that reads unknown names every reason that applies, not the first alone", async () => {
    const twins: StandingCase = {
      values: [definition("D1", { test: { occurrence: 1 } })],
      tests: [
        discoveredTest(["t"], { isDuplicate: true }),
        discoveredTest(["t"], { occurrence: 1, isDuplicate: true }),
      ],
    };
    const evidence = await inTempDir(async (dir) => {
      const record = await boundDetection(join(dir, "verified"), twins);
      return evidenceOf(join(dir, "unvouched"), record, {
        ...twins,
        facts: {
          discoveryCurrent: false,
          currentFingerprint: () => undefined,
        },
      });
    });
    expect(
      evidence !== undefined && "unknownReasons" in evidence
        ? [...evidence.unknownReasons].sort()
        : evidence,
    ).toStrictEqual([
      "duplicate-test-discovery-not-current",
      "no-current-fingerprint",
    ]);
  });

  it("D3943: the anchor read digests its mutation's file as decoded, a byte order mark and CRLF line endings kept, as the job that read the same file did", async () => {
    const text = "﻿export function a() {\r\n  return 1;\r\n}\r\n";
    const [only] = await inTempDir((dir) =>
      resolvedIn(dir, [definition("D1")], [TEST_T], {
        files: { [SOURCE]: text },
      }),
    );
    expect({
      state: only?.state,
      digest: only?.mutationFileDigest,
    }).toStrictEqual({
      state: "never-verified",
      digest: createHash("sha256").update(text).digest("hex"),
    });
  });
});

describe("each definition's one state, with its stored evidence", () => {
  it("D3944: a definition whose anchor is missing or that is invalid reads that, never the detection stored for its id, and is neither eligible, verified nor counted as holding unreadable evidence", async () => {
    const outcome = await inTempDir(async (dir) => {
      const values = [
        definition("D1", { mutation: { old: "return 3;" } }),
        definition("D2", { test: { name: ["missing"] } }),
        definition("D3", { mutation: { old: "return 4;" } }),
      ];
      const [anchorGone] = await standingsIn(join(dir, "bare"), { values });
      const detected = detectionOf(anchorGone);
      const standings = await standingsIn(join(dir, "stored"), {
        values,
        facts: {
          evidence: {
            evidence: [detected, { ...detected, defectId: "D2" }],
            evidenceRefusals: [
              { defectId: "D3", reason: "The store holds an unreadable facts" },
            ],
          },
        },
      });
      const counts = countDefectStandings(standings);
      return {
        read: standings.map(({ state, evidence, eligible }) => ({
          state,
          evidence,
          eligible,
        })),
        verified: counts.verified,
        unreadableEvidence: counts.unreadableEvidence,
      };
    });
    expect(outcome).toStrictEqual({
      read: [
        { state: "anchor-missing", evidence: undefined, eligible: false },
        { state: "invalid-definition", evidence: undefined, eligible: false },
        { state: "anchor-missing", evidence: undefined, eligible: false },
      ],
      verified: 0,
      unreadableEvidence: 0,
    });
  });

  it("D3945: a definition whose stored evidence was refused reads never verified with the refusal as its reason and is counted, while another definition still reads its verdict", async () => {
    const outcome = await inTempDir(async (dir) => {
      const values = [definition("D1"), definition("D2")];
      const [, second] = await standingsIn(join(dir, "bare"), { values });
      const standings = await standingsIn(join(dir, "stored"), {
        values,
        facts: {
          evidence: {
            evidence: [detectionOf(second)],
            evidenceRefusals: [
              {
                defectId: "D1",
                reason: 'The store holds an unreadable facts: "not json"',
              },
            ],
          },
        },
      });
      const counts = countDefectStandings(standings);
      return {
        read: standings.map(({ state, reason }) => ({ state, reason })),
        unreadableEvidence: counts.unreadableEvidence,
        verified: counts.verified,
      };
    });
    expect(outcome).toStrictEqual({
      read: [
        {
          state: "never-verified",
          reason: expect.stringMatching(
            /refused as unreadable.*: The store holds an unreadable facts: "not json"$/,
          ),
        },
        { state: "detected", reason: undefined },
      ],
      unreadableEvidence: 1,
      verified: 1,
    });
  });

  it("D3947: an unclear verdict whose error is not an assertion lists 3 of the intended test's errors by kind and name, with how many it left out", async () => {
    const errors: ErrorFact[] = [
      TYPE_ERROR,
      { kind: "other", name: "RangeError" },
      { kind: "other" },
      { kind: "other", name: "SyntaxError" },
      { kind: "other", name: "ReferenceError" },
    ];
    const evidence = await inTempDir(async (dir) => {
      const record = await boundDetection(join(dir, "verified"));
      return evidenceOf(join(dir, "stored"), {
        ...record,
        verdict: "unclear",
        judgement: {
          verdict: "unclear",
          reason: "not-an-assertion",
          facts: ranOnce({ test: { ...REJECTING_TEST, errors } }),
        },
      });
    });
    expect(evidence).toStrictEqual({
      freshness: "current",
      reason: "not-an-assertion",
      errors: { listed: errors.slice(0, 3), notListed: 2 },
    });
  });

  it("D3948: the states are listed invalid definition, anchor missing, survived, invalid experiment, unclear, never verified, then detected", () => {
    expect(DEFECT_STATES).toStrictEqual([
      "invalid-definition",
      "anchor-missing",
      "survived",
      "invalid-experiment",
      "unclear",
      "never-verified",
      "detected",
    ]);
  });

  it("D3949: the counts give each state, each freshness and each cause, and verified counts a detection only while its evidence is current", async () => {
    const counts = await inTempDir(async (dir) => {
      const values = [definition("D1"), definition("D2"), definition("D3")];
      const bare = await standingsIn(join(dir, "bare"), { values });
      const [first, second, third] = bare.map((standing) =>
        detectionOf(standing),
      );
      const stored = [
        first,
        second === undefined
          ? undefined
          : { ...second, adapterVersion: OTHER_ADAPTER_VERSION },
        third === undefined
          ? undefined
          : {
              ...third,
              verdict: "survived" as const,
              judgement: {
                verdict: "survived" as const,
                facts: ranOnce({ test: SURVIVING_TEST }),
              },
            },
      ].flatMap((record) => (record === undefined ? [] : [record]));
      return countDefectStandings(
        await standingsIn(join(dir, "stored"), {
          values,
          facts: holding(...stored),
        }),
      );
    });
    expect(counts).toStrictEqual({
      states: {
        "invalid-definition": 0,
        "anchor-missing": 0,
        survived: 1,
        "invalid-experiment": 0,
        unclear: 0,
        "never-verified": 0,
        detected: 2,
      },
      freshness: { current: 2, stale: 1, unknown: 0 },
      staleCauses: {
        "definition-changed": 0,
        "mutation-file-changed": 0,
        "another-adapter-version": 1,
        "another-falsifier-version": 0,
        "another-vitest-version": 0,
        "inputs-changed": 0,
      },
      unknownReasons: {
        "no-current-fingerprint": 0,
        "duplicate-test-discovery-not-current": 0,
      },
      unreadableEvidence: 0,
      eligible: 3,
      verified: 1,
    });
  });

  it("D3965: the counts give each reason for unknown, a definition counted under every reason that applies to it, beside the freshness counts", async () => {
    const counts = await inTempDir(async (dir) => {
      const unprinted = { workspacePath: "pkg", modulePath: "b.test.ts" };
      const given: StandingCase = {
        values: [
          definition("D1"),
          definition("D2", { test: { name: ["u"], occurrence: 1 } }),
          definition("D3", {
            test: { module: "pkg/b.test.ts", name: ["w"], occurrence: 1 },
          }),
        ],
        tests: [
          discoveredTest(["t"]),
          discoveredTest(["u"], { isDuplicate: true }),
          discoveredTest(["u"], { occurrence: 1, isDuplicate: true }),
          discoveredTest(["w"], { ...unprinted, isDuplicate: true }),
          discoveredTest(["w"], {
            ...unprinted,
            occurrence: 1,
            isDuplicate: true,
          }),
        ],
      };
      const bare = await standingsIn(join(dir, "bare"), given);
      const { freshness, unknownReasons } = countDefectStandings(
        await standingsIn(join(dir, "stored"), {
          ...given,
          facts: {
            ...holding(...bare.map((standing) => detectionOf(standing))),
            discoveryCurrent: false,
            currentFingerprint: (workspacePath) =>
              workspacePath === "pkg" ? undefined : BOUND_PRINT,
          },
        }),
      );
      return { freshness, unknownReasons };
    });
    expect(counts).toStrictEqual({
      freshness: { current: 1, stale: 0, unknown: 2 },
      unknownReasons: {
        "no-current-fingerprint": 1,
        "duplicate-test-discovery-not-current": 2,
      },
    });
  });

  it("D3950: a definition is eligible only when it is valid, its anchor matches and its test holds a current pass", async () => {
    const outcome = await inTempDir(async (dir) => {
      const passing = discoveredTest(["t"]);
      const stalePass = discoveredTest(["u"]);
      const failing = discoveredTest(["v"]);
      const standings = await standingsIn(dir, {
        values: [
          definition("D1"),
          definition("D2", { test: { name: ["u"] } }),
          definition("D3", { test: { name: ["v"] } }),
          definition("D4", { mutation: { old: "return 3;" } }),
        ],
        tests: [passing, stalePass, failing],
        facts: {
          testStandings: [
            { test: passing, state: "passed", freshness: "current" },
            { test: stalePass, state: "passed", freshness: "stale" },
            { test: failing, state: "failed", freshness: "current" },
          ],
        },
      });
      return {
        eligible: standings.map((standing) => standing.eligible),
        counted: countDefectStandings(standings).eligible,
      };
    });
    expect(outcome).toStrictEqual({
      eligible: [true, false, false, false],
      counted: 1,
    });
  });
});

describe("a definition naming a test in a module that failed to collect", () => {
  it("D3946: the not-discovered reason says the module failed to collect in the latest discovery, so none of its tests is discovered, and says so of no module that collected", async () => {
    const reasons = await inTempDir(async (dir) => {
      const found = discoveryOf([
        discoveredTest(["t"], { modulePath: "src/b.test.ts" }),
      ]);
      const failing: TestDiscovery = {
        ...found,
        workspaces: found.workspaces.map((entry) =>
          entry.status === "discovered"
            ? {
                ...entry,
                failedModules: [
                  {
                    projectName: "unit",
                    modulePath: TEST_MODULE,
                    errors: ["SyntaxError: Unexpected token"],
                  },
                ],
              }
            : entry,
        ),
      };
      const definitions = await resolvedAgainst(
        dir,
        [
          definition("D1"),
          definition("D2", {
            test: { module: "src/b.test.ts", name: ["missing"] },
          }),
        ],
        failing,
      );
      return definitions.map(({ state, reason }) => ({ state, reason }));
    });
    expect(reasons).toStrictEqual([
      {
        state: "invalid-definition",
        reason: expect.stringMatching(
          /; that module failed to collect in the latest discovery, so none of its tests is discovered$/,
        ),
      },
      {
        state: "invalid-definition",
        reason: expect.stringMatching(
          /; the latest discovery lists that module$/,
        ),
      },
    ]);
  });
});
