const pool = process.env.RT_FIXTURE_POOL ?? "forks";

// Two projects, each resolving its own snapshot environment: Vitest's own, and one this workspace names.
export default {
  test: {
    projects: [
      {
        test: {
          name: "own",
          include: ["own/**/*.test.mjs"],
          globals: true,
          pool,
        },
      },
      {
        test: {
          name: "custom",
          include: ["custom/**/*.test.mjs"],
          globals: true,
          pool,
          snapshotEnvironment: "./custom/custom-environment.mjs",
        },
      },
    ],
  },
};
