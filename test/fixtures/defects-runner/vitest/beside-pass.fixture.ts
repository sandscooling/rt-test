/// <reference types="vitest/globals" />

const THROW_AFTER_MS = 0;
const WAIT_MS = 20;

it("D1: passes beside an unhandled error", async () => {
  setTimeout(() => {
    throw new Error("boom beside a passing test");
  }, THROW_AFTER_MS);
  await new Promise((done) => setTimeout(done, WAIT_MS));
  expect(1).toBe(1);
});
