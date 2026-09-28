/// <reference types="vitest/globals" />
import "./throws-on-import.js";

it("D1: never collected", () => {
  expect(1).toBe(1);
});
