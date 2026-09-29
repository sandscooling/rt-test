import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  ownedRunName,
  ownerRunning,
  runOwner,
} from "../../../test/scripts/run-cleanup.mjs";
import { isInside } from "../paths.mjs";

const RUN_PREFIX = "rt-test-verify-defects-";
const NOT_FOUND = "ENOENT";

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

// Whether a leftover run's owner has ended. A run whose owner cannot be
// checked is kept, and the reason logged.
function ownerEnded(home, name, owner, running, log) {
  try {
    return !running(owner);
  } catch (error) {
    log(
      `Kept leftover defect run ${join(home, name)}: process ${owner.pid} could not be checked: ${error.message}`,
    );
    return false;
  }
}

// A run's name carries its owner's process id and start time, so a run killed
// before its cleanup is recognizable, and a run is kept while its own process
// runs, not while another process merely holds its id. A name recording only
// the id keeps its run while any process holds that id.
export function openRun(parent, log, running = ownerRunning) {
  mkdirSync(parent, { recursive: true });
  const home = fullPath(parent);
  for (const name of readdirSync(home)) {
    const owner = runOwner(name, RUN_PREFIX);
    if (owner !== undefined && ownerEnded(home, name, owner, running, log)) {
      removeLeftover(home, name, owner.pid, log);
    }
  }
  const run = mkdtempSync(join(home, ownedRunName(RUN_PREFIX)));
  assertInside(home, run);
  return run;
}
