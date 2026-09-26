import { writeFileSync } from "node:fs";

function mark(name) {
  writeFileSync(new URL(`./ran-${name}`, import.meta.url), "");
}

beforeAll(() => mark("beforeAll"));
beforeEach(() => mark("beforeEach"));

describe("suite", () => {
  it("plain", () => mark("body"));
  it.skip("skipped", () => mark("skipped"));
  it.todo("todo");
  it.each([1, 1, 2])("arm %i", () => mark("each"));
  it.for([3, 4])("for %i", () => mark("for"));
});

describe.each(["x", "y"])("each %s", () => {
  it("inner", () => mark("describe-each"));
});

describe.for(["z"])("dfor %s", () => {
  it("inner", () => mark("describe-for"));
});

describe("group", () => {
  it("same", () => {});
  it("same", () => {});
});

describe("group", () => {
  it("same", () => {});
});
