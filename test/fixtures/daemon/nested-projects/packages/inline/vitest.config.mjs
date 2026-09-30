import { presentVitest } from "../../present-vitest.mjs";

// Only an inline project, which cannot declare projects of its own.
export default {
  plugins: [presentVitest],
  test: {
    projects: [
      { extends: true, test: { name: "one", include: ["*.test.mjs"] } },
    ],
  },
};
