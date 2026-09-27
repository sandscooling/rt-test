import { appendFileSync } from "node:fs";
import { spawnsChildren, startHeartbeat } from "../a/children.mjs";

// Records the executor process that ran this workspace, so a test can end it however the test ends. With
// `spawn-children` present in `packages/a`, it starts a heartbeat child.
export default function setup() {
  appendFileSync(
    new URL("./executor-pids", import.meta.url),
    `${process.pid}\n`,
  );
  if (spawnsChildren()) return startHeartbeat(`b-setup-${process.pid}`);
}
