import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  beat,
  type LeaseOwner,
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
