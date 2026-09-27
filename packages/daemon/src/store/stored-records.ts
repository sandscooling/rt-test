import type { SQLOutputValue } from "node:sqlite";
import type { TestDiscovery } from "../vitest/discover-tests.js";
import type { WorkspaceRun } from "../vitest/run-workspace.js";
import { FINGERPRINT_DIGEST, NOT_FINGERPRINTED } from "./schema.js";

/** The inputs a result was produced from, or not fingerprinted when the daemon could not vouch for them from the job's start to its end. */
export type InputFingerprint =
  | { readonly kind: typeof FINGERPRINT_DIGEST; readonly digest: string }
  | { readonly kind: typeof NOT_FINGERPRINTED };

/** The project and worktree every read answers for. */
export interface StoreScope {
  readonly projectIdentity: string;
  readonly worktreeIdentity: string;
}

export interface StoreBindings extends StoreScope {
  readonly inputFingerprint: InputFingerprint;
}

interface StoredRecord extends StoreBindings {
  readonly adapterVersion: number;
}

export interface StoredRun extends StoredRecord {
  readonly runId: string;
  readonly run: WorkspaceRun;
}

export interface StoredDiscovery extends StoredRecord {
  readonly discoveryId: string;
  readonly discovery: TestDiscovery;
}

interface FingerprintColumns {
  readonly fingerprintKind: string;
  readonly fingerprintDigest: string | null;
}

/** Callers outside the type system can pass anything, so every binding is checked at run time. */
export function requireBindings(bindings: StoreBindings): void {
  requireScope(bindings);
  fingerprintColumns((bindings as Partial<StoreBindings>).inputFingerprint);
}

export function requireScope(scope: StoreScope): void {
  const { projectIdentity, worktreeIdentity } = (scope ??
    {}) as Partial<StoreScope>;
  requireNonEmpty("project identity", projectIdentity);
  requireNonEmpty("worktree identity", worktreeIdentity);
}

export function fingerprintColumns(
  fingerprint: InputFingerprint | undefined,
): FingerprintColumns {
  if (fingerprint?.kind === NOT_FINGERPRINTED) {
    return { fingerprintKind: NOT_FINGERPRINTED, fingerprintDigest: null };
  }
  if (fingerprint?.kind === FINGERPRINT_DIGEST) {
    requireNonEmpty("input fingerprint digest", fingerprint.digest);
    return {
      fingerprintKind: FINGERPRINT_DIGEST,
      fingerprintDigest: fingerprint.digest,
    };
  }
  throw new Error(
    `The input fingerprint is required: pass a digest or { kind: "${NOT_FINGERPRINTED}" }; got ${JSON.stringify(fingerprint)}`,
  );
}

export function fingerprintFromColumns(
  kind: SQLOutputValue,
  digest: SQLOutputValue,
): InputFingerprint {
  if (kind === NOT_FINGERPRINTED) return { kind: NOT_FINGERPRINTED };
  if (kind === FINGERPRINT_DIGEST && typeof digest === "string") {
    return { kind: FINGERPRINT_DIGEST, digest };
  }
  throw new Error(
    `The store holds an unreadable input fingerprint: kind ${String(kind)}, digest ${String(digest)}`,
  );
}

function requireNonEmpty(name: string, value: unknown): void {
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `The ${name} is required and must be a non-empty string; got ${JSON.stringify(value)}`,
    );
  }
}
