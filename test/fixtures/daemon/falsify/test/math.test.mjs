import { describe, expect, it } from "vitest";
import { add } from "../src/math.mjs";

// A matcher `expect.extend` adds fails with the error Vitest marks with the `JestExtendError` constructor.
expect.extend({
  toBeTwo(received) {
    return { pass: received === 2, message: () => "expected two" };
  },
});

describe("math", () => {
  it("adds", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("fails without adding", () => {
    expect(1).toBeTwo();
  });
});
