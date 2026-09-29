import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import {
  cleanUpRun,
  guardRun,
  ownedRunName,
  removeDirectory,
  sweepEndedRuns,
  type RunCleanup,
} from "../../../test/scripts/run-cleanup.mjs";

export { removeDirectory };

declare module "vitest" {
  export interface ProvidedContext {
    rtTestDaemonTempRoot: string;
  }
}

/** Each run's temp directories live under one parent named for the Vitest process that owns it. */
const RUN_PREFIX = "rt-test-daemon-run-";
/** Lists, one per line, each temp directory a live process still held when its test ended, with that test's name. */
export const HELD_DIRECTORIES_FILE = "held-directories";
/** Separates a held directory from the name of the test that created it, in each line of `HELD_DIRECTORIES_FILE`. */
export const HELD_RECORD_SEPARATOR = "\t";

interface HeldDirectory {
  readonly directory: string;
  readonly test: string;
}

function heldDirectories(root: string): HeldDirectory[] {
  const file = join(root, HELD_DIRECTORIES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [directory = line, test = "an unnamed test"] = line.split(
        HELD_RECORD_SEPARATOR,
      );
      return { directory, test };
    });
}

function describeHeld(held: HeldDirectory): string {
  return `${held.directory} (${held.test})`;
}

/**
 * A directory held at its test's end but free now gets a warning, since the hold did not outlive the run; one still
 * held is returned.
 */
async function stillHeldDirectories(root: string): Promise<HeldDirectory[]> {
  const stillHeld: HeldDirectory[] = [];
  for (const held of heldDirectories(root)) {
    if (await removeDirectory(held.directory)) {
      console.warn(
        `A test ended while a process still held its temp directory, which was free by the end of the run: ${describeHeld(held)}`,
      );
    } else {
      stillHeld.push(held);
    }
  }
  return stillHeld;
}

/**
 * Runs once every test worker has exited, and always cleans up what the run recorded, so its watchdog is left nothing.
 * Fails the run naming each directory still held, each recorded process it had to end, and a run directory still held.
 */
async function teardown(root: string): Promise<void> {
  let stillHeld: HeldDirectory[] = [];
  let cleanup: RunCleanup;
  try {
    stillHeld = await stillHeldDirectories(root);
  } finally {
    cleanup = await cleanUpRun(root);
  }
  const { ended, removed } = cleanup;
  const problems: string[] = [];
  if (stillHeld.length > 0) {
    problems.push(
      `A process still held a test's temp directory at the end of the run: ${stillHeld.map(describeHeld).join(", ")}`,
    );
  }
  if (ended.length > 0) {
    problems.push(
      `A process the run started was still running at the end of the run, and was ended: ${ended.join(", ")}`,
    );
  }
  if (!removed) {
    problems.push(
      `A process still held the run's temp directory at the end of the run: ${root}`,
    );
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
}

/**
 * Cleans up what ended runs left, then opens this run's temp parent under a watchdog that cleans it up if this run
 * ends without its teardown, as a killed run does.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  for (const problem of await sweepEndedRuns(RUN_PREFIX)) {
    console.warn(`Could not clean up an ended daemon test run: ${problem}`);
  }
  const root = mkdtempSync(join(tmpdir(), ownedRunName(RUN_PREFIX)));
  await guardRun(root);
  project.provide("rtTestDaemonTempRoot", root);
  return () => teardown(root);
}
