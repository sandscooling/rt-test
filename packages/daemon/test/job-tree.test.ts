import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonStatus, stopDaemon } from "../src/client.js";
import {
  DAEMON_TEST_TIMEOUT_MS,
  atHoldPoint,
  IDLE_ENTRY,
  WORKSPACE_A,
  eventually,
  fixtureFile,
  logged,
  settled,
  started,
  withDaemonConsumer,
} from "./daemon-harness.js";
import { confirmEvery } from "./harness.js";

/** A heartbeat as the fixture writes it: the child's process id and the time, in ms. */
const BEAT_PATTERN = /^(\d+) (\d+)$/;
/** A child rewrites its file in place, so a read can land between the truncation and the write. */
const TORN_READ_RETRIES = 20;

interface Beat {
  readonly pid: number;
  readonly at: number;
}

function readBeat(file: string): Beat | undefined {
  for (let attempt = 0; attempt < TORN_READ_RETRIES; attempt += 1) {
    const match = BEAT_PATTERN.exec(readFileSync(file, "utf8"));
    if (match !== null) return { pid: Number(match[1]), at: Number(match[2]) };
  }
  return undefined;
}

/** Each heartbeat file the daemon fixture's `packages/a` holds, by name, with the last beat it could read. */
function heartbeats(root: string): Map<string, Beat | undefined> {
  const directory = join(root, WORKSPACE_A);
  return new Map(
    readdirSync(directory)
      .filter((name) => name.startsWith("heartbeat-"))
      .map((name) => [name, readBeat(join(directory, name))]),
  );
}

/** Ten of the fixture's 50 ms heartbeats. */
const BEAT_WINDOW_MS = 500;

/** The process ids of the heartbeat children still running: those whose beat advanced over the beat window. */
async function stillBeating(root: string): Promise<number[]> {
  const before = heartbeats(root);
  await new Promise((wake) => setTimeout(wake, BEAT_WINDOW_MS));
  return [...heartbeats(root)].flatMap(([name, beat]) =>
    beat !== undefined && beat.at > (before.get(name)?.at ?? 0)
      ? [beat.pid]
      : [],
  );
}

describe("what a job starts ends with the job", () => {
  /** Past the moment a Windows job object ends an exited executor's tree, before the beat window opens. */
  const AFTER_IDLE_MS = 250;

  /** Runs every workspace with each global setup and test starting a heartbeat child as `spawnChildren` says. */
  function childrenAfterIdle(spawnChildren: string) {
    return withDaemonConsumer(async (root, pids) => {
      writeFileSync(fixtureFile(root, "spawn-children"), spawnChildren);
      const identity = await started(root, pids, confirmEvery(root));
      if ("thrown" in identity) return identity;
      const idle = await eventually(() => logged(identity.logFile, IDLE_ENTRY));
      await new Promise((wake) => setTimeout(wake, AFTER_IDLE_MS));
      const alive = await stillBeating(root);
      for (const pid of alive) process.kill(pid, "SIGKILL");
      const status = await settled(daemonStatus(root));
      return {
        idle,
        spawned: heartbeats(root).size,
        alive,
        serving: !("thrown" in status),
      };
    });
  }

  it(
    "D1665: a global setup stuck in synchronous code, which started a child through a shell, is ended at the executor bound with that child",
    async () => {
      const outcome = await withDaemonConsumer(async (root, pids) => {
        writeFileSync(fixtureFile(root, "spawn-children"), "shell");
        writeFileSync(fixtureFile(root, "stick-at"), "2");
        const identity = await started(root, pids, confirmEvery(root));
        if ("thrown" in identity) return identity;
        await atHoldPoint(root, "stuck");
        const stuckWith = await stillBeating(root);
        const stop = await settled(stopDaemon(root));
        const alive = await stillBeating(root);
        for (const pid of alive) process.kill(pid, "SIGKILL");
        return { stuckWith: stuckWith.length, stop, alive };
      });
      expect(outcome).toStrictEqual({
        stuckWith: 1,
        stop: undefined,
        alive: [],
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1661: once every job has ended, with the daemon still serving, no child a global setup or a test started through a shell still runs",
    async () => {
      expect(await childrenAfterIdle("shell")).toStrictEqual({
        idle: true,
        spawned: 6,
        alive: [],
        serving: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D1660: once every job has ended, with the daemon still serving, no child a global setup or a test started, in a thread or a forked worker, still runs",
    async () => {
      expect(await childrenAfterIdle("")).toStrictEqual({
        idle: true,
        spawned: 6,
        alive: [],
        serving: true,
      });
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
