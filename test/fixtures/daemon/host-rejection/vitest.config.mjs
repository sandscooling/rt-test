// RT_HOST_REJECTION names the one host-side site that leaks an unhandled rejection: `config` at load, `plugin` in a
// transform, `global-setup` in the global setup and `teardown` in its teardown. Each leaks synchronously, so Node
// reports it while that step of the session is still running. `config-then-throw` leaks at load, then fails the load.
// `global-setup-and-test-body` leaks in the global setup and in a test body, whose worker reports its own.
const site = process.env.RT_HOST_REJECTION ?? "";

function leak(where) {
  void Promise.reject(new Error(`host rejection from ${where}`));
}

if (site === "config" || site === "config-then-throw") leak("the config");
if (site === "config-then-throw") throw new Error("the config does not load");

export default {
  plugins: [
    {
      name: "leaking-transform",
      transform(_code, id) {
        if (site === "plugin" && id.endsWith("a.test.mjs"))
          leak("a plugin transform");
        return null;
      },
    },
  ],
  test: {
    globals: true,
    pool: "forks",
    globalSetup: ["./global-setup.mjs"],
  },
};
