it("throws later", async () => {
  setTimeout(() => {
    throw new Error("unhandled boom");
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
});

it("sibling", () => {});
