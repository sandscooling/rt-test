import { expect, it } from "vitest";
import { greet } from "../src/greet.mjs";
import { label } from "../src/label.mjs";

it("labels", () => {
  expect(label).toBe("before");
});

it("greets", () => {
  expect(greet("x")).toBe("hi x");
});
