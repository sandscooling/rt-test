export default {
  test: {
    globals: true,
    pool: "forks",
    globalSetup: ["./global-setup.mjs"],
  },
};
