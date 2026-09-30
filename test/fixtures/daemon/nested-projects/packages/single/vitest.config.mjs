import { presentVitest } from "../../present-vitest.mjs";

// Declares no projects, so the config is its one project.
export default {
  plugins: [presentVitest],
  test: { include: ["*.test.mjs"] },
};
