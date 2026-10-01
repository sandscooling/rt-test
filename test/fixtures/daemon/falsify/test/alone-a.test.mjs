import { expect, it } from "vitest";

// Passes only while no other test file has run in this worker.
const files = (globalThis.rtFixtureFiles ??= []);
files.push("alone-a");

it("runs alone", () => {
  expect(files).toEqual(["alone-a"]);
});
