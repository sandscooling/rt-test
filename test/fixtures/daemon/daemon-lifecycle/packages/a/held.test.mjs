import { existsSync, writeFileSync } from "node:fs";

const here = (name) => new URL(`./${name}`, import.meta.url);

async function holdUntil(release) {
  while (!existsSync(here(release))) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// With `hold-collect` present, collection waits here, in discovery and run alike, until `release-collect` appears.
if (existsSync(here("hold-collect"))) {
  writeFileSync(here("collecting"), String(process.pid));
  await holdUntil("release-collect");
}

// With `hold` present, the test runs until `release` appears, so a stop or a kill lands mid-run.
it("held", async () => {
  if (!existsSync(here("hold"))) return;
  writeFileSync(here("holding"), String(process.pid));
  await holdUntil("release");
}, 0);
