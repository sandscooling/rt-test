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

// The host answers the annotation only after its run hook returns, and a cancel posted by that hook reaches this
// worker first. A timeout of 0 sets no deadline, so no timer can end the test before the host acts.
it("running at abort", async ({ annotate }) => {
  await annotate("running");
}, 0);

it("never finishes", () => {});
