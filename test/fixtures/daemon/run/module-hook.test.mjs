beforeAll(() => {
  throw new Error("module beforeAll boom");
});

it("blocked by module", () => {});
