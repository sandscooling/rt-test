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

export interface Link {
  readonly path: string;
  /** Repository-relative for a copied directory, absolute into the package store. */
  readonly target: string;
}

export interface Catalog {
  readonly files: Files;
  readonly links: readonly Link[];
  readonly defects: readonly Defect[];
}

export declare const SANDBOX_DIRS: readonly string[];
export declare const SANDBOX_FILES: readonly string[];

export declare function walkTree(
  root: string,
  dir?: string,
): { files: string[]; links: string[] };
export declare function snapshotFiles(root: string): Map<string, Buffer>;
export declare function buildCatalog(
  files: Files,
  links?: readonly Link[],
): Catalog;
export declare function recordLinks(root: string): Link[];
export declare function loadCatalog(root: string): Catalog;
