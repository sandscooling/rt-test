import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const POLL_MS = 5;

// With RT_EXECUTOR_HOLD naming a directory, the first test writes `holding` there and runs until `release` appears,
// so a stop lands mid-run.
it("held", async () => {
  const hold = process.env.RT_EXECUTOR_HOLD;
  if (hold === undefined) return;
  writeFileSync(join(hold, "holding"), "");
  while (!existsSync(join(hold, "release"))) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
});

it("second", () => {});
