import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prepare } from "../src/prepare.mjs";

describe("hooked", () => {
  afterEach(() => {
    throw new Error("after boom");
  });

  it("passes its body", () => {});
});

describe("prepared", () => {
  let value;
  beforeAll(() => {
    value = prepare();
  });

  it("reads the prepared value", () => {
    expect(value).toBe(4);
  });

  describe("deeper", () => {
    it("reads it from a nested suite", () => {
      expect(value).toBe(4);
    });
  });
});

describe("unprepared", () => {
  it("does not read it", () => {
    expect(1).toBe(1);
  });

  it("leaks", () => {
    void Promise.reject(new Error("leaked rejection"));
  });
});

describe("broken setup", () => {
  beforeAll(() => {
    throw new Error("setup boom");
  });

  it("never starts", () => {});
});

describe("outer", () => {
  describe("inner broken", () => {
    beforeAll(() => {
      throw new Error("inner boom");
    });

    it("never starts inside", () => {});
  });
});
