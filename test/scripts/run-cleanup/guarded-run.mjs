// Plays a test run that a watchdog guards: starts one detached stand-in daemon inside the run's directory, records it,
// prints its id and waits to be killed.
import { spawn } from "node:child_process";
import { guardRun, recordStarted } from "../run-cleanup.mjs";

const [runRoot] = process.argv.slice(2);
await guardRun(runRoot);
const daemon = spawn(
  process.execPath,
  ["-e", "setInterval(() => {}, 1000);", runRoot],
  { detached: true, stdio: "ignore", windowsHide: true },
);
daemon.unref();
recordStarted(runRoot, { pids: [daemon.pid] });
process.stdout.write(`${daemon.pid}\n`);
setInterval(() => {}, 1000);
