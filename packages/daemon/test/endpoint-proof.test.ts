import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import type { Socket } from "node:net";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DaemonConnection } from "../src/daemon/daemon-connection.js";
import {
  createDaemonKey,
  daemonVerifier,
} from "../src/daemon/endpoint-proof.js";
import type { Endpoint } from "../src/daemon/endpoint.js";
import {
  provenRequest,
  type DaemonTarget,
} from "../src/daemon/proven-connection.js";
import {
  frozenProof,
  KEY_TEST_OPTIONS,
  keyedEndpoint,
  withDaemonKey,
} from "./daemon-key.js";
import { inTempDir } from "./harness.js";
import { withTestEndpoint } from "./test-endpoint.js";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn<typeof actual.spawnSync>(actual.spawnSync),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn<typeof actual.readFileSync>(actual.readFileSync),
    writeFileSync: vi.fn<typeof actual.writeFileSync>(actual.writeFileSync),
  };
});

const WORKTREE = "/home/dev/consumer";
const OTHER_WORKTREE = "/home/dev/other";
const CHALLENGE = "a fresh challenge";
const MISMATCH = "its proof does not match this worktree's daemon key";

describe("what a proof binds", KEY_TEST_OPTIONS, () => {
  it("D1562: a proof made with the key for another worktree identity is refused", async () => {
    const refusal = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      return withDaemonKey(endpoint, OTHER_WORKTREE, (key) => {
        const verifier = daemonVerifier(endpoint, WORKTREE);
        if (!verifier.ok) return verifier.reason;
        return verifier.verifier.refusal(CHALLENGE, {
          pid: process.pid,
          proof: key.prove(CHALLENGE),
        });
      });
    });
    expect(refusal).toBe(MISMATCH);
  });

  it("D1563: a proof made for another process id than the answer names is refused", async () => {
    const refusal = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      return withDaemonKey(endpoint, WORKTREE, (key) => {
        const verifier = daemonVerifier(endpoint, WORKTREE);
        if (!verifier.ok) return verifier.reason;
        return verifier.verifier.refusal(CHALLENGE, {
          pid: process.pid + 1,
          proof: key.prove(CHALLENGE),
        });
      });
    });
    expect(refusal).toBe(MISMATCH);
  });

  it("D1565: a proof built as the frozen construction sets out, over the key file's text, verifies", async () => {
    const refusal = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      return withDaemonKey(endpoint, WORKTREE, (_key, keyText) => {
        const verifier = daemonVerifier(endpoint, WORKTREE);
        if (!verifier.ok) return verifier.reason;
        return verifier.verifier.refusal(CHALLENGE, {
          pid: 4242,
          proof: frozenProof(keyText, CHALLENGE, WORKTREE, 4242),
        });
      });
    });
    expect(refusal).toBeUndefined();
  });

  it("D1690: a proof of another length is refused as not matching the key, not thrown", async () => {
    const refusal = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      return withDaemonKey(endpoint, WORKTREE, () => {
        const verifier = daemonVerifier(endpoint, WORKTREE);
        if (!verifier.ok) return verifier.reason;
        try {
          return verifier.verifier.refusal(CHALLENGE, {
            pid: process.pid,
            proof: "abc",
          });
        } catch (error) {
          return `threw ${(error as Error).name}`;
        }
      });
    });
    expect(refusal).toBe(MISMATCH);
  });

  it("D3286: an answer that carries no proof is refused as answering without one, quoting the answer", async () => {
    const refusal = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      return withDaemonKey(endpoint, WORKTREE, () => {
        const verifier = daemonVerifier(endpoint, WORKTREE);
        if (!verifier.ok) return verifier.reason;
        return verifier.verifier.refusal(CHALLENGE, {
          type: "hello",
          pid: 4242,
        });
      });
    });
    expect(refusal).toBe(
      'it answered without a proof: {"type":"hello","pid":4242}',
    );
  });
});

/** Answers every line a client sends with `answer`, as a process holding the endpoint would. */
function answering(answer: object): (socket: Socket) => void {
  return (socket) => {
    socket.on("data", () => socket.write(`${JSON.stringify(answer)}\n`));
  };
}

/** Sends a proven hello for `target` over a connection to `path`, and says why the client refused the answer. */
async function helloRefusal(
  target: DaemonTarget,
  path: string,
): Promise<string> {
  const opened = await DaemonConnection.open(path);
  if (!opened.ok) return opened.reason;
  try {
    await provenRequest(target, opened.connection, (challenge) => ({
      type: "hello",
      challenge,
    }));
    return "accepted";
  } catch (error) {
    return (error as Error).message;
  } finally {
    opened.connection.close();
  }
}

describe("a client's refusal of an answer", KEY_TEST_OPTIONS, () => {
  it("D3285: a request answered with a proof made with another key is refused naming the endpoint, the root and that the proof does not match the key", async () => {
    const outcome = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      const target = {
        consumerRoot: WORKTREE,
        worktreeIdentity: WORKTREE,
        endpoint,
      };
      return withDaemonKey(endpoint, WORKTREE, () =>
        withTestEndpoint(
          answering({
            type: "hello",
            pid: 4242,
            proof: frozenProof("another key", CHALLENGE, WORKTREE, 4242),
          }),
          async (path) => ({
            endpointPath: endpoint.path,
            refusal: await helloRefusal(target, path),
          }),
        ),
      );
    });
    expect(outcome.refusal).toBe(
      `The process answering on ${outcome.endpointPath} is not this user's daemon for ${WORKTREE}: its proof does not match this worktree's daemon key.`,
    );
  });
});

describe("writing and removing the key", KEY_TEST_OPTIONS, () => {
  it("D1691: the key file is written readable by its owner alone, mode 0600", async () => {
    const write = vi.mocked(writeFileSync);
    const modes = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      write.mockClear();
      const created = createDaemonKey(endpoint, WORKTREE);
      if (!created.ok) return created.reason;
      created.key.remove();
      return write.mock.calls
        .filter(([file]) => String(file).startsWith(endpoint.keyFile))
        .map(([, , options]) => (options as { mode?: number }).mode);
    });
    expect(modes).toStrictEqual([0o600]);
  });

  it("D1692: a key moved aside for removal that cannot be read back is kept, not deleted", async () => {
    const read = vi.mocked(readFileSync);
    const kept = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      const created = createDaemonKey(endpoint, WORKTREE);
      if (!created.ok) return created.reason;
      const actual = read.getMockImplementation();
      const warn = vi
        .spyOn(process, "emitWarning")
        .mockImplementation(() => undefined);
      read.mockImplementation(((file: string, ...rest: unknown[]) => {
        if (String(file).endsWith(".removing")) {
          throw Object.assign(new Error("EIO: i/o error, read"), {
            code: "EIO",
          });
        }
        return (actual as (...a: unknown[]) => unknown)(file, ...rest);
      }) as typeof readFileSync);
      try {
        created.key.remove();
      } finally {
        if (actual !== undefined) read.mockImplementation(actual);
        warn.mockRestore();
      }
      return readdirSync(endpoint.keyDirectory).filter((name) =>
        name.endsWith(".removing"),
      ).length;
    });
    expect(kept).toBe(1);
  });
});

describe("removing the key", KEY_TEST_OPTIONS, () => {
  it("D1564: a stopping daemon's key removal leaves the key a starting daemon wrote in its place", async () => {
    const kept = await inTempDir((dir) => {
      const endpoint = keyedEndpoint(dir);
      const created = createDaemonKey(endpoint, WORKTREE);
      if (!created.ok) return created.reason;
      writeFileSync(endpoint.keyFile, "the successor's key");
      created.key.remove();
      return existsSync(endpoint.keyFile)
        ? readFileSync(endpoint.keyFile, "utf8")
        : "removed";
    });
    expect(kept).toBe("the successor's key");
  });
});

describe("the Windows key directory", () => {
  const TOOL_SID = "S-1-5-21-1-2-3-1001";
  /** SYSTEM and Administrators, as `icacls /save` writes a protected directory's DACL in SDDL. */
  const PROTECTED_DACL = "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
  /** The same, with read access granted to the machine's Users group. */
  const USERS_DACL = `${PROTECTED_DACL}(A;OICI;0x1200a9;;;BU)`;
  const spawn = vi.mocked(spawnSync);

  function succeeded(stdout: string): SpawnSyncReturns<string> {
    return {
      pid: 0,
      output: [null, stdout, ""],
      stdout,
      stderr: "",
      status: 0,
      signal: null,
    };
  }

  /**
   * Runs `body` as Windows does, with `whoami` naming `TOOL_SID` and `icacls /save` writing `dacl`, whichever
   * platform runs the test. Returns where each `/save` wrote and the arguments of every other `icacls` call, and
   * puts everything back. The user's SID is cached per module instance, so on Windows the real-tool tests above cache
   * the machine's SID first and this `whoami` may never run: match the SID by pattern, never as `TOOL_SID`.
   */
  function withAclTools<T>(
    dacl: string,
    body: () => T,
  ): {
    readonly result: T;
    readonly icacls: string[][];
    readonly saves: string[];
  } {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    const systemRoot = process.env["SystemRoot"];
    const actual = spawn.getMockImplementation();
    const icacls: string[][] = [];
    const saves: string[] = [];
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env["SystemRoot"] = systemRoot ?? "C:\\Windows";
    spawn.mockImplementation(((command: string, args: readonly string[]) => {
      if (command.endsWith("whoami.exe")) {
        return succeeded(`"host\\dev","${TOOL_SID}"\r\n`);
      }
      if (args[1] === "/save") {
        saves.push(args[2] ?? "");
        writeFileSync(args[2] ?? "", `name\r\n${dacl}\r\n`, "utf16le");
      } else {
        icacls.push([...args]);
      }
      return succeeded("");
    }) as unknown as typeof spawnSync);
    try {
      return { result: body(), icacls, saves };
    } finally {
      if (actual !== undefined) spawn.mockImplementation(actual);
      if (systemRoot === undefined) delete process.env["SystemRoot"];
      if (platform !== undefined)
        Object.defineProperty(process, "platform", platform);
    }
  }

  function windowsEndpoint(keyDirectory: string): Endpoint {
    return {
      path: "\\\\.\\pipe\\rt-test-test",
      keyDirectory,
      keyFile: join(keyDirectory, "daemon.key"),
    };
  }

  it("D1577: a start refuses a key directory whose DACL still grants the Users group, naming it", async () => {
    const refusal = await inTempDir((dir) => {
      const keyDirectory = join(dir, "rt-test");
      mkdirSync(keyDirectory);
      const { result } = withAclTools(USERS_DACL, () =>
        createDaemonKey(windowsEndpoint(keyDirectory), WORKTREE),
      );
      if (!result.ok) return result.reason;
      result.key.remove();
      return "written";
    });
    expect(refusal).toStrictEqual(
      expect.stringContaining("grants access to BU,"),
    );
  });

  it("D1578: a client refuses a key it can read when the key directory's DACL grants the Users group", async () => {
    const refusal = await inTempDir((dir) => {
      const keyDirectory = join(dir, "rt-test");
      mkdirSync(keyDirectory);
      const endpoint = windowsEndpoint(keyDirectory);
      writeFileSync(endpoint.keyFile, "a key");
      const { result } = withAclTools(USERS_DACL, () =>
        daemonVerifier(endpoint, WORKTREE),
      );
      return result.ok ? "trusted" : result.reason;
    });
    expect(refusal).toStrictEqual(
      expect.stringContaining("grants access to BU,"),
    );
  });

  it("D1664: a client refuses a key directory whose DACL is null, which grants everyone access, even when a label follows it", async () => {
    const refusal = await inTempDir((dir) => {
      const keyDirectory = join(dir, "rt-test");
      mkdirSync(keyDirectory);
      const endpoint = windowsEndpoint(keyDirectory);
      writeFileSync(endpoint.keyFile, "a key");
      const { result } = withAclTools(
        "D:NO_ACCESS_CONTROLS:(ML;;NW;;;ME)",
        () => daemonVerifier(endpoint, WORKTREE),
      );
      return result.ok ? "trusted" : result.reason;
    });
    expect(refusal).toStrictEqual(
      expect.stringContaining("has no access control list"),
    );
  });

  it("D1685: the daemon sets itself as the key directory's owner before granting access, for an existing and a new directory", async () => {
    const steps = await inTempDir((dir) => {
      const existing = join(dir, "existing", "rt-test");
      mkdirSync(existing, { recursive: true });
      const created = join(dir, "created", "rt-test");
      return [existing, created].map((keyDirectory) => {
        const { result, icacls } = withAclTools(PROTECTED_DACL, () =>
          createDaemonKey(windowsEndpoint(keyDirectory), WORKTREE),
        );
        if (result.ok) result.key.remove();
        return icacls.map((args) => [args[1], args[2]]);
      });
    });
    const takeover = [
      ["/setowner", expect.stringMatching(/^\*S-1-5-21-[\d-]+$/)],
      ["/inheritance:r", "/grant:r"],
    ];
    expect(steps).toStrictEqual([takeover, takeover]);
  });

  it("D1686: the key directory's DACL is saved outside the directory under check", async () => {
    const places = await inTempDir((dir) => {
      const keyDirectory = join(dir, "rt-test");
      mkdirSync(keyDirectory);
      const endpoint = windowsEndpoint(keyDirectory);
      writeFileSync(endpoint.keyFile, "a key");
      const { saves } = withAclTools(PROTECTED_DACL, () =>
        daemonVerifier(endpoint, WORKTREE),
      );
      return saves.map((file) =>
        dirname(file) === keyDirectory ? "inside" : "outside",
      );
    });
    expect(places).toStrictEqual(["outside"]);
  });

  it("D1687: a protected DACL followed by a mandatory label is accepted", async () => {
    const outcome = await inTempDir((dir) => {
      const keyDirectory = join(dir, "rt-test");
      mkdirSync(keyDirectory);
      const endpoint = windowsEndpoint(keyDirectory);
      writeFileSync(endpoint.keyFile, "a key");
      const { result } = withAclTools(`${PROTECTED_DACL}S:(ML;;NW;;;LW)`, () =>
        daemonVerifier(endpoint, WORKTREE),
      );
      return result.ok ? "trusted" : result.reason;
    });
    expect(outcome).toBe("trusted");
  });

  it("D1688: a protected DACL carrying a deny entry for another trustee is accepted", async () => {
    const outcome = await inTempDir((dir) => {
      const keyDirectory = join(dir, "rt-test");
      mkdirSync(keyDirectory);
      const endpoint = windowsEndpoint(keyDirectory);
      writeFileSync(endpoint.keyFile, "a key");
      const { result } = withAclTools(
        "D:PAI(D;OICI;FA;;;BU)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)",
        () => daemonVerifier(endpoint, WORKTREE),
      );
      return result.ok ? "trusted" : result.reason;
    });
    expect(outcome).toBe("trusted");
  });

  it("D1579: a new key directory is given a DACL with inheritance removed, granting only the user, SYSTEM and Administrators", async () => {
    const grants = await inTempDir((dir) => {
      const keyDirectory = join(dir, "local", "rt-test");
      const { result, icacls } = withAclTools(PROTECTED_DACL, () =>
        createDaemonKey(windowsEndpoint(keyDirectory), WORKTREE),
      );
      if (!result.ok) return result.reason;
      result.key.remove();
      return icacls
        .filter((args) => args.includes("/grant:r"))
        .map((args) => args.slice(1));
    });
    expect(grants).toStrictEqual([
      [
        "/inheritance:r",
        "/grant:r",
        expect.stringMatching(/^\*S-1-5-21-[\d-]+:\(OI\)\(CI\)F$/),
        "*S-1-5-18:(OI)(CI)F",
        "*S-1-5-32-544:(OI)(CI)F",
      ],
    ]);
  });
});
