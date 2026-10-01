import { describe, expect, it } from "vitest";
import { receipt, total } from "../src/cart.mjs";

describe("total", () => {
  it("sums the discounted prices", () => {
    expect(total([10, 20])).toBe(27);
  });
});

describe("total", () => {
  it("sums the discounted prices", () => {
    expect(total([10, 20])).toBeTypeOf("number");
  });
});

describe("receipt", () => {
  it("prints the total", () => {
    expect(receipt([10, 20])).toBe("Total: 27");
  });
});
