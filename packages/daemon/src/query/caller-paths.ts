import { basename, dirname, join } from "node:path";
import { WINDOWS } from "../daemon/endpoint.js";
import {
  liesInside,
  realPath,
  relativePosixPath,
  ROOT_PATH,
} from "../vitest/find-workspaces.js";

/** Windows drops a trailing dot or space from a name, so such a name may mean the name without it. */
const TRAILING_DOT_OR_SPACE = /[. ]$/;
/** An 8.3 short name, which may stand for a long name that no longer exists. */
const SHORT_NAME_FORM = /~\d/;

/** The shapes of a missing name the Windows host may read as another name. */
const AMBIGUOUS_ON_WINDOWS: readonly {
  readonly pattern: RegExp;
  readonly shape: string;
}[] = [
  { pattern: TRAILING_DOT_OR_SPACE, shape: "ends in a dot or a space" },
  { pattern: SHORT_NAME_FORM, shape: "has an 8.3 short-name form" },
];

/** A caller's absolute path, resolved inside the consumer root. */
export interface CallerPath {
  /** The absolute path as the caller gave it. */
  readonly given: string;
  /** Relative to the root's canonical real path, `/`-separated; `ROOT_PATH` for the root itself. */
  readonly path: string;
}

export type CallerPathResolution =
  | ({ readonly ok: true } & CallerPath)
  | { readonly ok: false; readonly reason: string };

type Canonical =
  | {
      readonly ok: true;
      readonly path: string;
      /** The names below the nearest existing ancestor, kept as given. */
      readonly missing: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolves `absolutePath` relative to the consumer root's canonical real path: an existing path in any spelling the
 * host resolves to it, a missing one through its nearest existing ancestor. Refuses a path outside the root, and on
 * Windows a missing name the host may read as another name.
 */
export function resolveCallerPath(
  absolutePath: string,
  consumerRoot: string,
): CallerPathResolution {
  const root = realPath(consumerRoot);
  if (!root.ok) {
    return {
      ok: false,
      reason: `the consumer root ${consumerRoot} ${root.reason}`,
    };
  }
  const path = canonicalPath(absolutePath);
  if (!path.ok) {
    return { ok: false, reason: `${absolutePath} ${path.reason}` };
  }
  if (!liesInside(root.path, path.path)) {
    return {
      ok: false,
      reason: `${absolutePath} lies outside the consumer root ${consumerRoot}`,
    };
  }
  const ambiguous = ambiguousName(path.missing);
  if (ambiguous !== undefined) {
    return { ok: false, reason: `${absolutePath} ${ambiguous}` };
  }
  const relative = relativePosixPath(root.path, path.path);
  return {
    ok: true,
    given: absolutePath,
    path: relative === "" ? ROOT_PATH : relative,
  };
}

function canonicalPath(path: string): Canonical {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    const real = realPath(current);
    if (real.ok)
      return { ok: true, path: join(real.path, ...missing), missing };
    const parent = dirname(current);
    if (parent === current) return real;
    missing.unshift(basename(current));
    current = parent;
  }
}

/** Why a missing name may name another file on this host; undefined when none may. */
function ambiguousName(missing: readonly string[]): string | undefined {
  if (process.platform !== WINDOWS) return undefined;
  for (const name of missing) {
    const match = AMBIGUOUS_ON_WINDOWS.find(({ pattern }) =>
      pattern.test(name),
    );
    if (match !== undefined) {
      return `names nothing that exists, and its name "${name}" ${match.shape}, which Windows may read as another name`;
    }
  }
  return undefined;
}
