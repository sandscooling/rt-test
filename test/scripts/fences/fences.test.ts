import { describe, expect, it } from "vitest";
import { fenceKinds } from "../../../scripts/lib/fences.mjs";

describe("fenceKinds", () => {
  it("D850: lines between a fence's markers are code, and the rest prose", () => {
    expect(fenceKinds(["a", "```", "b", "```", "c"])).toEqual([
      "prose",
      "marker",
      "code",
      "marker",
      "prose",
    ]);
  });

  it("D851: a shorter marker inside a longer fence does not close it", () => {
    expect(fenceKinds(["````md", "```", "# x", "```", "````"])).toEqual([
      "marker",
      "code",
      "code",
      "code",
      "marker",
    ]);
  });

  it("D852: a marker of the other character does not close a fence", () => {
    expect(fenceKinds(["```", "~~~", "# x", "```"])).toEqual([
      "marker",
      "code",
      "code",
      "marker",
    ]);
  });

  it("D853: an opener that never closes fences nothing", () => {
    expect(fenceKinds(["```ts", "# x", "y"])).toEqual([
      "prose",
      "prose",
      "prose",
    ]);
  });

  it("D854: a marker carrying an info string does not close a fence", () => {
    expect(fenceKinds(["```", "```js", "# x", "```"])).toEqual([
      "marker",
      "code",
      "code",
      "marker",
    ]);
  });

  it("D855: a backtick run with a backtick in its info string opens no fence", () => {
    expect(fenceKinds(["``` inline ```", "# x", "```"])).toEqual([
      "prose",
      "prose",
      "prose",
    ]);
  });

  it("D856: a tilde fence fences its lines", () => {
    expect(fenceKinds(["~~~", "# x", "~~~"])).toEqual([
      "marker",
      "code",
      "marker",
    ]);
  });

  it("D857: a fence after an unclosed opener still fences its lines", () => {
    expect(fenceKinds(["```", "a", "~~~", "# x", "~~~"])).toEqual([
      "prose",
      "prose",
      "marker",
      "code",
      "marker",
    ]);
  });

  it("D858: a closer longer than its opener closes the fence", () => {
    expect(fenceKinds(["```", "# x", "`````", "y"])).toEqual([
      "marker",
      "code",
      "marker",
      "prose",
    ]);
  });

  it("D875: a fence indented inside a list item fences its lines", () => {
    expect(fenceKinds(["- item", "  ```", "  # x", "  ```"])).toEqual([
      "prose",
      "marker",
      "code",
      "marker",
    ]);
  });

  it("D876: a tilde opener whose info string holds a backtick opens a fence", () => {
    expect(fenceKinds(["~~~ `x`", "# x", "~~~"])).toEqual([
      "marker",
      "code",
      "marker",
    ]);
  });
});
