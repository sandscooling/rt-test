export default {
  test: {
    projects: [
      { test: { name: "node", globals: true, include: ["node.test.mjs"] } },
      {
        test: {
          name: "br",
          globals: true,
          include: ["br.test.mjs"],
          browser: { enabled: true, instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
};
