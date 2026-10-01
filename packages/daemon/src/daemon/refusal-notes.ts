import type { LatestResults } from "../store/open-store.js";
import type { DaemonLog } from "./daemon-log.js";

const DISCOVERY_REFUSED_ENTRY =
  "warning: the latest stored discovery was refused as unreadable, so a discovery is due as if none were stored, and no workspace runs until it is stored";
const RUN_REFUSED_ENTRY =
  "was refused as unreadable, so the daemon plans for it as if no run of it were stored";
const EVIDENCE_REFUSED_ENTRY =
  "was refused as unreadable, so the defect reads never verified until a new verdict replaces it";

/** Logs each refusal a read of the latest results holds, whole and once, so the log has it before an answer quotes it cut. */
export class RefusalNotes {
  readonly #log: DaemonLog;
  #loggedRefusal: string | undefined;
  /** The refusal last logged for each workspace whose latest run the last read refused, by its path. */
  #loggedRunRefusals: ReadonlyMap<string, string> = new Map();
  /** The refusal last logged for each defect whose stored evidence the last read refused, by its id. */
  #loggedEvidenceRefusals: ReadonlyMap<string, string> = new Map();

  constructor(log: DaemonLog) {
    this.#log = log;
  }

  note(results: LatestResults): void {
    this.#noteRefusal(results.discoveryRefusal);
    this.#noteRunRefusals(results.runRefusals);
    this.#noteEvidenceRefusals(results.evidenceRefusals);
  }

  /** Logs each refusal of the latest discovery once, as the reason a discovery is due. */
  #noteRefusal(refusal: string | undefined): void {
    if (refusal === this.#loggedRefusal) return;
    this.#loggedRefusal = refusal;
    if (refusal !== undefined) {
      this.#log.entry(`${DISCOVERY_REFUSED_ENTRY}: ${refusal}`);
    }
  }

  /** Logs each workspace's refusal once per reason, and again when it returns after a read that did not refuse it. */
  #noteRunRefusals(refusals: LatestResults["runRefusals"]): void {
    for (const { workspacePath, reason } of refusals) {
      if (this.#loggedRunRefusals.get(workspacePath) === reason) continue;
      this.#log.entry(
        `warning: the latest stored run of ${workspacePath} ${RUN_REFUSED_ENTRY}: ${reason}`,
      );
    }
    this.#loggedRunRefusals = new Map(
      refusals.map((refusal) => [refusal.workspacePath, refusal.reason]),
    );
  }

  /** Logs each defect's refusal once per reason, and again when it returns after a read that did not refuse it. */
  #noteEvidenceRefusals(refusals: LatestResults["evidenceRefusals"]): void {
    for (const { defectId, reason } of refusals) {
      if (this.#loggedEvidenceRefusals.get(defectId) === reason) continue;
      this.#log.entry(
        `warning: the stored evidence of defect ${defectId} ${EVIDENCE_REFUSED_ENTRY}: ${reason}`,
      );
    }
    this.#loggedEvidenceRefusals = new Map(
      refusals.map((refusal) => [refusal.defectId, refusal.reason]),
    );
  }
}
