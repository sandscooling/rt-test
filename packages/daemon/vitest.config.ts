import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@rt-test/daemon",
    globalSetup: ["./test/temp-root.ts"],
  },
});
