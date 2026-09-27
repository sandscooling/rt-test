import { existsSync } from "node:fs";
import { join } from "node:path";

// Preloaded into every process a daemon test starts, it acts only in the daemon: once the test writes the trigger
// into the state directory, it raises SIGTERM inside the daemon, which no Windows process can deliver to another.
const TRIGGER = "emit-sigterm";
const [, entry, , stateDirectory] = process.argv;

if (entry?.endsWith("daemon-main.ts") && stateDirectory !== undefined) {
  const poll = setInterval(() => {
    if (!existsSync(join(stateDirectory, TRIGGER))) return;
    clearInterval(poll);
    process.emit("SIGTERM");
  }, 10);
  poll.unref();
}
