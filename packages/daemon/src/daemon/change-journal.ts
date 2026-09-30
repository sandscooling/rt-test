import {
  testIdentityKey,
  type Freshness,
  type TestIdentity,
} from "@rt-test/core";
import { randomUUID } from "node:crypto";
import type { NotDiscoveredEntry, TestState } from "../query/answer.js";
import { CURSOR_USE, type CursorUse } from "../query/changes-answer.js";
import type { TestStanding } from "../query/test-states.js";

/**
 * A target until measured: how many test or entry changes may be recorded after a cursor before it expires. A worktree
 * whose tests all go stale at one edit expires every older cursor once it holds this many tests or more.
 */
const MAX_RECORDED_CHANGES = 100_000;

const CURSOR_SEPARATOR = ".";
const SEQUENCE_FORM = /^[1-9][0-9]*$/;
const TEST_KEY_PREFIX = "test:";
const ENTRY_KEY_PREFIX = "entry:";

/** A test's standing as the journal records it: history, never read as the test's standing now. */
export interface RecordedTest {
  readonly test: TestIdentity;
  readonly state: TestState;
  readonly freshness: Freshness;
}

/** A not-discovered entry the journal recorded as listed. */
export interface RecordedEntry {
  readonly entry: NotDiscoveredEntry;
}

export type RecordedStanding = RecordedTest | RecordedEntry;

/** A test or entry whose standing at a cursor differs from its latest one; each side is absent when it had or has none. */
export interface NetChange {
  readonly key: string;
  readonly atCursor: RecordedStanding | undefined;
  readonly now: RecordedStanding | undefined;
}

export type CursorReading =
  | {
      readonly use: typeof CURSOR_USE.used;
      readonly changes: readonly NetChange[];
    }
  | { readonly use: Exclude<CursorUse, typeof CURSOR_USE.used> };

interface RecordedChange {
  readonly sequence: number;
  readonly key: string;
  readonly before: RecordedStanding | undefined;
}

/**
 * The standings recorded in this daemon life: the latest one of each test and not-discovered entry, and each change
 * with the standing it replaced, so a cursor naming a recorded moment reads what changed since. Held in memory only,
 * so a cursor from another daemon life is not issued by this one.
 */
export class ChangeJournal {
  readonly #life = randomUUID();
  /** The latest recorded moment; 0 before the first. */
  #sequence = 0;
  #latest = new Map<string, RecordedStanding>();
  /** Oldest first. */
  #changes: RecordedChange[] = [];
  /** The latest sequence whose changes were dropped; a cursor before it is expired. */
  #dropped = 0;

  /**
   * Records a determined moment's standings and entries, adding a sequence only when one differs from the latest
   * record or none is recorded yet, and returns the cursor naming the latest sequence.
   */
  record(
    standings: readonly TestStanding[],
    entries: readonly NotDiscoveredEntry[],
  ): string {
    const next = new Map<string, RecordedStanding>();
    for (const { test, state, freshness } of standings) {
      next.set(testKey(test.identity), {
        test: test.identity,
        state,
        freshness,
      });
    }
    for (const entry of entries) next.set(entryKey(entry), { entry });
    const changed = [...next]
      .filter(([key, now]) => !same(this.#latest.get(key), now))
      .map(([key]) => key);
    for (const key of this.#latest.keys()) {
      if (!next.has(key)) changed.push(key);
    }
    if (this.#sequence === 0) {
      // No cursor comes before the first moment, so none reads its changes.
      this.#sequence = 1;
    } else if (changed.length > 0) {
      this.#sequence += 1;
      const sequence = this.#sequence;
      for (const key of changed) {
        this.#changes.push({ sequence, key, before: this.#latest.get(key) });
      }
    }
    this.#latest = next;
    this.#dropUnneeded();
    return this.#cursor(this.#sequence);
  }

  /** The cursor of the latest recorded moment, without recording; undefined before this life's first record. */
  latest(): string | undefined {
    return this.#sequence === 0 ? undefined : this.#cursor(this.#sequence);
  }

  /** Whether `cursor` names a moment whose changes this journal still holds, or why not. */
  use(cursor: string | undefined): CursorUse {
    return this.#usable(cursor).use;
  }

  /** For a usable cursor, each test and entry whose standing then differs from its latest; only the net change counts. */
  since(cursor: string | undefined): CursorReading {
    const usable = this.#usable(cursor);
    if (usable.use !== CURSOR_USE.used) return usable;
    const { sequence } = usable;
    const atCursor = new Map<string, RecordedStanding | undefined>();
    for (const change of this.#changes) {
      if (change.sequence > sequence && !atCursor.has(change.key)) {
        atCursor.set(change.key, change.before);
      }
    }
    const changes: NetChange[] = [];
    for (const [key, before] of atCursor) {
      const now = this.#latest.get(key);
      if (!same(before, now)) changes.push({ key, atCursor: before, now });
    }
    return { use: CURSOR_USE.used, changes };
  }

  #usable(
    cursor: string | undefined,
  ):
    | { readonly use: typeof CURSOR_USE.used; readonly sequence: number }
    | { readonly use: Exclude<CursorUse, typeof CURSOR_USE.used> } {
    if (cursor === undefined) return { use: CURSOR_USE.noneGiven };
    const sequence = this.#sequenceOf(cursor);
    if (sequence === undefined) return { use: CURSOR_USE.notIssued };
    if (sequence < this.#dropped) return { use: CURSOR_USE.expired };
    return { use: CURSOR_USE.used, sequence };
  }

  /**
   * Drops the oldest whole sequences while `MAX_RECORDED_CHANGES` or more changes are held: a cursor before a dropped
   * sequence would have that many recorded after it, so it is expired and nothing usable needs them.
   */
  #dropUnneeded(): void {
    let cut = 0;
    while (this.#changes.length - cut >= MAX_RECORDED_CHANGES) {
      const oldest = this.#changes[cut]?.sequence;
      if (oldest === undefined) break;
      while (this.#changes[cut]?.sequence === oldest) cut += 1;
      this.#dropped = oldest;
    }
    if (cut > 0) this.#changes = this.#changes.slice(cut);
  }

  #cursor(sequence: number): string {
    return `${this.#life}${CURSOR_SEPARATOR}${sequence}`;
  }

  /** The sequence a cursor of this life names, when this life recorded it; undefined otherwise. */
  #sequenceOf(cursor: string): number | undefined {
    const at = cursor.lastIndexOf(CURSOR_SEPARATOR);
    const digits = cursor.slice(at + CURSOR_SEPARATOR.length);
    if (at === -1 || cursor.slice(0, at) !== this.#life) return undefined;
    if (!SEQUENCE_FORM.test(digits)) return undefined;
    const sequence = Number(digits);
    return sequence <= this.#sequence ? sequence : undefined;
  }
}

function testKey(identity: TestIdentity): string {
  return `${TEST_KEY_PREFIX}${testIdentityKey(identity)}`;
}

/** An entry is keyed by its kind and the path fields that place it, so a changed reason alone is no change. */
function entryKey(entry: NotDiscoveredEntry): string {
  return `${ENTRY_KEY_PREFIX}${JSON.stringify([
    entry.kind,
    "workspacePath" in entry ? entry.workspacePath : null,
    "projectName" in entry ? entry.projectName : null,
    "modulePath" in entry ? entry.modulePath : null,
    "source" in entry ? entry.source : null,
  ])}`;
}

/** Two standings of one key are the same when both are absent, both entries, or tests of equal state and freshness. */
function same(
  before: RecordedStanding | undefined,
  now: RecordedStanding | undefined,
): boolean {
  if (before === undefined || now === undefined) return before === now;
  if ("entry" in before || "entry" in now) {
    return "entry" in before && "entry" in now;
  }
  return before.state === now.state && before.freshness === now.freshness;
}
