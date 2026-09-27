import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { spawnsChildren, startHeartbeat } from "./children.mjs";

// Bounded so an executor nobody ends still exits, and far past the daemon's 15 s executor bound.
const LOOP_MS = 40_000;
const here = (name) => new URL(`./${name}`, import.meta.url);

// Runs in the executor process at every discovery and run. With `spawn-children` present it starts a heartbeat
// child. The setup whose count `stick-at` names loops synchronously, where no abort reaches it.
export default function setup() {
  appendFileSync(here("executor-pids"), `${process.pid}\n`);
  appendFileSync(here("setups"), "x");
  const child = spawnsChildren()
    ? startHeartbeat(`setup-${process.pid}`)
    : undefined;
  if (!existsSync(here("stick-at"))) return child;
  const count = readFileSync(here("setups"), "utf8").length;
  if (count !== Number(readFileSync(here("stick-at"), "utf8"))) return child;
  appendFileSync(here("stuck"), `${process.pid}\n`);
  const end = Date.now() + LOOP_MS;
  while (Date.now() < end) {
    // Holds the executor's own thread.
  }
}
