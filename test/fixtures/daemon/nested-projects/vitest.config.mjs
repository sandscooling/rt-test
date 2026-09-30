import { presentVitest } from "./present-vitest.mjs";

// On Vitest 5, app's config is a nested projects container; Vitest 4.1 runs it as one project.
export default {
  plugins: [presentVitest],
  test: {
    projects: [
      "app/vitest.config.mjs",
      { extends: true, test: { name: "top", include: ["top/*.test.mjs"] } },
    ],
  },
};
