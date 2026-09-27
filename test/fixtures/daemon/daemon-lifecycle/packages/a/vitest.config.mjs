// The threads pool keeps every test in the executor process, so ending that process ends them all.
export default {
  test: {
    globals: true,
    pool: "threads",
    maxWorkers: 1,
    fileParallelism: false,
    globalSetup: ["./setup.mjs"],
  },
};
