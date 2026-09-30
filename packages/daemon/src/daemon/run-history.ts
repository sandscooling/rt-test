import type { WorkspaceDiscovery } from "../vitest/discover-tests.js";
import type { DaemonLog } from "./daemon-log.js";
import { testModulesKey } from "./due-workspaces.js";

/** The fields of a run job's report the run history reads. */
export interface HistoryReport {
  /** The input revision the run began at. */
  readonly revision: number;
  /** Whether a run record was stored. */
  readonly stored: boolean;
  /**
   * Whether its inputs changed while it ran with a fingerprint taken at its end, or a change interrupted it; such a
   * run was stored not fingerprinted, or nothing was stored.
   */
  readonly changedWhileRunning: boolean;
}

interface RunHistoryParts {
  readonly log: DaemonLog;
  /** The input revision now. */
  readonly revision: () => number;
}

/** What the record holds of the last run started for a workspace. */
interface Attempt {
  readonly revision: number;
  readonly modules: string;
  /** Whether the run ended with nothing stored. */
  readonly nothingStored: boolean;
  /** Whether its inputs changed while it ran at a revision the change did not move, so it runs once more. */
  readonly rerunOwed: boolean;
}

interface BegunRun {
  readonly path: string;
  readonly modules: string;
  /** Whether it is the once-more run its workspace's last run was owed. */
  readonly isRerun: boolean;
}

/**
 * By workspace, the last run the scheduler started: whether it stored nothing, and whether a run at a revision and
 * list of test modules is owed once more, since its inputs changed at a revision the change did not move.
 */
export class RunHistory {
  readonly #log: DaemonLog;
  readonly #revision: () => number;
  readonly #attempts = new Map<string, Attempt>();

  constructor(parts: RunHistoryParts) {
    this.#log = parts.log;
    this.#revision = parts.revision;
  }

  /** Whether the last run attempted for the workspace ended with nothing stored. */
  storedNothing(path: string): boolean {
    return this.#attempts.get(path)?.nothingStored === true;
  }

  ranAlready(
    path: string,
    revision: number,
    entry: WorkspaceDiscovery,
  ): boolean {
    const attempt = this.#attempts.get(path);
    return (
      attempt !== undefined &&
      attempt.revision === revision &&
      attempt.modules === testModulesKey(entry) &&
      !attempt.rerunOwed
    );
  }

  /**
   * Marks the run as having stored nothing, a mark a run that does not begin leaves in place. Returns what records
   * the run's end, which says whether it is owed once more.
   */
  began(
    entry: WorkspaceDiscovery,
    revision: number,
  ): (report: HistoryReport) => boolean {
    const path = entry.workspace.path;
    const modules = testModulesKey(entry);
    const before = this.#attempts.get(path);
    const isRerun =
      before?.rerunOwed === true &&
      before.revision === revision &&
      before.modules === modules;
    // Nothing is stored until the run reports, so a run that throws is retried as one whose process died.
    this.#attempts.set(path, {
      revision,
      modules,
      nothingStored: true,
      rerunOwed: false,
    });
    return (report) => this.#ended({ path, modules, isRerun }, report);
  }

  #ended(run: BegunRun, report: HistoryReport): boolean {
    const { path, modules, isRerun } = run;
    const unmoved =
      report.changedWhileRunning && report.revision === this.#revision();
    if (unmoved && isRerun) {
      this.#log.entry(
        `the run of ${path} was stored not fingerprinted again because its inputs changed while it ran at input revision ${report.revision}, which the change did not move, so it is held until the input revision or its list of test modules changes`,
      );
    } else if (unmoved) {
      this.#log.entry(
        `the run of ${path} was stored not fingerprinted because its inputs changed while it ran at input revision ${report.revision}, which the change did not move, so it runs once more`,
      );
    }
    const owedAgain = unmoved && !isRerun;
    this.#attempts.set(path, {
      revision: report.revision,
      modules,
      nothingStored: !report.stored,
      rerunOwed: owedAgain,
    });
    return owedAgain;
  }
}
