import type { TestProject } from "vitest/node";
import { testModuleFile } from "../inputs/non-inputs.js";
import { crawledLinks } from "../inputs/crawl-links.js";
import { namedList } from "../inputs/input-jobs.js";
import { globCwd, patternBase } from "../inputs/vitest-glob.js";
import { isStringArray } from "../json-guards.js";
import { releaseLine, type ReleaseLine } from "./load-vitest.js";
import {
  SNAPSHOT_GUARD_FILE,
  usesBrowserMode,
  type WorkspaceSession,
} from "./workspace-session.js";

export const STRING_FIND = "string";
export const REGEXP_FIND = "regexp";
export type AliasFindKind = typeof STRING_FIND | typeof REGEXP_FIND;

export interface ReportedAlias {
  /** The string as written, or a RegExp's source text. */
  readonly find: string;
  readonly findKind: AliasFindKind;
  /** A RegExp's flags, which change what it matches; empty for a string. */
  readonly flags: string;
  /** As Vite's resolved config holds it, separators included. */
  readonly replacement: string;
  readonly hasCustomResolver: boolean;
}

/**
 * A directory as a test file pattern or Vitest's crawl spells it, or the file a pattern with no glob segment names,
 * which a link, a `subst` drive or a short name can make differ.
 */
export interface SpelledDirectory {
  /** Absolute and `/`-separated, as Vitest's glob names the files it crawls to below it. */
  readonly spelled: string;
  /** Where that spelling resolves. */
  readonly directory: string;
}

/**
 * Each directory link found below the project's pattern bases by a walk that follows at least every link Vitest's
 * crawl follows, or why they are not known.
 */
export type CrawledLinks =
  | { readonly complete: true; readonly links: readonly SpelledDirectory[] }
  | { readonly complete: false; readonly reason: string };

/**
 * Every path in a project's selection facts is `/`-separated and named as a test module's path is: relative to the
 * consumer root, climbing with `..` for a file outside it, and absolute for a file on another Windows drive. A
 * spelling Vitest's glob uses, `vitestDirectory` and each pattern base's or crawled link's `spelled`, is always
 * absolute.
 */
export interface TestFilePatterns {
  /** Where the patterns match from, the consumer root being `.`. */
  readonly directory: string;
  /** `directory` as Vitest's glob spells it, which differs when the root was started through another spelling. */
  readonly vitestDirectory: string;
  /** Each `include` and `includeSource` pattern's base, as `patternBase` finds it, other than `vitestDirectory`. */
  readonly patternBases: readonly SpelledDirectory[];
  readonly crawledLinks: CrawledLinks;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly includeSource: readonly string[];
}

/** Vite's `envPrefix` for a config that sets none. */
const DEFAULT_ENV_PREFIX = "VITE_";
/** Where Vitest 5 records each nested projects container's config file, a member its types omit; absent when none. */
const CONTAINER_RECORD = "_containerConfigFiles";
/** The first Vitest major whose project configs can declare projects of their own. */
const CONTAINER_MAJOR = 5;
/**
 * The newest Vitest 5 minor whose source was checked for where it records nested projects containers. Raising it is
 * the step a Vitest 5 minor upgrade owes, once that minor's source is checked.
 */
const VERIFIED_CONTAINER_MINOR = 0;

/** Where one resolved Vite config loads env files from. */
export interface EnvSource {
  /** Null when the config turns env files off. */
  readonly envDirectory: string | null;
  /** Only a variable whose name begins with one of these reaches the env Vite gives tests. */
  readonly envPrefixes: readonly string[];
  /** As Vite resolved it, which names the `.env.<mode>` files. */
  readonly mode: string;
}

/** Stored with the facts, so the reason stays true after RT Test verifies more of Vitest. */
export interface EnvSourcesNotKnown {
  readonly notKnown: string;
}

export interface ProjectSelectionFacts {
  readonly projectName: string;
  /** Where Vite resolves an import beginning with `/`, such as an alias replacement `/src`, before the file system. */
  readonly viteRoot: string;
  /** Without RT Test's snapshot guard. */
  readonly setupFiles: readonly string[];
  /** The project's own, then the root project's, which Vitest runs on every run. */
  readonly globalSetupFiles: readonly string[];
  readonly aliases: readonly ReportedAlias[];
  readonly testFilePatterns: TestFilePatterns;
  /**
   * The project's own config's, then the root config's: Vitest gives the project's tests the env of both. Not known
   * where Vitest 5 may also give them a nested projects container's env, since no project names its container.
   */
  readonly envSources: readonly EnvSource[] | EnvSourcesNotKnown;
}

export function isNotKnown(
  envSources: ProjectSelectionFacts["envSources"],
): envSources is EnvSourcesNotKnown {
  return !Array.isArray(envSources);
}

/** Per project not in browser mode. Only a discovery stored without every fact this version reads is not reported. */
export type SelectionFacts =
  | {
      readonly reported: true;
      readonly projects: readonly ProjectSelectionFacts[];
    }
  | { readonly reported: false };

export const STRING_FIND_FLAGS = "";

type ViteConfig = TestProject["vite"]["config"];
type ViteAlias = ViteConfig["resolve"]["alias"][number];

/**
 * Reads resolved config, and the directories each project's crawl passes through for the links it follows. Carries
 * nothing the executor's JSON channel would lose.
 */
export async function selectionFacts(
  session: WorkspaceSession,
  signal: AbortSignal,
): Promise<SelectionFacts> {
  const rootGlobalSetup = asList(
    session.instance.getRootProject().config.globalSetup,
  );
  const notKnown = envSourcesNotKnown(session);
  const projects: ProjectSelectionFacts[] = [];
  for (const project of session.instance.projects) {
    if (usesBrowserMode(project)) continue;
    projects.push(
      await projectFacts(
        session,
        project,
        { rootGlobalSetup, notKnown },
        signal,
      ),
    );
  }
  return { reported: true, projects };
}

/** What every project of the session shares. */
interface SessionFacts {
  readonly rootGlobalSetup: readonly string[];
  /** Undefined when the env sources each project's config gives are all its tests read. */
  readonly notKnown: EnvSourcesNotKnown | undefined;
}

async function projectFacts(
  session: WorkspaceSession,
  project: TestProject,
  { rootGlobalSetup, notKnown }: SessionFacts,
  signal: AbortSignal,
): Promise<ProjectSelectionFacts> {
  const { config } = project;
  const rootRelative = rootRelativeTo(session, project.name);
  const ownGlobalSetup = asList(config.globalSetup);
  const includeSource = inSourcePatterns(config.includeSource);
  const vitestDirectory = globCwd(config.dir || config.root);
  return {
    projectName: project.name,
    viteRoot: rootRelative(project.vite.config.root),
    setupFiles: config.setupFiles
      .filter((file) => file !== SNAPSHOT_GUARD_FILE)
      .map(rootRelative),
    globalSetupFiles: [
      ...new Set([...ownGlobalSetup, ...rootGlobalSetup].map(rootRelative)),
    ],
    aliases: project.vite.config.resolve.alias.map(reportedAlias),
    testFilePatterns: {
      directory: rootRelative(config.dir || config.root),
      vitestDirectory,
      patternBases: patternBases(
        [...config.include, ...includeSource],
        vitestDirectory,
        rootRelative,
      ),
      crawledLinks: await crawledLinks(
        {
          vitestDirectory,
          globbed: [config.include, includeSource],
          exclude: config.exclude,
          rootRelative,
        },
        signal,
      ),
      include: [...config.include],
      exclude: [...config.exclude],
      includeSource: [...includeSource],
    },
    envSources: notKnown ?? [
      envSource(project.vite.config, rootRelative),
      envSource(session.instance.vite.config, rootRelative),
    ],
  };
}

/** Names a path the project's config reaches as a test module's path is named. */
function rootRelativeTo(
  session: WorkspaceSession,
  projectName: string,
): (path: string) => string {
  return (path) => {
    const location = session.locate(projectName, path);
    return testModuleFile(location.workspacePath, location.modulePath);
  };
}

/**
 * Vitest 5 gives the tests of a project that a nested projects container declares the container's env as well, and
 * records only which containers exist, so every project of a workspace holding one has env sources not known.
 */
function envSourcesNotKnown(
  session: WorkspaceSession,
): EnvSourcesNotKnown | undefined {
  const { config, version } = session.instance;
  const release = releaseLine(version);
  if (release !== undefined && release.major < CONTAINER_MAJOR) {
    return undefined;
  }
  const recorded = CONTAINER_RECORD in config ? config[CONTAINER_RECORD] : [];
  if (!isStringArray(recorded)) {
    return {
      notKnown: `Vitest records its nested projects containers in ${CONTAINER_RECORD} in a form RT Test does not read`,
    };
  }
  if (recorded.length === 0) {
    return verifiesContainerRecord(release)
      ? undefined
      : unrecordedContainers(config.projects, version);
  }
  const rootRelative = rootRelativeTo(
    session,
    session.instance.getRootProject().name,
  );
  const containers = [...new Set(recorded.map(rootRelative))].sort();
  return {
    notKnown: `a nested projects container declares its projects (${namedList(containers)})`,
  };
}

/** Where a verified minor records no container, it has none. A version that is not a release is not verified. */
function verifiesContainerRecord(release: ReleaseLine | undefined): boolean {
  return (
    release?.major === CONTAINER_MAJOR &&
    release.minor <= VERIFIED_CONTAINER_MINOR
  );
}

/**
 * On a minor not verified, a container can hide behind any `projects` entry naming a config file, a directory or a
 * glob, as the root config wrote it; an inline project cannot declare projects.
 */
function unrecordedContainers(
  declared: unknown,
  version: string,
): EnvSourcesNotKnown | undefined {
  const byPath =
    Array.isArray(declared) &&
    declared.some((entry: unknown) => typeof entry === "string");
  if (!byPath) return undefined;
  return {
    notKnown: `RT Test has not verified where Vitest ${version} records nested projects containers, and it records none in ${CONTAINER_RECORD} while the root config declares projects by path`,
  };
}

/**
 * Vite resolves `envDir` to an absolute path or `false`, and leaves `mode` as a JavaScript config wrote it, naming the
 * `.env.<mode>` files by its string form.
 */
function envSource(
  config: ViteConfig,
  rootRelative: (path: string) => string,
): EnvSource {
  const { envDir, envPrefix, mode } = config;
  return {
    envDirectory: envDir === false ? null : rootRelative(envDir),
    envPrefixes: envPrefixes(envPrefix),
    mode: String(mode),
  };
}

/**
 * Vite leaves `envPrefix` on the resolved config as a config file wrote it, which a JavaScript one need not type as
 * declared, and tests each prefix as a string.
 */
function envPrefixes(written: unknown): string[] {
  if (written === undefined) return [DEFAULT_ENV_PREFIX];
  const prefixes: readonly unknown[] = Array.isArray(written)
    ? written
    : [written];
  return prefixes.map((prefix) => String(prefix));
}

function patternBases(
  patterns: readonly string[],
  vitestDirectory: string,
  rootRelative: (path: string) => string,
): SpelledDirectory[] {
  const spellings = new Set<string>();
  for (const pattern of patterns) {
    const base = patternBase(pattern, vitestDirectory);
    if (base !== undefined && base !== vitestDirectory) spellings.add(base);
  }
  return [...spellings].map((spelled) => ({
    spelled,
    directory: rootRelative(spelled),
  }));
}

/** Typed as resolved, though Vitest gives a test config no default and reads an unset one as none. */
function inSourcePatterns(
  patterns: readonly string[] | null | undefined,
): readonly string[] {
  return patterns ?? [];
}

/** Typed as either, though Vitest resolves it to an array. */
function asList(files: string | readonly string[]): readonly string[] {
  return typeof files === "string" ? [files] : files;
}

function reportedAlias(alias: ViteAlias): ReportedAlias {
  const { find, replacement, customResolver } = alias;
  const isString = typeof find === "string";
  return {
    find: isString ? find : find.source,
    findKind: isString ? STRING_FIND : REGEXP_FIND,
    flags: isString ? STRING_FIND_FLAGS : find.flags,
    replacement,
    hasCustomResolver: customResolver !== undefined && customResolver !== null,
  };
}
