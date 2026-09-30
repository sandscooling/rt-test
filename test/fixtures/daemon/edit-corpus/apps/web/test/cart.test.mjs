import { describe, expect, it } from "vitest";
import { price } from "@corpus/lib/pricing";

describe("cart", () => {
  it("costs nothing when empty", () => {
    expect(price(0)).toBe(0);
  });
});
