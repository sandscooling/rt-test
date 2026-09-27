import { basename, posix } from "node:path";
import { workspaceConfig, type WorkspaceConfig } from "./config-loader.js";
import type { VitestWorkspace } from "./find-workspaces.js";

/** A workspace the user was shown before the start, with the config file shown for it. */
export interface ConfirmedWorkspace {
  /** As `VitestWorkspace.path` spells it. */
  readonly path: string;
  /** Relative to the consumer root, `/`-separated. */
  readonly configFile: string;
}

/** What the user confirmed: the daemon loads only these workspaces, each only through its confirmed config file. */
export interface ConfirmedStart {
  readonly consumerRoot: string;
  readonly workspaces: readonly ConfirmedWorkspace[];
}

/** The config file Vitest would load from the workspace, spelled as `ConfirmedWorkspace.configFile`; undefined when it holds none. */
export function chosenConfigFile(
  workspace: VitestWorkspace,
): string | undefined {
  const config = workspaceConfig(workspace.directory);
  return config === undefined ? undefined : rootRelative(workspace, config);
}

/** The workspace's config when it is still the confirmed one, so the file compared is the file loaded. */
export function confirmedConfig(
  workspace: VitestWorkspace,
  confirmedConfigFile: string,
): WorkspaceConfig | undefined {
  const config = workspaceConfig(workspace.directory);
  if (config === undefined) return undefined;
  return rootRelative(workspace, config) === confirmedConfigFile
    ? config
    : undefined;
}

export function confirmedEntry(
  start: ConfirmedStart,
  workspace: VitestWorkspace,
): ConfirmedWorkspace | undefined {
  return start.workspaces.find((entry) => entry.path === workspace.path);
}

/** A config file lies directly in its workspace's directory, which is the workspace path under the root. */
function rootRelative(
  workspace: VitestWorkspace,
  config: WorkspaceConfig,
): string {
  return posix.join(workspace.path, basename(config.file));
}
