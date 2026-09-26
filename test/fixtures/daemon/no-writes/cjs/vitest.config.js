// Each setting below writes into the consumer's tree unless RT Test overrides it.
const { version } = require("vitest/package.json");
const moduleCacheOn =
  Number.parseInt(version, 10) >= 5
    ? { fsModuleCache: true }
    : { experimental: { fsModuleCache: true } };

module.exports = {
  test: {
    globals: true,
    update: true,
    coverage: {
      enabled: true,
      provider: "custom",
      customProviderModule: "./coverage-provider.mjs",
    },
    ...moduleCacheOn,
  },
};
