import { beforeEach, describe, expect, it } from "vitest";
import { discounted, label, rate } from "../src/price.mjs";

describe("discount", () => {
  it("takes a tenth off", () => {
    expect(discounted(100)).toBe(90);
  });
});

function expectNineTenths() {
  expect(rate()).toBe(0.9);
}

describe("rate, checked before each test", () => {
  beforeEach(expectNineTenths);

  it("stays under one", () => {
    expect(rate()).toBeLessThan(1);
  });
});

describe("label", () => {
  it("shows two decimals and the currency", () => {
    expect(label(5)).toBe("5.00 USD");
  });
});
