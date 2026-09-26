import type { Git } from "../unbuilt/unbuilt-work.mjs";
import type { Catalog, Defect } from "./catalog.mjs";

export type HeadRecords = (source: string) => ReadonlyMap<string, string>;

export interface Pick {
  readonly defect: Defect;
  readonly reasons: readonly string[];
}

export interface Selection {
  readonly picks: readonly Pick[];
  readonly unattributed: readonly string[];
}

export declare function changedPaths(git: Git): Set<string>;
export declare function headRecordsIn(git: Git): HeadRecords;
export declare function selectChanged(
  catalog: Catalog,
  changed: ReadonlySet<string>,
  headRecords: HeadRecords,
): Selection;
