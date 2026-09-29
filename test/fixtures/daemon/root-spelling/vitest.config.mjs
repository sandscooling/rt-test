// The test starts discovery through a directory link to this folder and names that spelling of it here, with "/"
// separators, as a config that hardcodes the path it was started from would write it.
const started = process.env.RT_STARTED_ROOT;

export default {
  test: {
    projects: [
      {
        test: {
          name: "spelled",
          globals: true,
          include: [`${started}/spelled/**/*.test.mjs`],
        },
      },
      {
        test: {
          name: "source",
          globals: true,
          include: ["none/*.test.mjs"],
          includeSource: [`${started}/source/**/*.mjs`],
        },
      },
    ],
  },
};
