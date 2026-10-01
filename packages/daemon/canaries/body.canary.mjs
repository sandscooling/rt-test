import { describe, expect, it } from "vitest";
import canaries from "./canaries.json";
import {
  bodyValue,
  countedValues,
  declaredValue,
  leakValue,
  matcherValue,
  mixedValue,
  readShared,
  snapshotValue,
  storeShared,
  survivorValue,
  timeoutValue,
  typeErrorValue,
  undeclaredValue,
  unparsedValue,
} from "./src/subject.mjs";

// The name the set declares as an assertion error's, and one it does not declare.
const [DECLARED_ERROR_NAME] = canaries.assertionErrors;
const UNDECLARED_ERROR_NAME = "CanaryQueryError";
const TIMEOUT_MS = 100;

class NamedError extends Error {
  constructor(name) {
    super(`a ${name} was thrown`);
    this.name = name;
  }
}

// A hand-written check, as a testing library's query is: it throws an error of its own name, never chai's.
function checked(actual, expected, errorName) {
  if (actual !== expected) throw new NamedError(errorName);
  return actual;
}

expect.extend({
  toBeTheMatcherValue(received) {
    return {
      pass: received === "matcher",
      message: () => "expected the matcher value",
    };
  },
});

describe("body", () => {
  it("fails an expect", () => {
    expect(bodyValue()).toBe("body");
  });

  it("fails an extended matcher", () => {
    expect(matcherValue()).toBeTheMatcherValue();
  });

  it("throws an error of a declared name", () => {
    expect(checked(declaredValue(), "declared", DECLARED_ERROR_NAME)).toBe(
      "declared",
    );
  });

  it("passes whatever the site returns", () => {
    expect(typeof survivorValue()).toBe("string");
  });

  it("checks a value whose mutation does not parse", () => {
    expect(unparsedValue()).toBe("unparsed");
  });

  it("passes without calling the site", () => {
    expect(true).toBe(true);
  });

  it("passes without loading the module", () => {
    expect(true).toBe(true);
  });

  it("stores the shared value", () => {
    storeShared();
    expect(readShared()).toBeDefined();
  });

  // Relies on the test before it, the only one that runs the site: this one reads what that one stored.
  it("reads the value another test stored", () => {
    expect(readShared()).toBe("shared");
  });

  it("throws a type error", () => {
    expect(typeErrorValue().length).toBe(10);
  });

  it(
    "times out",
    async () => {
      const value = timeoutValue();
      if (value !== "timeout") await new Promise(() => {});
      expect(value).toBe("timeout");
    },
    TIMEOUT_MS,
  );

  it("counts its assertions", () => {
    expect.assertions(1);
    for (const value of countedValues()) expect(value).toBe("count");
  });

  it("matches an inline snapshot", () => {
    expect(snapshotValue()).toMatchInlineSnapshot(`"snapshot"`);
  });

  it("throws an error of an undeclared name", () => {
    expect(
      checked(undeclaredValue(), "undeclared", UNDECLARED_ERROR_NAME),
    ).toBe("undeclared");
  });

  it("fails beside a leaked rejection", () => {
    const value = leakValue();
    if (value !== "leak") void Promise.reject(new Error("leaked rejection"));
    expect(value).toBe("leak");
  });

  it("fails with an assertion and another error", () => {
    const value = mixedValue();
    expect.soft(value).toBe("mixed");
    if (value !== "mixed") throw new TypeError("not the mixed value");
  });
});
