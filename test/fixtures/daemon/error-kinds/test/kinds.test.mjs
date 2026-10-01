import { expect, it } from "vitest";
import { count } from "../src/count.mjs";

// Each test passes while `count` gives 2, and fails by one kind of error once it gives anything else.

// A class two steps below `Error` that sets no name, as the error a jest-dom matcher throws for a value that is no element.
class GenericTypeError extends Error {}
class HtmlElementTypeError extends GenericTypeError {}

class Unnamed extends Error {}

function mustBeTwo(received) {
  if (received !== 2) throw new HtmlElementTypeError("received no element");
}

expect.extend({
  // Throws from inside itself, where `toBeTwo` returns a failing result.
  toHoldTwo(received) {
    mustBeTwo(received);
    return { pass: true, message: () => "expected anything but two" };
  },
  // Its result passes only negated.
  toHoldThree(received) {
    mustBeTwo(received);
    return { pass: false, message: () => "expected three" };
  },
  toBeTwo(received) {
    return { pass: received === 2, message: () => "expected two" };
  },
});

it("throws in its body", () => {
  if (count() !== 2) throw new HtmlElementTypeError("received no element");
});

it("throws inside an extended matcher", () => {
  expect(count()).toHoldTwo();
});

it("throws inside a negated extended matcher", () => {
  expect(count()).not.toHoldThree();
});

it("throws an undeclared class's error", () => {
  if (count() !== 2) throw new Unnamed("not two");
});

it("throws a plain error", () => {
  if (count() !== 2) throw new Error("not two");
});

it("fails an extended matcher's result", () => {
  expect(count()).toBeTwo();
});
