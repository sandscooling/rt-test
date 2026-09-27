export type FormatStatus = "formatted" | "unchanged" | "skipped" | "failed";

export interface FormatResult {
  readonly status: FormatStatus;
  readonly repoPath: string | null;
  readonly reason: string | null;
  readonly note: string | null;
}

export declare function formatOnSave(
  root: string,
  filePath: unknown,
): Promise<FormatResult>;
