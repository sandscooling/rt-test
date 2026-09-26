import { describe, expect, it } from "vitest";
import { toPosix } from "../../../scripts/lib/paths.mjs";

describe("toPosix", () => {
  it("D1200: turns every backslash into a slash, not just the first", () => {
    expect(toPosix("scripts\\lib\\defects\\catalog.mjs")).toBe(
      "scripts/lib/defects/catalog.mjs",
    );
  });
});
