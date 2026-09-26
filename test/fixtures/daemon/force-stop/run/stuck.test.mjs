import { writeFileSync } from "node:fs";

// Far past the grace the tests set, so only a force-stop ends this test in time, and bounded so a run that is never
// force-stopped still ends.
const LOOP_MS = 20_000;

it("loops", () => {
  writeFileSync(new URL("./looping", import.meta.url), String(process.pid));
  const end = Date.now() + LOOP_MS;
  while (Date.now() < end) {
    // Holds the worker's thread, so no cancel message is ever read.
  }
}, 0);

it("never started", () => {});
