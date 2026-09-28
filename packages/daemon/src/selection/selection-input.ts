import { resolve } from "node:path";
import type { NonInputsDeclaration } from "../inputs/non-inputs.js";
import { protection, ROOT_WORKSPACE } from "../inputs/protection.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { ROOT_PATH } from "../vitest/find-workspaces.js";
import type { ProjectSelectionFacts } from "../vitest/selection-facts.js";
import type {
  NotRunnableWorkspace,
  SelectableWorkspace,
  SelectionAlias,
  SelectionInput,
  WorkspaceTests,
} from "./selection-types.js";

const NO_DISCOVERY_REASON =
  "no discovery is in effect, so the Vitest workspaces and their tests are not known";
const FACTS_NOT_REPORTED_REASON =
  "the discovery in effect does not report the setup files and aliases of the Vitest workspace";
const FAILED_MODULES_REASON = "discovery could not collect these test modules:";
const UNHANDLED_ERROR_REASON = "collection raised an unhandled error";
const PATH_SEPARATOR = ", ";
const REASON_SEPARATOR = "; ";

/** Selection's input as the discovery in effect decides it, before a change and its dependency information. */
export type DiscoveredSelectionInput = Omit<
  SelectionInput,
  "change" | "dependencies"
>;

export type SelectionInputBuild =
  | { readonly built: true; readonly input: DiscoveredSelectionInput }
  | { readonly built: false; readonly reason: string };

type DiscoveredWorkspace = Extract<
  WorkspaceDiscovery,
  { status: "discovered" }
>;

type WorkspaceFacts = Pick<
  SelectableWorkspace,
  "setupFiles" | "globalSetupFiles" | "aliases"
>;

const NO_FACTS: WorkspaceFacts = {
  setupFiles: [],
  globalSetupFiles: [],
  aliases: [],
};

/**
 * Builds selection's input from the discovery in effect, or says why none can be built. `consumerRoot` is the
 * consumer root's real path.
 */
export function buildSelectionInput(
  discovery: TestDiscovery | undefined,
  consumerRoot: string,
  declaration: NonInputsDeclaration,
): SelectionInputBuild {
  if (discovery === undefined) {
    return { built: false, reason: NO_DISCOVERY_REASON };
  }
  const workspaces: SelectableWorkspace[] = [];
  const notRunnable: NotRunnableWorkspace[] = [];
  for (const entry of discovery.workspaces) {
    switch (entry.status) {
      case "discovered": {
        if (!entry.selectionFacts.reported) {
          return {
            built: false,
            reason: `${FACTS_NOT_REPORTED_REASON} ${workspaceName(entry.workspace.path)}`,
          };
        }
        workspaces.push({
          workspace: entry.workspace,
          tests: discoveredTests(entry),
          ...mergedFacts(entry.selectionFacts.projects, consumerRoot),
        });
        break;
      }
      case "failed":
        workspaces.push({
          workspace: entry.workspace,
          tests: { known: false, reason: entry.error },
          ...NO_FACTS,
        });
        break;
      case "unsupported":
        notRunnable.push({
          workspace: entry.workspace,
          reason: entry.vitest.reason,
        });
        break;
      case "not-confirmed":
        notRunnable.push({ workspace: entry.workspace, reason: entry.reason });
        break;
    }
  }
  return {
    built: true,
    input: {
      workspaces,
      notRunnable,
      vitestListingNotRead: discovery.notRead,
      nonInputs: {
        declaration,
        protection: protection(discovery, consumerRoot),
      },
    },
  };
}

function workspaceName(path: string): string {
  return path === ROOT_PATH ? ROOT_WORKSPACE : path;
}

/** A browser-mode project's tests are never run, so its unsupported entry leaves the workspace's tests known. */
function discoveredTests(entry: DiscoveredWorkspace): WorkspaceTests {
  const failures: string[] = [];
  if (entry.failedModules.length > 0) {
    const paths = new Set(
      entry.failedModules.map(({ modulePath }) => modulePath),
    );
    failures.push(
      `${FAILED_MODULES_REASON} ${[...paths].join(PATH_SEPARATOR)}`,
    );
  }
  if (entry.unhandledErrors.length > 0) failures.push(UNHANDLED_ERROR_REASON);
  return failures.length === 0
    ? { known: true, tests: entry.tests.map(({ identity }) => identity) }
    : { known: false, reason: failures.join(REASON_SEPARATOR) };
}

/** Every project's facts apply to the whole workspace, which only adds edges. */
function mergedFacts(
  projects: readonly ProjectSelectionFacts[],
  consumerRoot: string,
): WorkspaceFacts {
  return {
    setupFiles: [...new Set(projects.flatMap(({ setupFiles }) => setupFiles))],
    globalSetupFiles: [
      ...new Set(projects.flatMap(({ globalSetupFiles }) => globalSetupFiles)),
    ],
    aliases: withoutRepeats(
      projects.flatMap(({ aliases, viteRoot }) =>
        aliases.map((alias) => ({
          ...alias,
          viteRoot: resolve(consumerRoot, viteRoot),
        })),
      ),
    ),
  };
}

function withoutRepeats(aliases: readonly SelectionAlias[]): SelectionAlias[] {
  return aliases.filter(
    (alias, index) =>
      aliases.findIndex((earlier) => sameAlias(alias, earlier)) === index,
  );
}

function sameAlias(left: SelectionAlias, right: SelectionAlias): boolean {
  return (
    left.find === right.find &&
    left.findKind === right.findKind &&
    left.flags === right.flags &&
    left.replacement === right.replacement &&
    left.hasCustomResolver === right.hasCustomResolver &&
    left.viteRoot === right.viteRoot
  );
}
