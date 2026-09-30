import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import { isNotKnown } from "../vitest/selection-facts.js";
import {
  comparable,
  countEnvironment,
  namedByEntry,
  variableEntries,
  type CountsByValue,
  type EnvironmentCount,
  type StartEnvironment,
} from "./environment-digest.js";
import { reportedProjects, workspaceListing } from "./protection.js";

/**
 * Each `$` with the name Vite's expansion reads after it: `$NAME`, or `${NAME` closed by `}` or opening a default or
 * alternate value. A `\` before it changes nothing, since Vite writes an escaped `$` back and a later substitution
 * expands it. A `$` matching neither group reads no name, though a substitution can build one after it.
 */
const DOLLAR =
  /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?=\}|:-|-|:\+|\+)|([A-Za-z_][A-Za-z0-9_]*))?/g;
/** No variable's name holds a NUL, so neither key can be a list of names. */
const NAME_SEPARATOR = "\u0000";
const EVERY_KEY = `${NAME_SEPARATOR}every`;

/** An env file's text, or the start environment value of a variable a reference from that file reached. */
export interface FoundIn {
  readonly file: string;
  /** As `comparable` spells it; absent for the file's own text. */
  readonly through?: string;
}

/** Why a listed or declared variable counts by value: a reference reaches it, or an env prefix begins its name. */
export type CarriedReason = FoundIn | { readonly prefix: string };

/** Which listed or declared variables count by value for a workspace, each by its `comparable` spelling. */
export type CarriedVariables =
  | {
      readonly every: false;
      readonly names: ReadonlyMap<string, CarriedReason>;
    }
  | {
      readonly every: true;
      /** Where a `$` begins no reference. */
      readonly where: FoundIn;
    };

/** Takes each workspace's decision, by the workspace's path, as it is made. */
export type CarriedReport = (
  workspace: string,
  carried: CarriedVariables,
) => void;

interface Scan {
  /** As `comparable` spells them. */
  readonly names: readonly string[];
  /** Whether a `$` begins no reference. */
  readonly stray: boolean;
}

interface Reference {
  readonly name: string;
  readonly where: FoundIn;
}

/**
 * The start environment under the entries in effect: which listed or declared variables Vite can carry to each
 * workspace's tests, and the environment's digest with them counted by value.
 */
export class CountedEnvironment {
  /** With every variable an entry names counted only as set. */
  readonly count: EnvironmentCount;
  readonly #start: StartEnvironment;
  readonly #declared: readonly string[];
  readonly #entries: readonly string[];
  readonly #report: CarriedReport;
  /** Each set variable's values by its `comparable` spelling, which on Windows several names can share. */
  readonly #values = new Map<string, string[]>();
  /** Each set variable an entry names, by its `comparable` spelling. */
  readonly #namedSet: readonly string[];
  readonly #valueScans = new Map<string, Scan>();
  readonly #reaches = new Map<string, readonly string[]>();
  readonly #digests = new Map<string, string>();

  constructor(
    start: StartEnvironment,
    declared: readonly string[],
    report: CarriedReport,
  ) {
    this.#start = start;
    this.#declared = declared;
    this.#entries = variableEntries(declared);
    this.#report = report;
    this.count = countEnvironment(start, declared);
    for (const [name, value] of Object.entries(start)) {
      if (value === undefined) continue;
      const key = comparable(name);
      this.#values.set(key, [...(this.#values.get(key) ?? []), value]);
    }
    this.#namedSet = [...this.#values.keys()].filter((key) =>
      namedByEntry(this.#entries, key),
    );
  }

  /**
   * Decides and reports which listed or declared variables count by value for `entry`, from `texts`, the text Vite
   * reads at each env file the workspace lists, by path, undefined where it reads nothing.
   */
  carried(
    entry: WorkspaceDiscovery,
    texts: ReadonlyMap<string, string | undefined>,
  ): CarriedVariables {
    const referenced = this.#referenced(entry, texts);
    const carried = referenced.every
      ? referenced
      : this.#withPrefixes(entry, referenced.names);
    this.#report(entry.workspace.path, carried);
    return carried;
  }

  /** The environment's digest with `carried` counted by value, which with none is the digest `count` holds. */
  digest(carried: CarriedVariables): string {
    if (!carried.every && carried.names.size === 0) return this.count.digest;
    const key = carried.every
      ? EVERY_KEY
      : [...carried.names.keys()].sort().join(NAME_SEPARATOR);
    let digest = this.#digests.get(key);
    if (digest === undefined) {
      digest = countEnvironment(
        this.#start,
        this.#declared,
        countsByValue(carried),
      ).digest;
      this.#digests.set(key, digest);
    }
    return digest;
  }

  /** Follows each reference from the workspace's env files through the values it reaches, each name once. */
  #referenced(
    entry: WorkspaceDiscovery,
    texts: ReadonlyMap<string, string | undefined>,
  ): CarriedVariables {
    const references = fileReferences(entry, texts);
    if (!Array.isArray(references)) return { every: true, where: references };
    const names = new Map<string, CarriedReason>();
    const visited = new Set<string>();
    // Also visits each reference a scanned value appends.
    for (const { name, where } of references) {
      const unvisited = this.#reach(name).filter((each) => !visited.has(each));
      for (const reached of unvisited) {
        visited.add(reached);
        if (namedByEntry(this.#entries, reached)) names.set(reached, where);
        const through = { file: where.file, through: reached };
        const value = this.#valueScan(reached);
        if (value.stray) return { every: true, where: through };
        references.push(
          ...value.names.map((next) => ({ name: next, where: through })),
        );
      }
    }
    return { every: false, names };
  }

  /** Adds each set variable an entry names that one of the workspace's env prefixes begins. */
  #withPrefixes(
    entry: WorkspaceDiscovery,
    referenced: ReadonlyMap<string, CarriedReason>,
  ): CarriedVariables {
    const names = new Map(referenced);
    const prefixes = envPrefixes(entry);
    for (const name of this.#namedSet) {
      if (names.has(name)) continue;
      const prefix = prefixes.find((candidate) =>
        name.startsWith(comparable(candidate)),
      );
      if (prefix !== undefined) names.set(name, { prefix });
    }
    return { every: false, names };
  }

  /**
   * What a reference to `name` can read: `name`, and each set variable whose name begins with it or begins it, since
   * a substitution can extend the name after a `$`, and Vite reads a name without an operator only up to a `null`.
   */
  #reach(name: string): readonly string[] {
    let reached = this.#reaches.get(name);
    if (reached === undefined) {
      reached = [
        name,
        ...[...this.#values.keys()].filter(
          (key) =>
            key !== name && (key.startsWith(name) || name.startsWith(key)),
        ),
      ];
      this.#reaches.set(name, reached);
    }
    return reached;
  }

  #valueScan(name: string): Scan {
    let scanned = this.#valueScans.get(name);
    if (scanned === undefined) {
      const scans = (this.#values.get(name) ?? []).map(scan);
      scanned = {
        names: scans.flatMap((each) => each.names),
        stray: scans.some((each) => each.stray),
      };
      this.#valueScans.set(name, scanned);
    }
    return scanned;
  }
}

/** The discovery's: every variable when a workspace counts every one, and otherwise each any workspace counts. */
export function carriedUnion(
  workspaces: readonly CarriedVariables[],
): CarriedVariables {
  const names = new Map<string, CarriedReason>();
  for (const carried of workspaces) {
    if (carried.every) return carried;
    for (const [name, reason] of carried.names) {
      if (!names.has(name)) names.set(name, reason);
    }
  }
  return { every: false, names };
}

/** Each reference in the text of the workspace's env files, in path order, or where a `$` begins none. */
function fileReferences(
  entry: WorkspaceDiscovery,
  texts: ReadonlyMap<string, string | undefined>,
): Reference[] | FoundIn {
  const references: Reference[] = [];
  for (const file of [...workspaceListing(entry).envFiles].sort()) {
    const text = texts.get(file);
    if (text === undefined) continue;
    const read = scan(text);
    if (read.stray) return { file };
    references.push(...read.names.map((name) => ({ name, where: { file } })));
  }
  return references;
}

function countsByValue(carried: CarriedVariables): CountsByValue {
  if (carried.every) return () => true;
  const { names } = carried;
  return (name) => names.has(name);
}

/** Every env prefix of the workspace's reported env sources. */
function envPrefixes(entry: WorkspaceDiscovery): string[] {
  return reportedProjects(entry).flatMap(({ envSources }) =>
    isNotKnown(envSources)
      ? []
      : envSources.flatMap((source) => source.envPrefixes),
  );
}

function scan(text: string): Scan {
  const names: string[] = [];
  for (const match of text.matchAll(DOLLAR)) {
    const name = match[1] ?? match[2];
    if (name === undefined) return { names, stray: true };
    names.push(comparable(name));
  }
  return { names, stray: false };
}
