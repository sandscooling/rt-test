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
  /** The recorded processes that were still running inside the run's directory, now ended. */
  readonly ended: readonly number[];
  /** False while Windows still holds the run's directory. */
  readonly removed: boolean;
}

export interface ChildProcess {
  readonly pid: number;
  readonly commandLine: string;
}

export declare const STARTED_FILE: string;
export declare function removeDirectory(directory: string): Promise<boolean>;
export declare function isRunning(pid: number): boolean;
export declare function endProcess(pid: number): void;
export declare function childProcessesOf(pid: number): ChildProcess[];
export declare function isRunWatchdog(commandLine: string): boolean;
export declare function recordStarted(
  runRoot: string,
  entry: StartedEntry,
): void;
export declare function removeKeyFile(keyFile: string): void;
export declare function cleanUpRun(runRoot: string): Promise<RunCleanup>;
export declare function sweepEndedRuns(prefix: string): Promise<string[]>;
export declare function guardRun(runRoot: string): Promise<void>;
