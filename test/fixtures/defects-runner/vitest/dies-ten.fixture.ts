/// <reference types="vitest/globals" />

it("D1: dies mid-test", () => {
  process.kill(process.pid, "SIGKILL");
  expect(1).toBe(1);
});

it("D2: never runs", () => {
  expect(2).toBe(2);
});

it("D3: never runs", () => {
  expect(3).toBe(3);
});

it("D4: never runs", () => {
  expect(4).toBe(4);
});

it("D5: never runs", () => {
  expect(5).toBe(5);
});

it("D6: never runs", () => {
  expect(6).toBe(6);
});

it("D7: never runs", () => {
  expect(7).toBe(7);
});

it("D8: never runs", () => {
  expect(8).toBe(8);
});

it("D9: never runs", () => {
  expect(9).toBe(9);
});

it("D10: never runs", () => {
  expect(10).toBe(10);
});
