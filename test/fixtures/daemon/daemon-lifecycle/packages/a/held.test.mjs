import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnsChildren, startHeartbeat } from "./children.mjs";

const here = (name) => new URL(`./${name}`, import.meta.url);

/** Waits until `release` appears, or, with a lifetime, until that many ms have passed, writing `held-out` then. */
async function holdUntil(release, lifetimeMs = Number.POSITIVE_INFINITY) {
  const end = Date.now() + lifetimeMs;
  while (!existsSync(here(release))) {
    if (Date.now() >= end) {
      writeFileSync(here("held-out"), "");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// With `hold-collect` present, collection waits here, in discovery and run alike, until `release-collect` appears.
if (existsSync(here("hold-collect"))) {
  writeFileSync(here("collecting"), String(process.pid));
  await holdUntil("release-collect");
}

// With `hold` present, the test runs until `release` appears, so a stop or a kill lands mid-run. A `hold` holding a
// number of ms is the hold's lifetime, so an executor nobody ends still finishes its run.
// With `spawn-children` present, the test starts a heartbeat child.
it("held", async () => {
  if (spawnsChildren()) await startHeartbeat(`test-${process.pid}`);
  if (!existsSync(here("hold"))) return;
  writeFileSync(here("holding"), String(process.pid));
  const lifetimeMs = Number(readFileSync(here("hold"), "utf8"));
  await holdUntil("release", lifetimeMs > 0 ? lifetimeMs : undefined);
}, 0);
