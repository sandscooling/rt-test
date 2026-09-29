// With RT_HOST_REJECTION at `global-setup-and-test-body`, the first test's body leaks a rejection in its worker too.
it("first", () => {
  if (process.env.RT_HOST_REJECTION === "global-setup-and-test-body")
    void Promise.reject(new Error("rejection from a test body"));
});

it("second", () => {});
