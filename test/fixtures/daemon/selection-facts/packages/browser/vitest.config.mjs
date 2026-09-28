// Vitest 5 fails a browser project that names no provider, so only Vitest 4.1 discovers this workspace.
export default {
  test: {
    projects: [
      { test: { name: "node", globals: true, include: ["node.test.mjs"] } },
      {
        test: {
          name: "web",
          globals: true,
          include: ["web.test.mjs"],
          browser: { enabled: true, instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
};
