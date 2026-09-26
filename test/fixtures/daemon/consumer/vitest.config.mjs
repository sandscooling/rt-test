export default {
  test: {
    projects: [
      { test: { name: "unit", globals: true, include: ["unit/*.test.mjs"] } },
      {
        test: {
          name: "again",
          globals: true,
          include: ["unit/shared.test.mjs"],
        },
      },
      {
        test: {
          name: "types",
          globals: true,
          include: [],
          typecheck: { enabled: true, include: ["types/*.test-d.mts"] },
        },
      },
    ],
  },
};
