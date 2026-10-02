import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: false,
    // A worker of this suite starts daemons, executor processes and Vitest runs of its own, so a quarter of the
    // machine's logical CPUs is left to them; Vitest's default takes all but one.
    maxWorkers: "75%",
    projects: [
      "packages/*",
      {
        test: {
          name: "tooling",
          include: ["test/**/*.test.ts"],
          setupFiles: ["test/scripts/git-environment.ts"],
        },
      },
    ],
  },
});
