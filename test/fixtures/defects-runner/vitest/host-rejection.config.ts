// Copied into a scratch sandbox as its config: the global setup runs in the Vitest main process, before any report.
export default {
  test: {
    include: ["**/*.fixture.ts"],
    globals: true,
    pool: "forks",
    globalSetup: ["./host-rejection.setup.ts"],
  },
};
