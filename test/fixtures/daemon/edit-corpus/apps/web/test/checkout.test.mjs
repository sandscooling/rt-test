import { describe, expect, it } from "vitest";
import { checkout } from "../src/checkout.mjs";

describe("checkout", () => {
  it("labels the order", () => {
    expect(checkout(1).label).toBe("Total: 5");
  });

  it("quotes the currency", () => {
    expect(checkout(1).quote.currency).toBe("USD");
  });

  it("uses the setup's locale", () => {
    expect(globalThis.corpusLocale).toBe("en-US");
  });
});
