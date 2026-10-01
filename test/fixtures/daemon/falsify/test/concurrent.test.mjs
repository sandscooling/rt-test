import { describe, expect, it } from "vitest";
import { scale } from "../src/scale.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "first" calls scale while "second" is still running beside it.
describe.concurrent("together", () => {
  it("first", async () => {
    await pause(20);
    expect(scale(2)).toBe(20);
  });

  it("second", async () => {
    await pause(500);
    expect(true).toBe(true);
  });
});
