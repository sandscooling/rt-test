import { describe, expect, it } from "vitest";
import { errorText } from "../src/vitest/error-text.js";
import { settle } from "./harness.js";

const DEEP_CHAIN_LEVELS = 20_000;

describe("error text for discovery reports", () => {
  it("D1010: an aggregate error keeps each member's message", () => {
    expect(
      errorText(
        new AggregateError(
          [new Error("Browser Mode was enabled")],
          "Failed to initialize projects",
        ),
      ),
    ).toContain("Browser Mode was enabled");
  });

  it("D1011: a serialized worker error reads as its message", () => {
    expect(errorText({ name: "Error", message: "collection boom" })).toBe(
      "collection boom",
    );
  });

  it("D1012: an error keeps the message of its cause", () => {
    expect(
      errorText(
        new Error("failed to load config", {
          cause: new Error("config boom"),
        }),
      ),
    ).toContain("config boom");
  });

  it("D1013: an error whose cause chain loops back is still formatted", () => {
    const error = new Error("outer");
    error.cause = new Error("inner", { cause: error });
    expect(settle(() => errorText(error))).toBe("outer\n  caused by: inner");
  });

  it("D1079: a cause chain deeper than the stack is cut off with a closing line", () => {
    let error = new Error("level 0");
    for (let level = 1; level <= DEEP_CHAIN_LEVELS; level += 1) {
      error = new Error(`level ${level}`, { cause: error });
    }
    expect(settle(() => errorText(error))).toEqual(
      expect.stringMatching(
        /errors nested deeper than 32 levels are not shown$/,
      ),
    );
  });
});
