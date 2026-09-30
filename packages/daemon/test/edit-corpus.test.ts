import { describe, expect, it } from "vitest";
import { DAEMON_TEST_TIMEOUT_MS } from "./daemon-harness.js";
import { checkSequence, CLEAN } from "./edit-corpus.js";
import {
  CONFIG_AND_RUN_IN_PROGRESS,
  INSIDE_PACKAGES,
  RENAME,
  SHARED_LIBRARY,
} from "./edit-corpus-sequences.js";

describe("the edit corpus replayed against the daemon beside plain Vitest", () => {
  it(
    "D3466: an edit to the shared library runs it and every workspace depending on it, and the daemon holds each failure a full run finds",
    async () => {
      expect(await checkSequence(SHARED_LIBRARY)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3467: edits inside packages run only the workspaces they reach, and no workspace holding a current result runs again",
    async () => {
      expect(await checkSequence(INSIDE_PACKAGES)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3468: a rename that leaves one import behind fails that module to load, and a docs edit afterwards runs nothing and moves no input revision",
    async () => {
      expect(await checkSequence(RENAME)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );

  it(
    "D3469: a Vitest config edit runs its workspace and that workspace's dependents only, as does an edit saved while a run is going",
    async () => {
      expect(await checkSequence(CONFIG_AND_RUN_IN_PROGRESS)).toBe(CLEAN);
    },
    DAEMON_TEST_TIMEOUT_MS,
  );
});
