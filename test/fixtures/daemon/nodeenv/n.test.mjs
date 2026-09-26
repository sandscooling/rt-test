it("always", () => {});

if (process.env.NODE_ENV === "test") {
  it("only under test", () => {});
}
