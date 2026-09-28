import { errorText } from "../vitest/error-text.js";
import { POSIX_SEPARATOR } from "../vitest/find-workspaces.js";
import { REGEXP_FIND } from "../vitest/selection-facts.js";
import { uncertain, type Graph } from "./graph-state.js";
import {
  SPECIFIER_FORM,
  type FoundSpecifier,
  type SpecifierForm,
} from "./source-imports.js";
import {
  EDGE_PRODUCER,
  UNCERTAINTY,
  type SelectableWorkspace,
  type SelectionAlias,
} from "./selection-types.js";
import {
  addSpecifierEdges,
  CURRENT_DIRECTORY,
  KEY_SEPARATOR,
  once,
  type Reference,
  type Scan,
  type SpecifierProducers,
  WINDOWS_PLATFORM,
} from "./specifier-edges.js";
import {
  aliasDetail,
  PARTIAL_VOLUME,
  SCHEME_RELATIVE_PREFIX,
  VITE_FS_PREFIX,
  VITE_SPECIAL_PREFIX,
  viteFsPath,
} from "./vitest-edges.js";

const WINDOWS_SEPARATOR = "\\";

const ALIAS_PRODUCERS: SpecifierProducers = {
  path: EDGE_PRODUCER.alias,
  bare: EDGE_PRODUCER.alias,
};

/** One alias of one Vitest workspace, its find ready to match the specifiers the scan reads. */
export interface ScanAlias {
  readonly dependent: string;
  readonly alias: SelectionAlias;
  readonly detail: string;
  readonly find: string | RegExp;
}

/** Where a specifier was read: its file's real directory, and the file's root-relative label. */
export interface Importer {
  readonly base: string;
  readonly label: string;
}

type CompiledFind =
  | { readonly ok: true; readonly find: string | RegExp }
  | { readonly ok: false; readonly reason: string };

/**
 * Every alias of every Vitest workspace except one with a customResolver, which picks the module itself and
 * already widens its workspace. A RegExp find that does not compile widens its workspace instead.
 */
export function scanAliases(
  graph: Graph,
  workspaces: readonly SelectableWorkspace[],
): ScanAlias[] {
  const prepared: ScanAlias[] = [];
  for (const { workspace, aliases } of workspaces) {
    for (const alias of aliases) {
      if (alias.hasCustomResolver) continue;
      const detail = aliasDetail(alias);
      const compiled = compiledFind(alias);
      if (compiled.ok) {
        prepared.push({
          dependent: workspace.path,
          alias,
          detail,
          find: compiled.find,
        });
      } else {
        uncertain(
          graph,
          workspace.path,
          UNCERTAINTY.unresolvableAlias,
          `${detail} has a RegExp find that does not compile, so the imports it rewrites are not known: ${compiled.reason}`,
        );
      }
    }
  }
  return prepared;
}

function compiledFind(alias: SelectionAlias): CompiledFind {
  if (alias.findKind !== REGEXP_FIND) return { ok: true, find: alias.find };
  try {
    return { ok: true, find: new RegExp(alias.find, alias.flags) };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

/**
 * Each alias whose find matches the specifier rewrites it, and the alias's Vitest workspace depends on where
 * the rewritten specifier resolves. Vite applies only a project's first matching alias; every matching one
 * applies here, since a workspace's aliases merge those of all its projects.
 */
export function addAliasedSpecifierEdges(
  scan: Scan,
  aliases: readonly ScanAlias[],
  importer: Importer,
  found: FoundSpecifier,
): void {
  for (const scanAlias of aliases) {
    const rewritten = rewrite(scanAlias, found.text);
    if (rewritten === undefined) continue;
    const reference = {
      dependent: scanAlias.dependent,
      base: importer.base,
      detail: `${importer.label} imports ${JSON.stringify(found.text)}, which ${scanAlias.detail} rewrites to ${JSON.stringify(rewritten)}`,
    };
    addRewrittenEdges(
      scan,
      reference,
      { text: hostSeparated(rewritten, found.form), form: found.form },
      scanAlias.alias.viteRoot,
    );
  }
}

/**
 * Vite normalizes an aliased glob's rewrite before globbing it, so on Windows its `\` separates. A plain
 * glob keeps its `\`, which the globber reads as an escape on every platform.
 */
function hostSeparated(text: string, form: SpecifierForm): string {
  return form === SPECIFIER_FORM.glob && process.platform === WINDOWS_PLATFORM
    ? text.split(WINDOWS_SEPARATOR).join(POSIX_SEPARATOR)
    : text;
}

/**
 * Matches and replaces as Vite's alias plugin does, with `String.prototype.replace` and its `$` patterns on
 * purpose. A RegExp is read from the specifier's start, whatever its `g` or `y` flag kept from the last one.
 */
function rewrite({ find, alias }: ScanAlias, text: string): string | undefined {
  if (typeof find === "string") {
    const matches =
      text === find || text.startsWith(`${find}${POSIX_SEPARATOR}`);
    return matches ? text.replace(find, alias.replacement) : undefined;
  }
  find.lastIndex = 0;
  if (!find.test(text)) return undefined;
  find.lastIndex = 0;
  return text.replace(find, alias.replacement);
}

/** A rewritten specifier beginning with `/` is read as Vite reads it; any other, as the scan reads a specifier. */
function addRewrittenEdges(
  scan: Scan,
  reference: Reference,
  rewritten: FoundSpecifier,
  viteRoot: string,
): void {
  const { text, form } = rewritten;
  if (text.startsWith(VITE_FS_PREFIX)) {
    addViteFsEdges(scan, reference, rewritten);
  } else if (text.startsWith(SCHEME_RELATIVE_PREFIX)) {
    widen(scan, reference, "which Vite may read as a URL rather than a path");
  } else if (text.startsWith(VITE_SPECIAL_PREFIX)) {
    widen(
      scan,
      reference,
      "which Vite may read as an id it serves specially rather than a path",
    );
  } else if (text.startsWith(POSIX_SEPARATOR)) {
    // Relative to the Vite root, so no character of the root's own path is read as glob syntax.
    const fromRoot = { ...reference, base: viteRoot };
    const underRoot = { text: `${CURRENT_DIRECTORY}${text}`, form };
    addSpecifierEdges(scan, fromRoot, underRoot, ALIAS_PRODUCERS);
    addSpecifierEdges(scan, reference, rewritten, ALIAS_PRODUCERS);
  } else {
    addSpecifierEdges(scan, reference, rewritten, ALIAS_PRODUCERS);
  }
}

function addViteFsEdges(
  scan: Scan,
  reference: Reference,
  { text, form }: FoundSpecifier,
): void {
  const rest = text.slice(VITE_FS_PREFIX.length);
  if (rest === "" || PARTIAL_VOLUME.test(rest)) {
    widen(
      scan,
      reference,
      `which names no file, since at most a drive follows ${VITE_FS_PREFIX}`,
    );
    return;
  }
  const path = { text: viteFsPath(rest), form };
  addSpecifierEdges(scan, reference, path, ALIAS_PRODUCERS);
}

/** Each quote widens its Vitest workspace once. */
function widen(scan: Scan, reference: Reference, cause: string): void {
  const key = [reference.dependent, reference.detail].join(KEY_SEPARATOR);
  if (!once(scan, key)) return;
  uncertain(
    scan.graph,
    reference.dependent,
    UNCERTAINTY.unresolvableAlias,
    `${reference.detail}, ${cause}`,
  );
}
