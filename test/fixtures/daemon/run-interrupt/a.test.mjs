it.skip("declared skip", () => {});

it.todo("declared todo");

it("skips itself", (context) => {
  context.skip();
});

describe("blocked", () => {
  beforeAll(() => {
    throw new Error("beforeAll boom");
  });
  it("blocked test", () => {});
});

it("passes first", () => {});

it("running at abort", () =>
  new Promise((resolve) => setTimeout(resolve, 2000)));

it("never finishes", () => {});
