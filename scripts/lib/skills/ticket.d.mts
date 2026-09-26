export declare const TEMPLATE_FILE: string;
export declare const ID_MARKERS: Readonly<Record<string, string>>;
export declare const CONTRACT_HEADINGS: readonly string[];
export declare const METADATA_KEYS: readonly string[];

export interface SectionBlock {
  readonly name: string;
  readonly body: readonly string[];
}

export type Outcome<T> =
  | ({ readonly errors?: undefined } & T)
  | ({ readonly errors: readonly string[] } & {
      readonly [K in keyof T]?: undefined;
    });

export declare function parseSectionsFile(
  text: string,
): Outcome<{ readonly blocks: readonly SectionBlock[] }>;

export declare function applyFills(
  text: string,
  blocks: readonly SectionBlock[],
): Outcome<{
  readonly text: string;
  readonly applied: readonly {
    readonly name: string;
    readonly lines: number;
    readonly keptComment: boolean;
  }[];
}>;

export declare function scaffold(text: string): {
  readonly sections: string;
  readonly skipped: readonly string[];
};

export declare function applyIds(
  text: string,
  assignments: Readonly<Record<string, string>>,
): Outcome<{ readonly text: string; readonly applied: readonly string[] }>;

export declare function checkTicket(
  text: string,
  templateText: string,
): readonly string[];

export declare function templateProblems(
  templateText: string,
): readonly string[];
