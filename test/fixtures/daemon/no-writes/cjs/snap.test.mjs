it("file snapshot", () => {
  expect("never stored").toMatchSnapshot();
});

it("file snapshot mismatch", () => {
  expect("actual").toMatchSnapshot();
});

it("inline snapshot", () => {
  expect("never stored").toMatchInlineSnapshot();
});

it("plain", () => {
  expect(1).toBe(1);
});
