import { expect, it } from "vitest";
import { label } from "../src/label.mjs";

it("reads the label", () => {
  expect(label()).toBe("client");
});
