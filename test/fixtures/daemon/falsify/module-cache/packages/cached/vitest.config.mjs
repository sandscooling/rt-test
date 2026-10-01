// A project config that sets the on-disk module cache itself, which the session's override does not reach on Vitest 4.1.
export default {
  test: { name: "cached", experimental: { fsModuleCache: true } },
};
