import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      "packages/*",
      { test: { name: "tooling", include: ["test/**/*.test.ts"] } },
    ],
  },
});
