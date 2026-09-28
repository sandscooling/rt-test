import {
  spawn as spawnProcess,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  runLeaseCli,
  type LeaseCliContext,
} from "../../../scripts/lib/orchestration/lease-cli.mjs";
import {
  beat,
  joinQueue,
  readLease,
  recordChild,
  releaseLane,
  releaseOwn,
  takeTurn,
} from "../../../scripts/lib/orchestration/lease.mjs";
import { PROCESS_SCENARIO, PROCESS_SCENARIO_TIMEOUT_MS } from "../timeouts.js";
import { REPO, withTemp, withTempAsync } from "./harness.js";
import {
  alive,
  COMMAND,
  HOLDER_PID,
  LEASE_FILE,
  NOW,
  owner,
  WORKTREE,
  writeLease,
} from "./lease-harness.js";

const PID = 777;
const CHILD_PID = 4242;
const ROOT = "/src/wt-2/";
const HOLD = "acquire (a manual hold)";
const LOCK_DIR = "lease.lock";
const QUEUED = "queued instead of running";
// Long enough for a child that is not held by the lock to finish its release.
const LOCKED_WAIT_MS = 1000;
const RUN = ["run", "--lane", "t-a", "--thread", "th-t-a", "--"];
const LEASE_MODULE = pathToFileURL(
  join(REPO, "scripts/lib/orchestration/lease.mjs"),
).href;
// Imports the store, says so, waits for stdin to close, then releases lane t-a and prints the outcome.
const RELEASE_SCRIPT = `
import { readFileSync, writeSync } from "node:fs";
const { releaseLane } = await import(${JSON.stringify(LEASE_MODULE)});
writeSync(1, "ready\\n");
readFileSync(0);
writeSync(1, releaseLane(process.argv[1], "t-a").status + "\\n");
`;
// Queues lane t-c as this process, says so, waits for stdin to close, then takes its turn and prints whether it did.
const TAKE_SCRIPT = `
import { readFileSync, writeSync } from "node:fs";
const { joinQueue, takeTurn } = await import(${JSON.stringify(LEASE_MODULE)});
const entry = joinQueue(process.argv[1], { lane: "t-c", thread: "th-t-c", worktree: "/src/wt-2", command: "bun run check", pid: process.pid });
writeSync(1, "ready\\n");
readFileSync(0);
writeSync(1, takeTurn(process.argv[1], entry).taken + "\\n");
`;

// A queue of one waiter, t-a with pid 1, behind whatever lease `record` describes.
function headTurn(
  dir: string,
  record: Record<string, unknown>,
  heartbeatAt: number,
  running: (pid: number | undefined) => boolean,
) {
  writeLease(dir, record, heartbeatAt);
  const entry = joinQueue(dir, owner("t-a", 1), NOW);
  return takeTurn(dir, entry, { now: NOW, running });
}

class FakeChild extends EventEmitter {
  readonly pid = CHILD_PID;
  readonly kills: string[] = [];

  kill(signal: string): boolean {
    this.kills.push(signal);
    return true;
  }
}

interface Spawned {
  readonly program: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv | undefined;
}

const exitWith = (code: number) => (child: FakeChild) => {
  child.emit("spawn");
  child.emit("exit", code, null);
};

// A CLI over `tmp/lease` whose spawned run follows `script`, and whose wait for a turn fails the run with QUEUED.
function cli(
  tmp: string,
  script: (child: FakeChild) => void = exitWith(0),
  overrides: Partial<LeaseCliContext> = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const spawned: Spawned[] = [];
  const signals = new EventEmitter();
  const dir = join(tmp, "lease");
  const ctx: LeaseCliContext = {
    root: ROOT,
    dir,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    now: () => NOW,
    running: alive(PID),
    pid: PID,
    sleep: () => Promise.reject(new Error(QUEUED)),
    spawn: (program, args, options) => {
      spawned.push({ program, args, env: options.env });
      const child = new FakeChild();
      setImmediate(() => script(child));
      return child as unknown as ChildProcess;
    },
    signals: signals as unknown as NonNullable<LeaseCliContext["signals"]>,
    platform: "linux",
    tempOptions: {
      platform: "linux",
      env: {},
      home: join(tmp, "home"),
      tmp: join(tmp, "tmp"),
    },
    ...overrides,
  };
  const run = (argv: readonly string[]) =>
    runLeaseCli(argv, ctx).catch((error: unknown) => String(error));
  return { dir, out, err, spawned, signals, run };
}

const linuxRunDir = (tmp: string) =>
  join(tmp, "home", ".rt-test-runs", "wt-2-777");

function leaseChild(script: string, dir: string) {
  return spawnProcess(
    process.execPath,
    ["--input-type=module", "-e", script, dir],
    { windowsHide: true },
  );
}

// Runs `script` over `dir`, holds the lock while it acts, and reports whether a lease existed meanwhile.
async function whileLocked(script: string, dir: string) {
  const child = leaseChild(script, dir);
  const exited = once(child, "exit");
  const output = await readyOutput(child);
  mkdirSync(join(dir, LOCK_DIR));
  child.stdin.end();
  await sleep(LOCKED_WAIT_MS);
  const leaseWhileLocked = existsSync(join(dir, LEASE_FILE));
  rmSync(join(dir, LOCK_DIR), { recursive: true, force: true });
  const [code] = await exited;
  return { leaseWhileLocked, code, output: output() };
}

async function readyOutput(child: ChildProcess): Promise<() => string> {
  let text = "";
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    text += chunk;
  });
  while (!text.startsWith("ready\n")) await once(child.stdout!, "data");
  return () => text;
}

describe("lease store", () => {
  it("D2273: keeps a waiter behind the queue head from taking a free lease", () => {
    const turn = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      joinQueue(dir, owner("t-a", 1), NOW);
      const second = joinQueue(dir, owner("t-b", 2), NOW + 1);
      return takeTurn(dir, second, { now: NOW + 2, running: alive(1, 2) });
    });
    expect(turn).toEqual({
      taken: false,
      rejoin: false,
      position: 1,
      holder: null,
    });
  });

  it("D2274: keeps the queue head waiting while a live lease is held", () => {
    const turn = withTemp((tmp) =>
      headTurn(
        join(tmp, "lease"),
        { ...owner("t-b", HOLDER_PID), at: NOW },
        NOW,
        alive(1, HOLDER_PID),
      ),
    );
    expect(turn).toEqual(
      expect.objectContaining({
        taken: false,
        holder: expect.objectContaining({ lane: "t-b" }),
      }),
    );
  });

  it("D2275: reclaims a lease whose heartbeat is over 60 s old, and not one exactly 60 s old", () => {
    const taken = [60_001, 60_000].map((age) =>
      withTemp(
        (tmp) =>
          headTurn(
            join(tmp, "lease"),
            { ...owner("t-b", HOLDER_PID), at: NOW - age },
            NOW - age,
            alive(1, HOLDER_PID),
          ).taken,
      ),
    );
    expect(taken).toEqual([true, false]);
  });

  it("D2276: reclaims a lease whose holder process is gone, heartbeat fresh", () => {
    const turn = withTemp((tmp) =>
      headTurn(
        join(tmp, "lease"),
        { ...owner("t-b", HOLDER_PID), at: NOW },
        NOW,
        alive(1),
      ),
    );
    expect(turn.taken).toBe(true);
  });

  it("D2277: keeps a lease whose holder is gone while its recorded run still runs", () => {
    const turn = withTemp((tmp) =>
      headTurn(
        join(tmp, "lease"),
        { ...owner("t-b", HOLDER_PID), at: NOW, childPid: 10 },
        NOW - 120_000,
        alive(1, 10),
      ),
    );
    expect(turn.taken).toBe(false);
  });
});

describe("lease lock", PROCESS_SCENARIO, () => {
  it("D2278: holds a release until the lock another process holds is gone", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const dir = join(tmp, "lease");
      writeLease(dir, { ...owner("t-a", HOLDER_PID), at: NOW });
      return whileLocked(RELEASE_SCRIPT, dir);
    });
    expect(seen).toEqual({
      leaseWhileLocked: true,
      code: 0,
      output: "ready\nreleased\n",
    });
  });

  it("D2376: holds a take until the lock another process holds is gone", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const dir = join(tmp, "lease");
      mkdirSync(dir, { recursive: true });
      return whileLocked(TAKE_SCRIPT, dir);
    });
    expect(seen).toEqual({
      leaseWhileLocked: false,
      code: 0,
      output: "ready\ntrue\n",
    });
  });

  it("D2279: breaks a lock left more than 5 s ago by a process that died holding it", () => {
    const run = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      mkdirSync(join(dir, LOCK_DIR), { recursive: true });
      const abandonedAt = (Date.now() - 6000) / 1000;
      utimesSync(join(dir, LOCK_DIR), abandonedAt, abandonedAt);
      return spawnSync(
        process.execPath,
        ["--input-type=module", "-e", RELEASE_SCRIPT, dir],
        {
          input: "",
          encoding: "utf8",
          timeout: PROCESS_SCENARIO_TIMEOUT_MS / 2,
          windowsHide: true,
        },
      );
    });
    expect({ status: run.status, stdout: run.stdout }).toEqual({
      status: 0,
      stdout: "ready\nnone\n",
    });
  });
});

describe("run-lease run", () => {
  it("D2280: prints its queue position and the holder while it waits", async () => {
    const err = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, { running: alive(PID, HOLDER_PID) });
      writeLease(c.dir, { ...owner("t-b", HOLDER_PID), at: NOW });
      await c.run([...RUN, "bun", "run", "check"]);
      return c.err;
    });
    expect(err).toEqual([
      "run-lease: WAITING, position 1, behind t-b (th-t-b): bun run check",
    ]);
  });

  it("D2281: records lane, thread, worktree without its trailing slash, command, pid and start time", async () => {
    const lease = await withTempAsync(async (tmp) => {
      let seen: unknown;
      const c = cli(tmp, (child) => {
        child.emit("spawn");
        seen = JSON.parse(readFileSync(join(tmp, "lease", LEASE_FILE), "utf8"));
        child.emit("exit", 0, null);
      });
      await c.run([...RUN, "bun", "run", "check"]);
      return seen;
    });
    expect(lease).toEqual({
      lane: "t-a",
      thread: "th-t-a",
      worktree: WORKTREE,
      command: COMMAND,
      pid: PID,
      at: NOW,
      childPid: CHILD_PID,
    });
  });

  it("D2282: records the run's pid in the lease once the run starts", async () => {
    const lease = await withTempAsync(async (tmp) => {
      let seen: { childPid?: number } | null = null;
      const c = cli(tmp, (child) => {
        child.emit("spawn");
        seen = readLease(join(tmp, "lease"));
        child.emit("exit", 0, null);
      });
      await c.run([...RUN, "bun", "run", "check"]);
      return seen as { childPid?: number } | null;
    });
    expect(lease?.childPid).toBe(CHILD_PID);
  });

  it("D2283: says RECLAIMED, naming the stale holder, when it takes a dead holder's lease", async () => {
    const err = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      writeLease(c.dir, { ...owner("t-old", HOLDER_PID), at: NOW });
      await c.run([...RUN, "bun", "run", "check"]);
      return c.err;
    });
    expect(err[0]).toBe(
      "run-lease: RECLAIMED a stale lease from t-old (th-t-old): bun run check, pid 9",
    );
  });

  it("D2284: beats the lease's heartbeat every 10 s while the run goes on", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const heartbeat = await withTempAsync(async (tmp) => {
        let clock = NOW;
        let seen = 0;
        const c = cli(
          tmp,
          (child) => {
            child.emit("spawn");
            clock = NOW + 30_000;
            vi.advanceTimersByTime(10_000);
            seen = statSync(join(tmp, "lease", LEASE_FILE)).mtimeMs;
            child.emit("exit", 0, null);
          },
          { now: () => clock },
        );
        await c.run([...RUN, "bun", "run", "check"]);
        return seen;
      });
      expect(heartbeat).toBe(NOW + 30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("D2285: exits with the run's own exit code", async () => {
    const code = await withTempAsync((tmp) =>
      cli(tmp, exitWith(3)).run([...RUN, "bun", "run", "check"]),
    );
    expect(code).toBe(3);
  });

  it("D2286: exits 127 when the program cannot start", async () => {
    const code = await withTempAsync((tmp) =>
      cli(tmp, (child) => {
        child.emit(
          "error",
          Object.assign(new Error("spawn npx ENOENT"), { code: "ENOENT" }),
        );
      }).run([...RUN, "npx", "vitest"]),
    );
    expect(code).toBe(127);
  });

  it("D2294: names the bun x remedy when a Windows .cmd shim cannot start", async () => {
    const err = await withTempAsync(async (tmp) => {
      const c = cli(
        tmp,
        (child) => {
          child.emit(
            "error",
            Object.assign(new Error("spawn npx ENOENT"), { code: "ENOENT" }),
          );
        },
        { platform: "win32" },
      );
      await c.run([...RUN, "npx", "vitest"]);
      return c.err;
    });
    expect(err).toContain(
      "run-lease: could not start npx: spawn npx ENOENT; a .cmd shim such as npx does not start without a shell, so run it through bun x",
    );
  });

  it("D2295: points TEMP and TMP at a per-run folder under the temp directory on Windows", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, {
        tempOptions: {
          platform: "win32",
          env: {},
          home: join(tmp, "home"),
          tmp: join(tmp, "tmp"),
        },
      });
      await c.run([...RUN, "bun", "run", "check"]);
      const env = c.spawned[0]?.env ?? {};
      return {
        expected: join(tmp, "tmp", "rt-test-runs", "wt-2-777"),
        vars: { TEMP: env.TEMP, TMP: env.TMP, TMPDIR: env.TMPDIR },
      };
    });
    expect(seen.vars).toEqual({
      TEMP: seen.expected,
      TMP: seen.expected,
      TMPDIR: undefined,
    });
  });

  it("D2296: points TMPDIR at a per-run folder under the home directory elsewhere", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      await c.run([...RUN, "bun", "run", "check"]);
      const env = c.spawned[0]?.env ?? {};
      return {
        expected: linuxRunDir(tmp),
        vars: { TEMP: env.TEMP, TMP: env.TMP, TMPDIR: env.TMPDIR },
      };
    });
    expect(seen.vars).toEqual({
      TEMP: undefined,
      TMP: undefined,
      TMPDIR: seen.expected,
    });
  });

  it("D2297: removes the run's temp folder after exit 0", async () => {
    const seen = await withTempAsync(async (tmp) => {
      let during = false;
      const c = cli(tmp, (child) => {
        during = existsSync(linuxRunDir(tmp));
        exitWith(0)(child);
      });
      await c.run([...RUN, "bun", "run", "check"]);
      return { during, after: existsSync(linuxRunDir(tmp)) };
    });
    expect(seen).toEqual({ during: true, after: false });
  });

  it("D2298: keeps the run's temp folder after a failing exit, and says where it is", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp, exitWith(1));
      await c.run([...RUN, "bun", "run", "check"]);
      return {
        kept: existsSync(linuxRunDir(tmp)),
        err: c.err,
        line: `run-lease: kept the run's temp folder ${linuxRunDir(tmp)} after exit 1`,
      };
    });
    expect({ kept: seen.kept, said: seen.err.includes(seen.line) }).toEqual({
      kept: true,
      said: true,
    });
  });

  it("D2299: sets leading NAME=value words in the run's environment rather than running them", async () => {
    const spawned = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      await c.run([...RUN, "FOO=bar", "node", "x.mjs"]);
      const [first] = c.spawned;
      return {
        program: first?.program,
        args: first?.args,
        foo: first?.env?.FOO,
      };
    });
    expect(spawned).toEqual({ program: "node", args: ["x.mjs"], foo: "bar" });
  });

  it("D2300: forwards SIGINT, SIGTERM and SIGHUP to its run", async () => {
    const kills = await withTempAsync(async (tmp) => {
      let child: FakeChild | undefined;
      const c = cli(tmp, (spawned) => {
        child = spawned;
        spawned.emit("spawn");
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
          c.signals.emit(signal, signal);
        }
        spawned.emit("exit", null, "SIGTERM");
      });
      await c.run([...RUN, "bun", "run", "check"]);
      return child?.kills;
    });
    expect(kills).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
  });

  it("D2301: keeps the lease after a forwarded signal until the run exits", async () => {
    const holder = await withTempAsync(async (tmp) => {
      let seen: number | undefined;
      const c = cli(tmp, (child) => {
        child.emit("spawn");
        c.signals.emit("SIGTERM", "SIGTERM");
        seen = readLease(join(tmp, "lease"))?.pid;
        child.emit("exit", null, "SIGTERM");
      });
      await c.run([...RUN, "bun", "run", "check"]);
      return seen;
    });
    expect(holder).toBe(PID);
  });

  it("D2302: runs under its own lane and thread's manual hold without queueing", async () => {
    const code = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, { running: alive(PID, 555) });
      writeLease(c.dir, { ...owner("t-a", 555), command: HOLD, at: NOW });
      return c.run([...RUN, "bun", "run", "check"]);
    });
    expect(code).toBe(0);
  });
});

describe("run-lease acquire", () => {
  it("D2303: holds the lease after ACQUIRED until it is released, then exits 0", async () => {
    const seen = await withTempAsync(async (tmp) => {
      let settled = false;
      let settledBeforeRelease: boolean | undefined;
      let released: Promise<void> = Promise.resolve();
      const out: string[] = [];
      const c = cli(tmp, undefined, {
        heartbeatMs: 1,
        out: (line) => {
          out.push(line);
          if (!line.startsWith("ACQUIRED")) return;
          released = sleep(20).then(() => {
            settledBeforeRelease = settled;
            releaseLane(join(tmp, "lease"), "t-a");
          });
        },
      });
      const code = await c
        .run(["acquire", "--lane", "t-a", "--thread", "th-t-a"])
        .finally(() => {
          settled = true;
        });
      await released;
      return { code, settledBeforeRelease, out };
    });
    expect(seen).toEqual({
      code: 0,
      settledBeforeRelease: false,
      out: [
        "ACQUIRED t-a (th-t-a): acquire (a manual hold); holding until release",
        "RELEASED t-a (th-t-a): acquire (a manual hold)",
      ],
    });
  });
});

describe("run-lease release", () => {
  it("D2304: releases the lease its own lane holds", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      writeLease(c.dir, { ...owner("t-a", HOLDER_PID), at: NOW });
      const code = await c.run(["release", "--lane", "t-a"]);
      return { code, out: c.out, left: existsSync(join(c.dir, LEASE_FILE)) };
    });
    expect(seen).toEqual({
      code: 0,
      out: ["RELEASED t-a (th-t-a): bun run check"],
      left: false,
    });
  });

  it("D2305: refuses to release another lane's lease, exiting 1", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      writeLease(c.dir, { ...owner("t-b", HOLDER_PID), at: NOW });
      const code = await c.run(["release", "--lane", "t-a"]);
      return { code, err: c.err, left: existsSync(join(c.dir, LEASE_FILE)) };
    });
    expect(seen).toEqual({
      code: 1,
      err: ["REFUSED held by t-b (th-t-b): bun run check, not by t-a"],
      left: true,
    });
  });

  it("D2306: reports NONE and exits 0 when nothing is held", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      const code = await c.run(["release", "--lane", "t-a"]);
      return { code, out: c.out };
    });
    expect(seen).toEqual({ code: 0, out: ["NONE no lease is held"] });
  });
});

describe("run-lease status", () => {
  it("D2307: reports a dead holder's lease as STALE under NORUN, never BUSY", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      writeLease(c.dir, { ...owner("t-a", HOLDER_PID), at: NOW });
      const code = await c.run(["status"]);
      return { code, out: c.out };
    });
    expect(seen).toEqual({
      code: 0,
      out: [
        "NORUN",
        "STALE t-a (th-t-a): bun run check, pid 9; the next run reclaims it",
      ],
    });
  });

  it("D2308: reports the live holder as BUSY and numbers each waiter from 1", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, { running: alive(HOLDER_PID, 10) });
      writeLease(c.dir, { ...owner("t-a", HOLDER_PID), at: NOW - 120_000 });
      const entry = joinQueue(c.dir, owner("t-b", 10), NOW - 60_000);
      beat(entry.file, NOW);
      const code = await c.run(["status"]);
      return { code, out: c.out };
    });
    expect(seen).toEqual({
      code: 0,
      out: [
        "BUSY t-a (th-t-a): bun run check, pid 9 in /src/wt-2, 2 min",
        "QUEUED 1 t-b (th-t-b): bun run check, 1 min",
      ],
    });
  });

  it("D2362: reports a lease kept only by its recorded run as ORPHANED", async () => {
    const out = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, { running: alive(10) });
      writeLease(c.dir, { ...owner("t-a", HOLDER_PID), at: NOW, childPid: 10 });
      await c.run(["status"]);
      return c.out;
    });
    expect(out).toEqual([
      "ORPHANED t-a (th-t-a): bun run check, wrapper pid 9 gone, run pid 10",
    ]);
  });
});

describe("lease store, after a review", () => {
  it("D2360: reclaims a killed wrapper's lease once its run has held it over 60 min, and not at exactly 60 min", () => {
    const taken = [3_600_001, 3_600_000].map((age) =>
      withTemp(
        (tmp) =>
          headTurn(
            join(tmp, "lease"),
            { ...owner("t-b", HOLDER_PID), at: NOW - age, childPid: 10 },
            NOW - age,
            alive(1, 10),
          ).taken,
      ),
    );
    expect(taken).toEqual([true, false]);
  });

  it("D2361: reclaims a lease whose holder and recorded run have both ended", () => {
    const turn = withTemp((tmp) =>
      headTurn(
        join(tmp, "lease"),
        { ...owner("t-b", HOLDER_PID), at: NOW, childPid: 10 },
        NOW,
        alive(1),
      ),
    );
    expect(turn.taken).toBe(true);
  });

  it("D2363: skips a dead waiter at the head of the queue", () => {
    const turn = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      joinQueue(dir, owner("t-a", 1), NOW);
      const second = joinQueue(dir, owner("t-b", 2), NOW + 1);
      return takeTurn(dir, second, { now: NOW + 2, running: alive(2) });
    });
    expect(turn.taken).toBe(true);
  });

  it("D2364: leaves a successor's lease in place when a wrapper that lost it releases", () => {
    const seen = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      writeLease(dir, { ...owner("t-b", 20), at: NOW });
      const released = releaseOwn(dir, PID);
      return { released, left: existsSync(join(dir, LEASE_FILE)) };
    });
    expect(seen).toEqual({ released: false, left: true });
  });

  it("D2365: writes no run pid into a successor's lease", () => {
    const seen = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      writeLease(dir, { ...owner("t-b", 20), at: NOW });
      const recorded = recordChild(dir, PID, CHILD_PID, NOW);
      return { recorded, childPid: readLease(dir)?.childPid };
    });
    expect(seen).toEqual({ recorded: false, childPid: undefined });
  });
});

describe("run-lease run, after a review", () => {
  it("D2366: exits 1 and keeps the temp folder when a signal ends the run", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const code = await cli(tmp, (child) => {
        child.emit("spawn");
        child.emit("exit", null, "SIGTERM");
      }).run([...RUN, "bun", "run", "check"]);
      return { code, kept: existsSync(linuxRunDir(tmp)) };
    });
    expect(seen).toEqual({ code: 1, kept: true });
  });

  it("D2367: reclaims a dead acquire's hold rather than running under it", async () => {
    const err = await withTempAsync(async (tmp) => {
      const c = cli(tmp);
      writeLease(c.dir, { ...owner("t-a", 555), command: HOLD, at: NOW });
      await c.run([...RUN, "bun", "run", "check"]);
      return c.err;
    });
    expect(err[0]).toBe(
      "run-lease: RECLAIMED a stale lease from t-a (th-t-a): acquire (a manual hold), pid 555",
    );
  });

  it("D2368: queues behind its own lane's hold taken from another thread", async () => {
    const result = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, { running: alive(PID, 555) });
      writeLease(c.dir, {
        ...owner("t-a", 555),
        thread: "th-other",
        command: HOLD,
        at: NOW,
      });
      return c.run([...RUN, "bun", "run", "check"]);
    });
    expect(result).toBe(`Error: ${QUEUED}`);
  });

  it("D2369: records itself as the hold's run, and queues when the hold vanishes before it can", async () => {
    const underHold = await withTempAsync(async (tmp) => {
      let during: number | undefined;
      const c = cli(
        tmp,
        (child) => {
          child.emit("spawn");
          during = readLease(join(tmp, "lease"))?.childPid;
          child.emit("exit", 0, null);
        },
        { running: alive(PID, 555) },
      );
      writeLease(c.dir, { ...owner("t-a", 555), command: HOLD, at: NOW });
      await c.run([...RUN, "bun", "run", "check"]);
      return { during, after: readLease(c.dir)?.childPid };
    });
    const vanished = await withTempAsync(async (tmp) => {
      let gone = false;
      const dir = join(tmp, "lease");
      const c = cli(tmp, undefined, {
        running: (pid) => {
          if (pid === 555 && !gone) {
            gone = true;
            rmSync(join(dir, LEASE_FILE));
          }
          return pid === 555 || pid === PID;
        },
      });
      writeLease(dir, { ...owner("t-a", 555), command: HOLD, at: NOW });
      await c.run([...RUN, "bun", "run", "check"]);
      return c.err[0]?.startsWith("run-lease: LEASED to t-a (th-t-a)");
    });
    expect({ ...underHold, vanished }).toEqual({
      during: PID,
      after: PID,
      vanished: true,
    });
  });

  it("D2370: exits 127 with the bun x remedy when spawn throws EINVAL for a Windows .cmd", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, {
        platform: "win32",
        spawn: () => {
          throw Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });
        },
      });
      const code = await c.run([...RUN, "npx", "vitest"]);
      return {
        code,
        said: c.err.includes(
          "run-lease: could not start npx: spawn EINVAL; a .cmd shim such as npx does not start without a shell, so run it through bun x",
        ),
      };
    });
    expect(seen).toEqual({ code: 127, said: true });
  });

  it("D2371: keeps waiting for a started run after a late error, holding the lease", async () => {
    const seen = await withTempAsync(async (tmp) => {
      let held: number | undefined;
      const c = cli(tmp, (child) => {
        child.emit("spawn");
        child.emit("error", new Error("late failure"));
        held = readLease(join(tmp, "lease"))?.pid;
        child.emit("exit", 0, null);
      });
      const code = await c.run([...RUN, "bun", "run", "check"]);
      return { code, held, said: c.err.includes("run-lease: late failure") };
    });
    expect(seen).toEqual({ code: 0, held: PID, said: true });
  });

  it("D2372: reports a heartbeat that cannot be written rather than dying", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const seen = await withTempAsync(async (tmp) => {
        let threw: string | undefined;
        const lease = join(tmp, "lease", LEASE_FILE);
        const c = cli(tmp, (child) => {
          child.emit("spawn");
          rmSync(lease);
          mkdirSync(lease);
          try {
            vi.advanceTimersByTime(10_000);
          } catch (error) {
            threw = String(error);
          }
          rmSync(lease, { recursive: true, force: true });
          child.emit("exit", 0, null);
        });
        await c.run([...RUN, "bun", "run", "check"]);
        return {
          threw,
          said: c.err.some((line) =>
            line.startsWith("run-lease: could not beat the lease: "),
          ),
        };
      });
      expect(seen).toEqual({ threw: undefined, said: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("D2373: reports a run pid that cannot be recorded rather than dying", async () => {
    const seen = await withTempAsync(async (tmp) => {
      let threw: string | undefined;
      const lease = join(tmp, "lease", LEASE_FILE);
      const c = cli(tmp, (child) => {
        rmSync(lease);
        mkdirSync(lease);
        try {
          child.emit("spawn");
        } catch (error) {
          threw = String(error);
        }
        rmSync(lease, { recursive: true, force: true });
        child.emit("exit", 0, null);
      });
      await c.run([...RUN, "bun", "run", "check"]);
      return {
        threw,
        said: c.err.some((line) =>
          line.startsWith(
            "run-lease: could not record run pid 4242 in the lease: ",
          ),
        ),
      };
    });
    expect(seen).toEqual({ threw: undefined, said: true });
  });

  it("D2375: makes no temp folder while it waits its turn", async () => {
    const seen = await withTempAsync(async (tmp) => {
      const c = cli(tmp, undefined, { running: alive(PID, HOLDER_PID) });
      writeLease(c.dir, { ...owner("t-b", HOLDER_PID), at: NOW });
      const result = await c.run([...RUN, "bun", "run", "check"]);
      return { result, made: existsSync(linuxRunDir(tmp)) };
    });
    expect(seen).toEqual({ result: `Error: ${QUEUED}`, made: false });
  });
});

describe("run-lease acquire, after a review", () => {
  it("D2374: says LOST, naming the new holder, when its hold is taken", async () => {
    const out = await withTempAsync(async (tmp) => {
      let taken: Promise<void> = Promise.resolve();
      const lines: string[] = [];
      const dir = join(tmp, "lease");
      const c = cli(tmp, undefined, {
        heartbeatMs: 1,
        running: alive(PID, 20),
        out: (line) => {
          lines.push(line);
          if (!line.startsWith("ACQUIRED")) return;
          taken = sleep(20).then(() =>
            writeLease(dir, { ...owner("t-b", 20), at: NOW }),
          );
        },
      });
      await c.run(["acquire", "--lane", "t-a", "--thread", "th-t-a"]);
      await taken;
      return lines;
    });
    expect(out[1]).toBe(
      "LOST t-a (th-t-a): acquire (a manual hold) to t-b (th-t-b): bun run check",
    );
  });
});
