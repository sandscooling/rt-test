import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  clientEndpoint,
  holderAfterConnectError,
  listenOnEndpoint,
} from "../src/daemon/endpoint.js";
import {
  runtimeDirectoryRefusal,
  takeLock,
} from "../src/daemon/runtime-directory.js";
import { inTempDir } from "./harness.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: vi.fn<typeof actual.lstatSync>(actual.lstatSync),
  };
});

const OWN_UID = 1000;
const OTHER_UID = 1001;
const DIRECTORY_TYPE = 0o040000;
const RUNTIME_DIRECTORY = "/run/user/rt-test-runtime";
const WORKTREE = "/home/dev/consumer";

interface FakeDirectory {
  readonly link?: boolean;
  /** A regular file stands where the directory should be. */
  readonly file?: boolean;
  readonly uid?: number;
  readonly permissions: number;
}

/** What `lstat` reports for the runtime directory, whichever platform runs the test. */
function fakeStats(directory: FakeDirectory): Stats {
  return {
    isSymbolicLink: () => directory.link === true,
    isDirectory: () => directory.link !== true && directory.file !== true,
    uid: directory.uid ?? OWN_UID,
    mode: DIRECTORY_TYPE | directory.permissions,
  } as Stats;
}

/** Runs `body` as the Linux user `OWN_UID`, with `lstat` answering `directory` when given, and puts everything back. */
function asLinuxUser<T>(
  body: () => T,
  directory?: FakeDirectory,
  runtimeDirectory = RUNTIME_DIRECTORY,
): T {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const getuid = Object.getOwnPropertyDescriptor(process, "getuid");
  const saved = process.env["XDG_RUNTIME_DIR"];
  const lstat = vi.mocked(lstatSync);
  const actualLstat = lstat.getMockImplementation();
  Object.defineProperty(process, "platform", { value: "linux" });
  Object.defineProperty(process, "getuid", {
    value: () => OWN_UID,
    configurable: true,
  });
  process.env["XDG_RUNTIME_DIR"] = runtimeDirectory;
  if (directory !== undefined) {
    lstat.mockImplementation((() =>
      fakeStats(directory)) as unknown as typeof lstatSync);
  }
  try {
    return body();
  } finally {
    if (actualLstat !== undefined) lstat.mockImplementation(actualLstat);
    if (saved === undefined) delete process.env["XDG_RUNTIME_DIR"];
    else process.env["XDG_RUNTIME_DIR"] = saved;
    if (getuid === undefined) delete (process as { getuid?: unknown }).getuid;
    else Object.defineProperty(process, "getuid", getuid);
    if (platform !== undefined)
      Object.defineProperty(process, "platform", platform);
  }
}

function refusalFor(directory: FakeDirectory): string | undefined {
  return asLinuxUser(
    () => runtimeDirectoryRefusal(RUNTIME_DIRECTORY, false),
    directory,
  );
}

describe("the Linux runtime directory", () => {
  it("D1466: a runtime directory other users can enter is refused, naming its mode and the one required", () => {
    expect(refusalFor({ permissions: 0o755 })).toBe(
      `other users can enter the runtime directory ${RUNTIME_DIRECTORY} (mode 755, 700 required)`,
    );
  });

  it("D1467: a runtime directory only its owner can enter is accepted", () => {
    expect(refusalFor({ permissions: 0o700 })).toBeUndefined();
  });

  it("D1468: a runtime directory that belongs to another user is refused", () => {
    expect(refusalFor({ permissions: 0o700, uid: OTHER_UID })).toBe(
      `the runtime directory ${RUNTIME_DIRECTORY} belongs to another user`,
    );
  });

  it("D1469: a runtime directory that is a symbolic link is refused", () => {
    expect(refusalFor({ permissions: 0o777, link: true })).toBe(
      `the runtime directory ${RUNTIME_DIRECTORY} is a symbolic link`,
    );
  });

  it("D1470: a client refuses to reach a daemon through a runtime directory other users can enter", () => {
    const location = asLinuxUser(() => clientEndpoint(WORKTREE), {
      permissions: 0o755,
    });
    expect(location).toStrictEqual({
      ok: false,
      reason: `other users can enter the runtime directory ${RUNTIME_DIRECTORY} (mode 755, 700 required)`,
    });
  });
});

describe("where the runtime directory is and what it holds", () => {
  it("D1536: a runtime directory path that is a regular file is refused", () => {
    expect(refusalFor({ permissions: 0o700, file: true })).toBe(
      `${RUNTIME_DIRECTORY} is not a directory`,
    );
  });

  it("D1533: a relative XDG_RUNTIME_DIR is passed over for rt-test-<uid> under the system temporary directory", () => {
    const location = asLinuxUser(
      () => clientEndpoint(WORKTREE),
      { permissions: 0o700 },
      "relative/runtime",
    );
    expect(location.ok ? location.runtimeDirectory : location.reason).toBe(
      join(tmpdir(), `rt-test-${OWN_UID}`),
    );
  });
});

describe("an endpoint a stale file still holds", () => {
  it("D1531: a start that finds its endpoint held by a stale file removes it and listens", async () => {
    const outcome = await inTempDir(async (worktree) => {
      const first = await listenOnEndpoint(worktree, (socket) =>
        socket.destroy(),
      );
      if (!first.ok) return first.reason;
      let removed = false;
      const second = await listenOnEndpoint(
        worktree,
        (socket) => socket.destroy(),
        {
          holder: () => Promise.resolve("stale-file"),
          removeStale: async () => {
            removed = true;
            await first.close();
          },
        },
      );
      try {
        return { removed, listening: second.ok };
      } finally {
        if (second.ok) await second.close();
        if (!removed) await first.close();
      }
    });
    expect(outcome).toStrictEqual({ removed: true, listening: true });
  });

  it("D1532: a refused connection reads as a stale file, and a missing endpoint as gone", () => {
    expect({
      refused: holderAfterConnectError("ECONNREFUSED"),
      missing: holderAfterConnectError("ENOENT"),
    }).toStrictEqual({ refused: "stale-file", missing: "gone" });
  });
});

describe("the Linux socket path limit", () => {
  /** A runtime directory whose socket path, `<directory>/<32 hex digits>.sock`, is `bytes` long. */
  function runtimeDirectoryFor(bytes: number): string {
    const socketName = 32 + ".sock".length;
    return `/${"r".repeat(bytes - socketName - 2)}`;
  }

  it("D1471: a socket path of 109 bytes is refused, naming its length and the 108-byte limit", () => {
    const location = asLinuxUser(
      () => clientEndpoint(WORKTREE),
      undefined,
      runtimeDirectoryFor(109),
    );
    expect(location).toStrictEqual({
      ok: false,
      reason: expect.stringMatching(
        / is 109 bytes, longer than the platform's limit of 108 bytes$/,
      ),
    });
  });

  it("D1472: a socket path of exactly 108 bytes is accepted", () => {
    const location = asLinuxUser(
      () => clientEndpoint(WORKTREE),
      undefined,
      runtimeDirectoryFor(108),
    );
    expect(location.ok).toBe(true);
  });
});

describe("the lock that serializes starts", () => {
  const LOCK_NAME = "endpoint.lock";

  /** A process id that no running process holds: the id of a child that has already exited. */
  function exitedPid(): number {
    const child = spawnSync(process.execPath, ["-e", ""]);
    return child.pid;
  }

  it("D1473: a lock held by a running process refuses, naming that process", async () => {
    const outcome = await inTempDir((dir) => {
      const file = join(dir, LOCK_NAME);
      writeFileSync(file, String(process.pid));
      const lock = takeLock(file);
      return lock.ok ? "taken" : lock.reason;
    });
    expect(outcome).toMatch(
      new RegExp(
        `^another start of this worktree's daemon, process ${process.pid}, holds `,
      ),
    );
  });

  it("D1474: a lock whose process has exited is taken over", async () => {
    const holder = await inTempDir((dir) => {
      const file = join(dir, LOCK_NAME);
      writeFileSync(file, String(exitedPid()));
      const lock = takeLock(file);
      return lock.ok ? readFileSync(file, "utf8") : lock.reason;
    });
    expect(holder).toBe(String(process.pid));
  });

  it("D1475: a lock that names no process refuses", async () => {
    const outcome = await inTempDir((dir) => {
      const file = join(dir, LOCK_NAME);
      writeFileSync(file, "");
      const lock = takeLock(file);
      return lock.ok ? "taken" : lock.reason;
    });
    expect(outcome).toMatch(/^another start of this worktree's daemon holds /);
  });

  it("D1476: releasing a lock leaves it in place when another process has since taken it", async () => {
    const kept = await inTempDir((dir) => {
      const file = join(dir, LOCK_NAME);
      const lock = takeLock(file);
      if (!lock.ok) return lock.reason;
      writeFileSync(file, String(exitedPid()));
      lock.release();
      return existsSync(file);
    });
    expect(kept).toBe(true);
  });
});
