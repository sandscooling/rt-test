export interface LeaseOwner {
  readonly lane: string;
  readonly thread: string;
  readonly worktree: string;
  readonly command: string;
  readonly pid: number;
}

export interface LeaseRecord extends Partial<LeaseOwner> {
  readonly lane: string;
  readonly thread: string;
  readonly command: string;
  readonly at?: number;
  readonly childPid?: number;
  readonly heartbeatAt: number;
  readonly file: string;
}

export interface QueueEntry {
  readonly file: string;
  readonly owner: LeaseOwner;
}

export interface Clock {
  readonly now?: number;
  readonly running?: (pid: number | undefined) => boolean;
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
export declare function isStale(
  record: LeaseRecord,
  now?: number,
  running?: (pid: number | undefined) => boolean,
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
): boolean;
export declare function releaseOwn(dir: string, pid: number): boolean;
export declare function releaseLane(dir: string, lane: string): ReleaseResult;
export declare function leaseStatus(dir: string, options?: Clock): LeaseStatus;
