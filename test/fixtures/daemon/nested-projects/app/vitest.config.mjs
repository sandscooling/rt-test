// Declares an inline project and a second container; its env directory reaches every project it declares.
export default {
  envDir: "envs",
  test: {
    name: "app",
    projects: [
      { test: { name: "inline", include: ["inline/*.test.mjs"] } },
      "inner/vitest.config.mjs",
    ],
  },
};
