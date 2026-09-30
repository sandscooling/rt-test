import { presentVitest } from "../../present-vitest.mjs";

// Projects by path, a config file and a directory, neither of which declares projects of its own.
export default {
  plugins: [presentVitest],
  test: {
    projects: [
      "pkg/vitest.config.mjs",
      "dir/",
      { extends: true, test: { name: "inl", include: ["inl/*.test.mjs"] } },
    ],
  },
};
