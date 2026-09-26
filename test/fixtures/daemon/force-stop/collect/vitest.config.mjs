export default {
  test: {
    globals: true,
    maxWorkers: 1,
    fileParallelism: false,
    pool: process.env.RT_FIXTURE_POOL ?? "forks",
  },
};
