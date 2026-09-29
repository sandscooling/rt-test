import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnsChildren, startHeartbeat } from "./children.mjs";

// Bounded so an executor nobody ends still exits, and far past the daemon's 15 s executor bound.
const LOOP_MS = 40_000;
const here = (name) => new URL(`./${name}`, import.meta.url);

/** Whether the marker `name` is present and holds this setup's count, so a test can act at one job alone. */
function atSetup(name, count) {
  return (
    existsSync(here(name)) && Number(readFileSync(here(name), "utf8")) === count
  );
}

// Runs in the executor process at every discovery and run. The setup whose count `host-rejection` names leaks an
// unhandled rejection on the executor's own thread. With `spawn-children` present it starts a heartbeat child. The
// setup whose count `stick-at` names loops synchronously, where no abort reaches it, and writes `stuck` only once its
// child has beaten, so a test acting at `stuck` finds that child running.
export default async function setup() {
  appendFileSync(here("executor-pids"), `${process.pid}\n`);
  appendFileSync(here("setups"), "x");
  const count = readFileSync(here("setups"), "utf8").length;
  if (atSetup("host-rejection", count)) {
    void Promise.reject(new Error("host rejection from packages/a's setup"));
  }
  if (spawnsChildren()) await startHeartbeat(`setup-${process.pid}`);
  if (!atSetup("stick-at", count)) return;
  appendFileSync(here("stuck"), `${process.pid}\n`);
  const end = Date.now() + LOOP_MS;
  while (Date.now() < end) {
    // Holds the executor's own thread.
  }
}
