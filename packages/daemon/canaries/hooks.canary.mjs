import {
  afterEach,
  assert,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { table } from "./src/loaded.mjs";
import {
  afterEachValue,
  beforeAllValue,
  beforeEachValue,
  cleanupValue,
  concurrentValue,
} from "./src/subject.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("module load", () => {
  it("reads what a module built while it loaded", () => {
    expect(table).toEqual([11, 12]);
  });

  it("runs once the subject module has loaded", () => {
    expect(true).toBe(true);
  });
});

describe("before each", () => {
  beforeEach(() => {
    assert.strictEqual(beforeEachValue(), "before-each");
  });

  it("runs after a checked setup", () => {
    expect(true).toBe(true);
  });
});

describe("after each", () => {
  afterEach(() => {
    if (afterEachValue() !== "after-each") {
      throw new Error("the teardown failed");
    }
  });

  it("runs before a checked teardown", () => {
    expect(true).toBe(true);
  });
});

describe("before all", () => {
  beforeAll(() => {
    if (beforeAllValue() !== "before-all") {
      throw new Error("the suite setup failed");
    }
  });

  it("runs after a checked suite setup", () => {
    expect(true).toBe(true);
  });
});

// Vitest records no hook state for a cleanup a `beforeEach` returns, so its failed assertion reads as the body's.
describe("returned cleanup", () => {
  let seen;

  beforeEach(() => {
    seen = undefined;
    return () => assert.strictEqual(seen, "cleanup");
  });

  it("is checked by a cleanup its setup returned", () => {
    seen = cleanupValue();
    expect(seen).toBeDefined();
  });
});

// "first" calls the site while "second" is still running beside it.
describe.concurrent("together", () => {
  it("first", async () => {
    await pause(20);
    expect(concurrentValue()).toBe("concurrent");
  });

  it("second", async () => {
    await pause(300);
    expect(true).toBe(true);
  });
});
