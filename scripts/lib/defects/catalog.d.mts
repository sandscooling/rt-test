export type Files = ReadonlyMap<string, Buffer>;

export interface Defect {
  readonly id: string;
  readonly defect: string;
  readonly file: string;
  readonly old: string;
  readonly new: string;
  readonly source: string;
  readonly test: string;
}

export interface Catalog {
  readonly files: Files;
  readonly defects: readonly Defect[];
}

export declare const SANDBOX_DIRS: readonly string[];
export declare const SANDBOX_FILES: readonly string[];

export declare function toPosix(path: string): string;
export declare function snapshotFiles(root: string): Map<string, Buffer>;
export declare function buildCatalog(files: Files): Catalog;
export declare function loadCatalog(root: string): Catalog;
