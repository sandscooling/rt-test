// Copied into a scratch sandbox as that sandbox's config, where no package resolves, so the fixtures use globals.
export default {
  test: {
    include: ["**/*.fixture.ts"],
    globals: true,
    pool: "forks",
  },
};
