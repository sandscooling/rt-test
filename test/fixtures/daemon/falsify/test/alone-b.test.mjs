import { expect, it } from "vitest";

// Passes only while no other test file has run in this worker.
const files = (globalThis.rtFixtureFiles ??= []);
files.push("alone-b");

it("runs alone", () => {
  expect(files).toEqual(["alone-b"]);
});
