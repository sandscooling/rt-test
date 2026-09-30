import type { DaemonLog } from "../src/daemon/daemon-log.js";
import { Executor } from "../src/daemon/executor.js";
import {
  discoveryFingerprint,
  SnapshotReads,
  workspaceFingerprint,
  type ProjectInputs,
} from "../src/inputs/fingerprint.js";
import { InputTracker } from "../src/inputs/input-tracker.js";
import type {
  TestDiscovery,
  WorkspaceDiscovery,
} from "../src/vitest/discover-tests.js";

/**
 * Compiled by the daemon's typecheck and never run. Each expected error is a place that could count the daemon's live
 * environment, or start an executor process from it, by leaving out the start environment or the reads carrying it.
 */
export function omittingTheStartEnvironment(
  project: ProjectInputs,
  entry: WorkspaceDiscovery,
  discovery: TestDiscovery,
  log: DaemonLog,
): void {
  // @ts-expect-error a snapshot's environment is required
  void new SnapshotReads(project.root);
  // @ts-expect-error a workspace fingerprint's reads are required
  workspaceFingerprint(project, entry);
  // @ts-expect-error a discovery fingerprint's reads are required
  discoveryFingerprint(project, discovery);
  // @ts-expect-error an executor's start environment is required
  void new Executor(log);
  // @ts-expect-error the tracker's start environment is required
  void new InputTracker({ consumerRoot: project.root, exclusions: [], log });
}
