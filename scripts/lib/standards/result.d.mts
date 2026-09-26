export interface Result {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export declare function result(
  code: number,
  out?: readonly string[],
  err?: readonly string[],
): Result;

export declare function emit(result: Result): void;
