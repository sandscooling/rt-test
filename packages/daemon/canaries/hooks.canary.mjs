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
  suiteRepeatValue,
  testRepeatValue,
} from "./src/subject.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// What the subject's one-time values return on every call after the first.
const SEEN_BEFORE = "seen";

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

// The suite gives its test the repeats. Under the mutation the setup's assertion fails on the first repeat alone, and
// Vitest keeps the test failed while the hook states it holds are those of its last repeat, which passed.
describe("repeated by its suite", { repeats: 2 }, () => {
  beforeEach(() => {
    assert.include(["suite-repeat", SEEN_BEFORE], suiteRepeatValue());
  });

  it("passes its body on every repeat", () => {
    expect(true).toBe(true);
  });
});

// The test declares one repeat itself, the fewest a test can be given.
describe("repeated by its own options", () => {
  beforeEach(() => {
    assert.include(["test-repeat", SEEN_BEFORE], testRepeatValue());
  });

  it("passes its body on both runs", { repeats: 1 }, () => {
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
