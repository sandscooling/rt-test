import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "rt-test",
    globalSetup: ["../daemon/test/temp-root.ts"],
  },
});
