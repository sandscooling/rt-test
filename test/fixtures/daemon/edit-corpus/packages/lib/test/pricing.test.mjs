import { describe, expect, it } from "vitest";
import { price } from "../src/index.mjs";

describe("price", () => {
  it("charges five per unit", () => {
    expect(price(2)).toBe(10);
  });

  it("charges nothing for no units", () => {
    expect(price(0)).toBe(0);
  });

  it.skip("applies a bulk discount", () => {
    expect(price(100)).toBe(450);
  });
});
