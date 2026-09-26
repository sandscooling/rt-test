beforeAll(() => {
  throw new Error("beforeAll boom");
});

it("blocked", () => {});
