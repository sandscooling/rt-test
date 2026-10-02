// Two inline projects of one config: one whose test environment is served through Vite's client environment, as
// jsdom's and happy-dom's are, and one under node with a setup file of its own.
export default {
  test: {
    projects: [
      {
        test: {
          name: "client",
          include: ["client/**/*.test.mjs"],
          environment: "./client/client-environment.mjs",
        },
      },
      {
        test: {
          name: "node",
          include: ["node/**/*.test.mjs"],
          setupFiles: ["./node/node-setup.mjs"],
        },
      },
    ],
  },
};
