import { existsSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { once } from "../src/once.mjs";

// The host test names a marker file, which outlives the worker, so this test rejects a wrong value the first time it
// meets one and lets it through every time after: a failure that does not repeat. With no marker named, a wrong value
// throws, so a job run without one fails loudly and leaves no marker behind.
const MARKER_VARIABLE = "RT_FIXTURE_ONCE_MARKER";

function metBefore() {
  const marker = process.env[MARKER_VARIABLE];
  if (!marker) throw new Error(`${MARKER_VARIABLE} names no marker file`);
  const met = existsSync(marker);
  writeFileSync(marker, "");
  return met;
}

it("flakes once", () => {
  const value = once();
  expect(value !== 42 && metBefore() ? 42 : value).toBe(42);
});
