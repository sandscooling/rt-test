import { CANARY_READING, type CanaryReading } from "../falsify/canary-set.js";
import { FALSIFIER_VERSION } from "../falsify/experiment-record.js";
import { namedList } from "../inputs/input-jobs.js";
import type { VitestWorkspace } from "../vitest/find-workspaces.js";
import {
  resolveWorkspaceVitest,
  type ResolvedVitest,
} from "../vitest/load-vitest.js";
import {
  takeCanaryReading,
  type CanaryReadingParts,
} from "./canary-reading.js";

/** What the gate says of the Vitest install a workspace resolves. */
export const STANDING = {
  confirmed: "confirmed",
  /** No job is sent: the install's reading disagreed, or the workspace resolves no supported Vitest. */
  waits: "waits",
  unread: "unread",
} as const;

/** A reading is kept by install for the daemon's life, so these two end a refusal and a change of the input revision does not. */
const REFUSAL_ENDS =
  "so no falsification job of the workspace begins until it resolves another Vitest install or the daemon is restarted";
const NO_JUDGEMENT = "no judgement";
const NO_VERDICT = "no verdict";
const LIST_SEPARATOR = ", ";

type VitestInstall = Parameters<typeof takeCanaryReading>[1];
type UnsupportedVitest = Extract<ResolvedVitest, { readonly supported: false }>;
type KeptReading = Exclude<
  CanaryReading,
  { readonly status: typeof CANARY_READING.none }
>;
type NoReading = Exclude<CanaryReading, KeptReading>;
type DisagreedCanary = Extract<
  CanaryReading,
  { readonly status: typeof CANARY_READING.disagreed }
>["canaries"][number];

/** What a workspace's mark is made from. */
interface WorkspaceWait {
  /** What happened, said of the workspace. */
  readonly what: string;
  /** What ends the wait; absent when a change of the input revision does. */
  readonly ends?: string;
}

/** An install no reading is kept of, with the workspace the gate was asked about. */
export interface UnreadInstall {
  readonly state: typeof STANDING.unread;
  readonly workspace: VitestWorkspace;
  readonly install: VitestInstall;
}

type InstallStanding =
  | { readonly state: typeof STANDING.confirmed }
  | ({ readonly state: typeof STANDING.waits } & WorkspaceWait)
  | UnreadInstall;

/**
 * Says whether a workspace's falsification job may be sent: only once RT Test's canaries have read as named under the
 * Vitest install the workspace resolves. It keeps each install's confirmed or disagreed reading in memory for the
 * daemon's life and nothing of a job that gave no reading, so an install whose reading is being taken is unread.
 */
export class CanaryGate {
  readonly #parts: CanaryReadingParts;
  readonly #kept = new Map<string, KeptReading>();

  constructor(parts: CanaryReadingParts) {
    this.#parts = parts;
  }

  /** Answers with no await, from the Vitest the workspace resolves now and the readings kept. */
  standing(workspace: VitestWorkspace): InstallStanding {
    const vitest = resolveWorkspaceVitest(workspace.directory);
    if (!vitest.supported) {
      return { state: STANDING.waits, ...unsupportedWait(vitest) };
    }
    const install = { directory: vitest.directory, version: vitest.version };
    const kept = this.#kept.get(installKey(install));
    if (kept === undefined) {
      return { state: STANDING.unread, workspace, install };
    }
    const wait = readingWait(install, kept);
    return wait === undefined
      ? { state: STANDING.confirmed }
      : { state: STANDING.waits, ...wait };
  }

  /**
   * Takes the reading of an unread install as one executor job, handed to the executor before this first awaits, so
   * an abort asked in the same tick finds the job. Call only while that executor holds no job.
   */
  async take({ workspace, install }: UnreadInstall): Promise<CanaryReading> {
    const { log } = this.#parts;
    const subject = `${workspace.path}, Vitest ${install.version}`;
    log.entry(`canary job started: ${subject}, install ${install.directory}`);
    const startedAt = performance.now();
    const reading = await takeCanaryReading(this.#parts, install);
    if (reading.status !== CANARY_READING.none) {
      this.#kept.set(installKey(install), reading);
    }
    log.entry(
      `canary job ended: ${subject}, ${endText(reading)}; ${Math.round(performance.now() - startedAt)} ms`,
    );
    return reading;
  }
}

/**
 * What a reading of `install` leaves a workspace on it waiting for: nothing when it confirmed, a refusal that outlasts
 * the input revision when it disagreed, and otherwise a wait at the revision the reading was taken at.
 */
export function readingWait(
  install: VitestInstall,
  reading: CanaryReading,
): WorkspaceWait | undefined {
  switch (reading.status) {
    case CANARY_READING.confirmed:
      return undefined;
    case CANARY_READING.disagreed:
      return {
        what: `its job is refused, since under Vitest ${reading.vitestVersion} with falsifier version ${FALSIFIER_VERSION} the canaries did not all read as named: ${namedList(reading.canaries.map(canaryText))}`,
        ends: REFUSAL_ENDS,
      };
    case CANARY_READING.none:
      return {
        what: `the canary job under its Vitest ${install.version} gave ${noReadingText(reading)}`,
      };
  }
}

function unsupportedWait(vitest: UnsupportedVitest): WorkspaceWait {
  const found =
    vitest.version === undefined ? "" : `Vitest ${vitest.version}, `;
  return {
    what: `its job was not sent, since its workspace resolves no supported Vitest (${found}supported ${vitest.supportedRange}): ${vitest.reason}`,
  };
}

function installKey({ directory, version }: VitestInstall): string {
  return JSON.stringify([directory, version]);
}

/** How a canary job ended, with every canary that disagreed, since an answer names only the first of them. */
function endText(reading: CanaryReading): string {
  switch (reading.status) {
    case CANARY_READING.confirmed:
      return reading.status;
    case CANARY_READING.disagreed:
      return `${reading.status}: ${reading.canaries.map(canaryText).join(LIST_SEPARATOR)}`;
    case CANARY_READING.none:
      return noReadingText(reading);
  }
}

function noReadingText(reading: NoReading): string {
  const detail = "detail" in reading ? `: ${reading.detail}` : "";
  return `no reading (${reading.kind}${detail})`;
}

function canaryText({ id, read, named }: DisagreedCanary): string {
  return `${id} (read ${judgementText(read)}, named ${judgementText(named)})`;
}

/** A verdict with its reason, each said as absent where the judgement holds none. */
function judgementText({ verdict, reason }: DisagreedCanary["read"]): string {
  if (verdict === undefined && reason === undefined) return NO_JUDGEMENT;
  const given = verdict ?? NO_VERDICT;
  return reason === undefined ? given : `${given}/${reason}`;
}
