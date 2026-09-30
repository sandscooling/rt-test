import { describe, expect, it } from "vitest";
import { quote } from "../src/quote.mjs";

describe("quote", () => {
  it("quotes the amount", () => {
    expect(quote(3).amount).toBe(15);
  });
});
