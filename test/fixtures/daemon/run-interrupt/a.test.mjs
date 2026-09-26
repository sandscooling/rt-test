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

// Settles only when a cancel aborts it or its timeout fails it, so a slow host cannot let it pass first.
it("running at abort", () => new Promise(() => {}), 10_000);

it("never finishes", () => {});
