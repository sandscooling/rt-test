export declare function openRun(
  parent: string,
  log: (line: string) => void,
  running?: (pid: number) => boolean,
): string;
