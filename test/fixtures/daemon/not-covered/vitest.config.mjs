export default {
  test: {
    globals: true,
    include: [
      "packages/collected/**/*.test.mjs",
      "packages/broken/**/*.test.mjs",
    ],
  },
};
