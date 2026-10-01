import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject, Vitest } from "vitest/node";
import { releaseLine } from "../vitest/load-vitest.js";
import { TOP_LEVEL_MODULE_CACHE_MAJOR } from "../vitest/workspace-session.js";
import { replaceAnchor } from "./anchor-match.js";
import {
  mutateWithProbe,
  type NoProbeSite,
  type ProbeSite,
} from "./reach-probe.js";
import {
  moduleFileKey,
  moduleFilePath,
  StaleTransformGuard,
  type ModuleInputTransform,
} from "./stale-transform-guard.js";

/** One defect's mutation: its file, absolute, and the exact text it replaces. */
export interface Mutation {
  readonly file: string;
  readonly old: string;
  readonly new: string;
}

/** What one transform of the mutated module did with the text Vitest handed it. */
export type MutationLoad =
  | {
      readonly applied: true;
      readonly probe:
        | { readonly placed: true; readonly site: ProbeSite }
        | { readonly placed: false; readonly reason: NoProbeSite };
    }
  /** `old` did not occur exactly once in the text transformed, so the module was served unmutated. */
  | { readonly applied: false; readonly occurrences: number };

/** A project that keeps an on-disk module cache on, which would write the mutated transform under the consumer's tree. */
export interface OnDiskModuleCache {
  readonly projectName: string;
  readonly setting: string;
}

/** Built beside this module, so it shares its extension: `.ts` run from source, `.js` from `dist`. */
const REACH_SETUP_FILE = fileURLToPath(
  new URL(
    `./reach-setup${extname(fileURLToPath(import.meta.url))}`,
    import.meta.url,
  ),
);

const TOP_LEVEL_MODULE_CACHE = "fsModuleCache";
const EXPERIMENTAL_MODULE_CACHE = "experimental.fsModuleCache";
const BAIL_OFF = 0;

interface ModuleCacheSettings {
  readonly fsModuleCache?: unknown;
  readonly experimental?: { readonly fsModuleCache?: unknown };
}

interface ActiveMutation {
  readonly mutation: Mutation;
  readonly fileKey: string;
  readonly baseName: string;
  readonly loads: MutationLoad[];
}

/**
 * The mutation of the experiment in progress, applied to the module it names in every project's server as Vite hands
 * that module's text to its first plugin, and nowhere else. No mutation is active outside an experiment.
 */
export class MutationTransform {
  readonly guard: StaleTransformGuard;
  #active: ActiveMutation | undefined;

  private constructor(instance: Vitest) {
    const transformInput: ModuleInputTransform = (code, id) =>
      this.#transformInput(code, id);
    this.guard = StaleTransformGuard.install(instance, transformInput);
  }

  /**
   * Prepares a loaded instance for falsification before its first run: every test file runs isolated whatever the
   * workspace configures, no failure cancels the rest of a run, no transformed module is copied to disk for the forks
   * pool, and the reach setup file runs first in every project. Throws when any of it cannot be installed.
   */
  static install(instance: Vitest): MutationTransform {
    for (const project of instance.projects) {
      project.config.isolate = true;
      project.config.bail = BAIL_OFF;
      serveWithoutTempCopies(project);
      project.config.setupFiles.unshift(REACH_SETUP_FILE);
    }
    return new MutationTransform(instance);
  }

  /** Applies `mutation` from now until `deactivate`, recording each transform of its module. */
  activate(mutation: Mutation): void {
    this.#active = {
      mutation,
      fileKey: moduleFileKey(mutation.file),
      baseName: foldedBaseName(mutation.file),
      loads: [],
    };
  }

  /** Ends the active mutation; an empty list means the mutated module was never loaded while it was active. */
  deactivate(): readonly MutationLoad[] {
    const loads = this.#active?.loads ?? [];
    this.#active = undefined;
    return loads;
  }

  #transformInput(code: string, id: string): string {
    const active = this.#active;
    if (active === undefined || !isModuleOf(id, active)) return code;
    const { mutation, loads } = active;
    const probed = mutateWithProbe(
      moduleFilePath(id),
      code,
      mutation.old,
      mutation.new,
    );
    switch (probed.status) {
      case "mutated":
        loads.push({
          applied: true,
          probe: { placed: true, site: probed.site },
        });
        return probed.text;
      case "anchor-count":
        loads.push({ applied: false, occurrences: probed.count });
        return code;
      case "no-probe-site":
        return withoutProbe(code, mutation, probed.reason, loads);
    }
  }
}

/**
 * Projects with an on-disk module cache still on, by the setting the loaded line honors: Vitest 5 the top-level one,
 * into which it resolves the deprecated spelling, and Vitest 4.1 the `experimental` one. Both are read when the
 * version names no line.
 */
export function onDiskModuleCaches(instance: Vitest): OnDiskModuleCache[] {
  const major = releaseLine(instance.version)?.major;
  const honored = [
    ...(major === undefined || major >= TOP_LEVEL_MODULE_CACHE_MAJOR
      ? [TOP_LEVEL_MODULE_CACHE]
      : []),
    ...(major === undefined || major < TOP_LEVEL_MODULE_CACHE_MAJOR
      ? [EXPERIMENTAL_MODULE_CACHE]
      : []),
  ];
  return instance.projects.flatMap((project) => {
    const settings = project.config as unknown as ModuleCacheSettings;
    return honored
      .filter((setting) => cacheSettingOn(settings, setting))
      .map((setting) => ({ projectName: project.name, setting }));
  });
}

function cacheSettingOn(
  settings: ModuleCacheSettings,
  setting: string,
): boolean {
  return setting === TOP_LEVEL_MODULE_CACHE
    ? settings.fsModuleCache === true
    : settings.experimental?.fsModuleCache === true;
}

/** The text Vitest transforms left no probe site, so the mutation is served without one and reach is unknown. */
function withoutProbe(
  code: string,
  mutation: Mutation,
  reason: NoProbeSite,
  loads: MutationLoad[],
): string {
  const replaced = replaceAnchor(code, mutation.old, mutation.new);
  if (!replaced.applied) {
    loads.push({ applied: false, occurrences: replaced.count });
    return code;
  }
  loads.push({ applied: true, probe: { placed: false, reason } });
  return replaced.text;
}

/**
 * The forks pool asks each project's fetcher to copy every transformed module to a file under the OS temp directory
 * for its workers to read, which would put the mutated text on disk. Every request is sent without that copy.
 */
function serveWithoutTempCopies(project: TestProject): void {
  const internal = project as unknown as { _fetcher?: unknown };
  const fetcher = internal._fetcher;
  if (typeof fetcher !== "function") {
    throw new Error(
      `project ${project.name} has no module fetcher RT Test can keep from copying transformed modules to disk`,
    );
  }
  internal._fetcher = (
    url: unknown,
    importer: unknown,
    environment: unknown,
    _copyToDisk: unknown,
    ...rest: unknown[]
  ): unknown =>
    Reflect.apply(fetcher, undefined, [
      url,
      importer,
      environment,
      false,
      ...rest,
    ]);
}

/** A query variant such as `?raw` serves the file as something other than its code, so only the plain id is mutated. */
function isModuleOf(id: string, active: ActiveMutation): boolean {
  const file = moduleFilePath(id);
  return (
    file === id &&
    foldedBaseName(file) === active.baseName &&
    moduleFileKey(id) === active.fileKey
  );
}

function foldedBaseName(path: string): string {
  return basename(path).toLowerCase();
}
