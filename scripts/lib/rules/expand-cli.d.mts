export interface RuleIo {
  readonly root?: string;
  out(text: string): void;
  err(text: string): void;
  stdin(): string;
}

export declare const USAGE: string;

export declare function runExpandRules(
  argv: readonly string[],
  io: RuleIo,
): number;
