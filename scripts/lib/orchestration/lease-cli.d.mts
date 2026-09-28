import type { ChildProcess, SpawnOptions } from "node:child_process";

export interface TempOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly tmp?: string;
}

export interface LeaseCliContext {
  readonly root: string;
  readonly dir: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now?: () => number;
  readonly running?: (pid: number | undefined) => boolean;
  readonly spawn?: (
    program: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcess;
  readonly sleep?: (ms: number) => Promise<unknown>;
  readonly pid?: number;
  readonly heartbeatMs?: number;
  readonly tempOptions?: TempOptions;
  readonly platform?: NodeJS.Platform;
  readonly signals?: Pick<NodeJS.Process, "on" | "off">;
}

export declare function leaseDirFor(
  root: string,
  env?: NodeJS.ProcessEnv,
): string;
export declare function heavyRunDenial(
  dir: string,
  command: string,
  options?: {
    readonly now?: number;
    readonly running?: (pid: number | undefined) => boolean;
  },
): string;
export declare function runLeaseCli(
  argv: readonly string[],
  ctx: LeaseCliContext,
): Promise<number>;
