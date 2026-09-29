/** One line of a run's record of what it started. Every field is optional; relative paths are recorded resolved. */
export interface StartedEntry {
  /** Processes the run started. */
  readonly pids?: readonly number[];
  /** Files that each list process ids, one per line, such as a fixture's executor ids. */
  readonly pidFiles?: readonly string[];
  /** Directories whose `.lock` files each hold the id of the process holding the lock. */
  readonly lockDirectories?: readonly string[];
  /** Key files, removed with the `.tmp` and `.removing` copies a killed writer leaves beside them. */
  readonly keyFiles?: readonly string[];
  /** Other files the run created outside its directory, such as a Linux socket. */
  readonly files?: readonly string[];
}

export interface RunCleanup {
  /** The recorded processes that were still running inside the run's directory, or started by one that was, now ended. */
  readonly ended: readonly number[];
  /** False while Windows still holds the run's directory. */
  readonly removed: boolean;
}

/** A process as its id and start time, which together tell it from every other process that held the id. */
export interface ProcessIdentity {
  readonly pid: number;
  /** In the OS's own units. */
  readonly startedAt: bigint;
}

/** A running process as the OS knew it when the record was taken. */
export interface ProcessRecord extends ProcessIdentity {
  readonly parent: number;
  readonly commandLine: string;
  /** Linux only. */
  readonly workingDirectory?: string;
}

/** The process a run directory's name records as its owner. */
export interface RunOwner {
  readonly pid: number;
  /** Absent from a name that records only the id. */
  readonly startedAt?: bigint;
}

export declare const STARTED_FILE: string;
export declare function removeDirectory(directory: string): Promise<boolean>;
export declare function isRunning(pid: number): boolean;
export declare function processRecords(
  pids: readonly number[],
): Map<number, ProcessRecord>;
export declare function childProcessesOf(pid: number): ProcessRecord[];
export declare function orphansOf(
  pids: readonly number[],
  sinceMs: number,
): ProcessRecord[];
export declare function stillRunning<Identity extends ProcessIdentity>(
  records: readonly Identity[],
): Identity[];
export declare function endRecorded(
  records: readonly ProcessRecord[],
): ProcessRecord[];
export declare function recordsInside(
  roots: readonly string[],
  pids: readonly number[],
): ProcessRecord[];
export declare function endOwnedProcesses(
  roots: readonly string[],
  pids: readonly number[],
): ProcessRecord[];
export declare function isRunWatchdog(commandLine: string): boolean;
export declare function recordStarted(
  runRoot: string,
  entry: StartedEntry,
): void;
export declare function removeKeyFile(keyFile: string): void;
export declare function cleanUpRun(runRoot: string): Promise<RunCleanup>;
export declare function ownedRunName(prefix: string): string;
export declare function runOwner(
  name: string,
  prefix: string,
): RunOwner | undefined;
export declare function ownerRunning(owner: RunOwner): boolean;
export declare function sweepEndedRuns(prefix: string): Promise<string[]>;
export declare function guardRun(runRoot: string): Promise<void>;
