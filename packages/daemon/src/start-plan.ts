import { resolve } from "node:path";
import { defaultStateDirectory } from "./store/consumer-identity.js";
import {
  chosenConfigFile,
  type ConfirmedStart,
  type ConfirmedWorkspace,
} from "./vitest/confirmed-start.js";
import {
  findVitestWorkspaces,
  type UnreadWorkspaceSource,
} from "./vitest/find-workspaces.js";

/** What a start would execute, for the user to confirm before anything runs. */
export interface StartPlan {
  /** Passed to `startDaemon` unchanged once the user confirms it, so the daemon loads only what was shown. */
  readonly start: ConfirmedStart;
  /** Absolute. */
  readonly stateDirectory: string;
  readonly notRead: readonly UnreadWorkspaceSource[];
}

const NO_CONFIG_FILE_REASON =
  "its Vitest or Vite config file does not resolve to an existing file, so it is not confirmed and will not be loaded";

/** Reads files only, and executes nothing: no config, plugin or test module is loaded. */
export function startPlan(
  consumerRoot: string,
  stateDirectory?: string,
): StartPlan {
  const root = resolve(consumerRoot);
  const listing = findVitestWorkspaces(root);
  const notRead = [...listing.notRead];
  const workspaces: ConfirmedWorkspace[] = [];
  for (const workspace of listing.workspaces) {
    const configFile = chosenConfigFile(workspace);
    if (configFile === undefined) {
      notRead.push({ source: workspace.path, reason: NO_CONFIG_FILE_REASON });
      continue;
    }
    workspaces.push({ path: workspace.path, configFile });
  }
  return {
    start: { consumerRoot: root, workspaces },
    stateDirectory: resolvedStateDirectory(root, stateDirectory),
    notRead,
  };
}

/** Defaults to `.rt-test` under the consumer root; a relative path resolves against the working directory. */
export function resolvedStateDirectory(
  consumerRoot: string,
  stateDirectory: string | undefined,
): string {
  return resolve(stateDirectory ?? defaultStateDirectory(consumerRoot));
}
