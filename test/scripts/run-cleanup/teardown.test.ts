import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  HELD_DIRECTORIES_FILE,
  HELD_RECORD_SEPARATOR,
} from "../../../packages/daemon/test/temp-root.js";
import { recordStarted, removeDirectory } from "../run-cleanup.mjs";
import { endAll, endsWithin, idleProcess, recordOf } from "../processes.js";
import { PROCESS_SCENARIO } from "../timeouts.js";
import { withDaemonRunSetup } from "./daemon-run.js";

vi.mock("../run-cleanup.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../run-cleanup.mjs")>();
  return {
    ...actual,
    removeDirectory: vi.fn<typeof actual.removeDirectory>(
      actual.removeDirectory,
    ),
  };
});

/** How long an ended process may take to go on a loaded machine. */
const STOP_WAIT_MS = 15_000;

describe("the daemon suite's teardown", PROCESS_SCENARIO, () => {
  it("D1777: ends and names a recorded process even when a test's temp directory is still held", async () => {
    const result = await withDaemonRunSetup(async (runRoot, teardown) => {
      writeFileSync(
        join(runRoot, HELD_DIRECTORIES_FILE),
        `${join(runRoot, "held-case")}${HELD_RECORD_SEPARATOR}D0: holds its directory\n`,
      );
      // Windows alone can hold a directory open, so the held directory's removal is what the stub decides.
      vi.mocked(removeDirectory).mockResolvedValueOnce(false);
      const owned = idleProcess([runRoot]);
      const identity = recordOf(owned);
      try {
        recordStarted(runRoot, { pids: [owned] });
        const outcome = await teardown().then(
          () => "passed",
          (error: Error) => error.message,
        );
        return [
          outcome.includes(`and was ended: ${owned}`),
          await endsWithin([identity], STOP_WAIT_MS),
        ];
      } finally {
        endAll([owned]);
      }
    });
    expect(result).toEqual([true, true]);
  });
});
