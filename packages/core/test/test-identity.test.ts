import { describe, expect, it } from "vitest";
import {
  identifyModuleTests,
  type TestModuleLocation,
} from "../src/test-identity.js";

const LOCATION: TestModuleLocation = {
  workspacePath: "packages/lib",
  projectName: "unit",
  modulePath: "src/a.test.ts",
};

function identityOf(
  namePaths: readonly (readonly string[])[],
  wanted: readonly string[],
): unknown {
  return identifyModuleTests(LOCATION, namePaths).find(
    (test) => JSON.stringify(test.identity.namePath) === JSON.stringify(wanted),
  )?.identity;
}

describe("test identity within one module", () => {
  it("D1000: tests sharing a name path are numbered by how many earlier tests share it", () => {
    const same = ["group", "same"];
    expect(
      identifyModuleTests(LOCATION, [same, same, same]).map(
        (test) => test.identity.occurrence,
      ),
    ).toEqual([0, 1, 2]);
  });

  it("D1001: a test whose name path is unique in its module is not marked duplicate", () => {
    expect(
      identifyModuleTests(LOCATION, [["alone"], ["twin"], ["twin"]])[0]
        ?.isDuplicate,
    ).toBe(false);
  });

  it("D1002: every copy of a repeated name path is marked duplicate, the first included", () => {
    expect(
      identifyModuleTests(LOCATION, [["alone"], ["twin"], ["twin"]])
        .slice(1)
        .map((test) => test.isDuplicate),
    ).toEqual([true, true]);
  });

  it("D1003: name paths that join to the same text stay distinct tests", () => {
    expect(
      identifyModuleTests(LOCATION, [
        ["a b", "c"],
        ["a", "b c"],
      ]).map((test) => [test.identity.occurrence, test.isDuplicate]),
    ).toEqual([
      [0, false],
      [0, false],
    ]);
  });

  it("D1004: adding, removing or moving other tests leaves a test's identity unchanged", () => {
    const target = ["suite", "target"];
    expect(
      identityOf([["suite", "moved"], ["removed"], target], target),
    ).toEqual(identityOf([target, ["added"], ["suite", "moved"]], target));
  });

  it("D1005: renaming an enclosing suite gives the test a new identity", () => {
    expect(
      identifyModuleTests(LOCATION, [["before", "test"]])[0]?.identity,
    ).not.toEqual(
      identifyModuleTests(LOCATION, [["after", "test"]])[0]?.identity,
    );
  });
});
