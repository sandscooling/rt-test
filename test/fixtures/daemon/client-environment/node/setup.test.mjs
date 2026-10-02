import { expect, it } from "vitest";

it("runs after its setup file", () => {
  expect(globalThis.consumerSetupRan).toBe(true);
});
