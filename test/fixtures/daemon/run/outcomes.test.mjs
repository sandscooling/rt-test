describe("suite", () => {
  it("passes", () => {});
  it("fails", () => {
    throw new Error("fail boom");
  });
  it(
    "times out",
    () => new Promise((resolve) => setTimeout(resolve, 1000)),
    50,
  );
  it.skip("declared skip", () => {});
  it.todo("todo");
  it("skips itself", (context) => {
    context.skip();
  });
  it.fails("expected failure", () => {
    throw new Error("expected boom");
  });
  it("same", () => {});
  it("same", () => {});
});

describe.skip("skipped suite", () => {
  it("inside", () => {});
});
