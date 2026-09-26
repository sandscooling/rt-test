const RUN_HOOK = Symbol.for("rt-test.fixture.run-hook");

function notify(event) {
  globalThis[RUN_HOOK]?.(event);
}

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

const runHook = {
  name: "rt-test-run-hook",
  configureVitest({ vitest }) {
    notify("configure");
    vitest.onAfterSetServer(() => {
      vitest.reporters.push({
        onTestRunStart: () => notify("run-start"),
        onTestCaseReady: (testCase) => notify(`ready:${testCase.name}`),
        onTestRunEnd: () => notify("run-end"),
      });
    });
  },
};

export default {
  plugins: [runHook],
  test: {
    globals: true,
    maxWorkers: 1,
    fileParallelism: false,
    globalSetup: ["./global-setup.mjs"],
    sequence: { sequencer: ByModuleId },
  },
};
