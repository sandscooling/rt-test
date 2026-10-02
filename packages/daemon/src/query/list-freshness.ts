import type { Freshness } from "@rt-test/core";
import type { StoredRun } from "../store/stored-records.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../vitest/discover-tests.js";
import { listedModules, vouchedModules } from "../vitest/test-lists.js";
import { CURRENT, STALE, UNKNOWN } from "./answer.js";
import { recordFreshness, type CurrentFingerprints } from "./test-states.js";

type DiscoveredWorkspace = Extract<
  WorkspaceDiscovery,
  { status: "discovered" }
>;

/** Each workspace's latest stored run, or why it was refused as unreadable, by workspace path. */
export interface StoredRuns {
  readonly latestRuns: ReadonlyMap<string, StoredRun>;
  readonly refusedRuns: ReadonlyMap<string, string>;
}

/**
 * The freshness an answer gives the discovery its counts come from: `own`, the discovery's by its own fingerprint,
 * unless that reads current while a run does not vouch for a list. A rediscovery carries a module's list only where
 * a run of its workspace is stored, so each discovered workspace holding a stored run is rated by its latest run:
 * as that run rates against the workspace's current fingerprint, and unknown when the run was refused as
 * unreadable or did not record, for a module the discovery lists tests for, exactly those tests. Any stale one
 * makes the discovery stale; otherwise any unknown one makes it unknown.
 */
export function listFreshness(
  own: Freshness,
  discovery: TestDiscovery,
  { latestRuns, refusedRuns }: StoredRuns,
  current: CurrentFingerprints,
): Freshness {
  if (own !== CURRENT) return own;
  let rated: Freshness = CURRENT;
  for (const entry of discovery.workspaces) {
    if (entry.status !== "discovered") continue;
    const path = entry.workspace.path;
    const latest = latestRuns.get(path);
    if (latest === undefined && !refusedRuns.has(path)) continue;
    const vouched =
      latest === undefined
        ? UNKNOWN
        : vouchedFreshness(entry, latest, current(path));
    if (vouched === STALE) return STALE;
    if (vouched === UNKNOWN) rated = UNKNOWN;
  }
  return rated;
}

function vouchedFreshness(
  entry: DiscoveredWorkspace,
  latest: StoredRun,
  currentFingerprint: string | undefined,
): Freshness {
  const freshness = recordFreshness(latest, currentFingerprint);
  if (freshness !== CURRENT) return freshness;
  return vouchedModules(entry, latest.run).length ===
    listedModules(entry).length
    ? CURRENT
    : UNKNOWN;
}
