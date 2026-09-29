import type { Git } from "../git.mjs";
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

export declare const CHANGED_FLAG: "--changed";
export declare function requireChangeset(git: Git, flag?: string): Set<string>;
/** Reads each source's records at HEAD once, however often it is asked. */
export declare function headRecordsIn(git: Git): HeadRecords;
export declare function selectChanged(
  catalog: Catalog,
  changed: ReadonlySet<string>,
  headRecords: HeadRecords,
): Selection;
/** The defects whose own record, test file or mutated file changed; no import widens it. */
export declare function selectEdited(
  catalog: Catalog,
  changed: ReadonlySet<string>,
  headRecords: HeadRecords,
): readonly Pick[];
