import { existsSync, readFileSync } from "node:fs";

// The `crash` file beside this setup names how the global setup ends the executor process it runs in: `throw` throws
// uncaught on the next turn of its event loop, before any test can finish, and `exit-in-teardown` calls
// `process.exit(3)` from the teardown, once the run has ended. `send-ready` ends nothing: it sends `ready` on the
// process's channel, as a project announcing readiness to a parent process manager does. Each executor process reads
// it afresh, so a test can change it between two jobs of one executor.
const CRASH_FILE = new URL("./crash", import.meta.url);
const crash = existsSync(CRASH_FILE) ? readFileSync(CRASH_FILE, "utf8") : "";
const EXIT_CODE = 3;

export default function setup() {
  if (crash === "send-ready") process.send?.("ready");
  if (crash === "throw") {
    setImmediate(() => {
      throw new Error("uncaught from the global setup");
    });
  }
  return () => {
    if (crash === "exit-in-teardown") process.exit(EXIT_CODE);
  };
}
