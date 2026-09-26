import { createRequire } from "node:module";

// Each setting below writes into the consumer's tree unless RT Test overrides it.
const { version } = createRequire(import.meta.url)("vitest/package.json");
const moduleCacheOn =
  Number.parseInt(version, 10) >= 5
    ? { fsModuleCache: true }
    : { experimental: { fsModuleCache: true } };

export default {
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
