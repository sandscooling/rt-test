import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import type { Vitest } from "vitest/node";

type DevEnvironment = Vitest["vite"]["environments"][string];
type ModuleNode = NonNullable<
  ReturnType<DevEnvironment["moduleGraph"]["getModuleById"]>
>;
type TransformResult = NonNullable<ModuleNode["transformResult"]>;

/** Rewrites a module's text as Vite hands it to the first plugin, before any plugin transforms it. */
export type ModuleInputTransform = (code: string, id: string) => string;

/** A module served from text other than its file's text on disk, which a run must not read. */
export interface StaleModule {
  readonly environment: string;
  readonly id: string;
}

const DIGEST_ALGORITHM = "sha256";
const WINDOWS = "win32";
/** Ids of modules no file backs, which no edit on disk can make stale. */
const VIRTUAL_ID_PREFIXES = ["\0", "virtual:"];
const QUERY_OR_HASH = /[?#].*$/s;

/**
 * Records, per environment of every Vite server the instance serves modules through, a digest of the text each module
 * was transformed from, so that before each run every module still cached from text other than its file's text now
 * can be invalidated, and a run that would still read one can be refused.
 */
export class StaleTransformGuard {
  readonly #inputs = new Map<DevEnvironment, Map<string, string>>();

  private constructor(
    environments: readonly DevEnvironment[],
    transformInput: ModuleInputTransform,
  ) {
    for (const environment of environments) {
      this.#inputs.set(environment, wrapTransform(environment, transformInput));
    }
  }

  /** Throws when an environment has no plugin container to wrap, so no run can read a transform the guard never saw. */
  static install(
    instance: Vitest,
    transformInput: ModuleInputTransform,
  ): StaleTransformGuard {
    return new StaleTransformGuard(
      servedEnvironments(instance),
      transformInput,
    );
  }

  /**
   * Invalidates every module of `files`, and every module cached from text other than its file's text now or from
   * text the guard never saw. Returns the modules that still would be served from such text.
   */
  freshen(files: readonly string[]): StaleModule[] {
    const reads = new FileReads();
    const targets = new Set(files.map((file) => reads.key(file)));
    for (const [environment, inputs] of this.#inputs) {
      const graph = environment.moduleGraph;
      for (const module of graph.idToModuleMap.values()) {
        if (mustInvalidate(module, inputs, targets, reads)) {
          graph.invalidateModule(module);
        }
      }
    }
    return this.#remaining(targets, reads);
  }

  #remaining(targets: ReadonlySet<string>, reads: FileReads): StaleModule[] {
    const remaining: StaleModule[] = [];
    for (const [environment, inputs] of this.#inputs) {
      for (const module of environment.moduleGraph.idToModuleMap.values()) {
        if (
          module.id !== null &&
          mustInvalidate(module, inputs, targets, reads)
        ) {
          remaining.push({ environment: environment.name, id: module.id });
        }
      }
    }
    return remaining;
  }
}

/** Each file's digest and key, read once per `freshen`, since nothing writes a file between its two passes. */
class FileReads {
  readonly #digests = new Map<string, string | undefined>();
  readonly #keys = new Map<string, string>();

  /** Undefined when the file cannot be read. */
  digest(file: string): string | undefined {
    if (!this.#digests.has(file)) {
      let digest: string | undefined;
      try {
        digest = digestOf(readFileSync(file, "utf8"));
      } catch {
        digest = undefined;
      }
      this.#digests.set(file, digest);
    }
    return this.#digests.get(file);
  }

  key(file: string): string {
    let key = this.#keys.get(file);
    if (key === undefined) {
      key = moduleFileKey(file);
      this.#keys.set(file, key);
    }
    return key;
  }
}

/**
 * A path as Vite keys a module's file: resolved through links, with `/` separators, and case-folded on Windows, where
 * a path's case does not name a different file.
 */
export function moduleFileKey(path: string): string {
  const slashed = realPathOf(moduleFilePath(path)).replaceAll("\\", "/");
  return process.platform === WINDOWS ? slashed.toLowerCase() : slashed;
}

/** A module id without the query or hash Vite may append to its file's path. */
export function moduleFilePath(id: string): string {
  return id.replace(QUERY_OR_HASH, "");
}

/** Every project's server, and the root's, which on Vitest 4.1 is a server of its own. */
function servedEnvironments(instance: Vitest): DevEnvironment[] {
  const servers = new Set([
    instance.vite,
    ...instance.projects.map((project) => project.vite),
  ]);
  return [...servers].flatMap((server) => Object.values(server.environments));
}

function wrapTransform(
  environment: DevEnvironment,
  transformInput: ModuleInputTransform,
): Map<string, string> {
  const container = environment.pluginContainer;
  const transform = container.transform.bind(container);
  const inputs = new Map<string, string>();
  container.transform = (code, id, options) => {
    const input = transformInput(code, id);
    inputs.set(id, digestOf(input));
    return transform(input, id, options);
  };
  return inputs;
}

/**
 * A cached module of a file named, or one transformed from text other than its file's now; a module whose file cannot
 * be read now counts, since it was transformed from text the file no longer holds.
 */
function mustInvalidate(
  module: ModuleNode,
  inputs: ReadonlyMap<string, string>,
  targets: ReadonlySet<string>,
  reads: FileReads,
): boolean {
  if (cachedResult(module) === undefined) return false;
  const { id, file } = module;
  if (file !== null && targets.size > 0 && targets.has(reads.key(file))) {
    return true;
  }
  if (id === null || file === null || isVirtual(id)) return false;
  const recorded = inputs.get(id);
  return recorded === undefined || recorded !== reads.digest(file);
}

/**
 * A soft invalidation moves the old result to `invalidationState`, a field Vite's types leave out, and Vite serves it
 * again without transforming.
 */
function cachedResult(module: ModuleNode): TransformResult | undefined {
  const state = (
    module as ModuleNode & {
      readonly invalidationState?: TransformResult | string;
    }
  ).invalidationState;
  return (
    module.transformResult ?? (typeof state === "object" ? state : undefined)
  );
}

function digestOf(text: string): string {
  return createHash(DIGEST_ALGORITHM).update(text).digest("hex");
}

function isVirtual(id: string): boolean {
  return VIRTUAL_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function realPathOf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}
