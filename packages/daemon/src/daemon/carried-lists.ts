import { isCurrentAdapterVersion } from "../query/test-states.js";
import type { LatestResults, RtTestStore } from "../store/open-store.js";
import type {
  StoreBindings,
  StoredDiscovery,
  StoreScope,
} from "../store/stored-records.js";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import {
  vouchedModules,
  withModuleLists,
  type ModuleTests,
  type WorkspaceLists,
} from "../vitest/test-lists.js";
import type { DaemonLog } from "./daemon-log.js";
import type { DiscoverOutcome, RunOutcome } from "./executor.js";

/** The discovery to store in place of the one in effect, bound as that one is, and the log's line for it. */
export interface ListRefresh {
  readonly bindings: StoreBindings;
  readonly discovery: TestDiscovery;
  readonly entry: string;
}

/** What storing a refreshed discovery reads and writes. */
interface RefreshParts {
  readonly store: Pick<RtTestStore, "readLatestDiscovery" | "writeDiscovery">;
  readonly scope: StoreScope;
  readonly log: DaemonLog;
}

const READING_CARRIED_LISTS =
  "reading the lists a rediscovery could carry, so it collects every test module";

/**
 * The lists a rediscovery keeps in place of collecting their modules, read through `latest`: from a discovery
 * stored under the current adapter version, each module of a discovered workspace whose collection raised no
 * unhandled error and whose latest stored run vouches for the module's list. A workspace with no stored run, or
 * whose latest was refused as unreadable, is collected whole, and so is every module when the read fails.
 */
export function listsToCarry(
  latest: () => LatestResults,
  log: DaemonLog,
): WorkspaceLists[] {
  let results: LatestResults;
  try {
    results = latest();
  } catch (error) {
    log.error(READING_CARRIED_LISTS, error);
    return [];
  }
  const stored = results.discovery;
  if (stored === undefined || !isCurrentAdapterVersion(stored.adapterVersion)) {
    return [];
  }
  const latestRuns = new Map(
    results.latestRuns.map(({ run }) => [run.workspace.path, run]),
  );
  return stored.discovery.workspaces.flatMap((entry) => {
    const run = latestRuns.get(entry.workspace.path);
    if (
      entry.status !== "discovered" ||
      entry.unhandledErrors.length > 0 ||
      run === undefined
    ) {
      return [];
    }
    const modules = vouchedModules(entry, run);
    return modules.length === 0
      ? []
      : [{ workspacePath: entry.workspace.path, modules }];
  });
}

/**
 * What the lists a stored run collected make of the discovery in effect, or undefined when they replace no list in
 * it or it is of another adapter version. The record keeps the fingerprint of the discovery it replaces, whose
 * listed modules and selection facts it leaves as they are.
 */
export function listRefresh(
  stored: StoredDiscovery | undefined,
  workspacePath: string,
  lists: readonly ModuleTests[],
): ListRefresh | undefined {
  if (stored === undefined || !isCurrentAdapterVersion(stored.adapterVersion)) {
    return undefined;
  }
  const replaced = withModuleLists(stored.discovery, workspacePath, lists);
  if (replaced === undefined) return undefined;
  const { projectIdentity, worktreeIdentity, inputFingerprint } = stored;
  return {
    bindings: { projectIdentity, worktreeIdentity, inputFingerprint },
    discovery: replaced.discovery,
    entry: `the run of ${workspacePath} collected ${replaced.changedModules} test modules whose tests differ from the discovery's, so the discovery is stored again with the run's lists`,
  };
}

/**
 * Stores the discovery in effect again with the test lists a stored run's job reported, when they differ from its
 * own, and hands the stored record to `stored` with what was done. A read or write that fails is logged, and leaves
 * the run stored and the lists as they were, which the run vouches for only where they hold the tests it recorded.
 */
export function refreshLists(
  { store, scope, log }: RefreshParts,
  workspacePath: string,
  outcome: RunOutcome,
  stored: (refreshed: StoredDiscovery, what: string) => void,
): void {
  const lists = outcome.ended ? outcome.lists : undefined;
  if (lists === undefined) return;
  const what = `storing the discovery with the test lists of the run of ${workspacePath}`;
  let refresh: ListRefresh | undefined;
  let refreshed: StoredDiscovery;
  try {
    refresh = listRefresh(
      store.readLatestDiscovery(scope),
      workspacePath,
      lists,
    );
    if (refresh === undefined) return;
    refreshed = store.writeDiscovery(refresh.bindings, refresh.discovery);
  } catch (error) {
    log.error(what, error);
    return;
  }
  log.entry(refresh.entry);
  stored(refreshed, what);
}

/**
 * One line for each workspace the start confirmed, as a discovery's executor reported it: its test modules listed,
 * collected and carried, or how it ended when it was not discovered, and its time.
 */
export function collectionLog(outcome: DiscoverOutcome): string[] {
  const collection = outcome.ended ? (outcome.collection ?? []) : [];
  return collection.map((workspace) => {
    const { workspacePath, status, listed, collected, carried, wallMs } =
      workspace;
    return status === "discovered"
      ? `discovery of ${workspacePath}: ${listed} test modules listed, ${collected} collected, ${carried} carried, in ${wallMs} ms`
      : `discovery of ${workspacePath}: ${status}, in ${wallMs} ms`;
  });
}
