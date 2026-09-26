/**
 * A setup file RT Test puts first in every project. Vitest resolves the project's snapshot environment, its own or
 * the one the project's config names, before any setup file runs, and saves every snapshot through it: even under
 * update `none` it rewrites a snapshot file that holds an unchecked entry and differs from its own serialization. Reads
 * stay the environment's own; saves and removals write nothing. It imports nothing, since it runs in the consumer's
 * worker, where `vitest` resolves to the consumer's install rather than RT Test's.
 */

interface SnapshotWrites {
  saveSnapshotFile: (filepath: string, snapshot: string) => Promise<void>;
  removeSnapshotFile: (filepath: string) => Promise<void>;
}

interface VitestWorkerGlobal {
  readonly __vitest_worker__?: {
    readonly config: {
      readonly snapshotOptions: {
        readonly snapshotEnvironment?: SnapshotWrites;
      };
    };
  };
}

const environment = (globalThis as VitestWorkerGlobal).__vitest_worker__?.config
  .snapshotOptions.snapshotEnvironment;
if (environment === undefined) {
  throw new Error(
    "RT Test found no Vitest snapshot environment in this worker, so it cannot keep snapshots from being written",
  );
}
environment.saveSnapshotFile = () => Promise.resolve();
environment.removeSnapshotFile = () => Promise.resolve();

export {};
