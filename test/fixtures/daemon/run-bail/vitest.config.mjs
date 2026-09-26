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
    bail: 1,
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { sequencer: ByModuleId },
  },
};
