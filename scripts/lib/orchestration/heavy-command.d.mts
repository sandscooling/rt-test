export declare const SHELL: Readonly<{
  BASH: "bash";
  POWERSHELL: "powershell";
}>;

export type Shell = (typeof SHELL)[keyof typeof SHELL];

export interface HeavyRunOptions {
  /** The directory a relative Vitest target resolves against. */
  readonly cwd?: string;
  /** Whether a Vitest target names a file; defaults to a stat under `cwd`. */
  readonly isFile?: (target: string) => boolean;
  /** The shell whose quoting and escapes the command line uses. */
  readonly shell?: Shell;
}

export declare function unleasedHeavyRuns(
  command: string,
  options?: HeavyRunOptions,
): string[];
