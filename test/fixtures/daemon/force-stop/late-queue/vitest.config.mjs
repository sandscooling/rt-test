export default {
  test: {
    globals: true,
    maxWorkers: 1,
    fileParallelism: false,
    globalSetup: ["./global-setup.mjs"],
  },
};
