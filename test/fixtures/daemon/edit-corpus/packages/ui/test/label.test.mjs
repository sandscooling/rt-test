import { describe, expect, it } from "vitest";
import { label } from "../src/label.mjs";

describe("label", () => {
  it("labels the total", () => {
    expect(label(2)).toBe("Total: 10");
  });
});
