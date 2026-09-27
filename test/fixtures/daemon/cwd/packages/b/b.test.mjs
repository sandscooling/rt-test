import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// A workspace's own `vitest` runs from its directory, so a test may resolve paths against `process.cwd()`.
it("runs in its own workspace directory", () => {
  expect(realpathSync(process.cwd())).toBe(
    realpathSync(dirname(fileURLToPath(import.meta.url))),
  );
});
