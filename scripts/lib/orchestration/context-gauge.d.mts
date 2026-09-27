export interface RateWindow {
  readonly used_percentage?: number;
  readonly resets_at?: string | number;
}

export interface RateLimits {
  readonly five_hour?: RateWindow;
  readonly seven_day?: RateWindow;
}

export interface GaugePayload {
  readonly transcript_path?: string;
  readonly agent_id?: string;
  readonly rate_limits?: RateLimits;
  readonly context_window?: {
    readonly used_percentage?: number;
    readonly used_tokens?: number;
    readonly max_tokens?: number;
    readonly total_tokens?: number;
  };
}

export declare function lastUsage(text: string): number | null;
export declare function usedTokens(transcriptPath: unknown): number | null;
export declare function formatContext(used: number, max?: number): string;
export declare function limitsFromCache(
  home: string,
  now?: number,
): RateLimits | null;
export declare function promptHeader(
  payload: GaugePayload,
  options: { readonly now?: Date; readonly home: string },
): string;
export declare function postToolContext(
  payload: GaugePayload,
  options?: { readonly now?: Date },
): string;
export declare function compactReminder(): string;
export declare function ownTranscriptPath(
  home: string,
  sessionId: string | undefined,
): string | null;
