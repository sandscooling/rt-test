import { expect, it } from "vitest";
import { add } from "../../../src/math.mjs";

it("adds in lib", () => {
  expect(add(1, 2)).toBe(3);
});
