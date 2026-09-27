import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

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
/**
 * How long a removal Windows refuses as held is retried: Windows reports an ended process exited before it releases
 * its handles, and a closed Vitest ends its workers without waiting for them. Node's own `rmSync` retries do not
 * cover `EPERM`, so the wait is explicit.
 */
const RELEASE_WINDOW_MS = 11_000;
const RELEASE_POLL_MS = 200;
const NO_SIGNAL = 0;
/** What Windows answers a removal of a directory that a live process holds open. */
const HELD_DIRECTORY_CODES: ReadonlySet<unknown> = new Set(["EPERM", "EBUSY"]);

interface HeldDirectory {
  readonly directory: string;
  readonly test: string;
}

export function isHeldOnWindows(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    HELD_DIRECTORY_CODES.has((error as NodeJS.ErrnoException).code)
  );
}

/** Removes the directory, retrying while Windows reports it held; resolves false when it is still held after the window. */
export async function removeDirectory(directory: string): Promise<boolean> {
  const deadline = Date.now() + RELEASE_WINDOW_MS;
  for (;;) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (!isHeldOnWindows(error)) throw error;
      if (Date.now() >= deadline) return false;
      await new Promise((wake) => setTimeout(wake, RELEASE_POLL_MS));
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, NO_SIGNAL);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Removes the parents that runs which have since ended left behind, since a killed or failed run never removes its
 * own. On Windows a parent a straggling process still holds is left for a later run to sweep.
 */
function sweepEndedRuns(): void {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith(RUN_PREFIX)) continue;
    const owner = Number.parseInt(name.slice(RUN_PREFIX.length), 10);
    if (!Number.isInteger(owner) || isRunning(owner)) continue;
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    } catch (error) {
      if (!isHeldOnWindows(error)) throw error;
    }
  }
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
 * Runs once every test worker has exited. A directory held at its test's end but free now gets a warning, since the
 * hold did not outlive the run; one still held fails the run, naming the test that created it.
 */
async function teardown(root: string): Promise<void> {
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
  if (stillHeld.length > 0) {
    throw new Error(
      `A process still held a test's temp directory at the end of the run: ${stillHeld.map(describeHeld).join(", ")}`,
    );
  }
  if (!(await removeDirectory(root))) {
    throw new Error(
      `A process still held the run's temp directory at the end of the run: ${root}`,
    );
  }
}

export default function setup(project: TestProject): () => Promise<void> {
  sweepEndedRuns();
  const root = mkdtempSync(join(tmpdir(), `${RUN_PREFIX}${process.pid}-`));
  project.provide("rtTestDaemonTempRoot", root);
  return () => teardown(root);
}
