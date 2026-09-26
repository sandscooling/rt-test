import { existsSync, writeFileSync } from "node:fs";

const here = (name) => new URL(`./${name}`, import.meta.url);

// Holds collection open until the host writes `release`.
writeFileSync(here("collecting"), "");
while (!existsSync(here("release"))) {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

it("held", () => {});
