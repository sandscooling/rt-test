import type { TestProject } from "vitest/node";
import { testModuleFile } from "../inputs/non-inputs.js";
import { globCwd, patternBase } from "../inputs/protection.js";
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
 * A directory as a test file pattern spells it, or the file a pattern with no glob segment names, which a link, a
 * `subst` drive or a short name can make differ.
 */
export interface PatternBase {
  /** Absolute and `/`-separated, as Vitest's glob names the files it crawls to below it. */
  readonly spelled: string;
  /** Where that spelling resolves. */
  readonly directory: string;
}

/**
 * Every path in a project's selection facts is `/`-separated and named as a test module's path is: relative to the
 * consumer root, climbing with `..` for a file outside it, and absolute for a file on another Windows drive. A
 * spelling Vitest's glob uses, `vitestDirectory` and each pattern base's `spelled`, is always absolute.
 */
export interface TestFilePatterns {
  /** Where the patterns match from, the consumer root being `.`. */
  readonly directory: string;
  /** `directory` as Vitest's glob spells it, which differs when the root was started through another spelling. */
  readonly vitestDirectory: string;
  /** Each `include` and `includeSource` pattern's base, as `patternBase` finds it, other than `vitestDirectory`. */
  readonly patternBases: readonly PatternBase[];
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  readonly includeSource: readonly string[];
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
}

/** Per project not in browser mode. Only a discovery stored without every fact this version reads is not reported. */
export type SelectionFacts =
  | {
      readonly reported: true;
      readonly projects: readonly ProjectSelectionFacts[];
    }
  | { readonly reported: false };

export const STRING_FIND_FLAGS = "";

type ViteAlias = TestProject["vite"]["config"]["resolve"]["alias"][number];

/** Reads resolved config only, and carries nothing the executor's JSON channel would lose. */
export function selectionFacts(session: WorkspaceSession): SelectionFacts {
  const rootGlobalSetup = asList(
    session.instance.getRootProject().config.globalSetup,
  );
  return {
    reported: true,
    projects: session.instance.projects
      .filter((project) => !usesBrowserMode(project))
      .map((project) => projectFacts(session, project, rootGlobalSetup)),
  };
}

function projectFacts(
  session: WorkspaceSession,
  project: TestProject,
  rootGlobalSetup: readonly string[],
): ProjectSelectionFacts {
  const { config } = project;
  const rootRelative = (path: string): string => {
    const location = session.locate(project.name, path);
    return testModuleFile(location.workspacePath, location.modulePath);
  };
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
      include: [...config.include],
      exclude: [...config.exclude],
      includeSource: [...includeSource],
    },
  };
}

function patternBases(
  patterns: readonly string[],
  vitestDirectory: string,
  rootRelative: (path: string) => string,
): PatternBase[] {
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
