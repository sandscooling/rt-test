import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { isInside } from "../paths.mjs";

const RUN_PREFIX = "rt-test-verify-defects-";
const RUN_NAME = new RegExp(`^${RUN_PREFIX}(\\d+)-`);
const PROBE_SIGNAL = 0;
const NO_SUCH_PROCESS = "ESRCH";
const NOT_FOUND = "ENOENT";

function isRunning(pid) {
  try {
    process.kill(pid, PROBE_SIGNAL);
    return true;
  } catch (error) {
    return error.code !== NO_SUCH_PROCESS;
  }
}

// Windows reports the temp directory by its 8.3 short name, and Vitest given a
// short-name root intermittently collects no test file at all.
const fullPath = (dir) => realpathSync.native(dir);

function assertInside(parent, child) {
  if (!isInside(parent, child)) {
    throw new Error(`Refusing a defect run outside ${parent}.`);
  }
}

function removeLeftover(parent, name, pid, log) {
  const run = join(parent, name);
  assertInside(parent, run);
  try {
    rmSync(run, { recursive: true });
    log(`Removed leftover defect run ${run}: process ${pid} has exited.`);
  } catch (error) {
    if (error.code !== NOT_FOUND && existsSync(run)) {
      log(`Could not remove leftover defect run ${run}: ${error.message}`);
    }
  }
}

// A run's name carries its owner's process id, so a run killed before its
// cleanup is recognizable, and a run whose process is still alive is kept.
export function openRun(parent, log, running = isRunning) {
  mkdirSync(parent, { recursive: true });
  const home = fullPath(parent);
  for (const name of readdirSync(home)) {
    const pid = RUN_NAME.exec(name)?.[1];
    if (pid !== undefined && !running(Number(pid))) {
      removeLeftover(home, name, pid, log);
    }
  }
  const run = mkdtempSync(join(home, `${RUN_PREFIX}${process.pid}-`));
  assertInside(home, run);
  return run;
}
