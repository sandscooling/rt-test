import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Writes a report under coverage/, as a real coverage provider does.
export default {
  getProvider() {
    let options;
    return {
      name: "rt-test-fixture-coverage",
      initialize(ctx) {
        options = {
          ...ctx.config.coverage,
          reportsDirectory: join(ctx.config.root, "coverage"),
        };
      },
      resolveOptions: () => options,
      clean() {
        mkdirSync(options.reportsDirectory, { recursive: true });
      },
      onAfterSuiteRun() {},
      generateCoverage: () => ({}),
      reportCoverage() {
        writeFileSync(join(options.reportsDirectory, "coverage.json"), "{}\n");
      },
    };
  },
  takeCoverage: () => ({}),
};
