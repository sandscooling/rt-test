import { appendFileSync } from "node:fs";

// Records the executor process that ran this workspace, so a test can end it however the test ends.
export default function setup() {
  appendFileSync(
    new URL("./executor-pids", import.meta.url),
    `${process.pid}\n`,
  );
}
