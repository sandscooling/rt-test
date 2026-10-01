import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { once } from "../src/once.mjs";

// A marker in the OS temp directory outlives the worker, so the test rejects a wrong value the first time it meets one
// and lets it through every time after: a failure that does not repeat.
const MARKER = join(tmpdir(), "rt-fixture-flaked-once");

it("flakes once", () => {
  const value = once();
  const flaked = existsSync(MARKER);
  if (value !== 42) writeFileSync(MARKER, "");
  expect(flaked ? 42 : value).toBe(42);
});
