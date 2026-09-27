// Vitest's default forks pool runs the test in a worker process of its own, so a child the test starts is the
// executor's grandchild.
export default {
  test: {
    globals: true,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    globalSetup: ["./setup.mjs"],
  },
};
