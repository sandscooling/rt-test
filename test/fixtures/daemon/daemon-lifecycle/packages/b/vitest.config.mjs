export default {
  test: {
    globals: true,
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
    globalSetup: ["./setup.mjs"],
  },
};
