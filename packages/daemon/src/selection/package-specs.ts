import { isAbsolute } from "node:path";

const NPM_ALIAS_PREFIX = "npm:";
const WORKSPACE_PREFIX = "workspace:";
const LOCAL_PATH_PREFIXES = ["file:", "link:", "portal:"];
const RELATIVE_PATH_PREFIXES = ["./", "../", "~/", "/"];
const RELATIVE_PATH_NAMES = [".", ".."];
const DEPENDENCY_REFERENCE_PREFIX = "$";
const SCOPE_PREFIX = "@";
const VERSION_SEPARATOR = "@";
const SUBPATH_SEPARATOR = "/";
const OVERRIDE_PARENT_SEPARATOR = ">";
const YARN_ANY_PARENT = "**/";

/** What a dependency, override or resolution value installs. */
export type SpecTarget =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "package"; readonly name: string }
  | { readonly kind: "workspace-key" }
  | { readonly kind: "workspace-package"; readonly name: string }
  | { readonly kind: "reference"; readonly name: string }
  | { readonly kind: "registry" };

export function parseSpec(spec: string): SpecTarget {
  if (spec.startsWith(DEPENDENCY_REFERENCE_PREFIX)) {
    return {
      kind: "reference",
      name: spec.slice(DEPENDENCY_REFERENCE_PREFIX.length),
    };
  }
  if (spec.startsWith(NPM_ALIAS_PREFIX)) {
    return {
      kind: "package",
      name: nameBeforeVersion(spec.slice(NPM_ALIAS_PREFIX.length)),
    };
  }
  if (spec.startsWith(WORKSPACE_PREFIX)) {
    return workspaceTarget(spec.slice(WORKSPACE_PREFIX.length));
  }
  const local = LOCAL_PATH_PREFIXES.find((prefix) => spec.startsWith(prefix));
  if (local !== undefined) {
    return { kind: "path", path: spec.slice(local.length) };
  }
  return isLocalPath(spec)
    ? { kind: "path", path: spec }
    : { kind: "registry" };
}

/** `workspace:*`, `workspace:^1.0.0`, `workspace:other@*` and `workspace:../other`. */
function workspaceTarget(rest: string): SpecTarget {
  if (isLocalPath(rest)) return { kind: "path", path: rest };
  return versionIndex(rest) === undefined
    ? { kind: "workspace-key" }
    : { kind: "workspace-package", name: nameBeforeVersion(rest) };
}

export function isLocalPath(spec: string): boolean {
  return (
    RELATIVE_PATH_NAMES.includes(spec) ||
    RELATIVE_PATH_PREFIXES.some((prefix) => spec.startsWith(prefix)) ||
    isAbsolute(spec)
  );
}

/** `@scope/name@^1` is `@scope/name`; `name` with no version is itself. */
function nameBeforeVersion(spec: string): string {
  const index = versionIndex(spec);
  return index === undefined ? spec : spec.slice(0, index);
}

function versionIndex(spec: string): number | undefined {
  const from = spec.startsWith(SCOPE_PREFIX) ? SCOPE_PREFIX.length : 0;
  const index = spec.indexOf(VERSION_SEPARATOR, from);
  return index === -1 ? undefined : index;
}

/**
 * The package an override or resolution key replaces: npm `a>b` and pnpm `a>b@1` name `b`, and Yarn
 * `**\/a/b` and `@s/a/@s/b` name the last package in the chain.
 */
export function overrideKeyPackage(key: string): string {
  const last = key.split(OVERRIDE_PARENT_SEPARATOR).at(-1) ?? key;
  const chain = last.startsWith(YARN_ANY_PARENT)
    ? last.slice(YARN_ANY_PARENT.length)
    : last;
  const segments = chain.split(SUBPATH_SEPARATOR);
  const scope = segments.at(-2);
  const name = segments.at(-1) ?? chain;
  const packageName =
    scope?.startsWith(SCOPE_PREFIX) === true
      ? `${scope}${SUBPATH_SEPARATOR}${name}`
      : name;
  return nameBeforeVersion(packageName);
}
