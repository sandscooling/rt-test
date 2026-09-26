describe("before fails", () => {
  beforeAll(() => {
    throw new Error("beforeAll boom");
  });
  it("blocked", () => {});
  describe("nested", () => {
    it("blocked deeper", () => {});
  });
});

describe("after fails", () => {
  afterAll(() => {
    throw new Error("afterAll boom");
  });
  it("ran", () => {});
  it("skips itself", (context) => {
    context.skip();
  });
});

describe("each fails", () => {
  beforeEach(() => {
    throw new Error("beforeEach boom");
  });
  it("hooked", () => {});
});
