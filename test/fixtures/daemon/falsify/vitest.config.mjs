const RUN_HOOK = Symbol.for("rt-test.fixture.run-hook");

// Reports each module Vite transforms to the host test, which edits a source file or looks at the temp directory then.
const reportTransforms = {
  name: "rt-test-report-transforms",
  transform(_code, id) {
    globalThis[RUN_HOOK]?.(`transform:${id}`);
  },
};

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

// Every setting here that would let one run differ from another is one a falsification job overrides: one worker
// reused across test files, and a run cancelled at its first failure.
export default {
  plugins: [reportTransforms],
  test: {
    isolate: false,
    bail: 1,
    fileParallelism: false,
    sequence: { sequencer: ByModuleId },
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["test/**/*.test.mjs"] },
      },
      "packages/lib",
    ],
  },
};
