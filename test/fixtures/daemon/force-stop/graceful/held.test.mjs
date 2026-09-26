import { existsSync, writeFileSync } from "node:fs";

const here = (name) => new URL(`./${name}`, import.meta.url);

afterAll(() => {
  writeFileSync(here("after-all-ran"), "");
});

// Runs until the host writes `release`, so the host can abort it mid-test and then let it end.
it("held at abort", async () => {
  writeFileSync(here("holding"), "");
  while (!existsSync(here("release"))) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}, 0);

it("never started", () => {});
