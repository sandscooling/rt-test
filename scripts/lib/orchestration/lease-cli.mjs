import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { processRecords } from "../../../test/scripts/run-cleanup.mjs";
import { toPosix } from "../paths.mjs";
import { mainCheckoutRoot } from "./claims-cli.mjs";
import {
  beat,
  HEARTBEAT_MS,
  isStale,
  joinQueue,
  LEASE_DIR,
  leaseStatus,
  processProbe,
  readLease,
  recordChild,
  RELEASE,
  releaseLane,
  releaseOwn,
  takeTurn,
} from "./lease.mjs";
import { ASSIGNMENT } from "./shell-segments.mjs";

const PROG = "run-lease";
const EXIT = { OK: 0, FAILED: 1, USAGE: 2, NOT_STARTED: 127 };
const POLL_MS = 1000;
const MS_PER_MINUTE = 60_000;
const VALUE_FLAGS = new Set(["--lane", "--thread"]);
const COMMAND_SEPARATOR = "--";
const HOLD_COMMAND = "acquire (a manual hold)";
const TRAILING_SLASHES = /\/+$/;
const RUNS_FOLDER_WINDOWS = "rt-test-runs";
const RUNS_FOLDER_HOME = ".rt-test-runs";
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const WINDOWS_RUNNER = "bun x";
const SHIM_START_ERRORS = new Set(["ENOENT", "EINVAL"]);
const USAGE = [
  "  run      --lane <name> --thread <threadId> -- <command> [<arg>...]",
  "  acquire  --lane <name> --thread <threadId>",
  "  release  --lane <name>",
  "  status",
];

class UsageError extends Error {}

// Every worktree shares the main checkout's lease, since they share one machine.
export const leaseDirFor = (root, env = process.env) =>
  env.RUN_LEASE_DIR ?? join(mainCheckoutRoot(root), LEASE_DIR);

/**
 * The per-run temp folder, outside the repository, and the environment that points the run at it. Node on Windows
 * reads TEMP and TMP, never TMPDIR; on Linux the folder sits under the home directory, since WSL clears /tmp.
 */
function runTempDir(
  root,
  pid,
  {
    platform = process.platform,
    env = process.env,
    home = homedir(),
    tmp = tmpdir(),
  } = {},
) {
  const name = `${basename(root)}-${pid}`;
  if (platform === "win32") {
    const dir = join(tmp, RUNS_FOLDER_WINDOWS, name);
    return { dir, env: { ...env, TEMP: dir, TMP: dir } };
  }
  const dir = join(home, RUNS_FOLDER_HOME, name);
  return { dir, env: { ...env, TMPDIR: dir } };
}

function parseArgs(argv) {
  const split = argv.indexOf(COMMAND_SEPARATOR);
  const own = split === -1 ? argv : argv.slice(0, split);
  const command = split === -1 ? [] : argv.slice(split + 1);
  const flags = {};
  for (let i = 0; i < own.length; i++) {
    if (!VALUE_FLAGS.has(own[i])) {
      throw new UsageError(`unexpected argument ${JSON.stringify(own[i])}`);
    }
    const value = own[i + 1];
    if (value === undefined) throw new UsageError(`${own[i]} needs a value`);
    flags[own[i].slice(2)] = value;
    i++;
  }
  return { flags, command };
}

function requireOwner(name, { flags }) {
  if (!flags.lane || !flags.thread) {
    throw new UsageError(`${name} needs --lane and --thread`);
  }
  return { lane: flags.lane, thread: flags.thread };
}

const age = (ctx, record) =>
  Math.round((ctx.now() - (record.at ?? record.heartbeatAt)) / MS_PER_MINUTE);

const describe = (record) =>
  `${record.lane} (${record.thread}): ${record.command}`;

function holderLine(ctx, holder, orphaned) {
  if (!holder) return "NORUN";
  if (orphaned) {
    return `ORPHANED ${describe(holder)}, wrapper pid ${holder.pid} gone, run pid ${holder.childPid}`;
  }
  return `BUSY ${describe(holder)}, pid ${holder.pid} in ${holder.worktree}, ${age(ctx, holder)} min`;
}

function status(ctx) {
  const { holder, orphaned, stale, queue } = leaseStatus(ctx.dir, clock(ctx));
  ctx.out(holderLine(ctx, holder, orphaned));
  if (stale) {
    ctx.out(
      `STALE ${describe(stale)}, pid ${stale.pid}; the next run reclaims it`,
    );
  }
  queue.forEach((entry, i) =>
    ctx.out(`QUEUED ${i + 1} ${describe(entry)}, ${age(ctx, entry)} min`),
  );
  return EXIT.OK;
}

function release(ctx, args) {
  const { lane } = args.flags;
  if (!lane) throw new UsageError("release needs --lane");
  const result = releaseLane(ctx.dir, lane);
  if (result.status === RELEASE.NONE) {
    ctx.out("NONE no lease is held");
    return EXIT.OK;
  }
  if (result.status === RELEASE.REFUSED) {
    ctx.err(`REFUSED held by ${describe(result.holder)}, not by ${lane}`);
    return EXIT.FAILED;
  }
  ctx.out(`RELEASED ${describe(result.holder)}`);
  return EXIT.OK;
}

const clock = (ctx) => ({ now: ctx.now(), running: ctx.running });

function reportWait(ctx, turn, last) {
  const holder = turn.holder ? describe(turn.holder) : "the waiter ahead";
  const line = `${PROG}: WAITING, position ${turn.position + 1}, behind ${holder}`;
  if (line !== last) ctx.err(line);
  return line;
}

/** Queues the owner and resolves once it holds the lease. */
async function waitTurn(ctx, owner) {
  let entry = joinQueue(ctx.dir, owner, ctx.now());
  let last = "";
  for (;;) {
    const turn = takeTurn(ctx.dir, entry, clock(ctx));
    if (turn.taken) {
      if (turn.reclaimed) {
        ctx.err(
          `${PROG}: RECLAIMED a stale lease from ${describe(turn.reclaimed)}, pid ${turn.reclaimed.pid}`,
        );
      }
      return turn.file;
    }
    if (turn.rejoin) entry = joinQueue(ctx.dir, owner, ctx.now());
    else last = reportWait(ctx, turn, last);
    beat(entry.file, ctx.now());
    await ctx.sleep(POLL_MS);
  }
}

/** Beats the lease while this process holds it; `onLost` runs once another holder or a release takes it. */
function keepAlive(ctx, file, pid, onLost) {
  const tick = () => {
    if (readLease(ctx.dir)?.pid === pid) beat(file, ctx.now());
    else {
      clearInterval(timer);
      onLost();
    }
  };
  const timer = setInterval(() => {
    try {
      tick();
    } catch (error) {
      ctx.err(`${PROG}: could not beat the lease: ${error.message}`);
    }
  }, ctx.heartbeatMs);
  return () => clearInterval(timer);
}

function exitCodeOf(code) {
  if (code !== null) return code;
  return EXIT.FAILED;
}

// Leading NAME=value words set the run's environment, as a shell would, rather than name the program.
function splitAssignments(command) {
  const at = command.findIndex((word) => !ASSIGNMENT.test(word));
  const words = at === -1 ? [] : command.slice(at);
  const assigned = command.slice(0, at === -1 ? command.length : at);
  const vars = Object.fromEntries(
    assigned.map((word) => [
      word.slice(0, word.indexOf("=")),
      word.slice(word.indexOf("=") + 1),
    ]),
  );
  return { vars, words };
}

function startFailure(ctx, program, error) {
  const shim =
    ctx.platform === "win32" && SHIM_START_ERRORS.has(error.code)
      ? `; a .cmd shim such as npx does not start without a shell, so run it through ${WINDOWS_RUNNER}`
      : "";
  ctx.err(`${PROG}: could not start ${program}: ${error.message}${shim}`);
}

// A termination signal reaches the wrapper alone when only it is signalled, so pass it on and wait for the run.
function forwardSignals(ctx, child) {
  const forward = (signal) => child.kill(signal);
  for (const signal of FORWARDED_SIGNALS) ctx.signals.on(signal, forward);
  return () => {
    for (const signal of FORWARDED_SIGNALS) ctx.signals.off(signal, forward);
  };
}

// Node reports most start failures as an 'error' event, but throws some (EINVAL for a Windows .cmd) from spawn itself.
function spawnChild(ctx, program, args, env) {
  try {
    return {
      child: ctx.spawn(program, args, {
        stdio: "inherit",
        env,
        windowsHide: true,
      }),
    };
  } catch (error) {
    return { error };
  }
}

function runChild(ctx, command, env, onStart) {
  return new Promise((resolveCode) => {
    const [program, ...args] = command;
    const notStarted = (error) => {
      startFailure(ctx, program, error);
      resolveCode(EXIT.NOT_STARTED);
    };
    const { child, error } = spawnChild(ctx, program, args, env);
    if (!child) {
      notStarted(error);
      return;
    }
    const unforward = forwardSignals(ctx, child);
    let started = false;
    child.once("spawn", () => {
      started = true;
      onStart(child.pid);
    });
    child.on("error", (failure) => {
      if (started) {
        ctx.err(`${PROG}: ${failure.message}`);
        return;
      }
      unforward();
      notStarted(failure);
    });
    child.once("exit", (code) => {
      unforward();
      resolveCode(exitCodeOf(code));
    });
  });
}

function removeTemp(ctx, dir, code) {
  if (code !== EXIT.OK) {
    ctx.err(`${PROG}: kept the run's temp folder ${dir} after exit ${code}`);
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    ctx.err(`${PROG}: could not remove ${dir}: ${error.message}`);
  }
}

/** The OS start time of `pid` as decimal text, or undefined when it cannot be read, which leaves the pid alone to judge it. */
function startTimeOf(ctx, pid) {
  try {
    return ctx.startedAt(pid);
  } catch (error) {
    ctx.err(
      `${PROG}: process ${pid} is recorded by its pid alone, since its start time could not be read: ${error.message}`,
    );
    return undefined;
  }
}

const readStartTime = (pid) =>
  processRecords([pid]).get(pid)?.startedAt.toString();

const leaseRecord = (ctx, owner, command) => ({
  ...owner,
  worktree: toPosix(ctx.root).replace(TRAILING_SLASHES, ""),
  command,
  pid: ctx.pid,
  startedAt: startTimeOf(ctx, ctx.pid),
});

// A live manual hold by the same lane and thread lets its own runs through without queueing behind it.
function ownHold(ctx, owner) {
  const current = readLease(ctx.dir);
  const own =
    current !== null &&
    current.command === HOLD_COMMAND &&
    current.lane === owner.lane &&
    current.thread === owner.thread &&
    !isStale(current, ctx.now(), ctx.running);
  return own ? current : null;
}

// The pid goes in first, since reading the start time can take seconds and a lease naming no run lapses with its wrapper.
function recordRun(ctx, childPid) {
  try {
    if (!recordChild(ctx.dir, ctx.pid, childPid, ctx.now())) return;
    const childStartedAt = startTimeOf(ctx, childPid);
    if (childStartedAt === undefined) return;
    recordChild(ctx.dir, ctx.pid, childPid, ctx.now(), childStartedAt);
  } catch (error) {
    ctx.err(
      `${PROG}: could not record run pid ${childPid} in the lease: ${error.message}`,
    );
  }
}

async function runLeased(ctx, record, words, env) {
  const file = await waitTurn(ctx, record);
  const stop = keepAlive(ctx, file, ctx.pid, () =>
    ctx.err(
      `${PROG}: LOST the lease mid-run; another run may overlap this one`,
    ),
  );
  try {
    ctx.err(`${PROG}: LEASED to ${describe(record)}; temp ${env.dir}`);
    mkdirSync(env.dir, { recursive: true });
    return await runChild(ctx, words, env.vars, (childPid) =>
      recordRun(ctx, childPid),
    );
  } finally {
    stop();
    releaseOwn(ctx.dir, ctx.pid);
  }
}

// Marks this wrapper as the hold's run, so a waiter keeps out while it runs. False once the hold is gone.
function joinOwnHold(ctx, record) {
  const hold = ownHold(ctx, record);
  return (
    hold !== null &&
    recordChild(ctx.dir, hold.pid, ctx.pid, ctx.now(), record.startedAt)
  );
}

async function run(ctx, args) {
  const owner = requireOwner("run", args);
  const { vars, words } = splitAssignments(args.command);
  if (words.length === 0) {
    throw new UsageError(`run needs ${COMMAND_SEPARATOR} and a command`);
  }
  const record = leaseRecord(ctx, owner, args.command.join(" "));
  const temp = runTempDir(ctx.root, ctx.pid, ctx.tempOptions);
  const env = { dir: temp.dir, vars: { ...temp.env, ...vars } };
  let code;
  if (joinOwnHold(ctx, record)) {
    ctx.err(`${PROG}: RUNNING under this lane's hold; temp ${temp.dir}`);
    mkdirSync(temp.dir, { recursive: true });
    code = await runChild(ctx, words, env.vars, () => {});
  } else {
    code = await runLeased(ctx, record, words, env);
    ctx.err(`${PROG}: RELEASED after exit ${code}`);
  }
  removeTemp(ctx, temp.dir, code);
  return code;
}

async function acquire(ctx, args) {
  const owner = requireOwner("acquire", args);
  if (args.command.length > 0) {
    throw new UsageError("acquire takes no command; use run for one");
  }
  const record = leaseRecord(ctx, owner, HOLD_COMMAND);
  const file = await waitTurn(ctx, record);
  ctx.out(`ACQUIRED ${describe(record)}; holding until release`);
  await new Promise((resolveHold) =>
    keepAlive(ctx, file, ctx.pid, resolveHold),
  );
  const current = readLease(ctx.dir);
  if (current === null) ctx.out(`RELEASED ${describe(record)}`);
  else ctx.out(`LOST ${describe(record)} to ${describe(current)}`);
  return EXIT.OK;
}

/**
 * Why a heavy run started without the wrapper is denied, naming the live holder when there is one. Without
 * `options.running` the holder is judged by pid alone: the run is denied either way, and a start-time query takes seconds.
 */
export function heavyRunDenial(dir, command, options = {}) {
  const queue = `To queue, run it as: node scripts/run-lease.mjs run --lane <group> --thread <threadId> -- ${command}`;
  const holder = readLease(dir);
  if (!holder || isStale(holder, options.now, options.running)) return queue;
  return `held by ${holder.lane} (${holder.thread}); wait for release or ask the orchestrator; do not retry. ${queue}`;
}

const COMMANDS = { run, acquire, release, status };

/** Runs one command and resolves with its exit code; `ctx.out` and `ctx.err` take one line each. */
export async function runLeaseCli(argv, ctx) {
  const [name, ...rest] = argv;
  const full = {
    now: Date.now,
    spawn,
    sleep,
    pid: process.pid,
    heartbeatMs: HEARTBEAT_MS,
    platform: process.platform,
    signals: process,
    startedAt: readStartTime,
    ...ctx,
  };
  full.running ??= processProbe((message) => full.err(`${PROG}: ${message}`));
  try {
    if (!Object.hasOwn(COMMANDS, name ?? "")) {
      throw new UsageError(`unknown command ${JSON.stringify(name ?? "")}`);
    }
    return await COMMANDS[name](full, parseArgs(rest));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    full.err(`${PROG}: ${error.message}`);
    for (const line of USAGE) full.err(line);
    return EXIT.USAGE;
  }
}
