import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import {
  BYTE_ORDER_MARK,
  PACKAGE_JSON,
  VITE_CONFIG_FILES,
  VITEST_CONFIG_FILES,
} from "./find-workspaces.js";

/** Loads through Vite's module runner, writing no temp file, but cannot load CommonJS syntax. */
const RUNNER_LOADER = "runner";
/** Vite's default: bundles an ESM config into `node_modules/.vite-temp/`, and `require`s a CommonJS one, writing nothing. */
const BUNDLE_LOADER = "bundle";

export type ConfigLoader = typeof RUNNER_LOADER | typeof BUNDLE_LOADER;

export interface WorkspaceConfig {
  /** Absolute. */
  readonly file: string;
  readonly loader: ConfigLoader;
}

type ManifestRead =
  { readonly found: true; readonly type: unknown } | { readonly found: false };

/** Vitest's own lookup order. */
const CONFIG_FILES = [...VITEST_CONFIG_FILES, ...VITE_CONFIG_FILES];
const ESM_EXTENSIONS: ReadonlySet<string> = new Set([".mts", ".mjs"]);
const COMMONJS_EXTENSIONS: ReadonlySet<string> = new Set([".cts", ".cjs"]);
const ESM_PACKAGE_TYPE = "module";

/** The config file Vitest would load from the workspace directory, and the loader that loads it writing nothing; undefined when it holds none. */
export function workspaceConfig(
  directory: string,
): WorkspaceConfig | undefined {
  const name = CONFIG_FILES.find((file) => existsSync(join(directory, file)));
  if (name === undefined) return undefined;
  const file = join(directory, name);
  return { file, loader: isViteEsmFile(file) ? RUNNER_LOADER : BUNDLE_LOADER };
}

/** Restates Vite's unexported `isFilePathESM`, which picks how the bundle loader treats the file. */
function isViteEsmFile(file: string): boolean {
  const extension = extname(file);
  if (ESM_EXTENSIONS.has(extension)) return true;
  if (COMMONJS_EXTENSIONS.has(extension)) return false;
  return nearestPackageType(dirname(file)) === ESM_PACKAGE_TYPE;
}

function nearestPackageType(directory: string): unknown {
  let current = directory;
  for (;;) {
    const manifest = readManifest(join(current, PACKAGE_JSON));
    if (manifest.found) return manifest.type;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Vite strips a byte order mark, and passes over a `package.json` it cannot stat, read or parse, or that holds `null`, and keeps looking upward. */
function readManifest(file: string): ManifestRead {
  try {
    if (statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
      return { found: false };
    }
    const text = readFileSync(file, "utf8");
    const manifest: unknown = JSON.parse(
      text.startsWith(BYTE_ORDER_MARK)
        ? text.slice(BYTE_ORDER_MARK.length)
        : text,
    );
    if (manifest === null) return { found: false };
    const type =
      typeof manifest === "object"
        ? (manifest as { type?: unknown }).type
        : undefined;
    return { found: true, type };
  } catch {
    return { found: false };
  }
}
