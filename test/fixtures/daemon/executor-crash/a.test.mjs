import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const POLL_MS = 5;
const HOLD = fileURLToPath(new URL("./hold-point", import.meta.url));

// With a `hold-point` directory beside this file, the first test writes `holding` there and runs until `release`
// appears, so a stop lands mid-run.
it("held", async () => {
  if (!existsSync(HOLD)) return;
  writeFileSync(join(HOLD, "holding"), "");
  while (!existsSync(join(HOLD, "release"))) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
});

it("second", () => {});
