import { writeFileSync } from "node:fs";

// Far past the grace the tests set, so only a force-stop ends this load in time, and bounded so a collection that is
// never force-stopped still ends.
const LOOP_MS = 20_000;

writeFileSync(new URL("./collecting", import.meta.url), "");
const end = Date.now() + LOOP_MS;
while (Date.now() < end) {
  // Holds the worker's thread, so no cancel message is ever read.
}
writeFileSync(new URL("./loop-finished", import.meta.url), "");

it("after the loop", () => {});
