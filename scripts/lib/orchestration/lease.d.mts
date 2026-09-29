import type { ProcessIdentity } from "../../../test/scripts/run-cleanup.mjs";

export interface LeaseOwner {
  readonly lane: string;
  readonly thread: string;
  readonly worktree: string;
  readonly command: string;
  readonly pid: number;
  /** The OS start time of `pid` as decimal text; absent when it could not be read, which leaves the pid alone. */
  readonly startedAt?: string;
}

export interface LeaseRecord extends Partial<LeaseOwner> {
  readonly lane: string;
  readonly thread: string;
  readonly command: string;
  readonly at?: number;
  readonly childPid?: number;
  readonly childStartedAt?: string;
  readonly heartbeatAt: number;
  readonly file: string;
}

export interface QueueEntry {
  readonly file: string;
  readonly owner: LeaseOwner;
}

/** Whether a process holds `pid`, and is the one started at `startedAt` when that is given. */
export type ProcessProbe = (
  pid: number | undefined,
  startedAt?: string,
) => boolean;

export interface Clock {
  readonly now?: number;
  readonly running?: ProcessProbe;
}

export type TurnResult =
  | {
      readonly taken: true;
      readonly reclaimed: LeaseRecord | null;
      readonly file: string;
    }
  | {
      readonly taken: false;
      readonly rejoin: boolean;
      readonly position: number;
      readonly holder: LeaseRecord | null;
    };

export declare const RELEASE: Readonly<{
  RELEASED: "released";
  REFUSED: "refused";
  NONE: "none";
}>;

export interface ReleaseResult {
  readonly status: (typeof RELEASE)[keyof typeof RELEASE];
  readonly holder: LeaseRecord | null;
}

export interface LeaseStatus {
  readonly holder: LeaseRecord | null;
  readonly orphaned: boolean;
  readonly stale: LeaseRecord | null;
  readonly queue: LeaseRecord[];
}

export declare const LEASE_DIR: string;
export declare const HEARTBEAT_MS: number;

export declare function beat(file: string, now?: number): boolean;
export declare function readLease(dir: string): LeaseRecord | null;
export declare function processProbe(
  report: (message: string) => void,
  options?: {
    readonly now?: () => number;
    readonly confirm?: (owner: ProcessIdentity) => boolean;
  },
): ProcessProbe;
export declare function isStale(
  record: LeaseRecord,
  now?: number,
  running?: ProcessProbe,
): boolean;
export declare function joinQueue(
  dir: string,
  owner: LeaseOwner,
  now?: number,
): QueueEntry;
export declare function takeTurn(
  dir: string,
  entry: QueueEntry,
  options?: Clock,
): TurnResult;
export declare function recordChild(
  dir: string,
  pid: number,
  childPid: number,
  now?: number,
  childStartedAt?: string,
): boolean;
export declare function releaseOwn(dir: string, pid: number): boolean;
export declare function releaseLane(dir: string, lane: string): ReleaseResult;
export declare function leaseStatus(dir: string, options?: Clock): LeaseStatus;
