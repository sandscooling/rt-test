export declare const USAGE: string;

export interface SkillIo {
  readonly root: string | undefined;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export declare function runFillTicket(
  argv: readonly string[],
  io: SkillIo,
): number;
