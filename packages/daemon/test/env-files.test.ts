import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  type Mode,
  type OpenMode,
  type PathLike,
  type Stats,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  envFileDigest,
  projectEnvFiles,
  type EnvFileDigest,
} from "../src/inputs/env-files.js";
import {
  ProjectInputs,
  workspaceFingerprint,
  type FingerprintResult,
} from "../src/inputs/fingerprint.js";
import type { WorkspaceDiscovery } from "../src/vitest/discover-tests.js";
import { ROOT_PATH } from "../src/vitest/find-workspaces.js";
import type { EnvSource } from "../src/vitest/selection-facts.js";
import {
  discoveredWorkspace,
  handBuiltReads,
  inTempDir,
  projectFacts,
  settle,
} from "./harness.js";

/**
 * Passes every read through, unless a test makes one report a FIFO or a socket, or fail as the OS can, since no test
 * can make a FIFO or a socket at a path on every host.
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    statSync: vi.fn<typeof actual.statSync>(actual.statSync),
    fstatSync: vi.fn<typeof actual.fstatSync>(actual.fstatSync),
    openSync: vi.fn<typeof actual.openSync>(actual.openSync),
    readFileSync: vi.fn<typeof actual.readFileSync>(actual.readFileSync),
    closeSync: vi.fn<typeof actual.closeSync>(actual.closeSync),
  };
});

const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");

/** The consumer root's own env source, in Vitest's mode with Vite's default prefix. */
const ROOT_SOURCE: EnvSource = {
  envDirectory: ".",
  envPrefixes: ["VITE_"],
  mode: "test",
};
const LOCAL_ENV_FILE = ".env.local";
const NOTHING_THERE: EnvFileDigest = { ok: true, digest: undefined };
const FIFO_WORD = "FIFO";

type Settled<T> = T | { thrown: string };
type EntryKind = "fifo" | "socket";

/** The consumer root as one Vitest workspace whose one project reports `sources`. */
function workspaceWithSources(
  root: string,
  sources: readonly EnvSource[],
): WorkspaceDiscovery {
  return discoveredWorkspace({ path: ROOT_PATH, directory: root }, [], {
    reported: true,
    projects: [projectFacts({ envSources: sources })],
  });
}

/** The root workspace's fingerprint over inputs holding nothing, its one project naming the root's env files. */
function rootFingerprint(root: string): Settled<FingerprintResult> {
  return settle(() =>
    workspaceFingerprint(
      new ProjectInputs(root, new Map()),
      workspaceWithSources(root, [ROOT_SOURCE]),
      handBuiltReads(root),
    ),
  );
}

/** `real` as the stat of a FIFO or a socket at the same place. */
function statsOfKind(real: Stats, kind: EntryKind): Stats {
  return Object.assign(Object.create(real) as Stats, {
    isFile: () => false,
    isFIFO: () => kind === "fifo",
    isSocket: () => kind === "socket",
  });
}

function samePath(target: PathLike, path: string): boolean {
  return resolve(String(target)) === resolve(path);
}

/** Makes each stat of `path` report `kind`; every other stat passes through. */
function statingAs(path: string, kind: EntryKind): void {
  vi.mocked(statSync).mockImplementation(((
    target: PathLike,
    options?: Parameters<typeof actualFs.statSync>[1],
  ) => {
    const real = actualFs.statSync(target, options);
    return samePath(target, path) && real !== undefined
      ? statsOfKind(real as Stats, kind)
      : real;
  }) as typeof statSync);
}

/** Makes every stat of an open descriptor report `kind`, as a swap after the path's stat leaves it. */
function openedAs(kind: EntryKind): void {
  vi.mocked(fstatSync).mockImplementation(((
    descriptor: number,
    options?: Parameters<typeof actualFs.fstatSync>[1],
  ) =>
    statsOfKind(
      actualFs.fstatSync(descriptor, options) as Stats,
      kind,
    )) as typeof fstatSync);
}

/** Makes each open of `path` fail with `code`; every other open passes through. */
function openFailsWith(path: string, code: string): void {
  vi.mocked(openSync).mockImplementation(
    (target: PathLike, flags: OpenMode, mode?: Mode | null) => {
      if (samePath(target, path)) throw systemError(code, `open '${path}'`);
      return actualFs.openSync(target, flags, mode);
    },
  );
}

/** An error carrying `code`, as a failed system call throws it. */
function systemError(code: string, call: string): Error {
  return Object.assign(new Error(`${code}: ${call}`), { code });
}

/** A refusal as whether it names the injected EIO, or the read or throw it was not. */
function refusalOf(read: Settled<EnvFileDigest>): unknown {
  return "ok" in read && !read.ok
    ? { ok: false, namesError: read.reason.includes("EIO") }
    : read;
}

function openedPath(path: string): boolean {
  return vi
    .mocked(openSync)
    .mock.calls.some(([target]) => samePath(target, path));
}

/** Each descriptor the reader opened and has not closed. */
function unclosed(): number[] {
  const closed = new Set(vi.mocked(closeSync).mock.calls.map(([fd]) => fd));
  return vi
    .mocked(openSync)
    .mock.results.flatMap(({ type, value }) =>
      type === "return" && !closed.has(value) ? [value] : [],
    );
}

/** Closes each descriptor the reader left open, after the test has counted them, so the temp directory can be removed. */
function closeLeftOpen(): void {
  for (const descriptor of unclosed()) actualFs.closeSync(descriptor);
}

/** Makes each stat of `path` fail with `code`; every other stat passes through. */
function statFailsWith(path: string, code: string): void {
  vi.mocked(statSync).mockImplementation(((
    target: PathLike,
    options?: Parameters<typeof actualFs.statSync>[1],
  ) => {
    if (samePath(target, path)) throw systemError(code, `stat '${path}'`);
    return actualFs.statSync(target, options);
  }) as typeof statSync);
}

/** Makes every read of an open descriptor fail with EIO. */
function readsFail(): void {
  vi.mocked(readFileSync).mockImplementation(() => {
    throw systemError("EIO", "read");
  });
}

/** Puts every mocked read back to passing through, forgetting its calls. */
function restoreReads(): void {
  vi.mocked(statSync).mockReset();
  vi.mocked(fstatSync).mockReset();
  vi.mocked(openSync).mockReset();
  vi.mocked(readFileSync).mockReset();
  vi.mocked(closeSync).mockReset();
}

/** Runs `body` over a temp dir holding a regular `.env.local`, with every mocked read passing through and none recorded. */
function withLocalEnvFile<T>(
  body: (root: string, file: string) => T,
): Promise<T> {
  return inTempDir((root) => {
    const file = join(root, LOCAL_ENV_FILE);
    writeFileSync(file, "VITE_A=1\n");
    restoreReads();
    try {
      return body(root, file);
    } finally {
      closeLeftOpen();
      restoreReads();
    }
  });
}

describe("the env files a source names", () => {
  it("D3052: each env source names .env, .env.local, .env.<mode> and .env.<mode>.local in its env directory", () => {
    expect(
      projectEnvFiles(
        projectFacts({
          envSources: [
            { envDirectory: "config", envPrefixes: ["VITE_"], mode: "staging" },
            ROOT_SOURCE,
          ],
        }),
      ),
    ).toStrictEqual([
      "config/.env",
      "config/.env.local",
      "config/.env.staging",
      "config/.env.staging.local",
      ".env",
      ".env.local",
      ".env.test",
      ".env.test.local",
    ]);
  });

  it("D3053: a source whose config turns env files off names none", () => {
    expect(
      projectEnvFiles(
        projectFacts({
          envSources: [
            { envDirectory: null, envPrefixes: ["VITE_"], mode: "test" },
          ],
        }),
      ),
    ).toStrictEqual([]);
  });
});

describe("reading an env file as Vite does", () => {
  it("D3054: a FIFO at a listed env path leaves its workspace with no fingerprint, the reason naming the file and saying it is a FIFO", async () => {
    const outcome = await withLocalEnvFile((root, file) => {
      statingAs(file, "fifo");
      const print = rootFingerprint(root);
      return "ok" in print && !print.ok
        ? {
            ok: false,
            namesFile: print.reason.includes(LOCAL_ENV_FILE),
            saysFifo: print.reason.includes(FIFO_WORD),
          }
        : print;
    });
    expect(outcome).toStrictEqual({
      ok: false,
      namesFile: true,
      saysFifo: true,
    });
  });

  it("D3055: a FIFO at a listed env path is never opened, since opening one releases a writer waiting on it", async () => {
    const opened = await withLocalEnvFile((_root, file) => {
      statingAs(file, "fifo");
      envFileDigest(file);
      return openedPath(file);
    });
    expect(opened).toBe(false);
  });

  it("D3056: a file that is a FIFO once opened, though a regular file when checked, is refused and never read", async () => {
    const outcome = await withLocalEnvFile((_root, file) => {
      openedAs("fifo");
      const read = envFileDigest(file);
      return {
        refused: !read.ok && read.reason.includes(FIFO_WORD),
        read: vi.mocked(readFileSync).mock.calls.length > 0,
      };
    });
    expect(outcome).toStrictEqual({ refused: true, read: false });
  });

  it("D3057: a directory at a listed env path, which Vite skips, fingerprints its workspace as though nothing were there", async () => {
    const prints = await inTempDir((root) => {
      const nothing = rootFingerprint(root);
      mkdirSync(join(root, LOCAL_ENV_FILE));
      return { nothing, directory: rootFingerprint(root) };
    });
    expect({
      computed: "ok" in prints.nothing && prints.nothing.ok,
      same: JSON.stringify(prints.directory) === JSON.stringify(prints.nothing),
    }).toStrictEqual({ computed: true, same: true });
  });

  it("D3058: a socket at a listed env path, which Vite skips, digests as nothing there rather than refusing", async () => {
    const read = await withLocalEnvFile((_root, file) => {
      statingAs(file, "socket");
      return envFileDigest(file);
    });
    expect(read).toStrictEqual(NOTHING_THERE);
  });

  it("D3059: an env file that cannot be opened leaves its workspace with no fingerprint, the reason naming the file and the error", async () => {
    const outcome = await withLocalEnvFile((root, file) => {
      openFailsWith(file, "EACCES");
      const print = rootFingerprint(root);
      return "ok" in print && !print.ok
        ? {
            ok: false,
            namesFile: print.reason.includes(LOCAL_ENV_FILE),
            namesError: print.reason.includes("EACCES"),
          }
        : print;
    });
    expect(outcome).toStrictEqual({
      ok: false,
      namesFile: true,
      namesError: true,
    });
  });

  it("D3060: an env file whose read fails is refused with the error, never thrown out of the fingerprint, and its descriptor is closed", async () => {
    const outcome = await withLocalEnvFile((_root, file) => {
      readsFail();
      const refusal = refusalOf(settle(() => envFileDigest(file)));
      return { refusal, leftOpen: unclosed().length };
    });
    expect(outcome).toStrictEqual({
      refusal: { ok: false, namesError: true },
      leftOpen: 0,
    });
  });

  it("D3061: an env file whose close fails is refused with the error, never thrown out of the fingerprint", async () => {
    const read = await withLocalEnvFile((_root, file) => {
      vi.mocked(closeSync).mockImplementation((descriptor) => {
        actualFs.closeSync(descriptor);
        throw systemError("EIO", "close");
      });
      return refusalOf(settle(() => envFileDigest(file)));
    });
    expect(read).toStrictEqual({ ok: false, namesError: true });
  });

  it("D3062: a file removed between its check and its open digests as nothing there", async () => {
    const read = await withLocalEnvFile((_root, file) => {
      openFailsWith(file, "ENOENT");
      return envFileDigest(file);
    });
    expect(read).toStrictEqual(NOTHING_THERE);
  });

  it("D3063: a file replaced by a socket or a device with no driver between its check and its open digests as nothing there", async () => {
    const read = await withLocalEnvFile((_root, file) => {
      openFailsWith(file, "ENXIO");
      return envFileDigest(file);
    });
    expect(read).toStrictEqual(NOTHING_THERE);
  });

  it("D3082: an env file whose stat fails for a reason other than no entry is refused with the error, never digested as nothing there", async () => {
    const read = await withLocalEnvFile((_root, file) => {
      statFailsWith(file, "EIO");
      return refusalOf(settle(() => envFileDigest(file)));
    });
    expect(read).toStrictEqual({ ok: false, namesError: true });
  });

  it("D3083: the reader closes every descriptor it opens, after a read and after a failed read alike", async () => {
    const leftOpen = await withLocalEnvFile((_root, file) => {
      envFileDigest(file);
      const afterRead = unclosed().length;
      readsFail();
      envFileDigest(file);
      return { afterRead, afterFailedRead: unclosed().length };
    });
    expect(leftOpen).toStrictEqual({ afterRead: 0, afterFailedRead: 0 });
  });

  it("D3084: a file that is a socket once opened, though a regular file when checked, digests as nothing there, as Vite skips a socket", async () => {
    const read = await withLocalEnvFile((_root, file) => {
      openedAs("socket");
      return envFileDigest(file);
    });
    expect(read).toStrictEqual(NOTHING_THERE);
  });

  it("D3064: a missing env file, and a path below a file, digest as nothing there", async () => {
    const reads = await inTempDir((root) => {
      writeFileSync(join(root, "config"), "not a directory\n");
      return {
        missing: envFileDigest(join(root, LOCAL_ENV_FILE)),
        belowFile: envFileDigest(join(root, "config", LOCAL_ENV_FILE)),
      };
    });
    expect(reads).toStrictEqual({
      missing: NOTHING_THERE,
      belowFile: NOTHING_THERE,
    });
  });
});

describe("a project whose env sources are not known", () => {
  it("D3123: names no env file, rather than failing to list them", () => {
    const project = projectFacts({
      envSources: {
        notKnown:
          "a nested projects container declares its projects (app/vitest.config.mjs)",
      },
    });
    expect(settle(() => projectEnvFiles(project))).toStrictEqual([]);
  });
});

describe("a listed setup file whose path runs through a file", () => {
  it("D3265: a listed setup file whose read fails with ENOTDIR, as Linux reports a path below a file, digests as absent, leaving its workspace the fingerprint it has with nothing there", async () => {
    const same = await inTempDir((root) => {
      const setup = "gen/setup.ts";
      const entry = discoveredWorkspace(
        { path: ROOT_PATH, directory: root },
        [],
        {
          reported: true,
          projects: [projectFacts({ setupFiles: [setup] })],
        },
      );
      const printOf = (): string | undefined => {
        const print = workspaceFingerprint(
          new ProjectInputs(root, new Map()),
          entry,
          handBuiltReads(root),
        );
        return print.ok ? print.digest : undefined;
      };
      restoreReads();
      try {
        const absent = printOf();
        writeFileSync(join(root, "gen"), "a file where a directory would be\n");
        vi.mocked(readFileSync).mockImplementation(((
          target: PathLike,
          options?: Parameters<typeof actualFs.readFileSync>[1],
        ) => {
          if (samePath(target, join(root, setup))) {
            throw systemError("ENOTDIR", `open '${join(root, setup)}'`);
          }
          return actualFs.readFileSync(target, options);
        }) as typeof readFileSync);
        const belowAFile = printOf();
        return absent !== undefined && belowAFile === absent;
      } finally {
        restoreReads();
      }
    });
    expect(same).toBe(true);
  });
});
