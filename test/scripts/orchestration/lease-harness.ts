import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  beat,
  type LeaseOwner,
  type LeaseRecord,
  type ProcessProbe,
} from "../../../scripts/lib/orchestration/lease.mjs";

export const NOW = 1_700_000_000_000;
export const HOLDER_PID = 9;
export const WORKTREE = "/src/wt-2";
export const COMMAND = "bun run check";
export const LEASE_FILE = "lease.json";

export const owner = (lane: string, pid: number): LeaseOwner => ({
  lane,
  thread: `th-${lane}`,
  worktree: WORKTREE,
  command: COMMAND,
  pid,
});

/** A process-liveness probe that answers yes for exactly `pids`. */
export const alive =
  (...pids: number[]) =>
  (pid: number | undefined) =>
    pid !== undefined && pids.includes(pid);

/**
 * A process probe that answers as the OS does: `processes` maps each held id to the start time of the process
 * holding it, and a probe given a start time is answered by that process alone.
 */
export const holds =
  (processes: Readonly<Record<number, string>>): ProcessProbe =>
  (pid, startedAt) => {
    const held = pid === undefined ? undefined : processes[pid];
    return (
      held !== undefined && (startedAt === undefined || startedAt === held)
    );
  };

/** A holder record for lane t-b, its heartbeat `age` ms before NOW, with `fields` laid over it. */
export const recordAged = (
  age: number,
  fields: Partial<LeaseRecord> = {},
): LeaseRecord => ({
  ...owner("t-b", HOLDER_PID),
  at: NOW,
  heartbeatAt: NOW - age,
  file: LEASE_FILE,
  ...fields,
});

/** Writes `record` as the lease in `dir`, its heartbeat stamped at `heartbeatAt`. */
export function writeLease(
  dir: string,
  record: Record<string, unknown>,
  heartbeatAt = NOW,
): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, LEASE_FILE), JSON.stringify(record));
  beat(join(dir, LEASE_FILE), heartbeatAt);
}
