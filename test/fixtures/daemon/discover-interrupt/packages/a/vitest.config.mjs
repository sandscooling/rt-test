import { writeFileSync } from "node:fs";

writeFileSync(new URL("./loaded", import.meta.url), "");
process.env.RT_FIXTURE_ENV = "interrupted workspace";
process.exitCode = 7;

class ByModuleId {
  async shard(specifications) {
    return specifications;
  }

  async sort(specifications) {
    return [...specifications].sort((a, b) =>
      a.moduleId.localeCompare(b.moduleId),
    );
  }
}

export default {
  test: {
    globals: true,
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { sequencer: ByModuleId },
  },
};
