import type { WaitMoment } from "../daemon/waits.js";
import type { NoAnswer } from "../query/answer.js";
import { queryBasis, type QueryBasis } from "../query/summary.js";
import { defectStandings, type DefectStanding } from "./defect-standings.js";
import { readDefinitionFiles, type InvalidEntry } from "./definition-files.js";
import { checkDefinitions } from "./definitions.js";
import {
  readAnchors,
  resolveDefinitions,
  type ResolvedDefinition,
} from "./resolve-definitions.js";

export interface WorktreeRead {
  readonly consumerRoot: string;
  readonly stateDirectory: string;
  readonly signal: AbortSignal;
  /** The latest stored results, the daemon's view and the inputs, read when it is called. */
  readonly moment: () => WaitMoment;
}

/** Every definition of a worktree with its standing, and what they were decided from. */
export interface WorktreeStandings {
  readonly basis: QueryBasis;
  readonly invalidEntries: readonly InvalidEntry[];
  /** The error names `rt-test.json` declares as assertions, which every standing's definition digest covers. */
  readonly assertionErrors: readonly string[];
  /** In the order the definition files give them. */
  readonly definitions: readonly ResolvedDefinition[];
  /** One for each definition, in the same order. */
  readonly standings: readonly DefectStanding[];
}

/**
 * Reads `rt-test.json`, the definition files and each mutation's file as they are now, then takes the daemon's moment
 * and resolves and rates every definition without awaiting again. So the daemon's facts in what it returns are those
 * of the moment it returns at, and each file's are as that file was read before it. Once the signal aborts nobody
 * waits for them and a stop may have closed the store, so it reads no moment.
 */
export async function worktreeStandings(
  read: WorktreeRead,
): Promise<WorktreeStandings | NoAnswer> {
  const { consumerRoot, signal } = read;
  const files = await readDefinitionFiles(
    consumerRoot,
    read.stateDirectory,
    signal,
  );
  const checked = checkDefinitions(files.definitions, consumerRoot);
  const anchors = await readAnchors(checked, signal);
  signal.throwIfAborted();
  const { results, view, inputs } = read.moment();
  const basis = queryBasis(results, view, inputs);
  if ("noAnswer" in basis) return basis;
  const { discovery } = basis.discovery;
  const { discoveryCurrent } = basis;
  const definitions = resolveDefinitions(
    checked,
    anchors,
    discovery,
    discoveryCurrent,
  );
  const { assertionErrors, invalidEntries } = files;
  return {
    basis,
    invalidEntries,
    assertionErrors,
    definitions,
    standings: defectStandings(definitions, {
      consumerRoot,
      assertionErrors,
      evidence: results,
      discovery,
      discoveryCurrent,
      currentFingerprint: basis.currentFingerprint,
      testStandings: basis.standings,
    }),
  };
}
