import { expect, it } from "vitest";
import { table } from "../src/loaded.mjs";
import { add } from "../src/math.mjs";

it("reads the table", () => {
  expect(table).toEqual([11, 12]);
});

it("adds beside the table", () => {
  expect(add(1, 1)).toBe(2);
});
