// The test writes outside-setup.mjs beside the consumer root before discovery.
export default {
  test: {
    globals: true,
    include: ["*.test.mjs"],
    globalSetup: ["./global.mjs"],
    setupFiles: [
      "./setup.mjs",
      "../../setup/shared-setup.mjs",
      "../../../outside-setup.mjs",
    ],
  },
};
