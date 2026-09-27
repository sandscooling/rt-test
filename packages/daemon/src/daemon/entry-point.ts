import { extname } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSION = ".ts";
/** Resolves `@rt-test/core` to its sources, which only a process running from source can load. */
const SOURCE_CONDITIONS = "--conditions=development";
const IMPORT_FLAG = "--import";
const MODULE_EXTENSION = extname(fileURLToPath(import.meta.url));

export interface EntryPoint {
  readonly file: string;
  /** The Node flags the entry needs ahead of its path. */
  readonly execArgv: readonly string[];
}

/** A process entry in this directory, built beside this module so it shares its extension: `.ts` from source, `.js` from `dist`. */
export function daemonEntryPoint(name: string): EntryPoint {
  const file = fileURLToPath(
    new URL(`./${name}${MODULE_EXTENSION}`, import.meta.url),
  );
  if (MODULE_EXTENSION !== SOURCE_EXTENSION) return { file, execArgv: [] };
  const hooks = new URL(`./source-hooks${SOURCE_EXTENSION}`, import.meta.url)
    .href;
  return { file, execArgv: [SOURCE_CONDITIONS, IMPORT_FLAG, hooks] };
}
